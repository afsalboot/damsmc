import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boundedInteger, searchText, literalPattern } from "../src/lib/query-input.js";

test("database limits are positive bounded integers for adversarial URL inputs", () => {
  for (const value of ["NaN", "Infinity", "-Infinity", "wat", null, undefined, ""]) assert.equal(boundedInteger(value, 20, 5, 50), 20);
  assert.equal(boundedInteger("-1000000", 20, 5, 50), 5);
  assert.equal(boundedInteger("0", 20, 5, 50), 5);
  assert.equal(boundedInteger("9999999999", 20, 5, 50), 50);
  assert.equal(boundedInteger("12.7", 20, 5, 50), 12);
});

test("search metacharacters are literal and excessive queries are rejected", () => {
  for (const text of ["Oil (100ml)", "a+b", "[", "a.*", "(a+)+$", "a\\b", "^$?{}|"]) {
    const pattern = new RegExp(literalPattern(text));
    assert.equal(pattern.test(text), true, text);
    assert.equal(pattern.test(`unrelated product`), false, text);
  }
  assert.equal(searchText("  oil  "), "oil");
  assert.throws(() => searchText("a".repeat(101)), error => error.status === 400);
});

function searchHarness(role) {
  const calls = [];
  const model = { find(filter) { calls.push(filter); return { select() { return this; }, limit() { return this; }, lean: async () => [] }; } };
  const dependencies = {
    URL, searchText, literalPattern,
    requireSession: async permission => { if (permission !== "ADMIN" || role !== "ADMIN") throw Error("FORBIDDEN"); },
    connectDb: async () => {}, ok: data => Response.json({ data }),
    apiError: error => Response.json({ error: error.message }, { status: error.status || 403 }),
    Product: model, Sale: model, Customer: model, Supplier: model, Purchase: model,
  };
  const source = readFileSync(new URL("../src/app/api/search/route.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export async function GET", "async function GET");
  const handler = new Function(...Object.keys(dependencies), `${source}; return GET;`)(...Object.values(dependencies));
  return { calls, get: query => handler(new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`)) };
}

test("global search rechecks current admin authorization before any resource query", async () => {
  // A previously issued ADMIN JWT must not substitute for the current DB role.
  const staff = searchHarness("STAFF");
  assert.equal((await staff.get("oil")).status, 403);
  assert.equal(staff.calls.length, 0);
  const owner = searchHarness("ADMIN");
  assert.equal((await owner.get("oil")).status, 200);
  assert.equal(owner.calls.length, 5);
  assert.equal((await owner.get("a".repeat(101))).status, 400);
  assert.equal(owner.calls.length, 5);
});

test("product endpoint treats attack patterns literally and rejects oversized queries before fetching", async () => {
  const filters = [];
  const deps = { URL, searchText, literalPattern, requireSession: async () => {}, connectDb: async () => {},
    getProducts: async filter => { filters.push(filter); return []; }, ok: data => Response.json({ data }),
    apiError: error => Response.json({ error: error.message }, { status: error.status || 500 }) };
  let source = readFileSync(new URL("../src/app/api/products/route.js", import.meta.url), "utf8");
  source = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST")).replace("export ", "");
  const get = new Function(...Object.keys(deps), `${source};return GET;`)(...Object.values(deps));
  assert.equal((await get(new Request("http://localhost/api/products?q=%28a%2B%29%2B%24&sales=true"))).status, 200);
  assert.equal(filters[0].$or[0].name.$regex, literalPattern("(a+)+$"));
  assert.equal(filters[0].active, true);
  assert.equal((await get(new Request(`http://localhost/api/products?q=${"x".repeat(101)}`))).status, 400);
  assert.equal(filters.length, 1);
});

test("recent sales handler bounds malformed pagination and fails closed for invalid customer IDs", async () => {
  const seen = [];
  const chain = { populate() { return this; }, sort() { return this; }, skip(n) { seen.push({ skip: n }); return this; }, limit(n) { seen.push({ limit: n }); return this; }, lean: async () => [] };
  const deps = { URL, boundedInteger, searchText, amount: Number, escapeRegex: literalPattern, saleForActor: sale => sale,
    mongoose: { isValidObjectId: value => /^[a-f\d]{24}$/.test(value || ""), Types: { ObjectId: class { constructor(value) { this.id = value; } } } },
    requireSession: async () => ({ role: "ADMIN" }), connectDb: async () => {},
    Sale: { find: () => chain, countDocuments: async () => 0, aggregate: async () => [] },
    ok: data => Response.json({ data }), fail: (error, status) => Response.json({ error }, { status }), apiError: error => Response.json({ error: error.message }, { status: error.status || 500 }) };
  let source = readFileSync(new URL("../src/app/api/sales/route.js", import.meta.url), "utf8");
  source = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST")).replace("export ", "");
  const get = new Function(...Object.keys(deps), `${source}; return GET;`)(...Object.values(deps));
  const response = await get(new Request("http://localhost/api/sales?view=recent&page=NaN&limit=NaN"));
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{ skip: 0 }, { limit: 20 }]);
  assert.equal((await get(new Request("http://localhost/api/sales?customerId=bad"))).status, 400);
  assert.equal((await get(new Request("http://localhost/api/sales?view=recent&dateFrom=invalid"))).status, 400);
  assert.equal(seen.length, 2);
});
