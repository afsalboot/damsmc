import test from "node:test";
import assert from "node:assert/strict";
import { observeSalesWrites } from "../src/lib/sales-cache-invalidation.js";
import { importProductsWithProgress } from "../src/lib/product-import-progress.js";
const id = "aaaaaaaaaaaaaaaaaaaaaaaa", other = "bbbbbbbbbbbbbbbbbbbbbbbb";
function setup(fetcher = async () => Response.json({ data: { affectedProductIds: [id] } })) {
  const events = new EventTarget(); const updates = [];
  const cache = { scope: "a", scopeEpoch: 1, generation: 1,
    invalidate: async value => { updates.push(value); cache.generation++; },
    clear: () => { cache.scope = null; cache.scopeEpoch++; } };
  const win = { fetch: fetcher, location: { origin: "http://localhost" }, setTimeout, clearTimeout,
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args), dispatchEvent: event => events.dispatchEvent(event) };
  const stop = observeSalesWrites({ cache, windowObject: win, Channel: null });
  return { cache, win, updates, stop };
}
const drain = () => new Promise(resolve => setTimeout(resolve, 15));
test("successful stock writes refresh authoritative IDs without waiting for cache completion", async () => {
  const f = setup(); const response = await f.win.fetch("/api/sales", { method: "POST" });
  assert.equal(response.ok, true); await drain(); assert.deepEqual(f.updates, [{ ids: [id], metadata: false }]); f.stop();
});
test("failed checkout does not invalidate or change correct cached stock", async () => {
  const f = setup(async () => Response.json({ error: "Insufficient stock" }, { status: 422 }));
  await f.win.fetch("/api/sales", { method: "POST" }); await drain(); assert.equal(f.updates.length, 0); assert.equal(f.cache.scope, "a"); f.stop();
});
test("concurrent committed mutations remain valid after another stock refresh", async () => {
  let resolve;
  const f = setup(async path => path.endsWith("slow") ? new Promise(r => { resolve = r; }) : Response.json({ data: { affectedProductIds: [id] } }));
  const slow = f.win.fetch("/api/sales/slow", { method: "POST" });
  await f.win.fetch("/api/sales", { method: "POST" }); await drain();
  resolve(Response.json({ data: { affectedProductIds: [other] } })); await slow; await drain();
  assert.ok(f.updates.some(update => update.ids.includes(other))); f.stop();
});
test("late successful mutations and denials cannot invalidate a newer account", async () => {
  for (const status of [200, 401, 403]) {
    let resolve; const f = setup(() => new Promise(r => { resolve = r; }));
    const pending = f.win.fetch("/api/sales", { method: "POST" }); f.cache.scope = "b"; f.cache.scopeEpoch++;
    resolve(Response.json({ data: { affectedProductIds: [id] } }, { status })); await pending; await drain();
    assert.equal(f.cache.scope, "b"); assert.equal(f.updates.length, 0); f.stop();
  }
});
test("logout purges the current account and does not broadcast private records", async () => {
  const f = setup(); await f.win.fetch("/api/auth/logout", { method: "POST" }); assert.equal(f.cache.scope, null); f.stop();
});
test("a product deletion reads IDs from its route and changes metadata", async () => {
  const f = setup(async () => Response.json({ data: { success: true } }));
  await f.win.fetch(`/api/products?id=${id}`, { method: "DELETE" }); await drain();
  assert.deepEqual(f.updates, [{ ids: [id], metadata: true }]); f.stop();
});
test("imports coalesce until the final batch and interrupted batches refresh committed data", async () => {
  for (const interrupt of [false, true]) {
    let count = 0;
    const f = setup(async () => { if (interrupt && ++count === 2) throw Error("connection lost"); return Response.json({ data: { imported: 10, skipped: 0, failed: 0, results: [] } }); });
    const previousWindow = globalThis.window; globalThis.window = f.win;
    try {
      await importProductsWithProgress(Array.from({ length: 25 }, () => ({})), async () => {
        const response = await f.win.fetch("/api/products/import", { method: "POST" });
        const data = (await response.json()).data; await drain(); assert.equal(f.updates.length, 0); return data;
      }, () => {});
      await drain(); assert.deepEqual(f.updates, [{ ids: [], metadata: true }]);
    } finally { globalThis.window = previousWindow; f.stop(); }
  }
});
test("readonly requests and generated unused barcodes do not invalidate the catalogue", async () => {
  const f = setup(); await f.win.fetch("/api/products"); await f.win.fetch("/api/products/barcode/generate", { method: "POST" }); await drain(); assert.equal(f.updates.length, 0); f.stop();
});
test("cross-tab notifications contain only scope and mutation IDs", async () => {
  const messages = [];
  class Channel { postMessage(value) { messages.push(value); } close() {} }
  const f = setup(); f.stop(); const stop = observeSalesWrites({ cache: f.cache, windowObject: f.win, Channel });
  await f.win.fetch("/api/sales", { method: "POST" }); await drain();
  assert.deepEqual(messages, [{ scope: "a", ids: [id], metadata: false }]); stop();
});
