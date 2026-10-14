const DB_NAME = "pos-sales-v1";
const RETENTION = 24 * 60 * 60 * 1000;
export function nativeSalesStorage(indexedDB = globalThis.indexedDB) {
  let opening;
  const db = () => opening ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ["meta", "rows", "details", "pages", "membership"]) request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onblocked = () => reject(Error("IndexedDB blocked"));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
  async function transaction(mode, callback) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(["meta", "rows", "details", "pages", "membership"], mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error("Cache transaction failed"));
      callback(tx, value => { result = value; });
    });
  }
  const removeScope = (tx, scope) => {
    for (const name of ["meta", "rows", "details", "pages", "membership"]) {
      const request = tx.objectStore(name).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!scope || cursor.value.scope === scope || Date.now() - cursor.value.savedAt > RETENTION) cursor.delete();
        cursor.continue();
      };
    }
  };
  return {
    async read(scope) {
      return transaction("readonly", (tx, done) => {
        const parts = {};
        let pending = 4;
        for (const name of ["meta", "rows", "details", "membership"]) {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => {
            parts[name] = request.result.filter(r => r.scope === scope && Date.now() - r.savedAt < RETENTION);
            if (--pending === 0) {
              const meta = parts.meta[0];
              if (!meta || meta.version !== 1 || parts.rows.length !== meta.count) return done(null);
              done({ ...meta, rows: parts.rows.sort((a, b) => a.order - b.order).map(r => r.value),
                details: parts.details.map(r => r.value), memberships: parts.membership.map(r => r.value) });
            }
          };
        }
      });
    },
    async replace(scope, snapshot) {
      // Delete and replace in one transaction: no orphan index or private detail rows.
      return transaction("readwrite", tx => {
        let pending = 5;
        for (const name of ["meta", "rows", "details", "pages", "membership"]) {
          const request = tx.objectStore(name).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) { if (cursor.value.scope === scope || Date.now() - cursor.value.savedAt > RETENTION) cursor.delete(); cursor.continue(); return; }
            if (--pending) return;
            const base = { scope, savedAt: Date.now() };
            tx.objectStore("meta").put({ ...base, key: scope, version: 1, count: snapshot.rows.length, etag: snapshot.etag, validatedAt: snapshot.validatedAt, fullFetchedAt: snapshot.fullFetchedAt });
            snapshot.rows.forEach((value, order) => tx.objectStore("rows").put({ ...base, key: `${scope}:${value._id}`, value, order }));
            snapshot.details.forEach(value => tx.objectStore("details").put({ ...base, key: `${scope}:${value.product._id}`, value }));
            snapshot.memberships.forEach(value => tx.objectStore("membership").put({ ...base, key: `${scope}:${value.filter}`, value }));
            tx.objectStore("pages").put({ ...base, key: `${scope}:initial`, ids: snapshot.rows.slice(0, 20).map(p => p._id) });
          };
        }
      });
    },
    async patch(scope, { rows = [], remove = [], removeDetails = [], details = [] }) {
      return transaction("readwrite", tx => {
        const base = { scope, savedAt: Date.now() };
        for (const id of remove) for (const name of ["rows", "details"]) tx.objectStore(name).delete(`${scope}:${id}`);
        for (const id of removeDetails) tx.objectStore("details").delete(`${scope}:${id}`);
        rows.forEach(({ value, order }) => tx.objectStore("rows").put({ ...base, key: `${scope}:${value._id}`, value, order }));
        details.forEach(value => tx.objectStore("details").put({ ...base, key: `${scope}:${value.product._id}`, value }));
        // Targeted metadata changes need a new complete validation before disk restoration.
        if (rows.length || remove.length) tx.objectStore("meta").delete(scope);
      });
    },
    async purge(scope) { return transaction("readwrite", tx => removeScope(tx, scope)); },
  };
}
