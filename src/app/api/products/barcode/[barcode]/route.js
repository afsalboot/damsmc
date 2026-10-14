import {salesCacheScope} from "@/lib/server/sales-cache-scope";
import { connectDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { apiError, fail, ok } from "@/lib/api";
import { normalizeBarcode, validateBarcode } from "@/lib/barcode";
import { getProducts } from "@/services/product.service";

export async function GET(request, { params }) {
  try {
    const auth = await requireSession("products.view");
    await connectDb();
    const identity = await salesCacheScope(auth);
    const scoped = response => { response.headers.set("X-POS-Cache-Scope", identity.scope); response.headers.set("Cache-Control", "private, no-store"); return response; };
    const { barcode: rawBarcode } = await params;
    const barcode = normalizeBarcode(rawBarcode);
    const context = new URL(request.url).searchParams.get("context") || "sale";
    const errors = validateBarcode(barcode);
    if (!barcode || errors.length) return scoped(fail(errors[0] || "Enter a valid barcode", 400));
    const [product] = await getProducts({ barcode });
    if (!product) return scoped(fail("Barcode not registered", 404));
    if (product.active === false) return scoped(fail(`${product.name} is inactive`, 409));
    if (context === "sale") {
      if (product.visibleInSales === false) return scoped(fail(`${product.name} is not available on the Sales screen`, 409));
      if (!product.stock?.hasStock) return scoped(fail(`${product.name} is out of stock`, 409));
    }
    return scoped(ok(product));
  } catch (error) {
    return apiError(error);
  }
}
