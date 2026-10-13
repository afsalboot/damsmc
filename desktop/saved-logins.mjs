import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isTrustedUrl } from "./policy.mjs";

const LOGIN_ENDPOINTS = new Set(["/api/auth/login", "/api/auth/username-login"]);
const loginKey = (entry) => `${entry.kind}:${entry.identifier.toLowerCase()}`;

export function loginCandidate(value) {
  if (!value || !["username", "email"].includes(value.kind) ||
      typeof value.identifier !== "string" || typeof value.password !== "string") {
    throw new Error("Invalid saved login.");
  }
  const identifier = value.identifier.trim();
  if (!identifier || identifier.length > 254 || /[\x00-\x1f\x7f]/.test(identifier) ||
      !value.password || value.password.length > 1024) throw new Error("Invalid saved login.");
  return { kind: value.kind, identifier, password: value.password };
}

export class SavedLogins {
  constructor({ filePath, crypto, now = Date.now }) {
    this.filePath = filePath;
    this.crypto = crypto;
    this.now = now;
    this.queue = Promise.resolve();
  }
  async available() { return this.crypto.isAsyncEncryptionAvailable(); }
  run(action) {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }
  async read() {
    if (!await this.available()) throw new Error("Encrypted login storage is unavailable.");
    let encrypted;
    try { encrypted = await readFile(this.filePath); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    if (encrypted.length > 1_000_000) throw new Error("Saved login storage is invalid.");
    const { result } = await this.crypto.decryptStringAsync(encrypted);
    const data = JSON.parse(result);
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 64 ||
        data.entries.some(entry => typeof entry.id !== "string" || typeof entry.origin !== "string" || !Number.isFinite(entry.updatedAt))) {
      throw new Error("Saved login storage is invalid.");
    }
    for (const entry of data.entries) loginCandidate(entry);
    return data.entries;
  }
  async write(entries) {
    // Encryption completes before any write; plaintext is never put on disk.
    if (!await this.available()) throw new Error("Encrypted login storage is unavailable.");
    const encrypted = await this.crypto.encryptStringAsync(JSON.stringify({ version: 1, entries }));
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(`${this.filePath}.tmp`, encrypted, { mode: 0o600 });
    await rename(`${this.filePath}.tmp`, this.filePath);
  }
  list(origin) {
    return this.run(async () => (await this.read()).filter(entry => entry.origin === origin)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, identifier, kind }) => ({ id, identifier, kind })));
  }
  matching(origin, candidate) {
    return this.run(async () => (await this.read()).find(entry => entry.origin === origin && loginKey(entry) === loginKey(candidate)) || null);
  }
  fill(origin, id) {
    return this.run(async () => {
      const entries = await this.read();
      const entry = entries.find(item => item.origin === origin && item.id === id);
      if (!entry) throw new Error("Saved login not found.");
      entry.updatedAt = this.now();
      await this.write(entries);
      return { kind: entry.kind, identifier: entry.identifier, password: entry.password };
    });
  }
  save(origin, candidate) {
    const clean = loginCandidate(candidate);
    return this.run(async () => {
      const entries = await this.read();
      const prior = entries.find(entry => entry.origin === origin && loginKey(entry) === loginKey(clean));
      if (prior) Object.assign(prior, clean, { updatedAt: this.now() });
      else {
        if (entries.length >= 64) throw new Error("Forget an old saved login before saving another.");
        entries.push({ id: randomUUID(), origin, ...clean, updatedAt: this.now() });
      }
      await this.write(entries);
    });
  }
  forget(origin, id) {
    return this.run(async () => {
      const entries = await this.read();
      await this.write(entries.filter(entry => entry.origin !== origin || entry.id !== id));
    });
  }
}

export function installSavedLogins({ ipc, session, dialog, store, startUrl, getContents, getWindow, now = Date.now }) {
  const origin = new URL(startUrl).origin;
  let lastAuthentication = null;
  let offering = false;
  function trusted(event, loginOnly = true) {
    const contents = getContents();
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        !isTrustedUrl(event.senderFrame.url, startUrl) ||
        (loginOnly && !/^\/login\/?$/.test(new URL(event.senderFrame.url).pathname))) {
      throw new Error("Untrusted saved login request.");
    }
  }
  session.webRequest.onCompleted(details => {
    if (details.webContentsId !== getContents()?.id || details.method !== "POST" ||
        !isTrustedUrl(details.url, startUrl)) return;
    const endpoint = new URL(details.url).pathname;
    if (LOGIN_ENDPOINTS.has(endpoint)) lastAuthentication = details.statusCode >= 200 && details.statusCode < 300 ? { endpoint, at: now() } : null;
  });
  ipc.handle("logins:list", async event => {
    trusted(event);
    if (!await store.available()) return { available: false, accounts: [] };
    try { return { available: true, accounts: await store.list(origin) }; }
    catch { return { available: false, accounts: [] }; }
  });
  ipc.handle("logins:fill", async (event, id) => {
    trusted(event);
    if (typeof id !== "string" || id.length > 64) throw new Error("Invalid saved login.");
    const login = await store.fill(origin, id);
    trusted(event); // Do not release credentials if navigation changed while decrypting.
    return login;
  });
  ipc.handle("logins:forget", async (event, id) => {
    trusted(event);
    const accounts = await store.list(origin);
    const account = accounts.find(entry => entry.id === id);
    if (!account) return false;
    const { response } = await dialog.showMessageBox(getWindow(), {
      type: "question", title: "Forget saved login", message: `Forget the saved login for ${account.identifier}?`,
      detail: "This removes the saved password from this computer. Your account stays active.",
      buttons: ["Forget", "Cancel"], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (response !== 0) return false;
    await store.forget(origin, id);
    return true;
  });
  ipc.handle("logins:offer", async (event, payload) => {
    trusted(event, false);
    if (offering || !lastAuthentication || lastAuthentication.endpoint !== payload?.endpoint ||
        now() - lastAuthentication.at > 10_000) return false;
    const candidate = loginCandidate(payload);
    lastAuthentication = null;
    offering = true;
    try {
      if (!await store.available()) return false;
      const prior = await store.matching(origin, candidate);
      if (prior?.password === candidate.password) return true;
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: "question", title: prior ? "Update saved password?" : "Save this login?",
        message: prior ? `Update the saved password for ${candidate.identifier}?` : `Save the login for ${candidate.identifier}?`,
        detail: "Save your username/email and password on this computer for this Windows account. You can fill or forget it on the login screen.",
        buttons: [prior ? "Update" : "Save", "Not now"], defaultId: 1, cancelId: 1, noLink: true,
      });
      if (response !== 0) return false;
      await store.save(origin, candidate);
      return true;
    } catch {
      await dialog.showMessageBox(getWindow(), { type: "error", title: "Login could not be saved",
        message: "Your sign-in succeeded, but this computer could not save the login. You can continue using the app." });
      return false;
    } finally { offering = false; }
  });
}
