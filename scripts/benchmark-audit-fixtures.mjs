// Runs real pre-change/current service functions with in-memory model fixtures.
// No database, credentials, network requests or financial writes.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { inventoryValue } from "../src/lib/inventory-value.js";
import { getBatchExpirySummary } from "../src/lib/batch-expiry.js";
import { calculatePhysicalStock, formatPhysicalStock, getLooseUnit, isCountBasedProduct, isLowStock } from "../src/services/inventory.service.js";

const query = rows => ({ populate() { return this; }, sort() { return this; }, select() { return this; }, lean: async () => rows });
const original = path => execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" });
const compile = (source, name, deps) => new Function(...Object.keys(deps), `${source}; return ${name};`)(...Object.values(deps));
const product = { _id: "p", name: "Fixture", baseUnit: "ml", packageType: "Bottle", packageSize: 100, packageSellingPrice: 10, reorderLevel: 1 };
const batches = Array.from({ length: 10000 }, (_, i) => ({ _id: String(i), productId: "p", packageSize: 100, sealedPackages: 1, openQuantity: 0, purchasePrice: 5 }));
const productDeps = { Product: { find: () => query([product]) }, InventoryBatch: { find: () => query(batches) }, inventoryValue, getBatchExpirySummary, calculatePhysicalStock, formatPhysicalStock, getLooseUnit, isCountBasedProduct, isLowStock,
  daysFromNow: date => date ? Math.ceil((new Date(date).getTime() - Date.now()) / 86400000) : null };
const products = Array.from({ length: 5000 }, (_, i) => ({ ...product, _id: String(i), name: `Fixture ${i}` }));
const datedBatches = Array.from({ length: 10000 }, (_, i) => ({ ...batches[i], productId: String(i % products.length), expiryDate: new Date(Date.now() + 10 * 86400000).toISOString() }));
const notificationDeps = { Product: { find: () => query(products) }, InventoryBatch: { find: () => query(datedBatches) }, Purchase: {},
  getSettings: async () => ({ notifications: { lowStock: false, expiry: true, expired: true, purchaseDue: false }, batchExpiry: { firstWarningDays: 90, criticalWarningDays: 7 } }),
  calculatePhysicalStock, formatPhysicalStock, isLowStock, purchaseDueNotificationId: () => "unused" };
const result = { fixture: true, cycles: 5, node: process.version, getProducts: { batches: batches.length, samples: [] }, notifications: { products: products.length, batches: datedBatches.length, samples: [] } };
for (const [key, path, name, deps] of [
  ["getProducts", "src/services/product.service.js", "getProducts", productDeps],
  ["notifications", "src/services/notification.service.js", "getNotifications", notificationDeps],
]) {
  const functions = {};
  for (const [label, source] of [["before", original(path)], ["after", await readFile(path, "utf8")]]) {
    let code = source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "");
    if (name === "getProducts") code = code.slice(code.indexOf("async function getProducts("), code.indexOf("async function getProductDetails("));
    functions[label] = compile(code, name, deps);
  }
  const normalized = output => name === "getNotifications" ? { count: output.count, items: output.items } : output;
  assert.deepEqual(normalized(await functions.before({ role: "ADMIN" })), normalized(await functions.after({ role: "ADMIN" })));
  for (let cycle = 0; cycle < 5; cycle++) {
    const sample = {};
    for (const label of cycle % 2 ? ["after", "before"] : ["before", "after"]) {
      const start = performance.now();
      await functions[label]({ role: "ADMIN" });
      sample[`${label}Ms`] = performance.now() - start;
    }
    result[key].samples.push(sample);
  }
  const median = field => result[key].samples.map(s => s[field]).sort((a, b) => a - b)[2];
  result[key].beforeMedianMs = median("beforeMs");
  result[key].afterMedianMs = median("afterMs");
  result[key].outputsEqual = true;
}
await writeFile("docs/audits/2026-10-16/fixture-benchmarks.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
