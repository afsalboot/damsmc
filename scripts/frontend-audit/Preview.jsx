"use client";
// Test-only component entry. The runner temporarily mounts it outside the
// protected workspace with a fake user and intercepts every API request.
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import SalesCacheBoundary from "@/components/SalesCacheBoundary";
import DashboardWorkspace from "@/components/DashboardWorkspace";
import SalesWorkspaceModern from "@/components/SalesWorkspaceModern";
import SalesCheckoutHostV2 from "@/components/SalesCheckoutHostV2";
import SalesSuccessHost from "@/components/SalesSuccessHost";
import SalesBarcodeHost from "@/components/barcode/SalesBarcodeHost";
import ProductCatalogue from "@/components/ProductCatalogue";
import CustomerWorkspaceAdvanced from "@/components/CustomerWorkspaceAdvanced";
import { SuppliersWorkspace } from "@/components/OperationsWorkspace";
import PurchasesWorkspace from "@/components/PurchasesWorkspace";
import ExpensesWorkspace from "@/components/ExpensesWorkspace";
import AccountsWorkspace from "@/components/AccountsWorkspace";
import ReportsWorkspace from "@/components/ReportsWorkspace";
import ReportCategoryScrollEnhancer from "@/components/ReportCategoryScrollEnhancer";
import StaffWorkspace from "@/components/StaffWorkspace";
import SettingsWorkspace from "@/components/SettingsWorkspace";
import ConsultationWorkspace from "@/components/ConsultationWorkspace";
import NotificationsWorkspace from "@/components/NotificationsWorkspace";
import RecentSalesWorkspace from "@/components/RecentSalesWorkspace";
import SaleSourceDetails from "@/components/SaleSourceDetails";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import LoginPinForm from "@/components/LoginPinForm";
import LoginForm from "@/components/LoginForm";
import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";

export default function Preview() {
  const params = useSearchParams(), screen = params.get("screen") || "sales";
  const screens = {
    dashboard: <DashboardWorkspace />,
    sales: <><SalesWorkspaceModern /><SalesBarcodeHost /><SalesCheckoutHostV2 /><SalesSuccessHost /></>,
    products: <ProductCatalogue />, customers: <CustomerWorkspaceAdvanced />,
    suppliers: <SuppliersWorkspace />, purchases: <PurchasesWorkspace />,
    expenses: <ExpensesWorkspace />, accounts: <AccountsWorkspace />,
    reports: <><ReportCategoryScrollEnhancer /><ReportsWorkspace /></>,
    staff: <StaffWorkspace />, settings: <SettingsWorkspace />,
    consultations: <ConsultationWorkspace />, "consultation-report": <ConsultationWorkspace report />,
    notifications: <NotificationsWorkspace />, "recent-sales": <RecentSalesWorkspace />,
    "sale-details": <SaleSourceDetails id="aaaaaaaaaaaaaaaaaaaaaaaa" />,
    "change-password": <ChangePasswordForm embedded />, "login-pin": <LoginPinForm enabled={false} />,
    "error-fallback": <ErrorPage retry={() => { document.documentElement.dataset.auditRetry = "requested"; }} />,
    "not-found": <NotFound />,
  };
  return <div data-audit-screen={screen}>
    {screen === "login" ? <LoginForm /> : <SalesCacheBoundary identity={{ scope: "frontend-audit-fixture", persistent: false }} enabled={screen === "sales"}>
      <AppShell user={{ name: "UI Audit Operator With A Long Display Name", role: "ADMIN", roleName: "Owner", consultationEnabled: true, permissions: [] }}>{screens[screen]}</AppShell>
    </SalesCacheBoundary>}
  </div>;
}
