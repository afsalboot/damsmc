// Local-only frontend inspection using real components and intercepted fixtures.
// The generated preview route is removed on exit and never part of a release.
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, unlink, rmdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fixtureResponse } from "./fixtures.mjs";

const phase = process.argv[2] || "before";
if (!["before", "after", "states", "recovery", "dense", "interaction"].includes(phase)) throw Error("Choose before, after, states, recovery, dense or interaction");
const output = `docs/audits/frontend-2026-10-16/${phase}`;
await mkdir(output, { recursive: true });
const route = resolve("src/app/frontend-audit-preview");
if (existsSync(route)) throw Error("Refusing to overwrite an existing preview route");
await mkdir(route);
await writeFile(join(route, "page.jsx"), `import {Suspense} from 'react';import {notFound} from 'next/navigation';import Preview from '../../../scripts/frontend-audit/Preview';export default function Page(){if(process.env.FRONTEND_AUDIT!=='1')notFound();return <Suspense><Preview/></Suspense>;}`);
const base = "http://localhost:3117";
const profile = await mkdtemp(join(tmpdir(), "pvamsp-frontend-audit-"));
const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3117"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_DIST_DIR: ".next-frontend-audit", FRONTEND_AUDIT: "1", BACKUP_SCHEDULER_ENABLED: "false", MONGODB_URI: "mongodb://127.0.0.1:1/frontend_audit", JWT_SECRET: "isolated-frontend-audit-not-a-real-secret" } });
let log = ""; server.stdout.on("data", chunk => { log += chunk; }); server.stderr.on("data", chunk => { log += chunk; });
let chrome, socket, id = 0;
const pending = new Map(), exceptions = [], missingFixtures = [], blockedWrites = [];
const sleep = ms => new Promise(wait => setTimeout(wait, ms));
const command = (method, params = {}) => new Promise((resolveCall, reject) => {
  const callId = ++id, timeout = setTimeout(() => { pending.delete(callId); reject(Error(`DevTools timeout: ${method}`)); }, 30000);
  pending.set(callId, message => { clearTimeout(timeout); message.error ? reject(Error(message.error.message)) : resolveCall(message.result); });
  socket.send(JSON.stringify({ id: callId, method, params }));
});
const evaluate = async expression => { const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || "Browser evaluation failed"); return response.result.value; };
const result = { phase, fixturesOnly: true, liveDatabase: false, widths: [320, 360, 375, 390, 414, 480, 640, 768, 820, 1024, 1280, 1366, 1440, 1536, 1920, 2560], screens: [], interactions: [] };
const measure = `(()=>{const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';const controls=[...document.querySelectorAll('input,select,textarea')].filter(el=>visible(el)&&el.type!=='hidden');const unnamed=controls.filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>({tag:el.tagName,type:el.type,placeholder:el.getAttribute('placeholder'),name:el.name,classes:el.className}));const buttons=[...document.querySelectorAll('button')].filter(visible);const tiny=buttons.filter(el=>{const r=el.getBoundingClientRect();return r.width<32||r.height<32}).map(el=>({text:el.getAttribute('aria-label')||el.title||el.innerText,classes:el.className}));return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,unnamed,tiny,headings:[...document.querySelectorAll('main h1,main h2')].map(el=>el.innerText).slice(0,8),errorText:document.querySelector('nextjs-portal')?.shadowRoot?.textContent?.slice(0,100)||null}})()`;
async function screenshot(name) { const response = await command("Page.captureScreenshot", { format: "png" }); await writeFile(`${output}/${name}.png`, Buffer.from(response.data, "base64")); }
async function clickText(text) {
  // Fresh DOM target before every click; no guessed coordinates.
  const target = await evaluate(`(()=>{const list=[...document.querySelectorAll('button')].filter(el=>el.getClientRects().length&&(el.innerText.trim()===${JSON.stringify(text)}||el.getAttribute('aria-label')===${JSON.stringify(text)}));if(!list.length)return {matches:0};const el=list[0];el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if (!target.x) throw Error(`Ambiguous/missing button ${text}: ${target.matches}`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await sleep(200);
}
async function navigate(screen, mode = "populated") {
  currentMode = mode;
  await command("Page.navigate", { url: `${base}/frontend-audit-preview?screen=${screen}&state=${mode}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(`document.querySelector('[data-audit-screen="${screen}"]')!==null&&document.readyState==='complete'`)) { await sleep(700); return; }
    await sleep(100);
  }
  throw Error(`Screen failed to render: ${screen}`);
}
let currentMode = "populated";
try {
  let ready = false;
  for (let attempt = 0; attempt < 160; attempt++) { try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {} await sleep(250); }
  if (!ready) throw Error("Audit preview server unavailable");
  chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=9318", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let target;
  for (let attempt = 0; attempt < 100; attempt++) { try { target = (await (await fetch("http://127.0.0.1:9318/json/list")).json()).find(tab => tab.type === "page"); if (target) break; } catch {} await sleep(100); }
  if (!target) throw Error("Headless Chrome unavailable");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((opened, reject) => { socket.onopen = opened; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      if (request.method !== "GET") { blockedWrites.push({ method: request.method, path: new URL(request.url).pathname }); void command("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {}); }
      else void fixtureResponse(request.url, currentMode).then(response => {
        if (response.status === 404) missingFixtures.push(response.error);
        return command("Fetch.fulfillRequest", { requestId, responseCode: response.status, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "X-POS-Cache-Scope", value: "frontend-audit-fixture" }], body: Buffer.from(JSON.stringify(response.status === 200 ? { data: response.data } : { error: response.error })).toString("base64") });
      }).catch(() => {}); // Navigation may cancel an interception before fulfillment.
    }
  };
  await command("Page.enable"); await command("Runtime.enable");
  await command("Fetch.enable", { patterns: [{ urlPattern: "*://localhost:3117/api/*", requestStage: "Request" }] });
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const screens = ["login", "dashboard", "sales", "products", "customers", "suppliers", "purchases", "expenses", "accounts", "reports", "staff", "settings", "consultations", "consultation-report", "notifications", "recent-sales", "sale-details", "change-password", "login-pin"];
  for (const [index, screen] of (["states", "recovery", "dense", "interaction"].includes(phase) ? [] : screens).entries()) {
    await command("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(screen);
    const samples = [];
    for (const width of result.widths) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: false });
      await command("Emulation.setTouchEmulationEnabled", { enabled: width < 768 });
      await sleep(70);
      samples.push(await evaluate(measure));
      if ([320, 768, 1366].includes(width)) await screenshot(`${String(index + 1).padStart(2, "0")}-${screen}-${width}`);
    }
    for (const [name, width, height] of [["landscape", 844, 390], ["zoom-equivalent", 683, 450]]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(80);
      samples.push({ ...await evaluate(measure), scenario: name });
      if (["sales", "products"].includes(screen)) await screenshot(`${screen}-${name}`);
    }
    result.screens.push({ screen, samples });
    console.log(`${phase}: ${screen}, overflow widths=${samples.filter(s => s.documentWidth > s.width + 1).map(s => s.width).join(',')||'none'}, unnamed=${samples[0].unnamed.length}`);
  }
  if (["states", "after", "recovery", "dense"].includes(phase)) {
    for (const screen of (phase === "states" ? ["sales", "products", "customers", "purchases", "reports"] : [])) {
      await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await navigate(screen, "loading");
      result.screens.push({ screen, state: "loading", samples: [await evaluate(measure)], text: await evaluate("document.querySelector('main')?.innerText") });
      await screenshot(`state-loading-${screen}-390`);
    }
    for (const screen of (phase === "recovery" ? [] : ["customers", "suppliers", "purchases", "expenses", "accounts", "staff", "consultations"])) {
      await navigate(screen, "dense");
      const samples = [];
      for (const width of result.widths) {
        await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false });
        await sleep(70);
        samples.push(await evaluate(measure));
        if ([320, 1366].includes(width)) {
          await screenshot(`dense-${screen}-${width}`);
          await evaluate(`(()=>{const row=[...document.querySelectorAll('tbody tr,main article.card,main button.card')].find(el=>el.getClientRects().length&&el.textContent.includes('LongUnbrokenDirectoryName'));row?.scrollIntoView({block:'center'})})()`);
          await screenshot(`dense-${screen}-${width}-rows`);
          await evaluate("window.scrollTo(0,0)");
        }
      }
      result.screens.push({ screen, state: "dense", samples });
      console.log(`dense: ${screen}, overflow=${samples.filter(sample => sample.documentWidth > sample.width + 1).map(sample => sample.width).join(',') || 'none'}`);
    }
    for (const mode of (phase === "states" ? ["empty", "error"] : phase === "recovery" ? ["error"] : [])) for (const screen of ["sales", "products", "customers", "suppliers", "purchases", "expenses", "accounts", "reports", "staff", "consultations", "recent-sales"]) {
      await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await navigate(screen, mode);
      result.screens.push({ screen, state: mode, samples: [await evaluate(measure)], text: (await evaluate("document.querySelector('main')?.innerText")).slice(-1800) });
      await screenshot(`state-${mode}-${screen}-390`);
      if (phase === "recovery") {
        currentMode = "populated";
        await clickText("Retry");
        await sleep(1000);
        result.screens.at(-1).recovered = !(await evaluate("document.querySelector('main')?.innerText")).includes("Preview network unavailable");
        await screenshot(`recovered-${screen}-390`);
      }
    }
    for (const screen of (phase === "states" ? ["error-fallback", "not-found"] : [])) {
      await navigate(screen);
      result.screens.push({ screen, samples: [await evaluate(measure)] });
      await screenshot(`state-${screen}-390`);
    }
  }
  // Mobile navigation and common create dialogs; never submit a form.
  for (const [screen, button] of [["products", "Add product"], ["customers", "Add Retail Customer"], ["suppliers", "Add supplier"], ["purchases", "New purchase"], ["expenses", "Add expense"], ["staff", "Add staff"], ["consultations", "New consultation"]]) {
    await command("Emulation.setTouchEmulationEnabled", { enabled: true });
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 600, deviceScaleFactor: 1, mobile: false });
    await navigate(screen);
    const buttons = await evaluate(`[...document.querySelectorAll('button')].filter(el=>el.getClientRects().length).map(el=>el.innerText.trim()||el.getAttribute('aria-label'))`);
    const label = buttons.find(label => label?.toLowerCase() === button.toLowerCase());
    if (!label) { result.interactions.push({ screen, button, blocked: "Button text differs", buttons }); continue; }
    await clickText(label);
    const opened = await evaluate(measure);
    opened.dialogs = await evaluate(`[...document.querySelectorAll('[role="dialog"],dialog[open]')].map(el=>({name:el.getAttribute('aria-label')||document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,rect:{top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,height:el.getBoundingClientRect().height},focusInside:el.contains(document.activeElement)}))`);
    const keyboard = await evaluate(`(()=>{const dialog=[...document.querySelectorAll('[role="dialog"],dialog[open]')].at(-1);if(!dialog)return null;const controls=[...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled)')].filter(el=>el.getClientRects().length&&el.tabIndex>=0);controls.at(-1)?.focus();return {count:controls.length}})()`);
    if (keyboard) {
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      keyboard.tabStayedInside = await evaluate(`(()=>{const dialog=[...document.querySelectorAll('[role="dialog"],dialog[open]')].at(-1);return !!dialog?.contains(document.activeElement)})()`);
    }
    if (keyboard) {
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8, windowsVirtualKeyCode: 9 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      keyboard.shiftTabStayedInside = await evaluate(`(()=>{const dialog=[...document.querySelectorAll('[role="dialog"],dialog[open]')].at(-1);return !!dialog?.contains(document.activeElement)})()`);
    }
    await screenshot(`20-${screen}-dialog-390x600`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(100);
    result.interactions.push({ screen, button: label, opened, keyboard, dialogsAfterEscape: await evaluate(`document.querySelectorAll('[role="dialog"],dialog[open]').length`), focusRestored: await evaluate(`document.activeElement?.innerText.trim()===${JSON.stringify(label)}||document.activeElement?.getAttribute('aria-label')===${JSON.stringify(label)}`) });
  }
  await navigate("sales");
  await evaluate(`document.querySelector('button[aria-label="Select Classical Ayurvedic Preparation 2"]').focus()`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(300);
  await screenshot("25-pos-quantity");
  await clickText("Add to sale");
  await sleep(4500); // Let the success toast clear before inspecting dialog controls.
  const paymentLabel = await evaluate('document.querySelector("[data-cart-payment]")?.innerText.trim()');
  await clickText(paymentLabel);
  await sleep(300);
  result.checkout = { cash: await evaluate(measure), dialog: await evaluate('({open:!!document.querySelector("[aria-labelledby=checkout-title]"),focusInside:!!document.querySelector("[aria-labelledby=checkout-title]")?.contains(document.activeElement)})') };
  await screenshot("26-pos-cash");
  await clickText("Split");
  result.checkout.split = await evaluate(measure);
  await screenshot("27-pos-split");
  await clickText("Close checkout");
  await navigate("sales");
  await clickText("Open navigation");
  await screenshot("30-mobile-navigation");
  result.navigation = await evaluate(`({dialog:!!document.querySelector('[role="dialog"]'),expanded:document.querySelector('button[aria-label="Open navigation"]')?.getAttribute('aria-expanded'),active:document.activeElement?.outerHTML.slice(0,250)})`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(100);
  result.navigation.escapeClosed = await evaluate("!document.querySelector('[role=dialog]')&&document.activeElement?.getAttribute('aria-label')==='Open navigation'");
  await clickText("Open navigation");
  await command("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  result.navigation.closedOnResize = await evaluate("!document.querySelector('[role=dialog]')&&getComputedStyle(document.body).overflow!=='hidden'");
  result.exceptions = exceptions; result.missingFixtures = [...new Set(missingFixtures)]; result.blockedWrites = blockedWrites;
} catch (error) { result.error = error.message; console.error(error.message); process.exitCode = 1; }
finally {
  result.exceptions = exceptions; result.missingFixtures = [...new Set(missingFixtures)]; result.blockedWrites = blockedWrites;
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  await writeFile(`${output}/server.txt`, log);
  if (socket?.readyState === WebSocket.OPEN) { await command("Browser.close").catch(() => {}); socket.close(); }
  chrome?.kill(); server.kill();
  await unlink(join(route, "page.jsx")).catch(() => {}); await rmdir(route).catch(() => {});
  await sleep(300);
  if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("pvamsp-frontend-audit-")) await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
