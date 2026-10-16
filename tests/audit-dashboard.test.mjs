import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dashboardRange, dashboardChartWindows } from "../src/lib/dashboard-dates.js";
import { dashboardStock, dashboardWholesale } from "../src/lib/dashboard-summary.js";
import { inventoryValue } from "../src/lib/inventory-value.js";
import { getLooseUnit } from "../src/services/inventory.service.js";

test("dashboard counts received purchases using the persisted purchaseStatus field", async () => {
  const query = data => ({ populate() { return this; }, lean: async () => data });
  const purchase = { _id: "fixture", purchaseStatus: "RECEIVED", purchasedAt: new Date("2026-10-16T06:00:00Z"), total: 125 };
  const product = { _id: "p", baseUnit: "ml", packageType: "Bottle", packageSize: 100, packageSellingPrice: 20, reorderLevel: 1 };
  const batch = { productId: { ...product }, packageSize: 100, sealedPackages: 1, openQuantity: 0, purchasePrice: 10 };
  let batchFilter;
  const deps = { dashboardRange: (range, from, to) => dashboardRange(range, from, to, new Date("2026-10-16T07:00:00Z")), dashboardChartWindows,
    dashboardStock, dashboardWholesale, valueInventory: inventoryValue, getLooseUnit,
    getSettings: async () => ({ features: {}, store: {} }),
    Sale: { find: () => query([]) }, Expense: { find: () => query([]) },
    Purchase: { find: filter => query(filter.purchaseStatus === "RECEIVED" ? [purchase] : []) },
    Product: { find: () => query([product]) }, InventoryBatch: { find: filter => { batchFilter = filter; return query([batch]); } },
    Customer: { countDocuments: async () => 0 }, Supplier: { countDocuments: async () => 0 }, User: { countDocuments: async () => 0 },
  };
  const source = readFileSync(new URL("../src/lib/server/dashboard-data.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace("export async function", "async function");
  const getData = new Function(...Object.keys(deps), `${source}; return getDashboardData;`)(...Object.values(deps));
  const data = await getData();
  assert.equal(data.purchases.count, 1);
  assert.equal(data.purchases.total, 125);
  assert.equal(data.inventory.value, 10);
  assert.deepEqual(batchFilter, { $or: [{ sealedPackages: { $gt: 0 } }, { openQuantity: { $gt: 0 } }] });
});

test("discarding exhausted historical batches preserves dashboard inventory and low-stock summaries", () => {
  const products = [{ _id: "p", packageSize: 100, baseUnit: "ml", packageType: "Bottle", reorderLevel: 2 }];
  const positive = { productId: "p", packageSize: 100, sealedPackages: 1, openQuantity: 10 };
  const exhausted = { productId: "p", packageSize: 100, sealedPackages: 0, openQuantity: 0 };
  const before = dashboardStock(products, [positive, exhausted]), after = dashboardStock(products, [positive]);
  assert.deepEqual(before.groups, after.groups);
  assert.deepEqual(before.lowStock, after.lowStock);
});
