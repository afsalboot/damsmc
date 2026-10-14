import test from "node:test";
import assert from "node:assert/strict";
import { SalesCache } from "../src/lib/sales-cache.js";
import { indexRow } from "../src/lib/sales-index.js";
import { nativeSalesStorage } from "../src/lib/sales-cache-storage.js";
import { IDBFactory } from "fake-indexeddb";

const first = "aaaaaaaaaaaaaaaaaaaaaaaa", second = "bbbbbbbbbbbbbbbbbbbbbbbb";
const product = (id = first, changes = {}) => ({ _id: id, name: id === first ? "Oil" : "Tablet", sku: id === first ? "OIL" : "TAB", barcode: "00123", manufacturer: "Factory", categoryId: { name: "Medicine" }, updatedAt: "2026-10-14", stock: { hasStock: true, sealedPackages: 4 }, ...changes });
function fixture(options = {}) {
  let now = 1000000;
  let products = [product(), product(second, { barcode: "00456" })];
  const calls = [];
  const storage = nativeSalesStorage(new IDBFactory());
  const fetcher = async (path, init) => {
    calls.push({ path, init });
    const url = new URL(path, "http://localhost");
    const params = url.searchParams;
    const scope = options.scope || "account-a";
    let data;
    if (params.has("membership")) data = [first];
    else if (params.has("ids")) data = products.filter(p => params.get("ids").split(",").includes(p._id)).map(p => params.has("details") ? p : indexRow(p));
    else if (path.includes("/barcode/")) data = products.find(p => p.barcode === decodeURIComponent(url.pathname.split("/").at(-1)));
    else if (init?.headers?.["If-None-Match"] === '"v1"') return new Response(null, { status: 304, headers: { "X-POS-Cache-Scope": scope, ETag: '"v1"' } });
    else data = products.map(indexRow);
    return Response.json({ data }, { status: data ? 200 : 404, headers: { "X-POS-Cache-Scope": scope, ETag: '"v1"' } });
  };
  const cache = new SalesCache({ fetcher, storage, now: () => now, ...options });
  cache.switchScope({ scope: options.scope || "account-a", persistent: true });
  return { cache, calls, storage, fetcher, advance: milliseconds => { now += milliseconds; }, setProducts: value => { products = value; } };
}
test("cold concurrent loads coalesce; cached search, clearing and navigation make no requests", async () => {
  const { cache, calls } = fixture();
  await Promise.all([cache.ensure(), cache.ensure(), cache.ensure()]);
  assert.equal(calls.length, 1);
  assert.equal(cache.search("factory").length, 2);
  assert.equal(cache.search("Medicine").length, 2);
  assert.equal(cache.search("").length, 2);
  await cache.ensure(); assert.equal(calls.length, 1);
});
test("fresh exact barcode hits preserve leading zeros and repeat scan details use zero requests", async () => {
  const { cache, calls } = fixture(); await cache.ensure(); await cache.sellingDetails([first]);
  calls.length = 0;
  assert.equal((await cache.barcode("00123"))._id, first);
  assert.equal((await cache.barcode("00123"))._id, first);
  assert.equal(cache.barcodes.get("123"), undefined);
  assert.equal(calls.length, 0);
});
test("barcode misses use one exact endpoint and the repeat scan reuses its validated detail", async () => {
  const f = fixture(); await f.cache.ensure(); f.setProducts([product(), product(second, { barcode: "00099" })]);
  const before = f.calls.length; assert.equal((await f.cache.barcode("00099"))._id, second);
  await f.cache.barcode("00099"); assert.equal(f.calls.length - before, 1);
});
test("unknown barcode does not clear a valid account cache", async () => {
  const { cache } = fixture(); await cache.ensure(); await assert.rejects(cache.barcode("999"));
  assert.equal(cache.scope, "account-a"); assert.equal(cache.state.rows.length, 2);
});
test("barcode index insertion projects metadata and does not retain full selling fields in index rows", async () => {
  const f = fixture(); await f.cache.ensure();
  f.setProducts([product(second, { barcode: "00099", priceTiers: [{ quantity: 1, price: 2 }], batches: [{ privateHistory: true }] })]);
  await f.cache.barcode("00099"); const row = f.cache.byId.get(second);
  assert.equal(row.batches, undefined); assert.equal(row.stock, undefined); assert.equal(row.priceTiers, undefined);
  assert.ok(f.cache.freshDetail(second).stock);
});
test("full refresh retains unchanged details across Date and JSON timestamp representations", async () => {
  const f = fixture(); f.setProducts([product(first, { updatedAt: new Date("2026-10-14") })]);
  await f.cache.ensure(); await f.cache.sellingDetails([first]); const detail = f.cache.freshDetail(first);
  await f.cache.refresh(true); assert.equal(f.cache.freshDetail(first), detail);
  f.setProducts([product(first, { name: "Restored Name", updatedAt: new Date("2026-10-14") })]);
  await f.cache.refresh(true); assert.equal(f.cache.freshDetail(first), null);
});
test("native IndexedDB restores complete rows and bounded details without a fetch", async () => {
  const f = fixture(); await f.cache.ensure(); await f.cache.sellingDetails([first]); await f.cache.writes;
  const restored = new SalesCache({ storage: f.storage, fetcher: () => { throw Error("network should not run"); }, now: () => 1000000 });
  restored.switchScope({ scope: "account-a", persistent: true }); await restored.ensure();
  assert.equal(restored.state.rows.length, 2); assert.equal(restored.freshDetail(first).stock.sealedPackages, 4);
});
test("IndexedDB failure retains a functional memory cache", async () => {
  const f = fixture({ storage: { read: async () => { throw Error("blocked"); }, replace: async () => { throw Error("full"); } } });
  await f.cache.ensure(); await f.cache.writes; assert.equal(f.cache.search("oil").length, 1);
});
test("stock membership is cached independently and all keystrokes search locally", async () => {
  const { cache, calls } = fixture(); await cache.ensure(); const membership = await cache.membership("Low Stock");
  const count = calls.length; await cache.membership("Low Stock");
  for (const query of ["", "o", "oi", "oil"]) assert.equal(cache.search(query, { filter: "Low Stock", membership }).length, 1);
  assert.equal(calls.length, count);
});
test("targeted metadata changes remove stale reverse maps, create rows and delete invisible products", async () => {
  const f = fixture(); await f.cache.ensure(); f.setProducts([product(first, { barcode: "00999", sku: "NEW" }), product(second, { barcode: "00456" })]);
  await f.cache.invalidate({ ids: [first], metadata: true }); assert.equal(f.cache.barcodes.has("00123"), false); assert.equal(f.cache.barcodes.get("00999"), first); assert.equal(f.cache.skus.get("new"), first);
  const third = "cccccccccccccccccccccccc"; f.setProducts([product(first), product(third, { barcode: "00333" })]);
  await f.cache.invalidate({ ids: [second, third], metadata: true }); assert.equal(f.cache.byId.has(second), false); assert.equal(f.cache.byId.has(third), true);
});
test("committed stock refresh replaces only affected selling details and keeps the metadata index", async () => {
  const f = fixture(); await f.cache.ensure(); await f.cache.sellingDetails([first, second]);
  const oldSecond = f.cache.freshDetail(second); f.setProducts([product(first, { stock: { hasStock: true, sealedPackages: 1 } }), product(second, { barcode: "00456" })]);
  const before = f.calls.length; await f.cache.invalidate({ ids: [first] });
  assert.equal(f.cache.freshDetail(first).stock.sealedPackages, 1); assert.equal(f.cache.freshDetail(second), oldSecond);
  assert.equal(f.calls.length - before, 1); assert.match(f.calls.at(-1).path, /details=true/);
  await f.cache.writes; assert.equal((await f.storage.read("account-a")).details.find(e => e.product._id === first).product.stock.sealedPackages, 1);
});
test("switching accounts and logout purge the former scope and private memory", async () => {
  const f = fixture(); await f.cache.ensure(); await f.cache.writes;
  f.cache.switchScope({ scope: "account-b", persistent: true }); assert.equal(f.cache.state.rows.length, 0);
  await f.cache.writes; assert.equal(await f.storage.read("account-a"), null);
  f.cache.clear(); assert.equal(f.cache.scope, null);
});
test("late success and denial from an earlier account cannot overwrite or clear the new account", async () => {
  for (const status of [200, 401, 403]) {
    let resolve;
    const cache = new SalesCache({ fetcher: () => new Promise(r => { resolve = r; }), storage: { read: async () => null, purge: async () => {} } });
    cache.switchScope({ scope: "old" }); const pending = cache.refresh(); await Promise.resolve();
    cache.switchScope({ scope: "new" });
    resolve(Response.json({ data: [indexRow(product())] }, { status, headers: { "X-POS-Cache-Scope": "old" } }));
    await assert.rejects(pending); assert.equal(cache.scope, "new"); assert.equal(cache.state.rows.length, 0);
  }
});
test("late IndexedDB restore is discarded after a scope switch", async () => {
  let resolve; const cache = new SalesCache({ storage: { read: () => new Promise(r => { resolve = r; }), purge: async () => {} } });
  cache.switchScope({ scope: "old", persistent: true }); const pending = cache.ensure(); await Promise.resolve();
  cache.switchScope({ scope: "new", persistent: true }); resolve({ rows: [indexRow(product())], fullFetchedAt: Date.now() }); await pending;
  assert.equal(cache.scope, "new"); assert.equal(cache.state.rows.length, 0);
});
test("a missing or mismatched response scope rejects private records", async () => {
  for (const headers of [{}, { "X-POS-Cache-Scope": "other" }]) {
    const cache = new SalesCache({ fetcher: async () => Response.json({ data: [indexRow(product())] }, { headers }) });
    cache.switchScope({ scope: "me" }); await assert.rejects(cache.refresh()); assert.equal(cache.state.rows.length, 0);
  }
});
test("304 validation retains the grid and does not extend maximum unconditional full-fetch age", async () => {
  const f = fixture(); await f.cache.ensure(); const fullAt = f.cache.fullFetchedAt;
  f.advance(300000); await f.cache.refresh(); assert.equal(f.cache.fullFetchedAt, fullAt); assert.equal(f.cache.state.rows.length, 2);
  f.advance(600001); await f.cache.refresh(); assert.equal(f.calls.at(-1).init.headers["If-None-Match"], undefined); assert.ok(f.cache.fullFetchedAt > fullAt);
});
test("atomic persistent replacement removes orphan rows and rejects incompatible records", async () => {
  const storage = nativeSalesStorage(new IDBFactory());
  const snapshot = { rows: [indexRow(product()), indexRow(product(second))], details: [], memberships: [], fullFetchedAt: Date.now(), validatedAt: Date.now() };
  await storage.replace("a", snapshot); await storage.replace("a", { ...snapshot, rows: [snapshot.rows[0]] });
  assert.equal((await storage.read("a")).rows.length, 1);
  await storage.patch("a", { remove: [first] }); assert.equal(await storage.read("a"), null);
});
test("details are bounded and the initial page remains protected", async () => {
  const f = fixture({ policy: { maxDetails: 55 } });
  const products = Array.from({ length: 100 }, (_, i) => product(i.toString(16).padStart(24, "0"), { barcode: String(i) }));
  f.setProducts(products); await f.cache.ensure();
  await f.cache.sellingDetails(products.slice(0, 50).map(p => p._id)); await f.cache.sellingDetails(products.slice(50, 70).map(p => p._id));
  assert.equal(f.cache.details.size, 55); products.slice(0, 20).forEach(p => assert.ok(f.cache.details.has(p._id)));
});
test("an older same-scope detail response cannot replace post-mutation stock", async () => {
  const f = fixture(); await f.cache.ensure(); let resolve;
  const original = f.cache.fetcher;
  f.cache.fetcher = () => new Promise(r => { resolve = r; }); const old = f.cache.sellingDetails([first]); await Promise.resolve();
  f.cache.fetcher = original; f.setProducts([product(first, { stock: { sealedPackages: 1 } })]);
  await f.cache.invalidate({ ids: [first] });
  resolve(Response.json({ data: [product()] }, { headers: { "X-POS-Cache-Scope": "account-a" } }));
  await assert.rejects(old); assert.equal(f.cache.details.get(first).product.stock.sealedPackages, 1);
});
