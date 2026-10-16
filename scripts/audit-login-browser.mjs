// Public login smoke against the isolated server started by audit-runtime.mjs.
// Auth status is an intercepted fixture; no sign-in or business writes occur.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

export async function auditLoginBrowser(base, output) {
  const profile = await mkdtemp(join(tmpdir(), "pvamsp-audit-browser-"));
  const child = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=9317", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let launchError;
  child.on("error", error => { launchError = error.code; });
  let socket;
  let id = 0;
  const pending = new Map();
  const errors = [], apiRequests = [];
  const command = (method, params = {}) => new Promise((resolveCall, reject) => {
    const callId = ++id;
    const timeout = setTimeout(() => { pending.delete(callId); reject(Error(`Browser timeout: ${method}`)); }, 10000);
    pending.set(callId, message => { clearTimeout(timeout); message.error ? reject(Error(message.error.message)) : resolveCall(message.result); });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = async expression => {
    const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error("Browser evaluation failed");
    return response.result.value;
  };
  try {
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw Error(`Chrome unavailable: ${launchError}`);
      try { target = (await (await fetch("http://127.0.0.1:9317/json/list")).json()).find(tab => tab.type === "page"); if (target) break; } catch {}
      await new Promise(wait => setTimeout(wait, 100));
    }
    if (!target) throw Error("Chrome DevTools unavailable");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((opened, reject) => { socket.onopen = opened; socket.onerror = reject; });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
      else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
      else if (message.method === "Fetch.requestPaused") {
        const { requestId, request } = message.params;
        apiRequests.push({ path: new URL(request.url).pathname, method: request.method, fixture: true });
        if (request.method === "GET" && new URL(request.url).pathname === "/api/auth/status") {
          void command("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify({ data: { needsBootstrap: false } })).toString("base64") });
        } else void command("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
    };
    await command("Page.enable"); await command("Runtime.enable");
    await command("Fetch.enable", { patterns: [{ urlPattern: `${base}/api/*`, requestStage: "Request" }] });
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `window.__audit={cls:0,lcp:null};new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__audit.cls+=e.value}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(list=>{window.__audit.lcp=list.getEntries().at(-1)?.startTime}).observe({type:'largest-contentful-paint',buffered:true});` });
    const viewports = [];
    for (const [name, width, height] of [["desktop", 1365, 900], ["mobile", 390, 844]]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: name === "mobile" });
      await command("Page.navigate", { url: `${base}/login` });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(`document.readyState==='complete'&&!!document.querySelector('input[type=password]')`)) { ready = true; break; }
        await new Promise(wait => setTimeout(wait, 100));
      }
      if (!ready) throw Error("Login did not render");
      await evaluate("new Promise(resolve=>setTimeout(resolve,300))");
      viewports.push(await evaluate(`({name:${JSON.stringify(name)},width:innerWidth,documentWidth:document.documentElement.scrollWidth,passwordField:!!document.querySelector('input[type=password]'),unlabeledInputs:[...document.querySelectorAll('input:not([type=hidden])')].filter(el=>!(el.labels?.length||el.getAttribute('aria-label')||el.getAttribute('aria-labelledby'))).length,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,ms:e.startTime})),ttfb:performance.getEntriesByType('navigation')[0]?.responseStart,...window.__audit})`));
      const screenshot = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(`${output}/login-${name}.png`, Buffer.from(screenshot.data, "base64"));
    }
    const result = { authenticated: false, authStatusFixture: true, errors, apiRequests, viewports,
      passed: errors.length === 0 && viewports.every(view => view.passwordField && view.unlabeledInputs === 0 && view.documentWidth <= view.width) };
    await writeFile(`${output}/login-browser.json`, JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { await command("Browser.close").catch(() => {}); socket.close(); }
    child.kill();
    await new Promise(wait => setTimeout(wait, 300));
    // Only remove the task-owned profile directly beneath the OS temp directory.
    if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("pvamsp-audit-browser-")) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
