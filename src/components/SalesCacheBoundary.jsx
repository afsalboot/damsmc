"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { observeSalesWrites } from "@/lib/sales-cache-invalidation";
import { salesCache } from "@/lib/sales-cache";

export default function SalesCacheBoundary({ identity, enabled, children }) {
  const router = useRouter();
  // Switch synchronously before descendant renders/effects can read private products.
  if (typeof window !== "undefined") salesCache.switchScope(enabled ? identity : null);
  useEffect(() => {
    if (!enabled) return;
    if (process.env.NEXT_PUBLIC_POS_PERF === "1") window.__POS_SALES_PERF__ = {
      persistence: async () => { await salesCache.writes; const saved = await salesCache.storage.read(salesCache.scope).catch(error => ({ error: error.message })); return { rows: saved?.rows?.length ?? 0, fullFetchedAt: saved?.fullFetchedAt ?? 0, error: saved?.error || salesCache.diskError }; },
      metrics: () => ({ source: salesCache.source, restoreMs: salesCache.restoreMs, indexRows: salesCache.state.rows.length,
        indexBytes: new TextEncoder().encode(JSON.stringify(salesCache.state.rows)).length, detailCount: salesCache.details.size,
        ready: salesCache.state.ready, freshDetails: [...salesCache.details.keys()].filter(id => salesCache.freshDetail(id)).length,
        barcodeCount: salesCache.barcodes.size, persistent: salesCache.persistent, diskError: salesCache.diskError }),
    };
    const stopObserving = observeSalesWrites({ cache: salesCache });
    const warm = () => { salesCache.ensure().then(() => salesCache.sellingDetails(salesCache.state.rows.slice(0, 20).map(p => p._id))).catch(() => {}); router.prefetch("/sales"); };
    const idle = window.requestIdleCallback ? window.requestIdleCallback(warm, { timeout: 1500 }) : window.setTimeout(warm, 200);
    const focus = () => { if (document.visibilityState === "visible" && Date.now() - salesCache.validatedAt >= salesCache.policy.focus) salesCache.refresh().catch(() => {}); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(focus, salesCache.policy.focus);
    return () => { stopObserving(); if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); delete window.__POS_SALES_PERF__; };
  }, [enabled, identity.scope, router]);
  return children;
}
