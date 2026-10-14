import { indexRow, searchIndex } from "./sales-index.js";
import { nativeSalesStorage } from "./sales-cache-storage.js";
export const SALES_POLICY = { metadata: 300000, detail: 30000, focus: 120000, full: 900000, retention: 86400000, maxDetails: 200 };
const EMPTY = Object.freeze({ rows: [], version: 0, ready: false });
export class SalesCache {
  constructor({ fetcher = (...args) => fetch(...args), storage = nativeSalesStorage(), now = Date.now, policy = {} } = {}) {
    this.fetcher = fetcher; this.storage = storage; this.now = now; this.policy = { ...SALES_POLICY, ...policy };
    this.listeners = new Set(); this.generation = 0; this.scopeEpoch = 0; this.scope = null; this.state = EMPTY;
    this.details = new Map(); this.memberships = new Map(); this.pending = new Map(); this.writes = Promise.resolve();
    this.byId = new Map(); this.barcodes = new Map(); this.skus = new Map();
    this.source = "empty"; this.restoreMs = 0; this.diskError = null;
  }
  subscribe = callback => { this.listeners.add(callback); return () => this.listeners.delete(callback); };
  snapshot = () => this.state;
  serverSnapshot = () => EMPTY;
  valid(generation) { return generation === this.generation && Boolean(this.scope); }
  switchScope(identity) {
    if (this.scope === identity?.scope) { this.persistent = Boolean(identity?.persistent); return; }
    const previous = this.scope;
    ++this.generation; ++this.scopeEpoch; this.scope = identity?.scope || null; this.persistent = Boolean(identity?.persistent);
    this.state = EMPTY; this.details.clear(); this.memberships.clear(); this.pending.clear();
    this.source = "empty"; this.restoreMs = 0;
    this.byId.clear(); this.barcodes.clear(); this.skus.clear(); this.etag = null; this.validatedAt = 0; this.fullFetchedAt = 0; this.restored = false;
    if (previous) this.disk(() => this.storage.purge(previous));
  }
  clear() { const scope = this.scope; this.switchScope(null); if (scope) this.disk(() => this.storage.purge(scope)); this.emit(); }
  disk(task) { this.writes = this.writes.then(task).catch(error => { this.diskError = error?.message || "Persistence unavailable"; }); return this.writes; }
  emit(rows = this.state.rows) {
    if (rows !== this.state.rows || this.byId.size !== rows.length) {
      this.byId = new Map(rows.map(p => [p._id, p]));
      this.barcodes = new Map(rows.filter(p => p.barcode).map(p => [p.barcode, p._id]));
      this.skus = new Map(rows.map(p => [p.searchSku, p._id]));
    }
    this.state = { rows, memberships: Object.fromEntries([...this.memberships].map(([filter, value]) => [filter, value.ids])), version: this.state.version + 1, ready: this.state.ready };
    this.listeners.forEach(callback => callback());
  }
  coalesce(key, work) {
    if (this.pending.has(key)) return this.pending.get(key);
    const generation = this.generation;
    const promise = Promise.resolve().then(work).finally(() => { if (this.valid(generation)) this.pending.delete(key); });
    this.pending.set(key, promise); return promise;
  }
  async request(path, options, generation = this.generation) {
    const response = await this.fetcher(path, options);
    if (!this.valid(generation)) throw Error("Discarded old cache response");
    if ([401, 403].includes(response.status)) { this.clear(); throw Error("Sales access denied"); }
    if (response.headers.get("X-POS-Cache-Scope") !== this.scope) { this.clear(); throw Error("Sales scope changed; reload to validate access"); }
    if (response.status === 304) return { response };
    const body = await response.json();
    if (!this.valid(generation)) throw Error("Discarded old cache response");
    if (!response.ok) throw Error(body.error || "Sales cache request failed");
    return { response, body };
  }
  persist() {
    if (!this.persistent) return;
    const scope = this.scope, generation = this.generation;
    const snapshot = { rows: this.state.rows, details: [...this.details.values()], memberships: [...this.memberships].map(([filter, value]) => ({ filter, ...value })),
      etag: this.etag, validatedAt: this.validatedAt, fullFetchedAt: this.fullFetchedAt };
    this.disk(() => this.valid(generation) ? this.storage.replace(scope, snapshot) : undefined);
  }
  async ensure() {
    if (!this.scope) return;
    return this.coalesce("ensure", async () => {
      const generation = this.generation;
      if (!this.restored) {
        this.restored = true;
        const restoreStart = performance.now();
        const saved = this.persistent ? await this.storage.read(this.scope).catch(() => null) : null;
        if (!this.valid(generation)) return;
        if (saved?.rows?.every(p => p._id && typeof p.searchText === "string") && this.now() - saved.fullFetchedAt < this.policy.retention) {
          this.source = "indexeddb"; this.restoreMs = performance.now() - restoreStart;
          this.etag = saved.etag; this.validatedAt = saved.validatedAt; this.fullFetchedAt = saved.fullFetchedAt;
          this.state = { ...this.state, ready: true };
          const ids = new Set(saved.rows.map(p => p._id));
          for (const entry of (saved.details || []).slice(-this.policy.maxDetails)) if (ids.has(entry.product?._id)) this.details.set(entry.product._id, entry);
          for (const entry of saved.memberships || []) this.memberships.set(entry.filter, { ids: entry.ids, at: entry.at });
          this.emit(saved.rows);
        }
      }
      if (!this.state.ready) await this.refresh();
      else if (this.now() - this.validatedAt >= this.policy.metadata || this.now() - this.fullFetchedAt >= this.policy.full) this.refresh().catch(() => {});
    });
  }
  refresh(force = false) {
    return this.coalesce("index", async () => {
      const generation = this.generation;
      const conditional = !force && this.etag && this.now() - this.fullFetchedAt < this.policy.full;
      const { response, body } = await this.request("/api/products/sales-index", { headers: conditional ? { "If-None-Match": this.etag } : {} }, generation);
      this.validatedAt = this.now();
      if (response.status !== 304) {
        this.source = "server";
        this.fullFetchedAt = this.now(); this.etag = response.headers.get("etag");
        const metadata = new Map(body.data.map(p => [p._id, JSON.stringify(p)]));
        for (const [id, entry] of this.details) if (metadata.get(id) !== JSON.stringify(indexRow(entry.product))) this.details.delete(id);
        this.state = { ...this.state, ready: true }; this.emit(body.data);
      } else this.emit();
      this.persist();
    });
  }
  freshDetail(id) { const value = this.details.get(String(id)); return value && this.now() - value.at < this.policy.detail ? value.product : null; }
  async sellingDetails(ids, force = false) {
    ids = [...new Set(ids.map(String))];
    if (ids.length > 50) throw Error("Selling detail page exceeds 50 products");
    const missing = ids.filter(id => force || !this.freshDetail(id));
    if (missing.length) await this.coalesce(`details:${missing.slice().sort().join(",")}`, async () => {
      const generation = this.generation;
      const { body } = await this.request(`/api/products/sales-index?details=true&ids=${missing.join(",")}`, undefined, generation);
      const found = new Set(body.data.map(p => String(p._id)));
      const removed = missing.filter(id => !found.has(id));
      for (const id of removed) this.details.delete(id);
      for (const product of body.data) { const id = String(product._id); this.details.delete(id); this.details.set(id, { product, at: this.now() }); }
      const protectedIds = new Set(this.state.rows.slice(0, 20).map(p => p._id));
      const evicted = [];
      for (const id of this.details.keys()) { if (this.details.size <= this.policy.maxDetails) break; if (!protectedIds.has(id) && !ids.includes(id)) { this.details.delete(id); evicted.push(id); } }
      this.emit(removed.length ? this.state.rows.filter(p => !removed.includes(p._id)) : this.state.rows);
      if (removed.length) this.persist();
      else if (this.persistent) {
        const scope = this.scope;
        const records = body.data.map(product => this.details.get(String(product._id)));
        this.disk(() => this.valid(generation) ? this.storage.patch(scope, { details: records, removeDetails: evicted }) : undefined);
      }
    });
    return ids.map(id => this.details.get(id)?.product).filter(Boolean);
  }
  async barcode(barcode) {
    const epoch = this.scopeEpoch;
    await this.ensure();
    if (epoch !== this.scopeEpoch || !this.scope) throw Error("Discarded old barcode scan");
    const id = this.barcodes.get(barcode);
    if (id) { const [product] = await this.sellingDetails([id]); if (product && product.stock?.hasStock) return product; if (product) throw Error(`${product.name} is out of stock`); }
    return this.coalesce(`barcode:${barcode}`, async () => {
      const { body } = await this.request(`/api/products/barcode/${encodeURIComponent(barcode)}?context=sale`);
      const product = body.data; this.details.set(String(product._id), { product, at: this.now() });
      const rows = this.state.rows.filter(p => p._id !== String(product._id)); rows.push(indexRow(product)); rows.sort((a, b) => a.name.localeCompare(b.name));
      this.emit(rows); this.persist(); return product;
    });
  }
  async membership(filter) {
    const existing = this.memberships.get(filter);
    if (existing && this.now() - existing.at < this.policy.detail) return new Set(existing.ids);
    return this.coalesce(`membership:${filter}`, async () => {
      const { body } = await this.request(`/api/products/sales-index?membership=${encodeURIComponent(filter)}`);
      this.memberships.set(filter, { ids: body.data, at: this.now() }); this.emit(); this.persist(); return new Set(body.data);
    });
  }
  search(query, options) { return searchIndex(this.state.rows, query, options); }
  async invalidate({ ids = [], metadata = false } = {}) {
    // An earlier stock read must not overwrite a refresh following a committed mutation.
    const generation = ++this.generation;
    this.pending.clear();
    this.memberships.clear();
    ids = [...new Set(ids.map(String))].filter(id => /^[a-f\d]{24}$/i.test(id));
    if (!ids.length) { this.details.clear(); this.validatedAt = 0; this.emit(); this.persist(); if (metadata) await this.refresh(true); return; }
    ids.forEach(id => this.details.delete(id)); this.emit(); this.persist();
    for (let offset = 0; offset < ids.length; offset += 50) {
      if (!this.valid(generation)) return;
      const page = ids.slice(offset, offset + 50);
      if (metadata) {
        const { body } = await this.request(`/api/products/sales-index?ids=${page.join(",")}`, undefined, generation);
        const rows = this.state.rows.filter(p => !page.includes(p._id)).concat(body.data).sort((a, b) => a.name.localeCompare(b.name));
        this.emit(rows); this.etag = null; this.validatedAt = 0;
        this.persist();
      }
      await this.sellingDetails(page, true);
    }
  }
}
export const salesCache = new SalesCache();
