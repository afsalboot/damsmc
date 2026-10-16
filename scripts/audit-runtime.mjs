// Isolated production smoke: fake local DB URI, disabled scheduler, no credentials.
// Every protected method is exercised WITHOUT a session. Never authenticates.
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
const output = "docs/audits/2026-10-16";
const base = "http://127.0.0.1:3107";
const files = (await readdir("src/app", { recursive: true })).map(file => file.replaceAll("\\", "/"));
const routePath = file => "/" + file.replace(/\/(?:page|route)\.js$/, "").replace(/^(?:page|route)\.js$/, "").split("/").filter(part => part && !part.startsWith("(")).join("/");
const inventory = [];
for (const file of files.filter(file => /(?:^|\/)(page|route)\.js$/.test(file))) {
  const source = await readFile(`src/app/${file}`, "utf8");
  const api = file.endsWith("route.js");
  const methods = api ? [...source.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(match => match[1]) : ["GET"];
  if (api && !methods.length && /export\s*\{\s*POST\s*\}/.test(source)) methods.push("POST");
  const requirements = [...new Set([...source.matchAll(/requireSession\(([^)]*)\)/g)].map(match => match[1] || "session"))];
  if (api && /await readSession\(/.test(source)) requirements.push("session (readSession)");
  inventory.push({ source: `src/app/${file}`, path: routePath(file), api, methods, requirements });
}
await writeFile(`${output}/route-inventory.json`, JSON.stringify(inventory, null, 2));
await writeFile(`${output}/routes.md`, "# Discovered route surface\n\nPage access inherits the workspace layout where applicable; the API guard column is static source evidence, not a full permission verdict.\n\n| URL | Methods | Source | Explicit API requirements |\n| --- | --- | --- | --- |\n" + inventory.map(row => `| ${row.path} | ${row.methods.join(", ")} | ${row.source} | ${row.requirements.join(", ") || (row.api ? "Public or delegated; inspect source" : "Page/layout")} |`).join("\n") + "\n");
const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3107"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production", BACKUP_SCHEDULER_ENABLED: "false", MONGODB_URI: "mongodb://127.0.0.1:1/audit_runtime", JWT_SECRET: "isolated-audit-placeholder-secret-1234567890" },
});
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });
const result = { isolated: true, liveDatabase: false, requests: [], loginSamples: [] };
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  if (!ready) throw Error("Isolated server did not start");
  for (const row of inventory) {
    if (row.api && !row.requirements.length) continue;
    if (!row.api && row.path === "/login") continue;
    const path = row.path.replaceAll(/\[[^\]]+\]/g, row.path.includes("reports/") ? "sales" : "000000000000000000000000");
    for (const method of row.methods) {
      const start = performance.now();
      const response = await fetch(base + path, { method, redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { ...(method !== "GET" && method !== "HEAD" ? { "Content-Type": "application/json" } : {}) },
        ...(method !== "GET" && method !== "HEAD" ? { body: "{}" } : {}) });
      await response.arrayBuffer();
      result.requests.push({ path: row.path, method, status: response.status, milliseconds: performance.now() - start, location: response.headers.get("location"),
        passed: row.api ? response.status === 401 : [307, 308].includes(response.status) });
    }
  }
  for (let cycle = 0; cycle < 5; cycle++) {
    const start = performance.now();
    const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(5000) });
    const html = await response.text();
    result.loginSamples.push({ milliseconds: performance.now() - start, htmlBytes: Buffer.byteLength(html), gzipBytes: gzipSync(html).length });
    if (cycle === 0) {
      result.headers = Object.fromEntries([...response.headers].filter(([key]) => ["cache-control", "content-security-policy", "strict-transport-security", "x-frame-options", "permissions-policy", "x-content-type-options", "x-powered-by"].includes(key)));
      const scripts = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]))];
      result.loginScripts = [];
      for (const path of scripts) {
        const bytes = Buffer.from(await (await fetch(new URL(path, base))).arrayBuffer());
        result.loginScripts.push({ path, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length });
      }
    }
  }
  const csrf = await fetch(`${base}/api/sales`, { method: "POST", headers: { Origin: "https://foreign.invalid", "Sec-Fetch-Site": "cross-site" }, body: "{}" });
  result.crossSiteWrite = { status: csrf.status, passed: csrf.status === 403 };
  result.sameOriginWrites = [];
  for (const origin of [base, "http://localhost:3107"]) {
    const response = await fetch(`${base}/api/sales`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
    result.sameOriginWrites.push({ origin, status: response.status, error: (await response.json()).error, passed: response.status === (origin === base ? 401 : 403) });
  }
  result.passed = result.requests.every(row => row.passed) && result.crossSiteWrite.passed && result.sameOriginWrites.every(row => row.passed);
  if (process.argv.includes("--browser")) {
    const { auditLoginBrowser } = await import("./audit-login-browser.mjs");
    result.browser = await auditLoginBrowser(base, output);
    result.passed &&= result.browser.passed;
  }
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  result.passed = false;
  result.error = error.message;
  process.exitCode = 1;
} finally {
  server.kill();
  await writeFile(`${output}/runtime.json`, JSON.stringify(result, null, 2));
  await writeFile(`${output}/runtime-server.txt`, serverLog);
  console.log(JSON.stringify({ passed: result.passed, requests: result.requests.length, failures: result.requests.filter(row => !row.passed), error: result.error, loginSamples: result.loginSamples }, null, 2));
}
