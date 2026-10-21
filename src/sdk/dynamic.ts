/**
 * DYNAMIC SDK — a small, asynchronous analytics + RUM snippet.
 *
 * Design rules:
 *  - no cookies: the session id lives in sessionStorage and rotates after
 *    30 minutes of inactivity;
 *  - no personal data: form values, input values and keystrokes are never
 *    read, and custom event props are filtered against a PII key list;
 *  - consent first: nothing is collected until consent is granted when
 *    Do Not Track is on;
 *  - cheap: events are batched (default 32 per request) and sent with
 *    sendBeacon when the page goes away;
 *  - honest: a batch that the server rejects is dropped (and reported in the
 *    console when debug is on) instead of being retried forever.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

export type DynamicPageview = {
  type: "pageview";
  path: string;
  ts: number;
  session: string;
  ref?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
};

export type DynamicVital = {
  type: "vital";
  metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  id?: string;
  path: string;
  ts: number;
  session: string;
};

export type DynamicCustom = {
  type: "event";
  name: string;
  path: string;
  ts: number;
  session: string;
  value?: number;
  props?: Record<string, string | number | boolean>;
};

export type DynamicEvent = DynamicPageview | DynamicVital | DynamicCustom;

export type DynamicOptions = {
  /** Site key (the public id from the console). */
  site?: string;
  /** Collect endpoint. */
  endpoint?: string;
  /** Collect Web Vitals (default true). */
  vitals?: boolean;
  /** Respect Do Not Track (default true). */
  respectDNT?: boolean;
  /** Send a pageview on load and on SPA navigation (default true). */
  autoPageview?: boolean;
  /** Flush interval in ms (default 5000). */
  flushInterval?: number;
  /** Maximum events per request (default 32, server limit is 64). */
  maxBatch?: number;
  /** Log decisions to the console. */
  debug?: boolean;
};

/* -------------------------------------------------------------------------
   Pure helpers (exported for tests)
   ------------------------------------------------------------------------- */

const PII_KEYS = new Set([
  "email",
  "e-mail",
  "mail",
  "name",
  "firstname",
  "lastname",
  "fullname",
  "password",
  "pass",
  "pwd",
  "secret",
  "token",
  "accesstoken",
  "apikey",
  "phone",
  "tel",
  "mobile",
  "msisdn",
  "ssn",
  "nationalid",
  "address",
  "street",
  "city",
  "zip",
  "postcode",
  "creditcard",
  "card",
  "cvv",
  "iban",
  "birthdate",
  "dob",
  "gender",
  "ip",
  "latitude",
  "longitude",
  "userid",
  "username",
]);

const MAX_PROPS = 8;
const MAX_PROP_LENGTH = 200;

/** True when a key looks like it would carry personal data. */
export function isPersonalKey(key: string): boolean {
  return PII_KEYS.has(key.trim().toLowerCase());
}

/** Drop personal-looking keys, keep the rest small. */
export function sanitizeProps(
  props?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!props) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (count >= MAX_PROPS) break;
    const name = key.trim().slice(0, 40);
    if (!name || isPersonalKey(name)) continue;
    if (typeof value === "string") out[name] = value.slice(0, MAX_PROP_LENGTH);
    else if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
    else if (typeof value === "boolean") out[name] = value;
    else continue;
    count += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Host of a URL — never the full path or query. */
export function hostOnly(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://invalid.local");
    if (!url.host || url.host === "invalid.local") return undefined;
    return url.host;
  } catch {
    return undefined;
  }
}

/** UTM parameters of a query string (source/medium/campaign only). */
export function parseUtm(
  search: string,
): { source?: string; medium?: string; campaign?: string } | undefined {
  if (!search) return undefined;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return undefined;
  }
  const pick = (key: string) => {
    const value = params.get(key);
    return value ? value.trim().slice(0, 100) : undefined;
  };
  const utm = {
    source: pick("utm_source"),
    medium: pick("utm_medium"),
    campaign: pick("utm_campaign"),
  };
  return utm.source || utm.medium || utm.campaign ? utm : undefined;
}

/** Split a queue into request-sized batches. */
export function chunkEvents<T>(events: T[], size: number): T[][] {
  const limit = Math.max(1, Math.min(64, size));
  const chunks: T[][] = [];
  for (let index = 0; index < events.length; index += limit) {
    chunks.push(events.slice(index, index + limit));
  }
  return chunks;
}

/** A random, non-identifying session id. */
export function createSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36);
  return `s_${stamp}${random}`;
}

/* -------------------------------------------------------------------------
   Runtime
   ------------------------------------------------------------------------- */

const CONSENT_KEY = "dynamic_consent";
const SESSION_KEY = "dynamic_sid";
const SESSION_TTL = 30 * 60 * 1000;
/**
 * The collect endpoint of the deployment that serves this file.
 *
 * It stays relative on purpose: the SDK is served by the same Worker that
 * hosts the API, so "the API next to me" is the correct default. A third
 * party site gets the absolute URL in the snippet (`data-endpoint`), which is
 * why a fork never sends its visitor data to someone else's database.
 */
const DEFAULT_ENDPOINT = "/api/collect";
const MAX_RETRIES = 2;

type State = {
  options: Required<DynamicOptions>;
  queue: DynamicEvent[];
  session: string | null;
  sessionAt: number;
  timer: number | null;
  consented: boolean;
  started: boolean;
  lastPath: string | null;
  utmSent: boolean;
  pending: Promise<void>;
};

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

const state: State = {
  options: {
    site: "",
    endpoint: "",
    vitals: true,
    respectDNT: true,
    autoPageview: true,
    flushInterval: 5000,
    maxBatch: 32,
    debug: false,
  },
  queue: [],
  session: null,
  sessionAt: 0,
  timer: null,
  consented: false,
  started: false,
  lastPath: null,
  utmSent: false,
  pending: Promise.resolve(),
};

function debug(...args: unknown[]) {
  if (state.options.debug && typeof console !== "undefined") console.info("[dynamic]", ...args);
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage disabled — the session simply stays in memory */
  }
}

function removeStorage(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function consentState(): "granted" | "denied" | "unknown" {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    if (value === "granted" || value === "denied") return value;
  } catch {
    /* ignore */
  }
  return "unknown";
}

function hasDoNotTrack(): boolean {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (!nav) return false;
  const value = nav.doNotTrack ?? (nav as unknown as { msDoNotTrack?: string }).msDoNotTrack;
  return value === "1" || value === "yes";
}

/** Current session id, rotated after 30 minutes of inactivity. */
function sessionId(): string | null {
  if (!state.consented) return null;
  const now = Date.now();
  const stored = readStorage(SESSION_KEY);
  if (stored && now - state.sessionAt < SESSION_TTL && state.session) {
    state.sessionAt = now;
    return state.session;
  }
  const id = createSessionId();
  state.session = id;
  state.sessionAt = now;
  writeStorage(SESSION_KEY, id);
  return id;
}

function currentPath(): string {
  if (!isBrowser) return "/";
  return window.location.pathname || "/";
}

function enqueue(event: DynamicEvent) {
  if (!state.consented) return;
  state.queue.push(event);
  debug("queued", event.type, state.queue.length);
  if (state.queue.length >= state.options.maxBatch) void flush();
}

/** Send one batch. Retries are limited and only for transport errors. */
async function sendBatch(batch: DynamicEvent[], attempt = 0): Promise<void> {
  const payload = JSON.stringify({
    site: state.options.site || undefined,
    events: batch,
  });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(state.options.endpoint, blob)) {
      debug("beacon sent", batch.length);
      return;
    }
  }

  try {
    const response = await fetch(state.options.endpoint, {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/json" },
      credentials: "omit",
      mode: "cors",
      keepalive: true,
    });
    if (response.ok) {
      debug("sent", batch.length);
      return;
    }
    // 4xx: the payload is wrong — retrying would not help.
    if (response.status < 500) {
      debug("rejected", response.status, batch.length);
      return;
    }
    throw new Error(`server_error_${response.status}`);
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      debug("dropped", batch.length, error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    await sendBatch(batch, attempt + 1);
  }
}

/** Flush the queue in request-sized batches. */
export function flush(): Promise<void> {
  if (!state.queue.length) return state.pending;
  const batches = chunkEvents(state.queue, state.options.maxBatch);
  state.queue = [];
  state.pending = state.pending.then(async () => {
    for (const batch of batches) {
      await sendBatch(batch);
    }
  });
  return state.pending;
}

/** Send a pageview for the current path. */
export function page(): void {
  if (!isBrowser || !state.consented) return;
  const session = sessionId();
  if (!session) return;
  const path = currentPath();
  const utm = state.utmSent ? undefined : parseUtm(window.location.search);
  state.utmSent = true;
  state.lastPath = path;
  enqueue({
    type: "pageview",
    path,
    ts: Date.now(),
    session,
    ref: hostOnly(document.referrer),
    utm,
  });
}

/** Send a custom event. */
export function track(
  name: string,
  props?: Record<string, unknown>,
  value?: number,
): void {
  if (!isBrowser || !state.consented) return;
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(name)) {
    debug("invalid event name", name);
    return;
  }
  const session = sessionId();
  if (!session) return;
  const clean = sanitizeProps(props);
  enqueue({
    type: "event",
    name,
    path: currentPath(),
    ts: Date.now(),
    session,
    value: typeof value === "number" && Number.isFinite(value) ? value : undefined,
    props: clean,
  });
}

function collectVitals() {
  const send = (
    metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB",
    id: string,
    value: number,
    rating?: string,
  ) => {
    const session = sessionId();
    if (!session) return;
    enqueue({
      type: "vital",
      metric,
      value,
      rating: rating as "good" | "needs-improvement" | "poor" | undefined,
      id,
      path: currentPath(),
      ts: Date.now(),
      session,
    });
  };

  try {
    onLCP((metric) => send("LCP", metric.id, metric.value, metric.rating));
    onINP((metric) => send("INP", metric.id, metric.value, metric.rating));
    onCLS((metric) => send("CLS", metric.id, metric.value, metric.rating));
    onFCP((metric) => send("FCP", metric.id, metric.value, metric.rating));
    onTTFB((metric) => send("TTFB", metric.id, metric.value, metric.rating));
  } catch (error) {
    debug("vitals unavailable", error);
  }
}

function patchHistory() {
  if (!isBrowser) return;
  const notify = () => {
    const path = currentPath();
    if (path === state.lastPath) return;
    page();
  };

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      notify();
      return result;
    };
  }
  window.addEventListener("popstate", notify);
}

function start() {
  if (state.started || !isBrowser) return;
  state.started = true;

  if (state.options.autoPageview) page();
  if (state.options.vitals) collectVitals();
  patchHistory();

  state.timer = window.setInterval(() => {
    void flush();
  }, state.options.flushInterval);

  window.addEventListener("pagehide", () => {
    void flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}

/** Grant or revoke consent. */
export const consent = {
  grant() {
    try {
      window.localStorage.setItem(CONSENT_KEY, "granted");
    } catch {
      /* ignore */
    }
    state.consented = true;
    start();
    return true;
  },
  deny() {
    try {
      window.localStorage.setItem(CONSENT_KEY, "denied");
    } catch {
      /* ignore */
    }
    state.consented = false;
    state.queue = [];
    state.session = null;
    removeStorage(SESSION_KEY);
    return true;
  },
  status() {
    return state.consented ? "granted" : consentState();
  },
};

/** Convenience alias for consent.deny() / consent.grant(). */
export const optOut = () => consent.deny();
export const optIn = () => consent.grant();

/** Read the site key from the script tag or a global. */
function resolveSite(): string {
  if (isBrowser) {
    const script = document.currentScript as HTMLScriptElement | null;
    const fromTag = script?.getAttribute("data-site");
    if (fromTag) return fromTag.trim();
    const global = (window as unknown as { DYNAMIC_SITE?: string }).DYNAMIC_SITE;
    if (global) return global.trim();
  }
  return "";
}

/** Read the collect endpoint from the script tag (absolute for other sites). */
function resolveEndpoint(): string {
  if (isBrowser) {
    const script = document.currentScript as HTMLScriptElement | null;
    const fromTag = script?.getAttribute("data-endpoint");
    if (fromTag) return fromTag.trim();
  }
  return DEFAULT_ENDPOINT;
}

/** Initialize the SDK. Safe to call twice. */
export function init(options: DynamicOptions = {}): void {
  if (!isBrowser) return;
  state.options = { ...state.options, ...options };
  if (!state.options.site) state.options.site = resolveSite();
  if (!state.options.endpoint) state.options.endpoint = resolveEndpoint();

  const stored = consentState();
  const scriptConsent = (
    document.currentScript as HTMLScriptElement | null
  )?.getAttribute("data-consent");

  if (stored === "denied") {
    state.consented = false;
    return;
  }
  if (stored === "granted" || scriptConsent === "granted") {
    state.consented = true;
  } else if (state.options.respectDNT && hasDoNotTrack()) {
    state.consented = false;
    debug("Do Not Track is on — waiting for consent");
    return;
  } else {
    // No explicit opt-out and no DNT: collect, as most privacy-first
    // analytics tools do (no cookies, no personal data).
    state.consented = true;
  }

  start();
}

/** Expose the public API. */
export const dynamic = {
  init,
  track,
  page,
  flush,
  consent,
  optOut,
  optIn,
  version: "1.0.0",
};

if (isBrowser) {
  (window as unknown as { dynamic: typeof dynamic }).dynamic = dynamic;
  // Auto-start when the tag carries a site key.
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.getAttribute("data-site")) {
    init({ site: script.getAttribute("data-site") ?? undefined });
  }
}
