import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { apiError, fail, ok } from "@/lib/api";
import { getPurchaseDetails, receivePendingPurchase } from "@/services/purchase.service";

export async function POST(_request, { params }) {
  try {
    const auth = await requireSession("purchases.edit");
    await connectDb();
    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return fail("Invalid purchase");
    await receivePendingPurchase(id, new mongoose.Types.ObjectId(auth.sub));
    return ok(await getPurchaseDetails(id));
  } catch (error) {
    return apiError(error);
  }
}
