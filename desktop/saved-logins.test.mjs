import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { SavedLogins, installSavedLogins } from "./saved-logins.mjs";

const origin = "https://pos.test";
const candidate = { kind: "username", identifier: "test-owner", password: "Fixture-password-37" };
function encryption() {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptStringAsync: async buffer => {
      const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return { result: Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false };
    },
  };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "saved-login-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "logins.enc"), crypto = encryption();
  return { filePath, crypto, store: new SavedLogins({ filePath, crypto }) };
}

test("opted-in logins persist encrypted across restart and suggestions never contain passwords", async t => {
  const { store, filePath, crypto } = await fixture(t);
  assert.deepEqual(await store.list(origin), []);
  await assert.rejects(stat(filePath), { code: "ENOENT" });
  await store.save(origin, candidate);
  const bytes = await readFile(filePath);
  assert.equal(bytes.includes(Buffer.from(candidate.password)), false);
  assert.equal(bytes.includes(Buffer.from(candidate.identifier)), false);
  const restarted = new SavedLogins({ filePath, crypto });
  const [account] = await restarted.list(origin);
  assert.deepEqual(Object.keys(account).sort(), ["id", "identifier", "kind"]);
  assert.deepEqual(await restarted.fill(origin, account.id), candidate);
});
test("production and local accounts cannot fill or delete each other's secrets", async t => {
  const { store } = await fixture(t);
  await store.save(origin, candidate);
  const [account] = await store.list(origin);
  assert.deepEqual(await store.list("http://localhost:3000"), []);
  await assert.rejects(store.fill("http://localhost:3000", account.id), /not found/);
  await store.forget("http://localhost:3000", account.id);
  assert.equal((await store.list(origin)).length, 1);
  await store.forget(origin, account.id);
  assert.deepEqual(await store.list(origin), []);
});
test("concurrent saves retain both accounts and password updates retain the existing account id", async t => {
  const { store } = await fixture(t);
  await Promise.all([store.save(origin, candidate), store.save(origin, { ...candidate, identifier: "other-account" })]);
  const account = (await store.list(origin)).find(entry => entry.identifier === candidate.identifier);
  await store.save(origin, { ...candidate, identifier: candidate.identifier.toUpperCase(), password: "Updated-fixture-password-39" });
  assert.equal((await store.list(origin)).length, 2);
  const filled = await store.fill(origin, account.id);
  assert.equal(filled.password, "Updated-fixture-password-39");
});
test("unavailable or failing encryption cannot write plaintext or destroy the prior vault", async t => {
  const { store, crypto, filePath } = await fixture(t);
  crypto.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(store.save(origin, candidate), /unavailable/);
  await assert.rejects(stat(filePath), { code: "ENOENT" });
  crypto.isAsyncEncryptionAvailable = async () => true;
  await store.save(origin, candidate);
  const before = await readFile(filePath);
  crypto.encryptStringAsync = async () => { throw new Error("Encryption failed"); };
  await assert.rejects(store.save(origin, { ...candidate, password: "Another-fixture-secret-40" }), /Encryption failed/);
  assert.deepEqual(await readFile(filePath), before);
});
test("damaged encrypted storage does not silently reset saved accounts", async t => {
  const { store, crypto, filePath } = await fixture(t);
  await store.save(origin, candidate);
  const before = await readFile(filePath);
  crypto.decryptStringAsync = async () => { throw new Error("Decrypt failed"); };
  await assert.rejects(store.save(origin, candidate), /Decrypt failed/);
  assert.deepEqual(await readFile(filePath), before);
});

async function integration(t) {
  const data = await fixture(t), handlers = new Map();
  const frame = { url: `${origin}/login` }, contents = { id: 23, mainFrame: frame };
  let completed;
  const state = { response: 1, prompts: 0, clock: 1000 };
  installSavedLogins({
    ipc: { handle: (name, handler) => handlers.set(name, handler) },
    session: { webRequest: { onCompleted: callback => { completed = callback; } } },
    dialog: { showMessageBox: async () => { state.prompts++; return { response: state.response }; } },
    store: data.store, startUrl: origin, getContents: () => contents, getWindow: () => ({}), now: () => state.clock,
  });
  const event = { sender: contents, senderFrame: frame };
  const authenticate = (statusCode = 200, endpoint = "/api/auth/username-login") => completed({ webContentsId: 23, method: "POST", statusCode, url: origin + endpoint });
  const offer = () => handlers.get("logins:offer")(event, { ...candidate, endpoint: "/api/auth/username-login" });
  return { ...data, state, event, frame, handlers, authenticate, offer };
}
test("save needs successful authentication and explicit Save; failures, Not now and stale outcomes save nothing", async t => {
  const h = await integration(t);
  assert.equal(await h.offer(), false); assert.equal(h.state.prompts, 0);
  h.authenticate(401); assert.equal(await h.offer(), false); assert.equal(h.state.prompts, 0);
  h.authenticate(); assert.equal(await h.offer(), false); assert.equal(h.state.prompts, 1);
  assert.deepEqual(await h.store.list(origin), []);
  h.authenticate(); h.state.clock += 11_000; assert.equal(await h.offer(), false);
  h.authenticate(); h.state.response = 0; assert.equal(await h.offer(), true);
  assert.equal((await h.store.list(origin)).length, 1);
  h.authenticate(); const prompts = h.state.prompts; await h.offer(); assert.equal(h.state.prompts, prompts);
});
test("saved login IPC rejects foreign pages, subframes and different senders before revealing a password", async t => {
  const h = await integration(t);
  await h.store.save(origin, candidate);
  const [account] = await h.store.list(origin);
  for (const event of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: `${origin}/login` } }]) {
    await assert.rejects(h.handlers.get("logins:fill")(event, account.id), /Untrusted/);
  }
  h.frame.url = "https://other.test/login";
  await assert.rejects(h.handlers.get("logins:list")(h.event), /Untrusted/);
  h.frame.url = `${origin}/dashboard`;
  await assert.rejects(h.handlers.get("logins:fill")(h.event, account.id), /Untrusted/);
});
test("forget requires consent, and failed or PIN authentication cannot qualify a save", async t => {
  const h = await integration(t);
  await h.store.save(origin, candidate);
  const [account] = await h.store.list(origin);
  assert.equal(await h.handlers.get("logins:forget")(h.event, account.id), false);
  assert.equal((await h.store.list(origin)).length, 1);
  h.state.response = 0;
  assert.equal(await h.handlers.get("logins:forget")(h.event, account.id), true);
  h.authenticate(200, "/api/auth/pin-login"); assert.equal(await h.offer(), false);
  h.authenticate(); h.authenticate(401); assert.equal(await h.offer(), false);
});
