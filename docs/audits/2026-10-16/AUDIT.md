# Application audit and repairs — 16 October 2026

Repository repairs and verification are complete for the changes described here. Full production acceptance is **not established**: authenticated end-to-end transactions, large-data load tests, deployed patches, physical printing, and recovery remain unverified. No live financial writes, seeds, restores, infrastructure changes, or index creation were performed.

## Application health

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Architecture | PASS: identified | Next.js App Router 16.3.8 after patch, React 19.2.8, Node 24.18.0 verification runtime, Mongoose 9.9.2/MongoDB; `package.json`, `src/models/index.js`, `src/lib/db.js`. |
| Surface discovery | PASS: enumerated | 23 pages and 68 API route files; every discovered URL/method/source/guard is in [routes.md](routes.md) and [route-inventory.json](route-inventory.json). Enumeration is not a claim of exhaustive branch coverage. |
| Automated regression | PASS | 370/370 application tests, 20/20 desktop tests; clean lint and successful production build. [after-tests.txt](after-tests.txt), [after-desktop.txt](after-desktop.txt), [after-lint.txt](after-lint.txt), [after-build.txt](after-build.txt). |
| Unauthenticated access | PASS within tested scope | 121 local production route/method checks: 99 protected API method requests rejected with 401 and 22 page requests redirected; valid-origin writes reach auth, foreign-origin writes return 403. [runtime.json](runtime.json). No authenticated role matrix is implied. |
| Public login browser smoke | PASS within tested scope | Headless Chrome, desktop 1365×900 and mobile 390×844: no runtime exceptions, no horizontal overflow, inputs labelled. Auth status was intercepted with a fixture; no login submitted. [login-browser.json](login-browser.json), [desktop screenshot](login-desktop.png), [mobile screenshot](login-mobile.png). |
| Production dependency advisories | PASS for registry snapshot | Root production audit: 3 vulnerable packages → 0. [npm-audit.json](npm-audit.json), [npm-audit-after.json](npm-audit-after.json). This is registry coverage, not proof of absence of every vulnerability. |
| Build-tool advisories | FAIL / remains | Root full audit: 5 high entries in the ESLint/glob dependency chain; desktop full audit: 8 moderate entries in the builder/download chain. Some entries describe the same transitive issue. See the remaining-work table. |
| Hosting | PASS: observed only | Electron targets `https://drabdullas-pos.vercel.app` (`desktop/policy.mjs:1`). Safe GETs observed Vercel, Brotli, private/no-store API responses, security headers, and 401 for unauthenticated products/sales. [hosted-readonly.json](hosted-readonly.json). Current local changes have not been deployed. |
| Local production configuration | FAIL for self-hosted mode | `npm run check:production` reports missing `BACKUP_DIR`; no value was invented or written. [production-config.txt](production-config.txt). Vercel's GridFS mode now correctly does not require a filesystem directory; covered in `tests/production-readiness.test.mjs`. Hosted environment variables remain UNKNOWN. |

The app is a database-wide, single-store POS rather than a tenant-scoped SaaS. Custom HS256 JWT cookies identify users; the server reloads current account state, authVersion and effective role/override permissions. React state drives the workspaces; Sales uses scoped memory/IndexedDB caches. APIs call domain services and Mongoose models. Financial writes use MongoDB transactions and checkout retry keys. Manual Cash/UPI/Bank records are present; no payment gateway SDK, PSP webhook, email service, Redis, external queue, WebSocket server, or application PWA manifest/service-worker integration was found in the inspected source/dependency surface.

The Electron shell is version 0.1.7 with Electron 44.4.5 and electron-builder 26.15.3. It loads the hosted app, restricts navigation/IPC origins, uses sandbox/context isolation without Node integration, and supports opt-in saved logins and printing. Existing desktop policy/printer/credential tests passed; no installer was rebuilt or deployed.

Request flow: browser/Electron → Vercel or self-hosted HTTPS proxy → Next API proxy (origin/search checks) → current account/session and permission check → handler/service → pooled MongoDB connection/transaction → JSON → React render. Catalogue cache reads shorten the Sales path; checkout continues to use database-authoritative prices, Settings, inventory and payment validation.

## Confirmed issues repaired

| Priority / issue | Root cause and affected paths | Implemented fix | Verification |
| --- | --- | --- | --- |
| P0: vulnerable production dependencies | `package.json` pinned Next 16.3.1; installed sharp/source-map-js were also flagged by the registry. Next advisories include platform/feature-dependent RCE, so installed vulnerability does not establish exploitation. | Next and matching lint config → 16.3.8; compatible transitive patches including sharp 0.35.5/source-map-js 1.2.2. No major upgrade or forced downgrade. | Production audit 0; tests/lint/build pass. [Maintainer Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [ImageResponse advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j). |
| P1: staff role escalation | `src/services/staff.service.js` restricted custom overrides but accepted a more privileged `roleId` with only staff.create/edit. Such a user could assign a role granting permissions they lacked. | `src/lib/staff-role-assignment.js:3`; creation and changed-role updates check grants. Owner and explicit staff.managePermissions delegates retain assignment authority. Existing-role profile edits remain allowed. | Real guard injected into service fixture tests; escalation is rejected before create/save, and normal owner credential workflows still pass. `tests/audit-role-assignment.test.mjs`, `tests/staff-credentials.test.mjs`. |
| P1: stale admin authority in global search | Proxy checked ADMIN from JWT; handler only required any current session. A current account downgraded without authVersion change could pass the old proxy role and search across modules. | `/api/search` independently requires current-account ADMIN (`src/app/api/search/route.js:3`). Its existing admin-only contract is preserved. | Staff denied before queries in executable handler test; admin gets bounded results. `tests/audit-query-input.test.mjs`. |
| P1: legitimate writes rejected by origin validation | Next's internal URL normalized hostname to localhost. Comparing Origin only with nextUrl.origin rejected valid 127.0.0.1 browser requests. | `src/lib/request-origin.js:1`, `src/proxy.js:9`: compare browser Origin with destination Host and request protocol; reject foreign sec-fetch-site, malformed hosts/origins and untrusted forwarded-host substitution. Trusted deployment proxy must preserve public Host/protocol. | Reproduced before: same-origin 403. After: valid-origin 401 reaches authentication; wrong host/cross-site stays 403. Three unit cases plus isolated HTTP checks. |
| P1: dashboard purchase totals omitted received purchases | `src/lib/server/dashboard-data.js:21` queried nonexistent `status` rather than schema `purchaseStatus`. | Query persisted `purchaseStatus: RECEIVED`. Exclude exhausted batches from the dashboard inventory read; they contribute no current stock/value. | Fixture received purchase now contributes count 1/value 125; exhausted-batch removal preserves stock groups and low-stock summaries. `tests/audit-dashboard.test.mjs`. |
| P2: raw regex product search / oversized query work | `/api/products` interpolated q as regex. Complex or malformed expressions could cause expensive DB matching or errors. | `src/lib/query-input.js`, `/api/products`: literal metacharacters and max 100 characters; same bounds apply to global/customer/recent-sale search. | Adversarial expressions, punctuation, oversized queries and sales-only filters tested against helper and handlers. No latency improvement is claimed for full collection substring searches. |
| P2: malformed pagination / filter widening | NaN could reach recent-sale skip/limit; customer search accepted negative limits; malformed customerId silently discarded the intended filter. | Finite bounded integer limits/pages, positive customer search limit, reject invalid customer IDs and invalid/reversed sale dates. | `tests/audit-query-input.test.mjs`: actual handlers verify bounded values and early rejection. |
| P2: customer/category join amplification | Customer lookup built an array of every complete sale twice per directory request; category counts embedded complete products. Large joined documents could exhaust memory or hit MongoDB document limits. | `src/lib/customer-statistics.js:4` groups inside lookup to at most one statistics document. `src/app/api/categories/route.js:4` counts inside lookup. Preserve history inclusion, zero/null cases, totals and dates. | Five read-only Mongo `$documents` fixture cases exercise real aggregation numeric/date semantics. Existing connected DB has zero customers, so real customer latency improvement is UNKNOWN. [database.json](database.json). |
| P2: quadratic batch grouping | Product and dashboard grouping copied the growing per-product array on every batch. | Push into a per-product map array (`src/services/product.service.js:126`, `src/lib/dashboard-summary.js:25`). | Five-cycle benchmark executes HEAD and current service with identical 10,000-batch fixture; output equality checked. Existing inventory/pricing tests pass. |
| P2: repeated linear product lookup per notification batch | `getNotifications` used products.find for each expiring batch. | Build a product-ID map once (`src/services/notification.service.js:20`). | Five-cycle real-service fixture, 5,000 products/10,000 batches; output equality checked. |
| P2: oversized ledger reads / waterfall | Accounts loaded entire sales including recipes/allocations and waited to fetch consultations until other queries finished. | Project ledger-required fields, preserving item count, snapshots, payment references and refunds. Fetch consultations with the independent read group. `src/app/api/accounts/route.js:12`, `src/services/accounting.service.js:4`. | Two read-only Mongo projection fixtures preserve exact ledger output for sales/split payments/expenses/consultation refunds; fixture bytes 4,954 → 961. Running-balance history remains complete. |
| P2: CSV formula injection | Reports, Accounts, Expenses and Customers CSVs escaped quotes but allowed spreadsheet formulas in user-controlled names/references. | Shared `src/lib/csv.js:1` prefixes formula-like text while preserving true numeric negative amounts. Product import reports already used Papa Parse escapeFormulae. | Formula prefixes, whitespace/control prefixes, empty cells, embedded quotes and numeric amounts tested in `tests/audit-csv.test.mjs`; report CSV tests pass. |
| P2: camera capture after close | Camera startup promise could resolve after effect cleanup, installing live controls after unmount/device switch. | Check activity after reader import/startup and stop late controls before assignment (`src/components/barcode/CameraBarcodeScanner.jsx:44`). | Deferred startup fixture resolves after cleanup and verifies stop, no enumeration and no retained controls. Actual camera hardware remains UNKNOWN. |
| P2: Cancel activated confirmation with Enter | Shared dialog document handler intercepted Enter even when Cancel had keyboard focus. | Keep native focused-button Enter behavior; retain Escape and focus trap. `src/components/ConfirmDialog.jsx`. | Executable key handler verifies Enter is not intercepted and Escape cancels. `tests/audit-lifecycle.test.mjs`. |
| P2: scanner stale closure / listener churn | Sales barcode effect depended on cart but captured add/edit state that could change independently; each cart change replaced the listener. | React useEffectEvent reads current state with one listener (`src/components/SalesWorkspaceModern.jsx:780`). | Clean hooks lint/build; existing cart/free-quantity/wholesale/edit tests pass. Physical scanner and authenticated browser workflow remain UNKNOWN. |
| P3: unnecessary auth data and full-page navigation | Session queries loaded password hash and notification arrays; a linked purchase action used window.location.assign. | Project session-required fields only in `src/lib/auth.js:22`; use router.push in Expenses. No permission/session cache added. | Existing auth/RBAC tests and build; protected endpoint HTTP denials remain correct. |
| P2: incorrect Vercel deployment requirement | Configuration validator always demanded BACKUP_DIR even though VERCEL=1 stores encrypted archives in MongoDB GridFS. | Make that requirement conditional; explain Vercel backup scheduling/storage limits in `DEPLOYMENT.md`. | Existing self-host checks preserved; explicit GridFS environment test passes. No hosted environment was changed. |

Authorization checks follow the principle of validating permissions at the resource operation, rather than relying solely on frontend/proxy decisions. Reference: [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Before / after evidence

| Metric | Before | After | Interpretation |
| --- | --- | --- | --- |
| Production vulnerable packages, registry snapshot | 3 (1 critical, 2 high) | 0 | Root production dependency audit only. |
| Product-service CPU, 10,000-batch fixture, five-cycle median | 87.60 ms | 0.80 ms | About 99.1% less processing time in this synthetic workload; identical output. Excludes DB/network/browser. |
| Notification-service CPU, 5,000 products/10,000 batches, five-cycle median | 197.78 ms | 9.07 ms | About 95.4% less processing time; identical output. Excludes DB/network/browser. |
| Ledger input payload, Mongo projection fixtures | 4,954 bytes | 961 bytes | About 80.6% reduction in these fixtures, with identical ledger results. Not a measured production HTTP payload. |
| Valid 127.0.0.1 Origin on protected write, no cookie | 403 from CSRF check | 401 from auth | Valid browser origin reaches authentication; foreign origin remains 403. |
| Application regression tests | 353 pass | 370 pass | 17 additional cases; not end-to-end transaction evidence. |
| Desktop regression tests | 20 pass | 20 pass | No desktop app behavior changes or version bump. |

Source and samples: [fixture-benchmarks.json](fixture-benchmarks.json), [database.json](database.json), [runtime.json](runtime.json). The fixture benchmark reads original service source from Git HEAD; rerun it against the same baseline commit to reproduce this comparison after committing the changes.

Current local production login GET median was approximately 16.34 ms in five samples, with 10,128-byte HTML (about 3 KB gzip). Initial login scripts total 634,100 raw / 194,918 gzip-estimated bytes; these are sums of requested script files, not a complete transfer-budget or bundle-regression comparison. Public login desktop/mobile FCP/LCP/CLS observations are in [login-browser.json](login-browser.json); these are single unthrottled observations with fixture auth status, not field Web Vitals or low-end device results. No authenticated navigation, checkout latency, INP, TBT or hydration-time improvement is claimed.

Safe hosted GET samples observed health 200, login 200, products 401, recent-sales 401; total response times were 2,342 / 1,632 / 1,024 / 818 ms respectively. Those are one sample per endpoint from this machine, including network/cold-start effects. They do not isolate the bottleneck or measure the new code, which is not deployed.

## Database and capacity

Native-driver inspection read counts/indexes/execution plans only; it imported no connected Mongoose models and did not call init/syncIndexes. The connected dataset had one product, one inventory batch, three sales, one category, zero customers, zero purchases, zero expenses and zero Settings records. No Settings document was inserted to enable persistence or benchmark features.

Observed plans: exact barcode uses the unique sparse barcode index; the catalogue active/visible/name query and newest-sales query use COLLSCAN + SORT on this tiny dataset. The existing inventory productId/customer sales indexes are present. No new indexes were added blindly. At realistic staging scale, evaluate `{createdAt:-1,_id:-1}` for recent sales, `{customerId:1,createdAt:-1}` for sorted customer history, and `{active:1,name:1}` for catalogue ordering. Compare executionStats before deploying an index and account for write/storage cost. Query-plan recommendations are not deployed optimizations.

Connection reuse and retry after connection failure are covered by `src/lib/db-connection.js` and `tests/production-readiness.test.mjs`. Driver server selection timeout is 10 seconds; no connection/memory/timeout limit was increased. Checkout's shared issuance guard and document counter serialize writes, preserving correctness but potentially constraining multi-cashier throughput. Its transactions, retry keys, request hash/actor checks, grouped stock buffer and rollback paths are covered by the existing fiscal/checkout/stock fixtures, not a new live concurrency test.

No credible user-capacity number can be inferred from three sales. For 10 users, verify hosted latency and pool/cold-start behavior; for 100, measure concurrent catalogue/polling and issuance throughput; for 500/1,000/10,000, full-history reports/ledgers, cached full catalogue, per-request stock scans and centralized issuance become architecture questions requiring load tests. These are risk assessments, not supported concurrency claims or recommended production limits. Do not add Redis until profiling demonstrates a cacheable bottleneck; stock, financial status, permissions and final checkout values must remain authoritative.

## Complete phase coverage

PASS below means only the scope explicitly stated. UNKNOWN requires the remaining action listed later. N/A means the corresponding integration/application type was absent in the inspected source, not that a hosting provider cannot supply it.

| Phase | Scope / outcome / evidence |
| --- | --- |
| 1 Architecture | PASS identified: package.json, models, auth, services, proxy, desktop policy and DEPLOYMENT.md. |
| 2 Baseline | PASS repository baseline captured in baseline-*.txt; fixture pre-change source retained through Git HEAD. UNKNOWN authenticated initial performance. |
| 3 Every route | PASS discovery and unauthenticated route surface: routes.md/runtime.json. UNKNOWN authenticated behavior/latency on each page. |
| 4 Network waterfall | PASS ledger consultation waterfall removed; login fixture makes one auth-status request per navigation. UNKNOWN full authenticated waterfall. |
| 5 APIs | PASS targeted search/pagination/projection fixes; UNKNOWN all API throughput under production workload. |
| 6 Database | PASS native read-only counts/index plans and Mongo fixture semantics: database.json. UNKNOWN large-data plans and production index capacity. |
| 7 Pagination | PASS finite recent-sales/customer-search bounds. FAIL scale concern remains for full catalogue and report/ledger source reads. |
| 8 Search | PASS bounded literal product/global/customer/recent-sale queries and existing local Sales index. UNKNOWN representative large-data substring search. |
| 9 POS | PASS existing cache/checkout/inventory/pricing fixtures preserved; UNKNOWN live cashier journey, printer and device latency. |
| 10 Rendering | PASS stable latest-state barcode listener; existing Sales pricing memoization retained. UNKNOWN authenticated React profiler. |
| 11 Large lists | PASS existing bounded Sales cards/catalogue display pagination retained. FAIL source-data reads can still be unbounded. |
| 12 JavaScript | PASS build and public-login script sizes recorded; camera decoder remains dynamic import. UNKNOWN authenticated route transfer budgets. |
| 13 Next.js | PASS installed route/proxy/auth/client/lazy-load docs read; API-only proxy matcher retained, framework patch verified. |
| 14 Authentication | PASS current DB role/authVersion/active checks retained and session projection reduced. UNKNOWN multi-instance timeout propagation. |
| 15 Caching | PASS scoped Sales ETag/memory/IndexedDB tests; private/no-store APIs verified locally/hosted. Settings uses a 30-second process cache. |
| 16 Redis | N/A not installed; no measured reason to add it. |
| 17 Images | Static branding inspected; largest PNG about 491 KB, BrandLogo uses eager static images for print/desktop compatibility. UNKNOWN slow-network LCP; no artwork recompression/redesign. |
| 18 Fonts | PASS local font assets present; no remote font fetch required by build. Browser font budget beyond login UNKNOWN. |
| 19 CSS | Reduced-motion rules present in globals.css; public login screenshots checked. UNKNOWN low-end animation/scroll profiling. |
| 20 Third-party scripts | N/A no analytics/chat/maps/PSP loader found in inspected app source/dependencies; CSP connect-src self. |
| 21 Security | PASS repaired regex/formula/authorization issues; targeted negative tests. UNKNOWN complete penetration test and nonce-based CSP compatibility. |
| 22 Authorization | PASS current-role search guard, assignment grant checks and unauthenticated denials. UNKNOWN full authenticated role/action matrix. |
| 23 Multi-tenancy | N/A current database-wide single-store architecture; sales-cache scope still separates datasource/store/user/permissions. Not safe to repurpose as multi-tenant SaaS without query/schema work. |
| 24 Input validation | PASS targeted query bounds and existing product/payment/quantity/ID validation fixtures. UNKNOWN exhaustive malformed-body combinations. |
| 25 Secrets | PASS source uses environment credentials; tracked env file list contains only .env.example. Secret values were never printed. UNKNOWN provider-side key rotation/access and full-history secret scan. |
| 26 Environment | PASS ignore rules and production validator tests. FAIL local self-host BACKUP_DIR absent; hosted env UNKNOWN. |
| 27 Headers | PASS configured/observed CSP, HSTS, nosniff, frame and referrer protections; CSP retains unsafe-inline. UNKNOWN stricter nonce policy rollout. |
| 28 Cookies | PASS source HttpOnly, production Secure, SameSite Lax, root path, 12-hour expiry (`src/lib/auth.js`). UNKNOWN authenticated hosted browser cookie lifecycle. |
| 29 Rate limits | PASS persistent Mongo AuthAttempt username/PIN/password-change limits and existing limiter tests. UNKNOWN gateway controls/abuse load; bootstrap limiter remains process-local. |
| 30 Errors | PASS apiError maps auth/cast/validation/duplicate errors and masks production 500 responses; negative runtime requests return clean errors. UNKNOWN provider log redaction. |
| 31 Logging | No credentials were printed; generic console.error and backup error metadata remain. UNKNOWN exhaustive production log inspection and retention. |
| 32 Capacity | UNKNOWN; small dataset cannot establish 10–10,000-user limits. Architecture risks described above. |
| 33 Connections | PASS connection reuse/retry unit coverage; UNKNOWN live pool saturation and serverless instance fan-out. |
| 34 Concurrency | PASS transaction/idempotency/stock implementation and fixture coverage; UNKNOWN multi-client last-item staging test. |
| 35 Memory | PASS removed quadratic copies and full joined arrays; late camera cleanup tested. FAIL scale concern for full-history reads/backups. |
| 36 CPU | PASS measured service-loop reductions; UNKNOWN report/export/backup CPU at realistic scale. |
| 37 Files | PASS source restore extension/100 MB checks, backup safe-name pattern and admin guard; UNKNOWN platform multipart/body limits and large-archive memory use. |
| 38 Jobs | FAIL unattended backup scheduling reliability: Vercel timer disabled, due backup triggered by status traffic. Source backup.service.js; needs a secured external scheduler. |
| 39 E-commerce | N/A public storefront/online order lifecycle absent; POS pricing remains server-authoritative and fixture-tested. |
| 40 SaaS | N/A subscription/plan/tenant workflows absent. |
| 41 Landing pages | N/A app is private POS; public login measured instead. |
| 42 Webhooks | N/A PSP/subscription callback endpoints absent in route inventory. |
| 43 Payments | PASS manual Cash/UPI/Bank/reference/split/credit fixtures; N/A automated PSP signature verification. UNKNOWN actual cashier/provider reconciliation. |
| 44 Mobile | PASS public login viewport smoke; UNKNOWN authenticated cart/modals/touch/keyboard on actual Android devices. |
| 45 Slow networks | UNKNOWN throttled authenticated journey, disconnects and hosted cold-start traces. Checkout uncertain-result retry fixtures pass. |
| 46 Electron | PASS 20 policy/print/credential unit tests; UNKNOWN new installed build, physical receipt and upgrade workflow. |
| 47 Accessibility | PASS Enter-on-Cancel correction, focus-trap source and login labels/overflow smoke; UNKNOWN full keyboard/screen-reader/contrast audit of every modal. |
| 48 SEO | N/A marketing SEO; root metadata exists for private POS. |
| 49 Dependencies | PASS root production audit 0, compatible updates applied. FAIL remaining build-chain advisory entries; no forced major upgrade/downgrade. |
| 50 Build | PASS lint, 370 tests, 20 desktop tests, Next 16.3.8 production build. |
| 51 Production config | FAIL local self-host directory missing; Vercel GridFS validator corrected. UNKNOWN actual hosted config/deployed version. |
| 52 Compression | PASS Brotli observed on hosted login/health; gzip estimates recorded locally. Actual asset CDN transfer budgets UNKNOWN. |
| 53 CDN | PASS Vercel observed and private API no-store headers; UNKNOWN authenticated cache behavior across regions/users. |
| 54 HTTP | PASS local/hosted status/header probes; UNKNOWN reverse-proxy size/time limits and keep-alive under load. |
| 55 Resilience | PASS connection failure retry and checkout uncertain-response fixtures; UNKNOWN DB outage/restore/platform failure drills. |
| 56 Timeouts | PASS bounded DB server selection and audit probes; no external app API integration needing new timeout found. UNKNOWN slow-query operational budgets. |
| 57 Retries | PASS checkout key retained after uncertain network/body errors; no automatic financial resubmission added. |
| 58 Idempotency | PASS server requestKey/hash/actor checks and client retry-lock fixtures; UNKNOWN hosted concurrency/retry test. |
| 59 Journeys | PASS unit/domain fixtures; UNKNOWN authenticated full journeys and live payment/printing. |
| 60 Regression | PASS existing pricing, GST arithmetic, discounts, customer, inventory, wholesale, purchases, consultation, receipt and accounting tests. UNKNOWN device/browser financial acceptance. |
| 61 After benchmark | PASS real-service fixture medians and payload equivalence; no invented hosted/checkout improvement. |
| 62 Prioritization | PASS P0/P1 addressed first; remaining scale/deployment risks separated below. |
| 63 Fix process | PASS source trace, executable regressions, benchmark and final checks for targeted repairs. |
| 64 Output | This report, raw evidence, route map, scripts and root RESUME.md. Full production success criteria remain open where marked UNKNOWN/FAIL. |

## Remaining work that needs a staging/deployment decision

| Priority / status | Evidence and failure mode | Smallest safe next action | Verification |
| --- | --- | --- | --- |
| P1 / FAIL build-chain advisories | `npm-audit-all-after.json`: braces/glob/ESLint chain; `desktop-audit-all.json`: sprintf-js/builder download chain. Root production audit is zero, but build tooling still processes inputs and must not be called vulnerability-free. | Use trusted build inputs; update when compatible upstream fixes exist. npm's suggested Next lint downgrade to 14.x and builder downgrade to 26.5.0 were not applied. These changes need a separate compatibility decision. [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). | Re-run full root/desktop npm audit and build/package/smoke acceptance after any toolchain change. |
| P1 / UNKNOWN deployed patch | Local package pins/lockfiles changed; hosted GET does not reveal the installed package version. A running old release can retain the production dependency vulnerabilities. | Review and deploy the verified patch through the normal deployment workflow. No deploy was requested/performed. | Confirm deployed package/lock versions and rerun hosted auth/origin/checkout acceptance. |
| P1 / UNKNOWN financial concurrency/recovery | Unit fixtures are not a replica-set transaction test; connected data is too small for capacity evidence. Backup restore and receipts were not executed. | Use a separate replica-set staging database, dedicated accounts and printer/device. Exercise retail/wholesale/mix/count-based/free-item/edit/split/credit/consultation/purchase cancellation, duplicate retry and final-stock contention. Perform an encrypted backup/restore drill there. | Reconcile invoices, payment totals, customer balances, stock allocations, counters, audit rows and restored data; confirm one invoice on retry and no oversell. |
| P2 / FAIL at scale: full-history/source reads | `src/app/api/accounts/route.js:12` still reads complete ledger history; `src/services/report.service.js:24` paginates after materializing data; `src/services/product.service.js:118` returns full catalogue; dashboard loads the selected period's sale lines. | Design database-side aggregates/cursors and a paginated catalogue/search contract in staging, retaining exports, all-history running balances, filters, totals and cart selection. Silently adding a limit would truncate correct financial totals and was not done. | Production-shaped fixtures, query plans, payload sizes, p50/p95/heap/event-loop profiles and exact before/after accounting/report comparisons. |
| P2 / UNKNOWN index scalability | `database.json` records COLLSCAN+SORT for catalogue/recent sales, but only one product/three sales. | Evaluate the concrete index candidates above against staging data. No production index was created merely for this tiny sample. | Compare examined keys/documents, sort spill, timings, write amplification and index size before deploying. |
| P2 / FAIL reliable unattended backups | `usesDatabaseBackupStorage` disables process timer on Vercel; `getBackupStatus` may start a due backup during a GET and waits for it; snapshot/encryption/archive buffering is memory-heavy. | Configure a separately secured scheduled backup route/job or provider-native backup policy with capacity limits; preserve current opportunistic behavior until replacement exists. | Verify backup age without user visits, off-site recovery and function/archive limits; run restore only in staging. |
| P2 / FAIL local self-host configuration | `production-config.txt` reports missing BACKUP_DIR. | Configure an actual durable restricted volume if self-hosting; for Vercel use verified GridFS/provider backups. Do not use an invented temp path to make the check green. | Rerun configuration check in the chosen deployment mode and verify storage/recovery operationally. |
| P2 / UNKNOWN runtime UX/Web Vitals | Login alone was browser-tested; no authenticated user session or target low-end device was used. Logo assets remain eager static PNGs and public login JS is about 195 KB gzip-estimated. | Capture authenticated Sales, catalogue, customers, dashboard, reports and Accounts waterfalls/React profiles on representative data and a throttled device. Recompress branding only after confirming print/desktop artwork requirements. | Multiple cold/warm cycles, field-appropriate FCP/LCP/CLS/INP, exact search/barcode/add/checkout timings and visual/device regression. |
| P2 / UNKNOWN deployment security controls | CSP uses unsafe-inline; gateway rate limits, request body limits, trusted forwarded IP handling, provider logs and secret lifecycle were not verified. | Verify actual proxy/platform configuration; stage a nonce policy and shared rate limiting only with app/print compatibility checks. | Cross-origin tests, multi-instance brute-force tests, upload-size rejection, log review and independent account/cache-isolation tests. |

## Files changed and reproduction

The dependency manifests/lockfiles carry compatible security updates. Application changes are the handlers/services/helpers/components identified in the repaired-issues table. Tests added: `tests/audit-{query-input,csv,lifecycle,role-assignment,origin,dashboard}.test.mjs`; existing staff-credential and production-readiness tests were extended. `DEPLOYMENT.md` documents Vercel backup mode. Root `RESUME.md` contains the handoff; raw logs, screenshots and JSON live in this directory.

Repeat repository checks:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd --prefix desktop test
npm.cmd run build
npm.cmd audit --omit=dev
npm.cmd audit
npm.cmd --prefix desktop audit
```

Read-only / isolated audit commands:

```powershell
node scripts/benchmark-audit-fixtures.mjs
node scripts/audit-database-readonly.mjs
node scripts/audit-runtime.mjs --browser
npm.cmd run check:production
```

The database command uses the environment connection with native read operations and transient `$documents` fixtures only. It prints counts/timings, not credentials or customer records. The runtime command launches its own server on 127.0.0.1:3107 with an unreachable placeholder DB, disables the backup timer, tests unauthenticated guards and optional headless Chrome on debug port 9317, then stops its processes. Browser auth status is a fixture; all other API requests are blocked there. It does not reuse a user's browser profile. Browser execution and registry/database access may require the appropriate local/network permissions.
