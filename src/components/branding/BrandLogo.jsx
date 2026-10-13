import { BRAND_NAME, BRAND_LOGO, BRAND_HEADER_LOGO, BRAND_ICON } from "@/lib/brand";

export default function BrandLogo({ compact = false, full = false, tone = "brand", className = "" }) {
  return (
    <span className={`brand-logo brand-logo--${tone}${compact ? " brand-logo--compact" : ""}${full ? " brand-logo--full" : ""}${className ? ` ${className}` : ""}`}>
      {/* Static artwork also works in isolated desktop and print documents. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={compact ? BRAND_ICON : full ? BRAND_LOGO : BRAND_HEADER_LOGO} alt={BRAND_NAME} loading="eager" />
    </span>
  );
}
