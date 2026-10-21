import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSandbox } from "./helpers/sdk-sandbox.mjs";
import {
  classifyValue,
  inspectProps,
  isSensitiveKey,
  redactUrl,
} from "../src/lib/privacy-rules.ts";

/** Every string that must never appear in an outgoing request. */
const SECRETS = [
  "jane.doe@example.com",
  "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh",
  "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
  "4242424242424242",
  "hunter2",
  "sk-live-9f8e7d6c5b4a3928",
];

describe("Privacy Gate — rules", () => {
  it("knows the sensitive property names", () => {
    for (const key of ["email", "password", "token", "apiKey", "cvv", "formvalue"]) {
      assert.equal(isSensitiveKey(key), true, `${key} should be sensitive`);
    }
    for (const key of ["plan", "items", "currency", "seats"]) {
      assert.equal(isSensitiveKey(key), false, `${key} should be allowed`);
    }
  });

  it("classifies the sensitive values", () => {
    assert.equal(classifyValue("jane.doe@example.com"), "email");
    assert.equal(classifyValue("9f8e7d6c5b4a39281706f5e4d3c2b1a0"), "token");
    assert.equal(classifyValue("4242424242424242"), "creditcard");
    assert.equal(classifyValue("Bearer abcdefghijklmnop"), "token");
    assert.equal(classifyValue("TRY"), null);
    assert.equal(classifyValue("3"), null);
    assert.equal(classifyValue("checkout"), null);
  });

  it("removes the sensitive query parameters of a URL", () => {
    const { url, redacted } = redactUrl("https://site.com/x?token=abc&page=2&email=a@b.com");
    assert.ok(!url.includes("token=abc"), "the token must be gone");
    assert.ok(!url.includes("a@b.com"), "the e-mail must be gone");
    assert.ok(url.includes("page=2"), "the harmless parameter stays");
    assert.deepEqual(redacted.sort(), ["email", "token"]);
  });

  it("drops the sensitive properties and keeps the harmless ones", () => {
    const { props, blocked } = inspectProps({
      email: "jane@example.com",
      plan: "pro",
      seats: 4,
      token: "abcdefghijklmnop",
    });
    assert.deepEqual(props, { plan: "pro", seats: 4 });
    assert.ok(blocked.length >= 2);
  });
});

describe("Privacy Gate — SDK", () => {
  it("never sends a sensitive value", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.track("checkout", {
      email: SECRETS[0],
      token: SECRETS[1],
      hash: SECRETS[2],
      card: SECRETS[3],
      password: SECRETS[4],
      apiKey: SECRETS[5],
      plan: "pro",
      items: 2,
    });
    await win.dynamic.flush();

    assert.equal(sent.length, 1, "the batch must be sent");
    const raw = JSON.stringify(sent[0].body);
    for (const secret of SECRETS) {
      assert.ok(!raw.includes(secret), `the request must not contain ${secret}`);
    }
    const event = sent[0].body.events.find((entry) => entry.type === "event");
    assert.ok(event, "the custom event must be sent");
    assert.deepEqual(event.props, { plan: "pro", items: 2 });
  });

  it("keeps the harmless analytics working", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.page();
    win.dynamic.track("signup", { plan: "free", seats: 3 });
    await win.dynamic.flush();

    assert.equal(sent.length, 1);
    const events = sent[0].body.events;
    const pageview = events.find((entry) => entry.type === "pageview");
    const custom = events.find((entry) => entry.type === "event");
    assert.ok(pageview, "the pageview must be sent");
    assert.equal(pageview.path, "/pricing");
    assert.ok(custom, "the custom event must be sent");
    assert.deepEqual(custom.props, { plan: "free", seats: 3 });
  });

  it("redacts a sensitive query parameter of a URL property", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.track("nav", { to: "https://site.com/x?token=supersecretvalue" });
    await win.dynamic.flush();

    const raw = JSON.stringify(sent[0].body);
    assert.ok(!raw.includes("supersecretvalue"), "the token must not be sent");
  });

  it("reports the blocked categories as counters, never as values", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.track("signup", { email: "jane@example.com", plan: "pro" });
    await win.dynamic.flush();

    const counters = sent[0].body.privacy;
    assert.ok(counters, "the batch must carry the counters");
    assert.ok(counters.email >= 1, "the blocked e-mail must be counted");
    const raw = JSON.stringify(sent[0].body);
    assert.ok(!raw.includes("jane@example.com"), "the value must not travel");
  });

  it("has a synthetic self test that sends nothing", async () => {
    const { win, sent } = createSandbox();
    const report = win.dynamic.privacy.selfTest();
    assert.equal(sent.length, 0, "the self test must not send anything");
    assert.ok(report.total > 0);
    assert.ok(report.blocked > 0, "the fabricated values must be blocked");
    assert.ok(report.allowed > 0, "the harmless values must pass");
  });
});
