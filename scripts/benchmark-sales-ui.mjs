// Measures an authenticated production UI through local DevTools. No credentials are read.
// Never submits checkout, changes inventory, prints, backs up or creates test data.
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const mode = process.argv[2] || "browser";
const checkout = process.argv.includes("--checkout");
const blocked = [];
if (!["browser", "electron"].includes(mode)) throw Error("Use browser or electron");
const profile = await mkdtemp(join(tmpdir(), "pvamsp-sales-benchmark-"));
const port = mode === "browser" ? 9223 : 9224;
const base = "http://localhost:3000";
const require = createRequire(import.meta.url);
const env = { ...process.env, POS_BENCHMARK_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const executable = mode === "browser" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : require("../desktop/node_modules/electron");
const args = mode === "browser" ? [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--disable-gpu", "--no-first-run", "--no-default-browser-check", `${base}/sales`] : [resolve("desktop"), "--local", "--benchmark", "--disable-gpu", `--remote-debugging-port=${port}`];
const child = spawn(executable, args, { env, stdio: ["ignore", "ignore", "pipe"], windowsHide: false });
let runtimeErrors = "";
child.stderr.on("data", data => { runtimeErrors = (runtimeErrors + data.toString()).slice(-3000); });
child.on("error", error => { runtimeErrors += error.message; });
let socket;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0; const pending = new Map(); const requests = [];
function command(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => { pending.delete(requestId); reject(Error(`DevTools timeout: ${method}`)); }, 30000);
    pending.set(requestId, value => { clearTimeout(timeout); value.error ? reject(Error(value.error.message)) : resolveCall(value.result); });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || "UI evaluation failed");
  return result.result.value;
}
async function waitFor(expression, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(200); }
  throw Error("UI readiness timeout");
}
async function action(code, ready = "true") {
  return evaluate(`(async()=>{const start=performance.now(); ${code}; const dispatchMs=performance.now()-start; const deadline=start+15000; while(!(${ready})){if(performance.now()>deadline)throw Error('Action readiness timeout');await new Promise(r=>setTimeout(r,10));} await new Promise(requestAnimationFrame); const domMs=performance.now()-start; await new Promise(requestAnimationFrame); return {dispatchMs,domMs,paintMs:performance.now()-start};})()`);
}
const median = values => values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page" && t.url.startsWith(base)); if (target) break; } catch {}
    await sleep(200);
  }
  if (!target) throw Error(`The native runtime did not expose a local app target: ${runtimeErrors}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => { socket.onopen = r; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    else if (message.method === "Fetch.requestPaused") {
      const request = message.params.request;
      const path = new URL(request.url).pathname;
      if (["GET", "HEAD", "OPTIONS"].includes(request.method) || ["/api/auth/login", "/api/auth/username-login", "/api/auth/logout"].includes(path)) void command("Fetch.continueRequest", { requestId: message.params.requestId });
      else { blocked.push({ method: request.method, path }); void command("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "BlockedByClient" }); }
    }
    else if (message.method === "Network.requestWillBeSent" && (checkout ? /\/api\/(products|sales|settings|customers)(?:\?|\/|$)/ : /\/api\/products(?:\?|\/|$)/).test(message.params.request.url)) requests.push({ id: message.params.requestId, method: message.params.request.method, path: new URL(message.params.request.url).pathname + new URL(message.params.request.url).search, start: message.params.timestamp });
    else if (message.method === "Network.responseReceived") { const entry = requests.find(r => r.id === message.params.requestId); if (entry) { entry.status = message.params.response.status; entry.serverTiming = message.params.response.headers["server-timing"] || message.params.response.headers["Server-Timing"]; } }
    else if (message.method === "Network.loadingFinished") { const entry = requests.find(r => r.id === message.params.requestId); if (entry) entry.wireBytes = message.params.encodedDataLength; }
  };
  await command("Runtime.enable"); await command("Network.enable");
  if (checkout) await command("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:3000/api/*", requestStage: "Request" }] });
  if (process.argv.includes("--fixture")) {
    const fixtureProcess = spawn(process.execPath, [resolve("scripts/benchmark-sales-cache.mjs"), String(port)], { env, stdio: "inherit", windowsHide: true });
    await new Promise((resolveFixture, reject) => { fixtureProcess.on("error", reject); fixtureProcess.on("exit", code => code === 0 ? resolveFixture() : reject(Error("Native fixture verification failed"))); });
  } else {
  console.log(`${mode}: sign in in the isolated application window. Waiting up to 10 minutes.`);
  await waitFor("Boolean(document.querySelector('a[href=\"/sales\"]') && !location.pathname.startsWith('/login'))", 600000);
  if (!(await evaluate("Boolean(document.querySelector('#pos-search'))"))) await action("document.querySelector('a[href=\"/sales\"]').click()", "Boolean(document.querySelector('#pos-search'))");
  if (checkout) {
    const { benchmarkCheckout } = await import("./benchmark-checkout-ui.mjs");
    await benchmarkCheckout({ mode, evaluate, action, waitFor, requests, blocked });
  } else {
  await waitFor("Boolean(window.__POS_SALES_PERF__?.metrics().ready && !document.querySelector('.sales-product-card')?.textContent.includes('Loading stock'))");
  await sleep(1000);
  const initialMetrics = await evaluate("window.__POS_SALES_PERF__.metrics()");
  const persistence = await evaluate("window.__POS_SALES_PERF__.persistence()");
  console.log(JSON.stringify({ mode, initialMetrics, persistence }));
  const samples = [];
  for (let cycle = 0; cycle < 5; cycle++) {
    const startCount = requests.length;
    await action("document.querySelector('a[href=\"/products\"]').click()", "!document.querySelector('#pos-search')");
    await sleep(300);
    const returnStart = requests.length;
    const opening = await action("document.querySelector('a[href=\"/sales\"]').click()", "Boolean(document.querySelector('#pos-search') && document.querySelector('.sales-product-card'))");
    const openingRequests = requests.slice(returnStart);
    const inputChange = value => `const input=document.querySelector('#pos-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))`;
    const searchStart = requests.length;
    const search = await action(inputChange("a"));
    const clear = await action(inputChange(""));
    const searchRequests = requests.length - searchStart;
    const filterStart = requests.length;
    await action("[...document.querySelectorAll('#sales-category-filters button')].find(b=>b.textContent==='Low Stock')?.click()");
    await sleep(150);
    const stockSearch = await action(inputChange("a"));
    const stockClear = await action(inputChange(""));
    await action("[...document.querySelectorAll('#sales-category-filters button')].find(b=>b.textContent==='All')?.click()");
    await waitFor("Boolean(window.__POS_SALES_PERF__.metrics().freshDetails)");
    const cartStart = requests.length;
    const selection = await action("document.querySelector('.sales-product-card')?.click()", "Boolean(document.querySelector('.sales-cart-item') || [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add to sale'))");
    const hasQuantityDialog = await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add to sale' && !b.disabled)");
    const add = hasQuantityDialog ? await action("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Add to sale' && !b.disabled).click()", "Boolean(document.querySelector('.sales-cart-item'))") : selection;
    const cartRequests = requests.length - cartStart;
    const beforeReload = requests.length;
    const reloadStart = performance.now(); await command("Page.reload", { ignoreCache: false });
    await waitFor("Boolean(document.querySelector('#pos-search') && window.__POS_SALES_PERF__?.metrics().ready && window.__POS_SALES_PERF__.metrics().freshDetails)");
    const reload = { readinessMs: performance.now() - reloadStart, metrics: await evaluate("window.__POS_SALES_PERF__.metrics()"), navigation: await evaluate("(()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd};})()") };
    await sleep(300);
    samples.push({ cycle: cycle + 1, opening, openingRequests, search, clear, searchRequests, stockSearch, stockClear, stockRequests: requests.slice(filterStart, cartStart), selection, add, cartRequests, reload, reloadRequests: requests.slice(beforeReload), productRequests: requests.length - startCount });
  }
  const summary = Object.fromEntries(["opening", "search", "clear", "stockSearch", "stockClear", "add"].map(key => [key, { medianDomMs: median(samples.map(s=>s[key].domMs)), medianPaintMs: median(samples.map(s=>s[key].paintMs)) }]));
  const result = { mode, origin: base, build: "local production build", initialMetrics, persistence, samples, summary, requests };
  await mkdir("performance-results", { recursive: true });
  await writeFile(`performance-results/${mode}.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ mode, summary, initialMetrics }, null, 2));
  }
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await command("Browser.close"); } catch {} socket.close(); }
  if (!child.killed) child.kill();
  await sleep(500);
  // Only the exact temporary directory created by this process is removed.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
