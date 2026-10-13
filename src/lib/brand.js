export const BRAND_NAME = "Dr Abdulla’s Ayurvedic Multi Speciality Medical Center";
export const BRAND_APP_NAME = "Dr Abdulla’s Ayurvedic POS";
export const BRAND_LOGO = "/brand/dr-abdullas-logo.png";
export const BRAND_HEADER_LOGO = "/brand/dr-abdullas-horizontal.png";
export const BRAND_ICON = "/brand/dr-abdullas-icon.png";
export const BRAND_RECEIPT_LOGO = "/brand/dr-abdullas-receipt-v3.png";
export const BRAND_ADDRESS = "Panthavoor, Perumukku";
export const BRAND_PHONE = "9895973858";

// Read legacy default branding without changing persisted business records.
export function brandStoreName(value) {
  const name = String(value || "").trim();
  return !name || /^oushad(?:h)?i(?:\s+pos)?$/i.test(name) ? BRAND_NAME : name;
}
