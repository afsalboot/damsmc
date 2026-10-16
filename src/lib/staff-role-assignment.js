import { applyPermissionDependencies, flattenPermissions } from "../services/rbac.service.js";

export function assertStaffRoleAssignment(role, actor) {
  if (actor.role === "ADMIN" || actor.permissions?.includes("staff.managePermissions")) return;
  const permissions = new Set(actor.permissions || []);
  if (flattenPermissions(applyPermissionDependencies(role.permissions)).some(permission => !permissions.has(permission))) {
    throw Object.assign(new Error("You do not have permission to assign this staff role"), { status: 403 });
  }
}
