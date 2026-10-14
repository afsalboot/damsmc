import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { INDEX_FIELDS, indexRow } from "../src/lib/sales-index.js";
import { calculatePhysicalStock, isLowStock } from "../src/services/inventory.service.js";
const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
function harness() {
  const calls = [];
  let actor = { role: "ADMIN", permissions: [] };
  const rows = [{ _id: id, name: "Oil", categoryId: { name: "Medicine" }, sku: "OIL", packageSize: 100, reorderLevel: 1, updatedAt: "2026-10-14" }];
  const Product = { find: filter => {
    calls.push({ type: "find", filter });
    return { select(fields) { calls.push({ type: "projection", fields }); return this; }, populate(path, fields) { calls.push({ type: "populate", path, fields }); return this; }, sort(order) { calls.push({ type: "sort", order }); return this; }, lean: async () => rows };
  } };
  const InventoryBatch = { aggregate: async pipeline => { calls.push({ type: "aggregate", pipeline }); return [{ _id: id, sealedPackages: 1, openQuantity: 50, sealedBase: 50 }]; } };
  const source = readFileSync(new URL("../src/app/api/products/sales-index/route.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace("export async function GET", "async function GET") + "\nGET";
  const GET = vm.runInNewContext(source, { createHash, Product, InventoryBatch, INDEX_FIELDS, indexRow, calculatePhysicalStock, isLowStock, performance, URL, Response,
    requireSession: async permission => { calls.push({ type: "auth", permission }); if (!actor) throw Error("UNAUTHORIZED"); return actor; },
    salesCacheScope: async () => ({ scope: "authenticated-store-user", persistent: true }),
    getProducts: async filter => { calls.push({ type: "details", filter }); return rows; },
    apiError: error => Response.json({ error: error.message }, { status: error.message === "UNAUTHORIZED" ? 401 : 403 }),
  });
  return { calls, rows, setActor: value => { actor = value; }, get: (path = "", headers = {}) => GET(new Request(`http://localhost/api/products/sales-index${path}`, { headers })) };
}
test("the lightweight index uses projected lean metadata and no batch reads", async () => {
  const h = harness(); const response = await h.get(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.data.length, 1);
  assert.equal(response.headers.get("X-POS-Cache-Scope"), "authenticated-store-user");
  assert.equal(h.calls.find(c => c.type === "projection").fields, INDEX_FIELDS);
  assert.equal(h.calls.some(c => ["details", "aggregate"].includes(c.type)), false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c => c.type === "find").filter)), { active: true, visibleInSales: { $ne: false } });
});
test("unchanged responses authenticate first and never return private rows to denied users", async () => {
  const h = harness(); const first = await h.get(); const etag = first.headers.get("etag");
  const unchanged = await h.get("", { "If-None-Match": etag }); assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), "");
  h.setActor(null); const denied = await h.get("", { "If-None-Match": etag }); assert.equal(denied.status, 401);
  h.setActor({ role: "STAFF", permissions: ["products.view"] }); assert.equal((await h.get()).status, 403);
});
test("detail queries are bounded, use selected IDs and avoid catalogue stock membership aggregation", async () => {
  const h = harness(); const response = await h.get(`?details=true&ids=${id}`); assert.equal(response.status, 200);
  assert.equal(h.calls.filter(c => c.type === "details").length, 1); assert.equal(h.calls.some(c => c.type === "aggregate"), false);
  assert.equal((await h.get("?details=true&ids=invalid")).status, 400);
  assert.equal((await h.get(`?details=true&ids=${Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(24, "0")).join(",")}`)).status, 400);
});
test("compact stock membership preserves physical quantities when historical batch size differs", async () => {
  const h = harness(); h.rows[0].reorderLevel = 1.5;
  const response = await h.get("?membership=Low%20Stock");
  assert.deepEqual((await response.json()).data, [id]);
  assert.equal(h.calls.some(c => c.type === "details"), false);
  assert.ok(h.calls.find(c => c.type === "aggregate").pipeline[1].$group.sealedBase);
});
test("ETags change on actual metadata changes even when timestamps were preserved", async () => {
  const h = harness(); const before = (await h.get()).headers.get("etag");
  h.rows[0].name = "Restored Product";
  assert.notEqual((await h.get("", { "If-None-Match": before })).headers.get("etag"), before);
});
