import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("scanner stops a camera that resolves after the effect has been cleaned up", async () => {
  const source = readFileSync(new URL("../src/components/barcode/CameraBarcodeScanner.jsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("    let active = true;"), source.indexOf("  }, [deviceId, onDetected, retry]);"))
    .replace('await import("@zxing/browser")', "await loadReader()");
  let resolveControls;
  let stopped = 0;
  let enumerated = 0;
  const controlsRef = { current: null };
  const videoRef = { current: { srcObject: null } };
  const deps = { controlsRef, videoRef, lockedRef: { current: false }, deviceId: "", setLoading() {}, setError() {}, setDevices() {}, onDetected() {},
    loadReader: async () => ({ BrowserMultiFormatReader: class {
      decodeFromConstraints() { return new Promise(resolve => { resolveControls = resolve; }); }
      static async listVideoInputDevices() { enumerated++; return []; }
    } }) };
  const cleanup = new Function(...Object.keys(deps), effect)(...Object.values(deps));
  await new Promise(setImmediate);
  cleanup();
  resolveControls({ stop: () => stopped++ });
  await new Promise(setImmediate);
  assert.equal(stopped, 1);
  assert.equal(enumerated, 0);
  assert.equal(controlsRef.current, null);
});

test("confirmation dialog lets Enter activate the focused Cancel button", () => {
  const source = readFileSync(new URL("../src/components/ConfirmDialog.jsx", import.meta.url), "utf8");
  const keydownSource = source.slice(source.indexOf("    const keydown ="), source.indexOf('    document.addEventListener("keydown", keydown);'));
  let confirmed = 0, cancelled = 0, prevented = false;
  const deps = { loading: false, disabled: false, onConfirm: () => confirmed++, onCancel: () => cancelled++ };
  const handler = new Function(...Object.keys(deps), `${keydownSource};return keydown;`)(...Object.values(deps));
  handler({ key: "Enter", preventDefault: () => { prevented = true; } });
  assert.equal(confirmed, 0);
  assert.equal(prevented, false);
  handler({ key: "Escape", preventDefault: () => { prevented = true; } });
  assert.equal(cancelled, 1);
});
