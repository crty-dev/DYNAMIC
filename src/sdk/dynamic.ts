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
import {
  DEFAULT_PRIVACY,
  inspectEvent,
  readCounters,
  selfTest,
  type PrivacyConfig,
  type PrivacyCounters,
} from "./privacy";

export type DynamicPageview = {
  type: "pageview";
  path: string;
  ts: number;
  session: string;
  ref?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  release?: string;
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
  release?: string;
};

export type DynamicCustom = {
  type: "event";
  name: string;
  path: string;
  ts: number;
  session: string;
  value?: number;
  props?: Record<string, string | number | boolean>;
  release?: string;
};

/** A release marker — the version that is live from this moment on. */
export type DynamicRelease = {
  type: "release";
  version: string;
  deployedAt: number;
  ts: number;
  session: string;
  path: string;
};

/** A JavaScript error, reported without any source code. */
export type DynamicError = {
  type: "error";
  message: string;
  kind: "error" | "unhandledrejection";
  source?: string;
  line?: number;
  column?: number;
  path: string;
  ts: number;
  session: string;
  release?: string;
};

export type DynamicEvent =
  | DynamicPageview
  | DynamicVital
  | DynamicCustom
  | DynamicRelease
  | DynamicError;

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
  /** Privacy Gate configuration (default: the conservative preset). */
  privacy?: Partial<PrivacyConfig>;
  /** The release that is live right now (e.g. "2026.10.4"). */
  release?: string;
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
/** The moment the session was created, so it survives a page reload. */
const SESSION_AT_KEY = "dynamic_sid_at";
const RELEASE_KEY = "dynamic_release";
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
  privacy: PrivacyConfig;
  /** The release that is live right now. */
  release: string | null;
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
    privacy: DEFAULT_PRIVACY,
    release: "",
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
  privacy: DEFAULT_PRIVACY,
  release: null,
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

/**
 * Current session id, rotated after 30 minutes of inactivity.
 *
 * The id lives in sessionStorage, so it survives a page reload: a visitor
 * that navigates inside the same tab keeps one session. The creation time
 * is stored next to it, otherwise every reload would look like a new
 * session and the visitor count would explode.
 */
function sessionId(): string | null {
  if (!state.consented) return null;
  const now = Date.now();
  const stored = readStorage(SESSION_KEY);
  const storedAt = Number(readStorage(SESSION_AT_KEY) ?? "0");
  if (stored && storedAt > 0 && now - storedAt < SESSION_TTL) {
    state.session = stored;
    state.sessionAt = storedAt;
    return stored;
  }
  const id = createSessionId();
  state.session = id;
  state.sessionAt = now;
  writeStorage(SESSION_KEY, id);
  writeStorage(SESSION_AT_KEY, String(now));
  return id;
}

function currentPath(): string {
  if (!isBrowser) return "/";
  return window.location.pathname || "/";
}

/**
 * Puts an event into the queue.
 *
 * The Privacy Gate runs first: a payload that carries a sensitive value is
 * redacted (or dropped) here, in the browser. The event that is queued is
 * therefore already safe to transmit.
 */
function enqueue(event: DynamicEvent) {
  if (!state.consented) return;

  const inspected = inspectEvent(event as never, state.privacy);
  if (!inspected.event) {
    debug("blocked", event.type);
    return;
  }
  if (inspected.blocked.length) {
    debug("redacted", event.type, inspected.blocked.join(","));
  }

  state.queue.push(inspected.event as DynamicEvent);
  debug("queued", event.type, state.queue.length);
  if (state.queue.length >= state.options.maxBatch) void flush();
}

/** The counters of the Privacy Gate since the last call (counts only). */
function privacyCounters(): PrivacyCounters | undefined {
  const counters = readCounters();
  const entries = Object.entries(counters).filter(([, value]) => (value ?? 0) > 0);
  return entries.length ? (Object.fromEntries(entries) as PrivacyCounters) : undefined;
}

/** Send one batch. Retries are limited and only for transport errors. */
async function sendBatch(batch: DynamicEvent[], attempt = 0): Promise<void> {
  const payload = JSON.stringify({
    site: state.options.site || undefined,
    events: batch,
    // Only counters: the gate never transmits a value it blocked.
    privacy: privacyCounters(),
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

/** The release that is live right now (null when the site has no marker). */
function currentRelease(): string | undefined {
  return state.release || undefined;
}

/**
 * Marks a release.
 *
 * The version is stored locally (so the events that follow carry it) and a
 * marker event is sent, which is the exact point in time the Change Radar
 * compares against. No source code, no commit message, no secret is part of
 * the marker - only a version string the developer chose.
 *
 * The marker is sent once per version and session: a snippet that calls
 * `dynamic.release()` on every page view must not write a row per page view.
 */
export function release(version: string, deployedAt?: number): void {
  if (!isBrowser) return;
  const trimmed = String(version ?? "").trim();
  if (!trimmed || !/^[A-Za-z0-9._+-]{1,64}$/.test(trimmed)) {
    debug("invalid release version");
    return;
  }
  const when = typeof deployedAt === "number" && Number.isFinite(deployedAt) ? deployedAt : Date.now();
  state.release = trimmed;
  try {
    window.localStorage.setItem(RELEASE_KEY, trimmed);
  } catch {
    /* storage disabled — the marker still works for this page view */
  }
  if (!state.consented) return;
  const session = sessionId();
  if (!session) return;

  // One marker per version and session.
  const markedKey = `${RELEASE_KEY}:${trimmed}:${session}`;
  if (readStorage(markedKey)) {
    debug("release already marked", trimmed);
    return;
  }
  writeStorage(markedKey, "1");

  enqueue({
    type: "release",
    version: trimmed,
    deployedAt: when,
    ts: Date.now(),
    session,
    path: currentPath(),
  });
  debug("release", trimmed);
}

/** The release that is live right now (read only). */
export function currentReleaseVersion(): string | null {
  return state.release;
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
    release: currentRelease(),
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
  // The properties are not filtered here: the Privacy Gate is the single
  // place that decides what may leave the browser, and it counts what it
  // removes. Filtering twice would hide the counters.
  enqueue({
    type: "event",
    name,
    path: currentPath(),
    ts: Date.now(),
    session,
    value: typeof value === "number" && Number.isFinite(value) ? value : undefined,
    props: props as Record<string, string | number | boolean> | undefined,
    release: currentRelease(),
  });
}

/**
 * Reports a JavaScript error.
 *
 * The message is redacted by the Privacy Gate before it is queued, so a
 * stack that contains an e-mail address or a token never leaves the
 * browser. The source is reduced to its host name.
 */
export function reportError(
  message: string,
  kind: "error" | "unhandledrejection" = "error",
  source?: string,
  line?: number,
  column?: number,
): void {
  if (!isBrowser || !state.consented) return;
  if (!state.privacy.captureErrors) return;
  const session = sessionId();
  if (!session) return;
  const text = String(message ?? "").slice(0, 300);
  if (!text) return;
  enqueue({
    type: "error",
    message: text,
    kind,
    source: hostOnly(source),
    line: typeof line === "number" && Number.isFinite(line) ? line : undefined,
    column: typeof column === "number" && Number.isFinite(column) ? column : undefined,
    path: currentPath(),
    ts: Date.now(),
    session,
    release: currentRelease(),
  });
}

/** Listens for uncaught errors and rejected promises. */
function collectErrors(): void {
  if (!isBrowser) return;
  try {
    window.addEventListener("error", (event) => {
      const error = (event as ErrorEvent).error;
      reportError(
        error?.message ?? (event as ErrorEvent).message ?? "unknown error",
        "error",
        (event as ErrorEvent).filename,
        (event as ErrorEvent).lineno,
        (event as ErrorEvent).colno,
      );
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
      reportError(message, "unhandledrejection");
    });
  } catch (error) {
    debug("error capture unavailable", error);
  }
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
      release: currentRelease(),
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
  if (state.privacy.captureErrors) collectErrors();
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

/** Read the release version from the script tag or the local storage. */
function resolveRelease(): string | null {
  if (isBrowser) {
    const script = document.currentScript as HTMLScriptElement | null;
    const fromTag = script?.getAttribute("data-release");
    if (fromTag && fromTag.trim()) return fromTag.trim();
    try {
      const stored = window.localStorage.getItem(RELEASE_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Read the privacy configuration from the script tag. */
function resolvePrivacy(): Partial<PrivacyConfig> {
  if (!isBrowser) return {};
  const script = document.currentScript as HTMLScriptElement | null;
  const raw = script?.getAttribute("data-privacy");
  if (!raw) return {};
  // "strict" | "balanced" | "off" — an unknown value keeps the default.
  if (raw === "strict" || raw === "balanced" || raw === "off") {
    return { mode: raw };
  }
  return {};
}

/** Initialize the SDK. Safe to call twice. */
export function init(options: DynamicOptions = {}): void {
  if (!isBrowser) return;
  state.options = { ...state.options, ...options };
  state.privacy = { ...DEFAULT_PRIVACY, ...state.options.privacy, ...resolvePrivacy() };
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

  // The release of the previous visit is kept, so the measurements of a
  // session stay comparable even when the marker event was never sent.
  const known = resolveRelease();
  if (known) state.release = known;
  if (state.options.release) state.release = state.options.release;

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
  release,
  reportError,
  privacy: {
    /** The rules that are active in this browser. */
    rules: () => ({
      mode: state.privacy.mode,
      redactQuery: state.privacy.redactQuery,
      blockValues: state.privacy.blockValues,
      captureErrors: state.privacy.captureErrors,
    }),
    /** The counters since the last read (counts only, never values). */
    counters: readCounters,
    /**
     * A synthetic self test: fabricated values run through the gate, so the
     * owner can see what would be blocked. Nothing is transmitted.
     */
    selfTest: () => selfTest(state.privacy),
  },
  version: "1.1.0",
};

if (isBrowser) {
  (window as unknown as { dynamic: typeof dynamic }).dynamic = dynamic;
  // Auto-start when the tag carries a site key.
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.getAttribute("data-site")) {
    init({ site: script.getAttribute("data-site") ?? undefined });
  }
}
