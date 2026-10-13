import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { BRAND_RECEIPT_LOGO } from "../src/lib/brand.js";

test("thermal logo has opaque black ink and white paper without translucent or grey fills", async () => {
  const image = sharp(fileURLToPath(new URL(`../public${BRAND_RECEIPT_LOGO}`, import.meta.url)));
  const metadata = await image.metadata();
  assert.equal(metadata.hasAlpha, false, "Transparency can disappear during printer rasterization");
  const { data, info } = await image.greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 992);
  let ink = 0;
  for (const pixel of data) {
    assert.ok(pixel === 0 || pixel === 255, "Thermal artwork must contain only solid black and white");
    if (pixel === 0) ink++;
  }
  assert.ok(ink / data.length > 0.2 && ink / data.length < 0.6, "Filled logo shapes must be present without flooding the paper");
});
