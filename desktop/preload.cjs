const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oushadhiDesktop", {
  printReceipt: (html) => ipcRenderer.invoke("receipt:print", html),
  offerSaveLogin: (candidate) => ipcRenderer.invoke("logins:offer", candidate),
});

// Keep saved-password retrieval inside the isolated preload. Only a real click
// on the login screen fills an individual account; no password-list API is exposed.
let savedLoginPanel;
let savedLoginForm;
function passwordLoginFields() {
  if (!/^\/login\/?$/.test(window.location.pathname)) return null;
  const identifier = document.querySelector('main form input[name="username"], main form input[name="email"]');
  const form = identifier?.form;
  const password = form?.querySelector('input[name="password"]');
  if (!form || !password || form.querySelector('input[name="pin"], input[name="setupToken"], input[name="newPassword"]')) return null;
  return { form, identifier, password };
}
function attachSavedLogins() {
  const fields = passwordLoginFields();
  if (!fields) { savedLoginPanel?.remove(); savedLoginPanel = null; savedLoginForm = null; return; }
  if (savedLoginPanel?.isConnected && savedLoginForm === fields.form && savedLoginPanel.dataset.kind === fields.identifier.name) return;
  savedLoginPanel?.remove();
  const panel = document.createElement("div");
  savedLoginPanel = panel;
  savedLoginForm = fields.form;
  panel.dataset.kind = fields.identifier.name;
  panel.dataset.desktopSavedLogins = "true";
  panel.style.cssText = "margin:0 0 16px;padding:12px;border:1px solid #d7e5dc;border-radius:10px;background:#f5faf6;color:#183d2b;font:13px/1.5 Arial,sans-serif";
  const label = document.createElement("label");
  label.textContent = "Saved logins on this computer";
  label.style.cssText = "display:block;font-weight:700";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Choose a saved username or email");
  select.style.cssText = "display:block;width:100%;margin:6px 0;padding:8px;background:white;color:#183d2b;border:1px solid #cad8cf;border-radius:6px;font:inherit";
  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:8px;margin-top:6px";
  const fill = document.createElement("button"), forget = document.createElement("button");
  for (const button of [fill, forget]) {
    button.type = "button";
    button.style.cssText = "padding:6px 10px;border:1px solid #bdcec3;border-radius:6px;font:inherit;font-weight:700;cursor:pointer;background:white;color:#183d2b";
  }
  fill.textContent = "Use saved login";
  forget.textContent = "Forget";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.style.cssText = "margin:4px 0 0;font-size:12px";
  label.appendChild(select);
  controls.append(fill, forget);
  panel.append(label, controls, status);
  const anchor = fields.identifier.closest("label");
  if (anchor?.parentElement === fields.form) fields.form.insertBefore(panel, anchor);
  else fields.form.prepend(panel);
  select.addEventListener("change", () => { fill.disabled = forget.disabled = !select.value; });
  const refresh = async () => {
    try {
      const { accounts, available } = await ipcRenderer.invoke("logins:list");
      if (!panel.isConnected) return;
      select.replaceChildren(new Option("Choose a saved login", ""));
      const matching = accounts.filter(account => account.kind === fields.identifier.name);
      for (const account of matching) select.append(new Option(account.identifier, account.id));
      label.hidden = controls.hidden = !matching.length;
      fill.disabled = forget.disabled = true;
      status.textContent = !available ? "Saving logins is unavailable on this computer. Enter your login manually." :
        matching.length ? "Choose an account to fill its username/email and password." :
          "After signing in, choose Save to remember this login on this computer.";
    } catch {
      label.hidden = controls.hidden = true;
      status.textContent = "Enter your login manually. Saved logins could not be loaded.";
    }
  };
  fill.addEventListener("click", async event => {
    if (!event.isTrusted || !select.value) return;
    fill.disabled = forget.disabled = true;
    try {
      const account = await ipcRenderer.invoke("logins:fill", select.value);
      const current = passwordLoginFields();
      if (!current || current.form !== fields.form || current.identifier.name !== account.kind) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      for (const [input, value] of [[current.identifier, account.identifier], [current.password, account.password]]) {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      current.password.focus();
      status.textContent = "Login filled. Select Sign in when you are ready.";
    } catch { status.textContent = "This login could not be filled. Enter it manually."; }
    finally { fill.disabled = forget.disabled = !select.value; }
  });
  forget.addEventListener("click", async event => {
    if (!event.isTrusted || !select.value) return;
    fill.disabled = forget.disabled = true;
    try {
      if (await ipcRenderer.invoke("logins:forget", select.value)) {
        const current = passwordLoginFields();
        if (current?.form === fields.form) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(current.password, "");
          current.password.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await refresh();
      }
    } catch { status.textContent = "This saved login could not be forgotten. Try again."; }
    finally { fill.disabled = forget.disabled = !select.value; }
  });
  void refresh();
}
new MutationObserver(attachSavedLogins).observe(document, { childList: true, subtree: true });
window.addEventListener("DOMContentLoaded", attachSavedLogins, { once: true });

// Offer saving only password logins confirmed by the server. The main process
// independently checks the successful authentication request and asks consent.
contextBridge.executeInMainWorld({
  func: () => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      let candidate;
      try {
        const [resource, options] = args;
        const url = new URL(resource instanceof Request ? resource.url : resource, window.location.href);
        if (/^\/login\/?$/.test(window.location.pathname) && url.origin === window.location.origin &&
            ["/api/auth/login", "/api/auth/username-login"].includes(url.pathname) &&
            options?.method?.toUpperCase() === "POST" && typeof options.body === "string") {
          const body = JSON.parse(options.body);
          const form = document.querySelector('main form input[name="password"]')?.form;
          if (form && !form.querySelector('input[name="pin"], input[name="setupToken"], input[name="newPassword"]') &&
              !body.setupUsername && !body.newPassword && !body.pin && typeof body.password === "string") {
            const kind = url.pathname === "/api/auth/username-login" ? "username" : "email";
            if (typeof body[kind] === "string") candidate = { endpoint: url.pathname, kind, identifier: body[kind], password: body.password };
          }
        }
      } catch { /* Other fetch calls keep their normal behavior. */ }
      const response = await originalFetch(...args);
      if (candidate && response.ok) {
        try {
          const result = await response.clone().json();
          if (result.data?.user && !result.data.user.mustChangePassword) {
            void window.oushadhiDesktop.offerSaveLogin(candidate).catch(() => {});
          }
        } catch { /* Saving must never interrupt a successful sign-in. */ }
      }
      return response;
    };
  },
});

// Older hosted login pages still carry the previous store's wordmark.
// The desktop title bar already supplies the current medical center logo.
contextBridge.executeInMainWorld({
  func: () => {
    const updateLoginBranding = () => {
      if (!/^\/login\/?$/.test(window.location.pathname)) return;
      for (const wordmark of document.querySelectorAll("main.min-h-screen .oushadhi-logo")) {
        wordmark.hidden = true;
        wordmark.style.setProperty("display", "none", "important");
      }
      for (const paragraph of document.querySelectorAll("main.min-h-screen p")) {
        if (/^Sign in to open the Oushad(?:h)?i workspace\.$/i.test(paragraph.textContent.trim())) {
          paragraph.textContent = "Sign in to open the medical center workspace.";
        }
      }
    };
    updateLoginBranding();
    new MutationObserver(updateLoginBranding).observe(document, {
      childList: true,
      subtree: true,
    });
  },
});

// Adapt the hosted receipt iframe without changing checkout or its saved sale.
contextBridge.executeInMainWorld({
  func: () => {
    const installed = new WeakMap();
    const attach = (frame) => {
      if (frame.title !== "Thermal receipt print") return;
      const install = () => {
        const target = frame.contentWindow;
        if (!target || installed.get(frame) === target.print) return;
        let printing = false;
        const directPrint = async () => {
          if (printing) return;
          const doc = frame.contentDocument;
          if (!doc?.querySelector(".thermal-receipt")) return;
          printing = true;
          try {
            await window.oushadhiDesktop.printReceipt(doc.documentElement.outerHTML);
          } finally {
            target.dispatchEvent(new Event("afterprint"));
          }
        };
        target.print = directPrint;
        installed.set(frame, directPrint);
      };
      install();
      frame.addEventListener("load", install, { once: true });
    };
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "IFRAME") attach(node);
        node.querySelectorAll("iframe").forEach(attach);
      }
    }).observe(document, { childList: true, subtree: true });
  },
});
