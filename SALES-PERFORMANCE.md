# Sales cache implementation and verification

Date: 14 October 2026. Repository: PVAMSP POS. All application timings below are local production builds against the database configured by this checkout. They do not establish hosted deployment or installed-client behavior.

## Outcome and limits

Warm Sales returns, search/clear, stock-filter search, and cached cart additions met the requested limits in five cycles in Chrome and the actual Electron shell. There was one visible active product, a 696-byte index (rows only), and no live barcodes. Each measured warm operation made zero product requests.

The configured database has no persisted global Settings document. The server therefore cannot derive the existing store ObjectId and intentionally disables IndexedDB persistence for real accounts. No Settings record was created to manufacture a result. Saving the real store configuration through the existing Settings workflow would establish that identity; account persistence then needs a fresh live check. Native IndexedDB and exact barcode behavior were verified separately using isolated fixtures.

The original application had no frontend product cache/index path to activate. Sales fetched the whole product catalogue and all associated batches on each mount and after checkout; scans always fetched the exact endpoint; the entire grid rendered, formatters were rebuilt, and cart pricing reran during search. Management search remains available; cashier search now uses local normalized metadata.

## Measurements

Times are milliseconds. Paint means two animation-frame boundaries after the action/readiness check, an approximation rather than a compositor trace. DOM readiness is also recorded in the JSON files. Native processes used an isolated temporary profile and --disable-gpu. No meaningful p95 is inferred from five samples.

| Operation | Chrome median paint | Chrome samples | Electron median paint | Electron samples |
|---|---:|---|---:|---|
| Warm return from Products | 19.5 | 19.5, 17.5, 20.1, 19.2, 23.2 | 19.3 | 19.8, 19.3, 21.0, 18.6, 17.9 |
| Text search | 12.7 | 13.4, 12.1, 13.0, 12.7, 11.8 | 13.1 | 13.1, 13.2, 12.7, 12.3, 13.1 |
| Clear search | 13.2 | 12.7, 13.6, 12.8, 13.8, 13.2 | 13.6 | 12.3, 13.6, 14.0, 14.3, 12.2 |
| Low Stock search | 7.0 | 7.6, 7.0, 6.7, 5.2, 7.0 | 7.1 | 11.4, 7.9, 5.3, 5.3, 7.1 |
| Stock-filter clear | 13.4 | 13.4, 13.6, 12.6, 12.3, 13.5 | 12.7 | 12.7, 12.1, 13.6, 13.1, 12.3 |
| Cached cart addition | 20.1 | 20.1, 21.0, 19.5, 19.4, 20.1 | 21.6 | 20.4, 21.6, 19.2, 23.7, 26.4 |

Each of the five cycles had 0 product request starts during return, search/clear, stock-filter search, and cart addition. Reload had four starts per cycle: metadata, bounded details, and two stock-membership sets. Reload cannot use account persistence while the store identity is missing.

| Reload, persistence disabled | Median readiness | Individual samples |
|---|---:|---|
| browser | 508.2 | 527.5, 512.8, 506.8, 508.2, 506.2 |
| electron | 706.6 | 538.1, 528.7, 731.1, 706.6, 825.2 |

Before/after evidence is available for the final route-prefetch correction, not for the untouched application: the initial cache implementation painted Sales returns in 329.7 ms in Chrome and 330.0 ms in Electron; full dynamic-route prefetch reduced these medians to 19.5 ms and 19.3 ms. The initial runs already used the new cache. Their search figures measured event dispatch differently and must not be presented as an original-app comparison.

UI measurements were captured after the prefetch correction, before the final datasource-isolation and metadata projection/timestamp hardening. The final source passed the full tests, lint and normal production build; authenticated UI timings were not repeated after those small changes.

Raw per-cycle readiness, paint, request start timestamps, counts, HTTP status, Server-Timing, transfer bytes and cache metrics: [browser.json](performance-results/browser.json), [electron.json](performance-results/electron.json). Initial intermediate runs: [browser-initial.json](performance-results/browser-initial.json), [electron-initial.json](performance-results/electron-initial.json).

The first recorded final Chrome metadata/details server timings were 140.8/170.4 ms; Electron 210.1/208.4 ms. These include validated authentication and network-backed queries. Warm cashier operations avoid those requests.

## Native fixtures

10,000 synthetic index rows (4,056,671 JSON bytes) were used only in isolated browser storage/memory. This does not represent the live catalogue, a live barcode scan, or the app route reload. No MongoDB data was seeded.

| Runtime | Native index restore | Restore requests | Median local search | Median exact cached barcode | Operation requests |
|---|---:|---:|---:|---:|---:|
| browser | 65.3 | 0 | 0.30 | 0.00 | 0 |
| electron | 65.2 | 0 | 0.40 | 0.00 | 0 |

Individual fixture samples and cold-load timing: [browser-fixture.json](performance-results/browser-fixture.json), [electron-fixture.json](performance-results/electron-fixture.json). Values reported as 0 ms are below the runtime timer resolution. Native fixture snapshots were purged afterward.

## API, scope and storage

- GET /api/products/sales-index authenticates products.view and sales.view using validated session data. Projected lean reads retain active/visible filtering and name ordering. Search includes name, SKU, exact barcode, manufacturer and populated category. Metadata contains revision/search fields and displayed prices/units/flags, with no batch, supplier, audit, image or full pricing configuration.
- The same endpoint accepts at most 50 IDs for complete selling details or targeted metadata. Selling details reuse getProducts restricted to those IDs, so inventory reads stay batched and bounded. Lightweight rows are never passed into cart pricing, mixture selection or checkout. Editing a historical bill retains the original credited-stock data path and does not persist those credited values in the cache.
- membership=Low Stock or Opened Stock returns compact ID lists from grouped physical batch totals and existing stock predicates. Local text search intersects cached membership; it never runs a stock aggregation per character.
- SHA-256 scope includes the server-only configured datasource (never returned), existing global Settings ObjectId, validated user ID, authVersion, role/roleId and sorted effective permissions. Products have no tenant/branch predicates in this application; consultation branch IDs are not product tenancy and were not invented as cache identity. Missing store identity disables disk persistence. A missing/mismatched scope response is rejected; current 401/403 clears private memory and disk, and old-account responses cannot clear a newer account.
- Native IndexedDB database pos-sales-v1, schema version 1, stores meta, individual rows, details, pages and membership. Keys include the server scope; metadata tracks schema/count, ETag, validation/full-fetch times. Full replacement is one transaction and removes orphan rows. Detail writes/removals are targeted; incompatible/incomplete snapshots are ignored. Failure/blocked storage leaves memory usable.
- The index and initial 20-card page are protected. Detail records are capped at 200; there are only two stock-membership sets and one protected initial-page record. The complete main index follows the actual catalogue size without a silent truncation. Old scopes are purged on account switch/logout; persistent records have a 24-hour hard retention.

## Freshness and writes

Metadata freshness is five minutes; details and membership 30 seconds. Visible/focus checks run every two minutes. Unconditional metadata reads are required after 15 minutes even when previous checks returned 304. Authentication precedes 304, and its metadata ETag never validates stock.

The authenticated shell switches scope before descendants read products, warms the index/initial page during idle time, and fully prefetches Sales. React subscribes to one module-owned cache via useSyncExternalStore. The grid is paginated at 20 cards; formatting instances are reused, and pricing is memoized against cart/customer/settings/edit inputs.

Successful checkout returns persisted affectedProductIds, including original bill products restored during edits, different-product free items and stock-row product IDs. Idempotent retries retain those IDs. Refresh deletes only affected details and fetches authoritative replacements in groups of at most 50; it does not subtract stock client-side. Failed checkout does not alter cached stock. Receipt handling does not await refresh.

The authenticated-shell observer covers successful product/category writes, stock opening/adjustments, purchase writes/cancellation, existing sale writes, merge/import/restore/reset paths. Product metadata writes use targeted ID reads where available; operations without reliable IDs use a full metadata validation. Imports coalesce to the final batch and refresh after an interrupted sequence. Independent concurrent writes retain their refresh notifications. Cross-tab messages carry scope, IDs and mutation flags only. Generated unused barcodes and readonly requests do not invalidate products.

Caches contain no credentials, tokens, customer records, carts or sales. Server checkout validation, transactions, idempotency, existing prices/tax/discount/payment rules and stock allocation remain authoritative. Offline checkout was not added.

## Query evidence

Read-only inspection found products _id, unique sku, unique sparse barcode, wholesaleEnabled and unique sparse duplicateKey indexes. InventoryBatch has _id and productId indexes. The visible catalogue query examined one document in 0 ms; the barcode query used barcode_1, examined zero documents for a missing barcode and took 1 ms. No index was added or rebuilt. With this catalogue size there is no measured justification for another index. Live data was not changed for query inspection.

## Validation

- Full application suite: 347/347 passed, including cache loading/coalescing, native API-compatible IndexedDB restoration/replacement/eviction, reverse maps, 304/full age, account/permission changes, logout, late reads/success/denial, target stock refresh, failed checkout, import interruption and endpoint bounds/authentication.
- Electron suite: 20/20 passed. Existing hosted shell smoke passed at this repository's production URL, https://drabdullas-pos.vercel.app. This smoke is separate from the local Sales benchmarks.
- ESLint: 0 errors, 3 pre-existing warnings (ExpensesWorkspace navigation/unused suppression and the existing Sales barcode callback dependency).
- Normal production build passed with performance instrumentation disabled; an isolated instrumented production build was used for measurements. Benchmark metric exposure requires NEXT_PUBLIC_POS_PERF=1; ordinary production has no performance console logging.
- Live product index without authentication returned 401; login returned 200.

## Changed files

New cache/index implementation: src/lib/sales-index.js, sales-cache.js, sales-cache-storage.js, sales-cache-invalidation.js, use-sales-cache.js; src/lib/server/sales-cache-scope.js; src/components/SalesCacheBoundary.jsx; src/app/api/products/sales-index/route.js.

Integration: src/app/(workspace)/layout.js, src/components/AppShell.jsx, SalesWorkspaceModern.jsx, barcode/SalesBarcodeHost.jsx; src/app/api/products/barcode/[barcode]/route.js; src/app/api/sales/route.js; src/lib/auth.js; src/lib/product-import-progress.js; src/models/index.js.

Verification: scripts/profile-sales-queries.mjs, benchmark-sales-ui.mjs, benchmark-sales-cache.mjs; tests/sales-cache.test.mjs, sales-cache-invalidation.test.mjs, sales-index-route.test.mjs, sales-cache-scope.test.mjs and additional sale-edit assertions; package.json/package-lock.json add fake-indexeddb as a test-only dependency. Production uses native IndexedDB.

desktop/main.mjs adds a development-only isolated benchmark profile, forced benchmark window visibility and disables scheduled backups for benchmark mode. Existing desktop branding/identity/package changes were preserved. No installer was rebuilt.

## Reproduction

Run from the repository root in PowerShell:

```powershell
npm.cmd test
npm.cmd run desktop:test
npm.cmd run lint
npm.cmd run build
node --env-file=.env.local scripts/profile-sales-queries.mjs

# Terminal 1: instrumented, isolated production build/server
$env:NEXT_PUBLIC_POS_PERF='1'
$env:NEXT_DIST_DIR='.next-sales-performance'
npm.cmd run build
node node_modules/next/dist/bin/next start --port 3000

# Terminal 2: sign in only in the application window when requested
node scripts/benchmark-sales-ui.mjs browser
node scripts/benchmark-sales-ui.mjs electron

# Native cache fixtures need no sign-in
node scripts/benchmark-sales-ui.mjs browser --fixture
node scripts/benchmark-sales-ui.mjs electron --fixture

# Clear instrumentation variables before an ordinary production build
Remove-Item Env:NEXT_PUBLIC_POS_PERF -ErrorAction SilentlyContinue
Remove-Item Env:NEXT_DIST_DIR -ErrorAction SilentlyContinue
npm.cmd run build
```

## Outstanding checks

Original-app before timings were not captured. Actual-account persistent reload requires a genuine saved Settings/store identity; live barcode timing requires real existing barcodes. Larger live catalogue paging, changing a real account permission mid-session, production cross-tab mutations, and successful inventory-changing workflows were not exercised against live data. Fixture/unit regressions cover these behaviors without manufacturing transactions. Receipt printing, physical devices, checkout/runtime database mutations, production deployment and installed Electron upgrades remain unverified. The five-cycle local data should not be generalized to the hosted deployment or a larger live catalogue.

Owned benchmark runtimes/profiles are closed and removed by the scripts; the owned local benchmark server is stopped after verification. No deployment, publication, installer rebuild, live sale, stock adjustment, refund, print or backup was performed.
