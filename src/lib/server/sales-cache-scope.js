import { createHash } from "node:crypto";
import { Settings } from "@/models";
// This application has one database-wide Settings record, not product tenants or branches.
// Its persisted ObjectId identifies the store. A missing record disables disk persistence.
export async function salesCacheScope(session) {
  const store = await Settings.findOne({ key: "global" }).select("_id").lean();
  const permissions = [...session.permissions].sort();
  // Also separate deployments/databases that contain cloned user or Settings IDs.
  // Connection information is hashed only on the server and is never returned or persisted.
  const scope = createHash("sha256").update(JSON.stringify(["sales-v1", process.env.MONGODB_URI || null, store?._id?.toString() || null,
    session.sub, session.authVersion, session.role, session.roleId, permissions])).digest("hex");
  return { scope, persistent: Boolean(store?._id) };
}
