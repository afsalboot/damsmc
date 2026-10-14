import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/lib/server/sales-cache-scope.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "").replace("export async function", "async function") + "\nsalesCacheScope";
async function scope({ store = "store-id", database = "configured-database-a", ...changes } = {}) {
  const get = vm.runInNewContext(source, { createHash, process: { env: { MONGODB_URI: database } }, Settings: { findOne: () => ({ select: () => ({ lean: async () => store ? { _id: store } : null }) }) } });
  return get({ sub: "validated-user", authVersion: 1, role: "STAFF", roleId: "role-id", permissions: ["sales.view", "products.view"], ...changes });
}
test("cache scope changes for users, authentication versions, roles, effective permissions and cloned databases", async () => {
  const initial = await scope();
  for (const changes of [{ sub: "other-user" }, { authVersion: 2 }, { role: "ADMIN" }, { roleId: "other-role" }, { permissions: ["products.view"] }, { store: "other-store" }, { database: "configured-database-b" }]) assert.notEqual((await scope(changes)).scope, initial.scope);
  assert.equal((await scope({ permissions: ["products.view", "sales.view"] })).scope, initial.scope);
});
test("a missing store identity disables persistence while separating memory by datasource", async () => {
  const result = await scope({ store: null }); assert.equal(result.persistent, false); assert.match(result.scope, /^[a-f\d]{64}$/);
  assert.notEqual((await scope({ store: null, database: "other-database" })).scope, result.scope);
  assert.equal(JSON.stringify(result).includes("configured-database"), false);
});
