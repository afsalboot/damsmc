import "./globals.css";
import { BRAND_APP_NAME, BRAND_NAME } from "@/lib/brand";
import { Toaster } from "sonner";
import NumberInputDefaults from "@/components/NumberInputDefaults";
import ModalTooltipEnhancer from "@/components/ModalTooltipEnhancer";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import PurchaseBarcodeHost from "@/components/barcode/PurchaseBarcodeHost";

export const metadata = {
  title: BRAND_APP_NAME,
  description: `Point of sale and inventory management for ${BRAND_NAME}`,
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NumberInputDefaults />
        <ModalTooltipEnhancer />
        <PurchaseBarcodeHost />
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
