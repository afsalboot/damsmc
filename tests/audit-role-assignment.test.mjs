import test from "node:test";
import assert from "node:assert/strict";
import { assertStaffRoleAssignment } from "../src/lib/staff-role-assignment.js";

test("staff creation/edit permissions cannot grant a role above the actor's permissions", () => {
  const actor = { role: "STAFF", permissions: ["staff.view", "staff.edit", "staff.create", "sales.view"] };
  assert.throws(() => assertStaffRoleAssignment({ permissions: { staff: { managePermissions: true } } }, actor), error => error.status === 403);
  assert.throws(() => assertStaffRoleAssignment({ permissions: { sales: { create: true } } }, actor), error => error.status === 403);
  assert.doesNotThrow(() => assertStaffRoleAssignment({ permissions: { sales: { view: true } } }, actor));
});

test("owner and explicitly delegated permission managers can assign roles", () => {
  const role = { permissions: { staff: { manageRoles: true }, settings: { edit: true } } };
  assert.doesNotThrow(() => assertStaffRoleAssignment(role, { role: "ADMIN" }));
  assert.doesNotThrow(() => assertStaffRoleAssignment(role, { role: "STAFF", permissions: ["staff.managePermissions"] }));
});
