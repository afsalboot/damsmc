import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../src/components/SalesCheckoutHostV2.jsx", import.meta.url), "utf8");
function handler(performComplete) {
  const transitions = [], errors = [], submittingRef = { current: false };
  const body = source.slice(source.indexOf("  async function complete("), source.indexOf("  async function performComplete("));
  return { complete: vm.runInNewContext(`${body}\ncomplete`, { performComplete, submittingRef, setSaving: value => transitions.push(value), toast: { error: value => errors.push(value) } }), transitions, errors, submittingRef };
}
test("two same-turn submits cannot both enter customer lookup or payment submission", async () => {
  let resolve, calls = 0;
  const h = handler(() => { calls++; return new Promise(r => { resolve = r; }); });
  const event = { preventDefault() {} };
  const first = h.complete(event); await h.complete(event); assert.equal(calls, 1); assert.equal(h.submittingRef.current, true);
  resolve(); await first; assert.deepEqual(h.transitions, [true, false]); assert.equal(h.submittingRef.current, false);
});
test("a customer lookup failure unlocks checkout and is surfaced without an unhandled rejection", async () => {
  const h = handler(async () => { throw Error("Customer lookup failed"); });
  await h.complete(null); await h.complete(null);
  assert.deepEqual(h.errors, ["Customer lookup failed", "Customer lookup failed"]); assert.equal(h.submittingRef.current, false);
});
test("direct checkout uses the same synchronous submit lock", async () => {
  let resolve; const calls = [];
  const h = handler((event, direct) => { calls.push({ event, direct }); return new Promise(r => { resolve = r; }); });
  const first = h.complete(null, true); await h.complete(null, true); assert.equal(calls.length, 1); assert.equal(calls[0].direct, true);
  resolve(); await first;
});
