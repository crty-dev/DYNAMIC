/**
 * A minimal browser-ish sandbox for the built DYNAMIC SDK bundle.
 *
 * The SDK is an IIFE that only touches `window`, `document`, `navigator`,
 * `sessionStorage`, `localStorage`, `history` and `fetch`, so a small
 * context is enough to run it in node. The requests it would send are
 * collected in `sent`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const BUNDLE = path.resolve(import.meta.dirname, "..", "..", "public", "js", "dynamic.js");

function memoryStorage(map = new Map()) {
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  };
}

/**
 * @param {object} [options]
 * @param {string|null} [options.doNotTrack]   the DNT header value
 * @param {string} [options.site]             the site key of the script tag
 * @param {string} [options.endpoint]         the collect endpoint
 * @param {boolean} [options.sendBeacon]      whether sendBeacon exists
 * @param {Map} [options.sessionStorage]      a shared storage (page reload)
 * @param {Map} [options.localStorage]        a shared storage (page reload)
 */
export function createSandbox(options = {}) {
  const sent = [];
  const sessionMap = options.sessionStorage ?? new Map();
  const localMap = options.localStorage ?? new Map();

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
    sessionStorage: memoryStorage(sessionMap),
    localStorage: memoryStorage(localMap),
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    navigator: {
      doNotTrack: options.doNotTrack ?? null,
      sendBeacon: options.sendBeacon ? () => true : null,
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0",
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    performance: { now: () => 1700000000000 },
    Blob: function BlobStub(parts) {
      this.parts = parts;
    },
  };

  const attributes = {
    "data-site": options.site ?? "site_test_key",
    "data-endpoint": options.endpoint,
    "data-privacy": options.privacy,
    "data-release": options.release,
    "data-consent": options.consent,
  };

  const doc = {
    currentScript: {
      getAttribute: (name) => {
        const value = attributes[name];
        return value === undefined ? null : value;
      },
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
  return { context, win, sent, sessionMap, localMap };
}
