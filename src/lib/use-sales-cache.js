"use client";
import { useEffect, useSyncExternalStore } from "react";
import { salesCache } from "./sales-cache.js";
export function useSalesCache() {
  const snapshot = useSyncExternalStore(salesCache.subscribe, salesCache.snapshot, salesCache.serverSnapshot);
  useEffect(() => { salesCache.ensure().catch(() => {}); }, []);
  return snapshot;
}
