# Discovered route surface

Page access inherits the workspace layout where applicable; the API guard column is static source evidence, not a full permission verdict.

| URL | Methods | Source | Explicit API requirements |
| --- | --- | --- | --- |
| / | GET | src/app/page.js | Page/layout |
| /login | GET | src/app/login/page.js | Page/layout |
| /change-password | GET | src/app/change-password/page.js | Page/layout |
| /api/suppliers | GET, POST | src/app/api/suppliers/route.js | "purchases.view", "purchases.create" |
| /api/suppliers/[id] | GET, PUT, DELETE | src/app/api/suppliers/[id]/route.js | "purchases.view", "purchases.edit", "ADMIN" |
| /api/staff | GET, POST | src/app/api/staff/route.js | "staff.view", "staff.create", "staff.managePermissions" |
| /api/staff/[id] | GET, PATCH, PUT, DELETE | src/app/api/staff/[id]/route.js | "staff.view", "staff.edit", "staff.managePermissions", "staff.deactivate" |
| /api/staff/[id]/reset-password | POST | src/app/api/staff/[id]/reset-password/route.js | "staff.resetPassword" |
| /api/staff/[id]/reactivate | POST | src/app/api/staff/[id]/reactivate/route.js | "staff.deactivate" |
| /api/staff/[id]/deactivate | POST | src/app/api/staff/[id]/deactivate/route.js | "staff.deactivate" |
| /api/staff/[id]/activity | GET | src/app/api/staff/[id]/activity/route.js | "staff.view" |
| /api/staff/options | GET | src/app/api/staff/options/route.js | "expenses" |
| /api/settings | GET, PATCH, PUT | src/app/api/settings/route.js | "settings.view", "settings.edit", "ADMIN" |
| /api/settings/reset | POST | src/app/api/settings/reset/route.js | "ADMIN" |
| /api/settings/receipt | GET | src/app/api/settings/receipt/route.js | session |
| /api/settings/invoice-reset | GET, POST | src/app/api/settings/invoice-reset/route.js | "ADMIN" |
| /api/settings/audit | GET | src/app/api/settings/audit/route.js | "settings.edit" |
| /api/search | GET | src/app/api/search/route.js | "ADMIN" |
| /api/sales | GET, POST | src/app/api/sales/route.js | "sales.view", "sales.create", "ADMIN" |
| /api/sales/[id] | GET | src/app/api/sales/[id]/route.js | "sales.view", "ADMIN" |
| /api/roles | GET, POST | src/app/api/roles/route.js | "staff.view", "staff.manageRoles" |
| /api/roles/[id] | PATCH, DELETE | src/app/api/roles/[id]/route.js | "staff.manageRoles" |
| /api/reports/[type] | GET | src/app/api/reports/[type]/route.js | "reports.view", `reports.${permission}`, "reports.export" |
| /api/purchases | GET, POST | src/app/api/purchases/route.js | "purchases.view", "purchases.create" |
| /api/purchases/[id] | GET, PUT, PATCH, DELETE | src/app/api/purchases/[id]/route.js | "purchases.view", "purchases.edit", "ADMIN" |
| /api/purchases/[id]/stock-transactions | GET | src/app/api/purchases/[id]/stock-transactions/route.js | "purchases.view" |
| /api/purchases/[id]/cancel | POST | src/app/api/purchases/[id]/cancel/route.js | "purchases.cancel" |
| /api/products | GET, POST, PUT, PATCH, DELETE | src/app/api/products/route.js | "products.view", "products.create", "products.edit", "products.deactivate", "ADMIN" |
| /api/products/[id] | GET | src/app/api/products/[id]/route.js | "products.view" |
| /api/products/[id]/stock | POST | src/app/api/products/[id]/stock/route.js | "products.stockAdjust" |
| /api/products/[id]/adjustment | POST | src/app/api/products/[id]/adjustment/route.js | "products.stockAdjust" |
| /api/products/sales-index | GET | src/app/api/products/sales-index/route.js | "products.view" |
| /api/products/merge | POST | src/app/api/products/merge/route.js | "ADMIN" |
| /api/products/import | POST | src/app/api/products/import/route.js | "products.import" |
| /api/products/duplicates | GET | src/app/api/products/duplicates/route.js | "products.view" |
| /api/products/bulk | PATCH, DELETE | src/app/api/products/bulk/route.js | "products.edit", "ADMIN" |
| /api/products/barcode/[barcode] | GET | src/app/api/products/barcode/[barcode]/route.js | "products.view" |
| /api/products/barcode/generate | POST | src/app/api/products/barcode/generate/route.js | "products.create" |
| /api/notifications | GET, PATCH, DELETE | src/app/api/notifications/route.js | "products.view" |
| /api/health | GET | src/app/api/health/route.js | Public or delegated; inspect source |
| /api/expenses | GET, POST | src/app/api/expenses/route.js | "expenses.view", "expenses.create" |
| /api/expenses/[id] | GET, PATCH | src/app/api/expenses/[id]/route.js | "expenses.view", "expenses.edit" |
| /api/expenses/[id]/void | POST | src/app/api/expenses/[id]/void/route.js | "expenses.void" |
| /api/expense-categories | GET, POST | src/app/api/expense-categories/route.js | "expenses.view", "expenses.manageCategories" |
| /api/expense-categories/[id] | PATCH, DELETE | src/app/api/expense-categories/[id]/route.js | "expenses.manageCategories" |
| /api/doctors | GET, POST | src/app/api/doctors/route.js | "doctor.view", "doctor.manage" |
| /api/doctors/[id] | PATCH | src/app/api/doctors/[id]/route.js | "doctor.manage" |
| /api/dashboard | GET | src/app/api/dashboard/route.js | "dashboard.view" |
| /api/customers | GET, POST | src/app/api/customers/route.js | "customers.view", "customers.create" |
| /api/customers/[id] | GET, PATCH, DELETE | src/app/api/customers/[id]/route.js | "customers.view", "customers.edit", "customers.deactivate" |
| /api/customers/search | GET | src/app/api/customers/search/route.js | "customers.view" |
| /api/consultations | GET, POST | src/app/api/consultations/route.js | "consultation.view", "consultation.create" |
| /api/consultations/[id] | GET, PATCH, DELETE | src/app/api/consultations/[id]/route.js | "consultation.view", "consultation.edit", "consultation.delete" |
| /api/consultations/[id]/cancel | POST | src/app/api/consultations/[id]/cancel/route.js | "consultation.cancel" |
| /api/consultations/reset-tokens | POST | src/app/api/consultations/reset-tokens/route.js | "ADMIN" |
| /api/consultations/options | GET | src/app/api/consultations/options/route.js | "consultation.view" |
| /api/categories | GET, POST, PUT, DELETE | src/app/api/categories/route.js | "products.view", "products.create", "products.edit", "ADMIN" |
| /api/backups | GET, POST | src/app/api/backups/route.js | "ADMIN" |
| /api/backups/[name] | GET | src/app/api/backups/[name]/route.js | "ADMIN" |
| /api/backups/restore | POST | src/app/api/backups/restore/route.js | "ADMIN" |
| /api/backups/folders | GET | src/app/api/backups/folders/route.js | "ADMIN" |
| /api/auth/users | GET | src/app/api/auth/users/route.js | Public or delegated; inspect source |
| /api/auth/username-login | POST | src/app/api/auth/username-login/route.js | Public or delegated; inspect source |
| /api/auth/status | GET | src/app/api/auth/status/route.js | Public or delegated; inspect source |
| /api/auth/pin-login | POST | src/app/api/auth/pin-login/route.js | Public or delegated; inspect source |
| /api/auth/pin | POST | src/app/api/auth/pin/route.js | session |
| /api/auth/logout | POST | src/app/api/auth/logout/route.js | Public or delegated; inspect source |
| /api/auth/login | POST | src/app/api/auth/login/route.js | Public or delegated; inspect source |
| /api/auth/change-password | POST | src/app/api/auth/change-password/route.js | session (readSession) |
| /api/auth/bootstrap | POST | src/app/api/auth/bootstrap/route.js | Public or delegated; inspect source |
| /api/accounts | GET | src/app/api/accounts/route.js | "accounts" |
| /suppliers | GET | src/app/(workspace)/suppliers/page.js | Page/layout |
| /staff | GET | src/app/(workspace)/staff/page.js | Page/layout |
| /settings | GET | src/app/(workspace)/settings/page.js | session |
| /settings/login-pin | GET | src/app/(workspace)/settings/login-pin/page.js | session |
| /settings/change-password | GET | src/app/(workspace)/settings/change-password/page.js | session |
| /sales | GET | src/app/(workspace)/sales/page.js | Page/layout |
| /sales/[id] | GET | src/app/(workspace)/sales/[id]/page.js | Page/layout |
| /sales/recent | GET | src/app/(workspace)/sales/recent/page.js | Page/layout |
| /sales/new | GET | src/app/(workspace)/sales/new/page.js | Page/layout |
| /reports | GET | src/app/(workspace)/reports/page.js | Page/layout |
| /purchases | GET | src/app/(workspace)/purchases/page.js | Page/layout |
| /products | GET | src/app/(workspace)/products/page.js | Page/layout |
| /notifications | GET | src/app/(workspace)/notifications/page.js | Page/layout |
| /login-pin | GET | src/app/(workspace)/login-pin/page.js | Page/layout |
| /expenses | GET | src/app/(workspace)/expenses/page.js | Page/layout |
| /dashboard | GET | src/app/(workspace)/dashboard/page.js | Page/layout |
| /customers | GET | src/app/(workspace)/customers/page.js | Page/layout |
| /consultations | GET | src/app/(workspace)/consultations/page.js | "consultation.view" |
| /consultations/report | GET | src/app/(workspace)/consultations/report/page.js | "consultation.view" |
| /accounts | GET | src/app/(workspace)/accounts/page.js | Page/layout |
