import { createHash } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { Product, InventoryBatch } from "@/models";
import { getProducts } from "@/services/product.service";
import { calculatePhysicalStock, isLowStock } from "@/services/inventory.service";
import { INDEX_FIELDS, indexRow } from "@/lib/sales-index";
import { salesCacheScope } from "@/lib/server/sales-cache-scope";

export async function GET(request) {
  const start = performance.now();
  try {
    const auth = await requireSession("products.view");
    if (auth.role !== "ADMIN" && !auth.permissions.includes("sales.view")) throw Error("FORBIDDEN");
    const identity = await salesCacheScope(auth);
    const headers = { "X-POS-Cache-Scope": identity.scope, "Cache-Control": "private, no-store" };
    const params = new URL(request.url).searchParams;
    const filter = { active: true, visibleInSales: { $ne: false } };
    const requested = params.get("ids");
    if (requested !== null) {
      const ids = [...new Set(requested.split(",").filter(Boolean))];
      if (ids.length > 50 || ids.some(id => !/^[a-f\d]{24}$/i.test(id))) return Response.json({ error: "At most 50 valid product IDs are required" }, { status: 400, headers });
      filter._id = { $in: ids };
      if (params.get("details") === "true") {
        const data = ids.length ? await getProducts(filter) : [];
        headers["Server-Timing"] = `selling-details;dur=${(performance.now() - start).toFixed(1)}`;
        return Response.json({ data, ...identity }, { headers });
      }
    }
    if (params.has("membership")) {
      const products = await Product.find(filter).select("packageSize reorderLevel loosePricingMethod looseConversionType unitsPerPackage").lean();
      // Aggregate only physical totals, then reuse the authoritative membership predicate.
      const batches = await InventoryBatch.aggregate([{ $match: { productId: { $in: products.map(p => p._id) } } },
        { $group: { _id: "$productId", sealedPackages: { $sum: "$sealedPackages" }, openQuantity: { $sum: "$openQuantity" }, sealedBase: { $sum: { $multiply: ["$sealedPackages", "$packageSize"] } } } }]);
      const byId = new Map(batches.map(b => [String(b._id), b]));
      const data = products.filter(p => {
        const b = byId.get(String(p._id));
        const stock = calculatePhysicalStock(b ? [{ ...b, packageSize: b.sealedPackages ? b.sealedBase / b.sealedPackages : 0 }] : [], p);
        return params.get("membership") === "Low Stock" ? isLowStock(stock, p) : stock.openQuantity > 0;
      }).map(p => String(p._id));
      return Response.json({ data, ...identity }, { headers });
    }
    const data = (await Product.find(filter).select(INDEX_FIELDS).populate("categoryId", "name slug active").sort({ name: 1 }).lean()).map(indexRow);
    const etag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
    headers.ETag = etag;
    headers["Server-Timing"] = `sales-index;dur=${(performance.now() - start).toFixed(1)}`;
    if (!requested && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json({ data, ...identity }, { headers });
  } catch (error) { return apiError(error); }
}
