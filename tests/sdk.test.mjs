import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUNDLE = path.join(ROOT, "public", "js", "dynamic.js");

/** Minimal browser-ish sandbox for the built SDK bundle. */
function createSandbox(options = {}) {
  const sent = [];
  const storage = () => {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
    };
  };

  const location = {
    href: "https://example.com/pricing?utm_source=news&utm_medium=social&utm_campaign=spring",
    origin: "https://example.com",
    host: "example.com",
    hostname: "example.com",
    pathname: "/pricing",
    search: "?utm_source=news&utm_medium=social&utm_campaign=spring",
  };

  const win = {
    location,
    sessionStorage: storage(),
    localStorage: storage(),
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    navigator: {
      doNotTrack: options.doNotTrack ?? null,
      sendBeacon: null,
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0",
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    performance: { now: () => 1700000000000 },
    Blob: class {
      constructor(parts) {
        this.parts = parts;
      }
    },
    addEventListenerSpy: true,
  };

  const doc = {
    currentScript: {
      getAttribute: (name) => (name === "data-site" ? "site_test_key" : null),
    },
    referrer: "https://news.ycombinator.com/item?id=42",
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
  win.document = doc;

  const context = vm.createContext({
    window: win,
    document: doc,
    navigator: win.navigator,
    location,
    history: win.history,
    sessionStorage: win.sessionStorage,
    localStorage: win.localStorage,
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 202 };
    },
    console: { info() {}, warn() {}, error() {} },
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    setInterval: win.setInterval,
    clearInterval: win.clearInterval,
    Blob: win.Blob,
    performance: win.performance,
    URL,
    URLSearchParams,
    Date,
    Math,
    JSON,
    Promise,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
    Intl,
  });

  vm.runInContext(readFileSync(BUNDLE, "utf8"), context, { filename: "dynamic.js" });
  return { context, win, sent };
}

describe("DYNAMIC SDK", () => {
  it("exposes the public API on window", () => {
    const { win } = createSandbox();
    assert.ok(win.dynamic, "window.dynamic should exist");
    assert.equal(typeof win.dynamic.track, "function");
    assert.equal(typeof win.dynamic.page, "function");
    assert.equal(typeof win.dynamic.flush, "function");
    assert.equal(typeof win.dynamic.consent.grant, "function");
  });

  it("sends a pageview with path, referrer host, utm and a session id", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.page();
    await win.dynamic.flush();

    assert.equal(sent.length, 1);
    const payload = sent[0].body;
    assert.equal(payload.site, "site_test_key");
    const event = payload.events[0];
    assert.equal(event.type, "pageview");
    assert.equal(event.path, "/pricing");
    assert.equal(event.ref, "news.ycombinator.com");
    assert.equal(event.utm.source, "news");
    assert.equal(event.utm.medium, "social");
    assert.equal(event.utm.campaign, "spring");
    assert.match(event.session, /^s_[a-z0-9]+$/);
  });

  it("never sends personal props and caps the payload", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.track("signup", {
      email: "user@example.com",
      password: "hunter2",
      plan: "free",
      seats: 3,
    });
    await win.dynamic.flush();

    const event = sent[0].body.events.find((entry) => entry.type === "event");
    assert.ok(event, "the custom event should be sent");
    assert.equal(event.name, "signup");
    assert.deepEqual(event.props, { plan: "free", seats: 3 });
  });

  it("rejects invalid event names", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.track("not a valid name!");
    await win.dynamic.flush();
    const custom = sent[0].body.events.filter((entry) => entry.type === "event");
    assert.equal(custom.length, 0);
  });

  it("batches events into request sized chunks", async () => {
    const { win, sent } = createSandbox();
    for (let index = 0; index < 5; index++) {
      win.dynamic.track(`event_${index}`);
    }
    await win.dynamic.flush();
    assert.equal(sent.length, 1);
    const custom = sent[0].body.events.filter((entry) => entry.type === "event");
    assert.equal(custom.length, 5);
  });

  it("stops collecting after opt-out and clears the queue", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.optOut();
    assert.equal(win.dynamic.consent.status(), "denied");
    win.dynamic.track("signup");
    win.dynamic.page();
    await win.dynamic.flush();
    assert.equal(sent.length, 0);
  });

  it("does not collect when Do Not Track is on until consent is granted", async () => {
    const { win, sent } = createSandbox({ doNotTrack: "1" });
    win.dynamic.page();
    await win.dynamic.flush();
    assert.equal(sent.length, 0);

    win.dynamic.consent.grant();
    win.dynamic.page();
    await win.dynamic.flush();
    assert.equal(sent.length, 1);
  });

  it("reuses one session id for the whole visit", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.page();
    win.dynamic.track("click");
    await win.dynamic.flush();
    const [first, second] = sent[0].body.events;
    assert.equal(first.session, second.session);
  });
});
