import { SETTINGS_DEFAULTS, normalizeSettings } from "../../src/services/settings.service.js";
import { indexRow } from "../../src/lib/sales-index.js";
import { dashboardRange, dashboardChartWindows } from "../../src/lib/dashboard-dates.js";
import { dashboardStock, dashboardWholesale } from "../../src/lib/dashboard-summary.js";
import { inventoryValue } from "../../src/lib/inventory-value.js";
import { getLooseUnit } from "../../src/services/inventory.service.js";
import { readFileSync } from "node:fs";

export const settings = { ...normalizeSettings(structuredClone(SETTINGS_DEFAULTS)), features: { consultation: true }, _capabilities: { role: "ADMIN", edit: true, audit: true, reset: true, backup: true, backupStorage: "mongodb" } };
export const category = { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Ayurvedic Medicines and Therapeutic Preparations", slug: "medicines", active: true, productCount: 24 };
export const products = Array.from({ length: 24 }, (_, i) => ({
  _id: i.toString(16).padStart(24, "0"), name: i ? `Classical Ayurvedic Preparation ${i + 1}` : "LongProductNameWithoutSpacesForResponsiveLayoutVerificationAndOverflowChecks",
  sku: `AUDIT-${i + 1}`, barcode: `999000${String(i).padStart(6, "0")}`, manufacturer: "UI Audit Fixture Manufacturer", categoryId: category,
  active: true, visibleInSales: true, baseUnit: "ml", packageUnit: "ml", packageType: "Bottle", packageSize: 100, packageSellingPrice: 125.5,
  allowPackageSale: true, allowLooseSale: true, allowMixture: true, loosePricingMethod: "per_base_unit", loosePricePerUnit: 1.255, looseUnit: "ml", reorderLevel: 5,
  stock: { sealedPackages: 100, openQuantity: 500, totalBaseQuantity: 10500, totalLooseQuantity: 10500, hasStock: true, availablePackages: 105 }, stockLabel: "100 Bottles + 500 ml", batches: [],
  valuation: { knownCost: 7000, costValue: 7000, sellingValue: 13177.5, missingCostBatches: 0 }, nearestExpiry: null, updatedAt: "2026-10-16T00:00:00.000Z",
}));
const pagination = { page: 1, limit: 20, total: 0, pages: 1 };
const doctor = { _id: "dddddddddddddddddddddddd", name: "UI Audit Doctor", qualification: "BAMS", consultationFee: 200, active: true };
const role = { _id: "cccccccccccccccccccccccc", name: "Cashier", slug: "cashier", permissions: { sales: { view: true, create: true }, products: { view: true } }, active: true };
const sale = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", invoiceNumber: "AUDIT-PREVIEW-ONLY", createdAt: "2026-10-16T06:00:00Z", total: 125.5, subtotal: 125.5, amountPaid: 125.5, balanceDue: 0, items: [{ ...products[1], name: products[1].name, productId: products[1]._id, kind: "PRODUCT", saleMode: "PACKAGE", quantity: 1, packageSellingPrice: 125.5, total: 125.5 }], payments: [{ method: "CASH", amount: 125.5 }], customerSnapshot: { name: "UI Audit Customer With A Long Name", phone: "0000000000" }, cashierSnapshot: { name: "Audit Operator" }, storeSnapshot: settings.store, paymentStatus: "PAID", discount: 0, tax: 0, roundOff: 0 };
const chain = rows => ({ populate() { return this; }, lean: async () => rows });
const dashboardSource = readFileSync("src/lib/server/dashboard-data.js", "utf8").replace(/^import .*;\r?\n/gm, "").replace("export async function", "async function");
const dashboardDeps = { dashboardRange, dashboardChartWindows, dashboardStock, dashboardWholesale, valueInventory: inventoryValue, getLooseUnit, getSettings: async () => settings,
  Sale: { find: () => chain([]) }, Expense: { find: () => chain([]) }, Purchase: { find: () => chain([]) }, Product: { find: () => chain([]) }, InventoryBatch: { find: () => chain([]) },
  Customer: { countDocuments: async () => 0 }, Supplier: { countDocuments: async () => 0 }, User: { countDocuments: async () => 0 }, Consultation: { aggregate: async () => [] } };
const getDashboard = new Function(...Object.keys(dashboardDeps), `${dashboardSource};return getDashboardData;`)(...Object.values(dashboardDeps));

export async function fixtureResponse(url, mode = "populated") {
  const { pathname: path, searchParams: params } = new URL(url);
  if (mode === "loading") await new Promise(resolve => setTimeout(resolve, 3500));
  if (mode === "error" && !["/api/settings", "/api/notifications", "/api/auth/status"].includes(path)) return { status: 503, data: null, error: "Preview network unavailable. Please retry." };
  const empty = mode === "empty";
  const catalog = mode === "single" ? products.slice(1, 2) : products;
  let data;
  if (path === "/api/settings") data = settings;
  else if (path === "/api/settings/receipt") data = { receipt: settings.receipt };
  else if (path === "/api/auth/status") data = { needsBootstrap: false };
  else if (path === "/api/categories") data = [category];
  else if (path === "/api/products/sales-index") {
    data = empty ? [] : params.has("membership") ? catalog.map(row => row._id) : params.get("details") === "true" ? catalog.filter(row => params.get("ids")?.split(",").includes(row._id)) : catalog.map(indexRow);
  } else if (path === "/api/products") data = empty ? [] : products;
  else if (path === "/api/products/duplicates") data = { groups: [], canMerge: true };
  else if (path.startsWith("/api/products/")) data = { ...products[1], batches: [], history: [], salesHistory: [] };
  else if (path === "/api/dashboard") data = { ...await getDashboard(params.get("range") || "today", params.get("from"), params.get("to")), currentUser: { name: "Audit Operator" } };
  else if (path === "/api/customers/search") data = [];
  else if (path === "/api/customers") data = { rows: [], meta: pagination, kpis: {}, highValueThreshold: 10000 };
  else if (path === "/api/suppliers") data = [];
  else if (path === "/api/purchases" || path === "/api/expenses") data = { rows: [], pagination, kpis: {}, categoryBreakdown: [], categories: [], paymentMethods: ["CASH", "UPI", "BANK"] };
  else if (path === "/api/expense-categories") data = [];
  else if (path === "/api/accounts") data = { movements: [], pagination, summary: {}, paymentMethods: [], enabledMethods: ["CASH", "UPI", "BANK"], cashFlow: [], supportedTypes: [], supportedSources: [] };
  else if (path === "/api/staff") data = { rows: [], roles: [role], pagination, kpis: {}, capabilities: { create: true, edit: true, deactivate: true, managePermissions: true, manageRoles: true, resetPassword: true } };
  else if (path === "/api/staff/options" || path === "/api/roles") data = [role];
  else if (path === "/api/doctors") data = { rows: [doctor], canManage: true };
  else if (path === "/api/consultations/options") data = { doctors: [doctor], payments: { enabledMethods: ["CASH", "UPI", "BANK"], requireReference: {} }, receipt: settings.receipt, store: settings.store, capabilities: { create: true, edit: true, delete: true, print: true, cancel: true, overrideFee: true, customers: true, resetTokens: true } };
  else if (path === "/api/consultations") data = { rows: [], pagination, summary: {} };
  else if (path === "/api/notifications") data = { items: [], unreadCount: 0, count: 0 };
  else if (path === "/api/sales") data = params.get("view") === "recent" ? { sales: empty ? [] : [sale], summary: {}, pagination: { ...pagination, total: empty ? 0 : 1 } } : [];
  else if (path.startsWith("/api/sales/")) data = sale;
  else if (path.startsWith("/api/reports/")) data = { title: "Reports", description: "Preview data only", rows: [], columns: [], kpis: [], charts: {}, pagination, access: { allowed: ["overview", "sales", "inventory", "purchases", "expenses", "customers", "cash-flow", "staff"], canExport: true } };
  else if (path === "/api/backups") data = { storage: "mongodb", configured: true, backups: [], automaticEnabled: false, directory: "UI preview only", frequency: "DAILY" };
  else if (path === "/api/settings/audit") data = { rows: [], pagination };
  else if (path === "/api/settings/invoice-reset") data = { nextInvoiceNumber: "AUDIT-ONLY", canReset: true };
  else return { status: 404, error: `Missing UI fixture: ${path}` };
  if (mode === "dense") {
    const timestamp = "2026-10-16T06:00:00Z";
    const long = "LongUnbrokenDirectoryNameForResponsiveOverflowVerification";
    const rows = Array.from({ length: 20 }, (_, index) => ({
      _id: `fixture-${index}`, id: `fixture-${index}`, name: `${long}${index}`, businessName: long,
      email: `${long.toLowerCase()}@example.invalid`, phone: "0000000000", address: long.repeat(2), active: true,
      createdAt: timestamp, lastPurchaseAt: timestamp, lastLoginAt: timestamp, expenseDate: timestamp, purchasedAt: timestamp, date: timestamp,
      purchaseCount: 12345, totalSpent: 12345678.9, averageBill: 123456.78, totalPurchased: 12345678.9,
      customerType: "RETAIL", roleId: role, effectivePermissions: [], permissionOverrides: {},
      purchaseNumber: `AUDIT-${index}`, supplierId: { name: long }, supplierSnapshot: { name: long },
      supplierInvoiceNumber: long, items: [{ productId: products[1]._id, quantity: 123456, freeQuantity: 12 }],
      purchaseStatus: "RECEIVED", paymentStatus: "PAID", paymentMethod: "CASH", total: 12345678.9, balanceDue: 0,
      title: long, description: long.repeat(2), category: "Operations", source: "MANUAL", status: "ACTIVE", accountAmount: 12345678.9,
      staffSnapshot: { name: long }, type: "SALE", reference: `AUDIT-${index}`, party: long, method: "CASH", direction: "IN", amount: 12345678.9, runningBalance: 98765432.1,
      patient: { name: long, phone: "0000000000" }, doctorSnapshot: { name: long }, consultationFee: 12345678.9, opNumber: `AUDIT-${index}`, tokenNumber: index + 1,
    }));
    if (path === "/api/suppliers") data = rows;
    if (["/api/customers", "/api/purchases", "/api/expenses", "/api/staff", "/api/consultations"].includes(path)) {
      data = { ...data, rows, pagination: { ...pagination, total: 200, pages: 10 }, meta: { ...pagination, total: 200, pages: 10 } };
    }
    if (path === "/api/accounts") data = { ...data, movements: rows, pagination: { ...pagination, total: 200, pages: 10 } };
  }
  return { status: 200, data };
}
