import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DESKTOP_APP_ID, DESKTOP_PROFILE_NAME } from "./identity.mjs";
const require = createRequire(import.meta.url);
const { AppInfo } = require("app-builder-lib/out/appInfo.js");
const { getWindowsInstallationDirName } = require("app-builder-lib/out/targets/targetUtil.js");
const { UUID } = require("builder-util-runtime");
const metadata = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("./package-lock.json", import.meta.url), "utf8"));
const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
const namespace = UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3");
const appInfo = pkg => new AppInfo({ metadata: pkg, config: pkg.build });
const guid = pkg => pkg.build.nsis?.guid || UUID.v5(appInfo(pkg).id, namespace);
const legacy = { name: "oushadhi-pos-desktop", version: "0.1.6", build: { appId: "com.oushadhi.pos", productName: "Oushadhi POS" } };

test("Dr Abdulla and Oushadhi generate different NSIS registrations and installation directories", () => {
  assert.notEqual(guid(metadata), guid(legacy));
  assert.notEqual(getWindowsInstallationDirName(appInfo(metadata), true), getWindowsInstallationDirName(appInfo(legacy), true));
  const oldClone = { ...legacy, build: { ...legacy.build, productName: metadata.build.productName } };
  assert.notEqual(getWindowsInstallationDirName(appInfo(metadata), true), getWindowsInstallationDirName(appInfo(oldClone), true));
  assert.notEqual(metadata.name, legacy.name);
});
test("runtime profile and taskbar identities match this customer's installer", () => {
  assert.equal(DESKTOP_APP_ID, metadata.build.appId);
  assert.equal(DESKTOP_PROFILE_NAME, metadata.name);
  assert.notEqual(DESKTOP_PROFILE_NAME, legacy.name);
  assert.ok(metadata.build.files.includes("identity.mjs"));
  assert.ok(main.includes("app.setAppUserModelId(DESKTOP_APP_ID)"));
  assert.ok(main.includes('join(app.getPath("appData"), DESKTOP_PROFILE_NAME)'));
  assert.equal(main.includes('"com.oushadhi.pos"'), false);
  assert.equal(main.includes('"oushadhi-pos-desktop"'), false);
});
test("release and lockfile metadata stay synchronized", () => {
  assert.equal(metadata.version, "0.1.7");
  assert.equal(lock.name, metadata.name);
  assert.equal(lock.version, metadata.version);
  assert.equal(lock.packages[""].name, metadata.name);
  assert.equal(lock.packages[""].version, metadata.version);
});
