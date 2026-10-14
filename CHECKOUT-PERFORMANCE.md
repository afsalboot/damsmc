# Checkout and payment checks

14 October 2026 ? PVAMSP POS, local production build in Chrome and the actual Electron shell. Hosted deployment and installed-client behavior were not tested.

## No sales or stock changes

No checkout was submitted, payment taken, sale edited, refund issued, stock adjusted, receipt printed or backup run. The isolated clients had a DevTools request guard that blocked non-read API methods except ordinary login/logout. Neither completed run attempted a financial write; the guard recorded no blocked attempts because the runner only opened, edited and cancelled the payment form.

Full-document SHA-256 fingerprints of the configured database's sales, inventorybatches and stocktransactions matched exactly before and after the work. Counts stayed at 2 sales, 1 inventory batch and 3 stock transactions. Authentication can update the signed-in user's session activity; sales and stock records were unchanged.

Evidence: [before fingerprints](performance-results/checkout-before.json), [after fingerprints](performance-results/checkout-after.json). No document contents, credentials or customer records were exported.

## Implemented fixes

- SalesCheckoutHostV2.jsx now reuses one currency formatter. Its existing calculateSalePricing call is memoized against the actual cart, customer consultation fields, wholesale state, edit data, discount reason, Settings, payment method and place of supply. Cash received, split amount and reference typing no longer rerun invoice pricing. Tax, discount, rounding and stock calculations were not changed.
- A synchronous submittingRef guard now covers customer duplicate lookup and the entire asynchronous submit path. Two clicks in the same React update cannot both enter lookup/payment submission. It applies to normal and direct checkout, releases in finally, and surfaces an early lookup failure instead of leaving an unhandled rejection. Existing server idempotency keys and uncertain-result retry handling remain unchanged.
- Aborted wholesale customer-search successes can no longer replace the current results or clear a newer search indicator.

## Five-cycle production UI results

Milliseconds; paint is approximated by two animation-frame boundaries. DOM readiness/dispatch timings, request start timestamps, HTTP statuses and Server-Timing where present are stored in the raw JSON. All measurements use isolated temporary profiles and --disable-gpu; no p95 is inferred.

| Action | Chrome median paint | Chrome individual samples | Electron median paint | Electron individual samples |
|---|---:|---|---:|---|
| Open checkout/payment | 19.4 | 19.4, 20.9, 18.9, 18.7, 20.6 | 20.4 | 54.2, 20.4, 20.1, 19.5, 21.0 |
| Cash received entry | 12.5 | 13.1, 11.8, 12.6, 12.5, 12.0 | 12.4 | 12.2, 12.4, 12.5, 13.3, 12.4 |
| Select UPI | 12.8 | 11.9, 13.7, 12.7, 13.4, 12.8 | 12.1 | 11.7, 12.1, 11.9, 13.0, 12.4 |
| Reference entry | 13.6 | 12.1, 11.9, 13.9, 13.9, 13.6 | 13.6 | 14.2, 13.3, 13.7, 13.6, 13.5 |
| Select Split | 12.8 | 14.2, 12.3, 12.6, 12.8, 13.0 | 12.6 | 13.3, 12.6, 12.2, 12.5, 12.8 |
| Split cash entry | 13.3 | 13.3, 14.4, 13.3, 12.8, 12.3 | 13.3 | 11.3, 13.3, 13.5, 12.9, 14.2 |
| Split UPI entry | 12.7 | 12.5, 12.0, 12.7, 13.3, 12.7 | 13.2 | 14.1, 13.3, 12.9, 13.2, 11.7 |
| Cancel checkout | 19.9 | 18.6, 20.2, 20.0, 18.8, 19.9 | 19.5 | 18.4, 19.9, 18.4, 19.5, 19.5 |

All five Chrome cycles made zero API requests. Electron's first opening made one GET /api/settings while the Sales settings load was still settling; it painted in 54.2 ms. The remaining four Electron cycles made zero API requests. No sales/payment POST or inventory mutation occurred. Cash and matching split inputs enabled the existing completion control in all five cycles; that control was inspected but never clicked.

Raw data: [Chrome](performance-results/checkout-browser.json), [Electron](performance-results/checkout-electron.json). There is no untouched-code before benchmark, so these are measured final timings, not a claimed quantified speedup. The initial runner stopped on an explicit-submit-attribute selector mismatch; the corrected runs use the DOM button type property. Neither initial run submitted payment.

## Submission and payment verification with isolated fixtures

The actual checkout handler and server route code run with deferred promises or an in-memory transactional model harness, never the configured MongoDB. New regressions cover simultaneous clicks, direct checkout locking, lookup failures/unlock, UPI and split acceptance, amount mismatch, disabled methods, Settings-required references and Settings-disabled split payment. Invalid payments leave fixture stock, the original bill and audit writes unchanged; successful fixture edits allocate stock once.

Existing and expanded checkout-request tests verify that network failure, malformed success bodies, HTTP 500, 408 and 429 retain the same idempotency key; changed uncertain request bodies are rejected; definitive 4xx responses clear the pending request. Existing tests also cover pricing, rounding, wholesale credit, edited historical prices, external purchases, loose/count/package inventory and rollback.

A successful live checkout commit and its real MongoDB/payment/receipt latency remain unmeasured because exercising that transaction would change sales and stock. Fixture runtime is not presented as live HTTP or database latency.

## Remaining checks and existing UI findings

- New retail Cash/UPI/Split and normal cancellation were measured live. Wholesale Credit, Bank/Card historical edits, delivery/consultation/tax variants, customer selection and actual payment submission were not exercised in the live UI; relevant existing fixture tests passed.
- The payment selector and reference labels still do not fully reflect Settings: SalesCheckoutHostV2.jsx renders Cash/UPI/Split and calls the reference optional, while src/app/api/sales/route.js rejects disabled methods, required missing references and disallowed split payments. The fixture checks prove server rejection/rollback, not complete UI guidance. This performance pass preserves the existing available-method layout and server business rules.
- Payment submission still performs authoritative customer resolution when entered details need matching. No global customer cache or unsafe authorization cache was introduced.
- Normal production logging remains unchanged. No deployment, publication or installer rebuild was performed.

## Checks and changed files

Full application tests: 353/353 passed. Electron tests: 20/20 passed. Production build passed. ESLint: 0 errors and the same 3 pre-existing warnings in ExpensesWorkspace.jsx and SalesWorkspaceModern.jsx. git diff --check passed.

This follow-up changed src/components/SalesCheckoutHostV2.jsx; tests/checkout-request.test.mjs and tests/sale-edit.test.mjs; added tests/checkout-submit-lock.test.mjs, scripts/benchmark-checkout-ui.mjs and scripts/snapshot-checkout-readonly.mjs; and extended scripts/benchmark-sales-ui.mjs with a guarded --checkout mode. Prior Sales cache and unrelated desktop changes were preserved. No server checkout/payment or inventory business logic was changed in this follow-up.

## Reproduction

From the repository root, PowerShell:

```powershell
npm.cmd test
npm.cmd run desktop:test
npm.cmd run lint
npm.cmd run build
node --env-file=.env.local scripts/snapshot-checkout-readonly.mjs before

# Terminal 1: normal production build
node node_modules/next/dist/bin/next start --port 3000

# Terminal 2: sign in only inside each isolated app window
node scripts/benchmark-sales-ui.mjs browser --checkout
node scripts/benchmark-sales-ui.mjs electron --checkout
node --env-file=.env.local scripts/snapshot-checkout-readonly.mjs after
```

The runners close their owned native runtimes and remove their own temporary profiles. The local benchmark server used for this check was stopped afterward.
