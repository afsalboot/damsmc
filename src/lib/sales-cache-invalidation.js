export function mutationProductIds(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (value.productId) result.add(String(value.productId._id || value.productId));
  if (Array.isArray(value.affectedProductIds)) value.affectedProductIds.forEach(id => result.add(String(id)));
  for (const child of Object.values(value)) if (child && typeof child === "object") mutationProductIds(child, result);
  return result;
}
export function observeSalesWrites({ cache, windowObject = window, Channel = globalThis.BroadcastChannel }) {
  const original = windowObject.fetch;
  const scope = cache.scope, scopeEpoch = cache.scopeEpoch;
  const current = () => scope === cache.scope && scopeEpoch === cache.scopeEpoch;
  let importDepth = 0, importDirty = false, readers = 0, timer, disposed = false;
  let pendingIds = new Set(), metadata = false, unknown = false;
  const channel = Channel ? new Channel("pos-sales-invalidation-v1") : null;
  const refresh = message => { if (current()) cache.invalidate(message).catch(() => {}); };
  if (channel) channel.onmessage = event => {
    if (!current() || event.data?.scope !== scope) return;
    if (event.data.logout) cache.clear(); else refresh(event.data);
  };
  function flush() {
    if (disposed || !current() || importDepth || readers) return;
    if (importDirty) { importDirty = false; unknown = true; metadata = true; }
    if (!pendingIds.size && !unknown) return;
    const message = { ids: unknown ? [] : [...pendingIds], metadata };
    pendingIds = new Set(); metadata = false; unknown = false;
    channel?.postMessage({ scope, ...message }); refresh(message);
  }
  function schedule(message) {
    if (!current()) return;
    if (!message.ids?.length) unknown = true;
    message.ids?.forEach(id => pendingIds.add(id)); metadata ||= Boolean(message.metadata);
    windowObject.clearTimeout(timer); timer = windowObject.setTimeout(flush, 0);
  }
  windowObject.fetch = async (input, options) => {
    let url;
    try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, windowObject.location.origin); } catch { return original(input, options); }
    const epoch = cache.scopeEpoch;
    const response = await original(input, options);
    if (!current() || epoch !== cache.scopeEpoch || url.origin !== windowObject.location.origin || !url.pathname.startsWith("/api/")) return response;
    if ([401, 403].includes(response.status)) { channel?.postMessage({ scope, logout: true }); cache.clear(); return response; }
    const method = String(options?.method || input?.method || "GET").toUpperCase();
    if (method === "GET" || !response.ok) return response;
    if (url.pathname === "/api/auth/logout") { channel?.postMessage({ scope, logout: true }); cache.clear(); return response; }
    if (!/^\/api\/(products|sales|purchases|categories|inventory|batches|refunds)(\/|$)/.test(url.pathname) && !["/api/backups/restore", "/api/settings/reset"].includes(url.pathname)) return response;
    if (url.pathname === "/api/products/barcode/generate") return response;
    readers++;
    // Cache refresh remains independent of receipt processing and checkout retry semantics.
    response.clone().json().then(body => {
      if (!current()) return;
      if (url.pathname === "/api/products/import" && (importDepth || importDirty)) { importDirty = true; return; }
      if (url.pathname === "/api/sales" && Array.isArray(body.data?.affectedProductIds) && !body.data.affectedProductIds.length) return;
      const ids = mutationProductIds(body.data);
      const pathId = url.pathname.match(/^\/api\/products\/([a-f\d]{24})(\/|$)/i)?.[1];
      if (pathId) ids.add(pathId);
      if (url.pathname.startsWith("/api/products") && body.data?._id) ids.add(String(body.data._id));
      try {
        const requestBody = typeof options?.body === "string" ? JSON.parse(options.body) : null;
        if (url.pathname.startsWith("/api/products")) {
          for (const key of ["id", "targetId"]) if (requestBody?.[key]) ids.add(String(requestBody[key]));
          for (const id of [...(requestBody?.ids || []), ...(requestBody?.sourceIds || [])]) ids.add(String(id));
        }
      } catch {}
      const deletedId = url.searchParams.get("id"); if (deletedId) ids.add(deletedId);
      const stockOnly = /^\/api\/products\/[a-f\d]{24}\/(stock|adjustment)$/i.test(url.pathname);
      schedule({ ids: [...ids], metadata: (!stockOnly && /^\/api\/(products|categories)(\/|$)/.test(url.pathname)) || ["/api/backups/restore", "/api/settings/reset"].includes(url.pathname) });
    }).catch(() => { if (current()) schedule({ metadata: true }); }).finally(() => { readers--; flush(); });
    return response;
  };
  const batch = event => {
    if (event.detail === "start") { importDepth++; importDirty = true; }
    else { importDepth = Math.max(0, importDepth - 1); flush(); }
  };
  windowObject.addEventListener("pos-product-import", batch);
  return () => {
    disposed = true; windowObject.fetch = original; channel?.close(); windowObject.clearTimeout(timer);
    windowObject.removeEventListener("pos-product-import", batch);
  };
}
