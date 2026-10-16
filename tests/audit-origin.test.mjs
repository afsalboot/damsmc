import test from "node:test";
import assert from "node:assert/strict";
import { isCrossSiteWrite } from "../src/lib/request-origin.js";
const request = (headers, method = "POST", internal = "http://localhost:3000") => ({ method, headers: new Headers(headers), nextUrl: new URL(internal) });

test("same-origin writes use destination Host when Next normalizes the internal hostname", () => {
  assert.equal(isCrossSiteWrite(request({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })), false);
  assert.equal(isCrossSiteWrite(request({ host: "store.example", origin: "https://store.example" }, "POST", "https://localhost:3000")), false);
});

test("foreign, null, malformed, different scheme and different port origins are blocked", () => {
  for (const origin of ["https://foreign.example", "null", "invalid", "https://localhost:3000", "http://localhost:4000"]) {
    assert.equal(isCrossSiteWrite(request({ host: "localhost:3000", origin })), true, origin);
  }
  assert.equal(isCrossSiteWrite(request({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "cross-site" })), true);
  assert.equal(isCrossSiteWrite(request({ host: "store.example@foreign.example", origin: "http://foreign.example" })), true);
});

test("untrusted forwarded host cannot override Host and non-browser clients retain auth enforcement", () => {
  assert.equal(isCrossSiteWrite(request({ host: "store.example", origin: "http://foreign.example", "x-forwarded-host": "foreign.example" })), true);
  assert.equal(isCrossSiteWrite(request({ host: "localhost:3000" })), false);
  assert.equal(isCrossSiteWrite(request({ origin: "https://foreign.example" }, "GET")), false);
});
