import { Hono, type Context } from "hono";
import { z } from "zod";
import { createAuth, enabledSocialProviders } from "./auth";
import { rememberExecutionContext } from "./execution";
import { siteByKey, siteByOrigin } from "./sites";
import { addPrivacyCounters, upsertRelease } from "./signature";
import { goalsFor, type Goal } from "./goals";
import {
  analyticsSummary,
  bucketCount,
  emptySeries,
  MIN_P75_SAMPLES,
  resolveRange,
  rumSummary,
  RANGES,
  VITAL_METRIC_LIST,
} from "./analytics";
import { allowedOrigins, config, type AppEnv, type Bindings } from "./env";
import { readOutbox } from "./mailer";
import { createProjectsApp } from "./projects";
import { rateLimit } from "./rate-limit";

export type { Bindings, Variables, AppEnv } from "./env";

type Site = {
  id: number;
  public_id: string;
  name: string;
  origin: string;
  created_at: number;
  retention_days: number;
  daily_event_limit: number;
  events_today: number;
  counter_day: string | null;
};

const app = new Hono<AppEnv>();

/* ==========================================================================
   Limits — sized for the Cloudflare Free plan
   ========================================================================== */

const MAX_BATCH = 64;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_ATTRIBUTION_BYTES = 4 * 1024;
const MAX_PROPS = 8;
const MAX_PROP_VALUE = 200;
const RATINGS = ["good", "needs-improvement", "poor"] as const;
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

/* ==========================================================================
   Event schema
   ========================================================================== */

const utmSchema = z
  .object({
    source: z.string().max(100).optional(),
    medium: z.string().max(100).optional(),
    campaign: z.string().max(100).optional(),
  })
  .optional();

const baseEventShape = {
  /** Epoch milliseconds; seconds are accepted and normalized. Defaults to server time. */
  ts: z.number().int().nonnegative().optional(),
  /** Pathname only — query strings and fragments are stripped before storage. */
  path: z.string().max(1024).optional(),
  /** Anonymous, rotating session id from the SDK. */
  session: z.string().max(64).optional(),
  /** web-vitals metric id, used for dedup. */
  id: z.string().max(64).optional(),
  /** Referrer host only (no path, no query). */
  ref: z.string().max(253).optional(),
  /** Campaign parameters. */
  utm: utmSchema,
  /** Optional JSON object; capped at 4 KB before storage. */
  attribution: z.record(z.string(), z.unknown()).optional(),
  /** The release that was live when the measurement was taken. */
  release: z.string().max(64).optional(),
};

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseEventShape,
    type: z.literal("pageview"),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("vital"),
    metric: z.enum(VITAL_METRIC_LIST),
    value: z.number().nonnegative().max(1_000_000_000),
    rating: z.enum(RATINGS).optional(),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("event"),
    name: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.:-]+$/, "Use letters, numbers, _, ., : or - only"),
    /** Optional conversion value (revenue, credits, …). */
    value: z.number().nonnegative().max(1_000_000_000).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("release"),
    /** The version string the developer chose (no source code, no secrets). */
    version: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._+-]+$/, "Use letters, numbers, ., _, + or - only"),
    /** When the release went live (ms). */
    deployedAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("error"),
    /** The redacted error message. */
    message: z.string().max(300).optional(),
    kind: z.enum(["error", "unhandledrejection"]).optional(),
    /** The host of the script that failed (never a full path). */
    source: z.string().max(253).optional(),
    line: z.number().int().nonnegative().max(100000).optional(),
    column: z.number().int().nonnegative().max(100000).optional(),
  }),
]);

const envelopeSchema = z.object({
  /** Optional public site key or hostname. Falls back to the request origin. */
  site: z.string().min(1).max(253).optional(),
  events: z.array(eventSchema).max(MAX_BATCH),
  /**
   * The counters of the Privacy Gate — counts only, never a value.
   */
  privacy: z.record(z.string().max(32), z.number().int().nonnegative()).optional(),
});

type IncomingEvent = z.infer<typeof eventSchema>;

/** Property keys that would carry personal data — never stored. */
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

/* ==========================================================================
   Normalizers
   ========================================================================== */

// Control characters are stripped from user supplied strings (User-Agent, tags).
// oxlint-disable-next-line eslint/no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Normalize any http(s) URL to its origin; returns null for invalid values. */
function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Turn a site key / hostname (e.g. "example.com") into an origin.
 * Bare hostnames prefer the request origin when the host matches, so local
 * http development and custom ports work without weakening explicit URLs.
 */
function siteKeyToOrigin(key: string, requestOrigin: string | null): string | null {
  const direct = normalizeOrigin(key);
  if (direct) return direct;
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(key)) return null;

  const httpsOrigin = normalizeOrigin(`https://${key}`);
  if (!httpsOrigin || !requestOrigin) return httpsOrigin;
  try {
    const requested = new URL(requestOrigin);
    const candidate = new URL(httpsOrigin);
    if (requested.hostname === candidate.hostname && requested.port === candidate.port) {
      return requested.origin;
    }
  } catch {
    /* fall through to https */
  }
  return httpsOrigin;
}

function cleanPath(value: string | undefined): string | null {
  if (!value) return null;
  let pathname = value.trim();
  if (!pathname) return null;
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      return null;
    }
  }
  const cut = pathname.search(/[?#]/);
  if (cut >= 0) pathname = pathname.slice(0, cut);
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  return pathname.slice(0, 512) || "/";
}

/** Keep the referrer host only — no path, no query, no fragment. */
function cleanReferrer(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) return null;
  let host = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      host = new URL(trimmed).host;
    } catch {
      return null;
    }
  }
  host = host.split("/")[0].split("?")[0].split("#")[0];
  if (!host || !/^[a-z0-9.\-[\]:]+$/.test(host)) return null;
  return host.slice(0, 253);
}

/** The release version of an event — a short, safe identifier. */
function cleanRelease(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(CONTROL_CHARS, "");
  if (!trimmed || !/^[A-Za-z0-9._+-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * The details of a JavaScript error.
 *
 * The message is validated again on the server: a stack that carries an
 * e-mail address or a token is replaced, never stored.
 */
function cleanErrorDetail(event: Extract<IncomingEvent, { type: "error" }>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const message = (event.message ?? "").trim().slice(0, 300);
  if (message) {
    out.message = isSensitiveText(message) ? "[redacted]" : message.replace(CONTROL_CHARS, "");
  }
  if (event.kind) out.kind = event.kind;
  const source = cleanReferrer(event.source);
  if (source) out.source = source;
  if (typeof event.line === "number") out.line = event.line;
  if (typeof event.column === "number") out.column = event.column;
  return Object.keys(out).length ? out : null;
}

/** True when a free text value looks like personal data or a secret. */
function isSensitiveText(value: string): boolean {
  return (
    /[^\s@<>()[\],;:]+@[^\s@<>()[\],;:]+\.[a-z]{2,}/i.test(value) ||
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/.test(value) ||
    /\b[0-9a-f]{24,}\b/i.test(value) ||
    /\b(?:bearer|basic|token|password|secret)\s*[:=]?\s*\S{8,}/i.test(value)
  );
}

function cleanTag(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(CONTROL_CHARS, "");
  if (!trimmed) return null;
  return trimmed.slice(0, 100);
}

function cleanSession(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanUserAgent(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(CONTROL_CHARS, "").trim().slice(0, 512);
  return cleaned || null;
}

function cleanCountry(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toUpperCase();
  // XX = unknown, T1 = Tor; neither is a real ISO country code.
  if (!/^[A-Z]{2}$/.test(cleaned) || cleaned === "XX" || cleaned === "T1") return null;
  return cleaned;
}

function normalizeTs(ts: number | undefined, now: number): number {
  if (ts === undefined) return now;
  const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  if (!Number.isFinite(ms) || ms < 0) return now;
  return Math.min(ms, now + FUTURE_TOLERANCE_MS);
}

function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Keep only safe, short props — personal data never reaches D1.
 */
function cleanProps(props: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!props) return null;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (count >= MAX_PROPS) break;
    const name = key.trim().slice(0, 40);
    if (!name) continue;
    if (PII_KEYS.has(name.toLowerCase())) continue;
    if (typeof value === "string") {
      // The client filters too, but the server validates on its own: a
      // value that looks like an e-mail or a token is never stored.
      if (isSensitiveText(value)) continue;
      out[name] = value.slice(0, MAX_PROP_VALUE);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[name] = value;
    } else if (typeof value === "boolean") {
      out[name] = value;
    }
    count += 1;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Sanitize a web-vitals attribution blob.
 *
 * The library hands us element snippets (outerHTML) and page URLs. An element
 * snippet can contain an attribute value ("value=...") and a URL can carry
 * query parameters, so both are stripped before storage.
 */
function cleanAttribution(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= 8) break;
    const name = key.trim().slice(0, 40);
    if (!name) continue;
    if (PII_KEYS.has(name.toLowerCase())) continue;

    if (typeof raw === "string") {
      let text = raw;
      // Drop attribute values: value="secret", data-user="jane@x.com" → value=""
      text = text.replace(/=\s*"[^"]*"/g, '=""').replace(/=\s*'[^']*'/g, "=''");
      // Drop query strings and fragments from URLs.
      text = text.split("?")[0].split("#")[0];
      // The value check runs on the cleaned text: a query string that
      // carried an e-mail is already gone, the readable path stays.
      if (isSensitiveText(text)) continue;
      out[name] = text.slice(0, 200);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[name] = raw;
    } else if (typeof raw === "boolean") {
      out[name] = raw;
    } else {
      continue;
    }
    count += 1;
  }
  return Object.keys(out).length ? out : null;
}

/* ==========================================================================
   User agent → device / browser / os (server side, so it cannot be spoofed)
   ========================================================================== */

function parseUserAgent(ua: string | null): { device: string; browser: string; os: string } {
  const agent = ua ?? "";
  let device = "desktop";
  if (/bot|crawler|spider|crawling|preview|monitoring|headless|lighthouse|facebookexternalhit/i.test(agent)) {
    device = "bot";
  } else if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(agent)) {
    device = "tablet";
  } else if (/Mobi|iPhone|iPod|Windows Phone|Android.*Mobile|IEMobile/i.test(agent)) {
    device = "mobile";
  }

  let browser = "other";
  if (/Edg\/|Edge\//i.test(agent)) browser = "edge";
  else if (/OPR\/|Opera/i.test(agent)) browser = "edge";
  else if (/Firefox\/|FxiOS/i.test(agent)) browser = "firefox";
  else if (/Chrome\/|CriOS/i.test(agent)) browser = "chrome";
  else if (/Safari\//i.test(agent)) browser = "safari";

  let os = "other";
  if (/Windows NT/i.test(agent)) os = "windows";
  else if (/Android/i.test(agent)) os = "android";
  else if (/iPhone|iPad|iPod|iOS/i.test(agent)) os = "ios";
  else if (/Mac OS X|Macintosh/i.test(agent)) os = "macos";
  else if (/Linux/i.test(agent)) os = "linux";

  return { device, browser, os };
}

/* ==========================================================================
   Bodies
   ========================================================================== */

type JsonRead =
  | { ok: true; value: unknown }
  | { ok: false; error: "invalid_json" | "payload_too_large" };

/** Read at most `maxBytes` from the request body, then parse it as JSON. */
async function readJson(request: Request, maxBytes: number): Promise<JsonRead> {
  if (!request.body) return { ok: false, error: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "payload_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

/** Read a binary body with a hard size cap. */
async function readBinary(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: "too_large" | "empty" }> {
  if (!request.body) return { ok: false, error: "empty" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "empty" };
  }
  if (total === 0) return { ok: false, error: "empty" };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/* ==========================================================================
   Sites
   ========================================================================== */

const SITE_COLUMNS =
  "id, public_id, name, origin, created_at, retention_days, daily_event_limit, events_today, counter_day";

async function siteById(db: D1Database, id: number): Promise<Site | null> {
  return db
    .prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<Site>();
}

/**
 * v1 is self-serve: the first valid collect from a new origin creates its site.
 * The number of sites is capped so the public endpoint cannot be used to fill
 * the D1 write quota with throwaway sites.
 */
async function registerSite(
  db: D1Database,
  origin: string,
  maxSites = 500,
): Promise<{ site: Site; created: boolean }> {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM sites").first<{ n: number }>();
  if ((count?.n ?? 0) >= maxSites) {
    const error = new Error("site_limit_reached") as Error & { code?: string };
    error.code = "site_limit_reached";
    throw error;
  }
  const host = new URL(origin).hostname.slice(0, 253);
  const publicId = `site_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const result = await db
    .prepare("INSERT OR IGNORE INTO sites (public_id, name, origin, created_at) VALUES (?, ?, ?, ?)")
    .bind(publicId, host, origin, Date.now())
    .run();

  const site = await siteByOrigin(db, origin);
  if (!site) throw new Error("site_registration_failed");
  return { site, created: (result.meta.changes ?? 0) > 0 };
}

type ResolveResult =
  | { site: Site; created: boolean }
  | {
      error: "site_required" | "unknown_site" | "origin_mismatch" | "site_limit_reached";
      status: 400 | 403 | 404 | 429;
    };

async function resolveSite(
  db: D1Database,
  requestOrigin: string | null,
  siteKey: string | undefined,
  maxSites = 500,
): Promise<ResolveResult> {
  if (siteKey) {
    const key = siteKey.trim();
    const existing = await siteByKey(db, key);
    if (existing) {
      const configuredOrigin = normalizeOrigin(existing.origin) ?? existing.origin;
      if (requestOrigin && configuredOrigin !== requestOrigin) {
        return { error: "origin_mismatch", status: 403 };
      }
      return { site: existing, created: false };
    }

    const keyOrigin = siteKeyToOrigin(key, requestOrigin);
    if (!keyOrigin) return { error: "unknown_site", status: 404 };

    const byOrigin = await siteByOrigin(db, keyOrigin);
    if (byOrigin) return { site: byOrigin, created: false };
    return registerSite(db, keyOrigin, maxSites);
  }

  if (!requestOrigin) return { error: "site_required", status: 400 };
  const existing = await siteByOrigin(db, requestOrigin);
  if (existing) return { site: existing, created: false };
  return registerSite(db, requestOrigin, maxSites);
}

/* ==========================================================================
   Goals
   ========================================================================== */

/** Match an event against the site goals (by name, or by path for page goals). */
function matchGoal(goals: Goal[], event: IncomingEvent, path: string | null): Goal | null {
  for (const goal of goals) {
    if (event.type === "event" && event.name === goal.name) return goal;
    if (goal.path && path && goal.path === path) return goal;
  }
  return null;
}

/* ==========================================================================
   Shared helpers
   ========================================================================== */


/** Bounded LIMIT helper — never lets a bad query parameter reach D1. */
function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function invalidPayload(c: Context<AppEnv>, issues: z.ZodIssue[]) {
  return c.json(
    {
      error: "invalid_payload",
      issues: issues.slice(0, 8).map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    },
    400,
  );
}

function unauthorized(c: Context<AppEnv>) {
  return c.json({ error: "unauthorized" }, 401);
}

/**
 * The visitor IP as seen by the edge (empty string for server-to-server calls).
 *
 * `cf-connecting-ip` is the header Cloudflare writes itself, but a zone
 * that removes the visitor IP headers also removes it. `x-real-ip` is
 * rewritten by the edge with the real address, so it is the second
 * choice; `x-forwarded-for` is the last one because a visitor can send it.
 */
function clientIp(c: Context<AppEnv>): string {
  const edge = c.req.header("cf-connecting-ip")?.trim();
  if (edge) return edge;
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

function tooManyRequests(c: Context<AppEnv>, retryAfter: number) {
  c.header("Retry-After", String(retryAfter));
  return c.json(
    {
      error: "rate_limited",
      retryAfter,
      message: "Too many requests. Slow down and try again shortly.",
    },
    429,
  );
}

/* ==========================================================================
   CORS + origin capture for the public ingest endpoint
   ========================================================================== */

app.use("/api/collect", async (c, next) => {
  const rawOrigin = c.req.header("origin");
  let corsOrigin: string | null = null;
  if (rawOrigin) {
    corsOrigin = normalizeOrigin(rawOrigin);
    if (!corsOrigin) return c.json({ error: "invalid_origin" }, 403);
  }

  const requestOrigin = corsOrigin ?? normalizeOrigin(c.req.header("referer") ?? "");
  c.set("requestOrigin", requestOrigin);

  if (corsOrigin) {
    c.header("Access-Control-Allow-Origin", corsOrigin);
    // The SDK sends the batch with navigator.sendBeacon, which always
    // includes the credentials. The browser therefore refuses the request
    // unless the preflight allows credentials — without this header every
    // third party site would silently lose its events.
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }

  if (c.req.method === "OPTIONS") {
    if (!corsOrigin) return c.json({ error: "origin_required" }, 403);
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    c.header("Access-Control-Allow-Headers", "content-type");
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  }

  // Cheap protection before any body is read: 120 requests per minute per IP.
  const limit = rateLimit(`collect:${clientIp(c) || "unknown"}`, 120, 60_000);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfter);

  await next();
});

/** Read-only reports resolve the site the same way ingest does. */
app.use("/api/analytics/*", async (c, next) => {
  const rawOrigin = c.req.header("origin");
  const corsOrigin = rawOrigin ? normalizeOrigin(rawOrigin) : null;
  c.set("requestOrigin", corsOrigin ?? normalizeOrigin(c.req.header("referer") ?? ""));
  if (corsOrigin) {
    c.header("Access-Control-Allow-Origin", corsOrigin);
    c.header("Vary", "Origin");
  }
  const limit = rateLimit(`analytics:${clientIp(c) || "unknown"}`, 60, 60_000);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfter);
  await next();
});

app.use("/api/rum/*", async (c, next) => {
  const rawOrigin = c.req.header("origin");
  const corsOrigin = rawOrigin ? normalizeOrigin(rawOrigin) : null;
  c.set("requestOrigin", corsOrigin ?? normalizeOrigin(c.req.header("referer") ?? ""));
  if (corsOrigin) {
    c.header("Access-Control-Allow-Origin", corsOrigin);
    c.header("Vary", "Origin");
  }
  const limit = rateLimit(`rum:${clientIp(c) || "unknown"}`, 60, 60_000);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfter);
  await next();
});

/* ==========================================================================
   GET /api/health — smoke test
   ========================================================================== */

app.get("/api/health", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name LIMIT 12",
  ).all<{ name: string }>();
  return c.json({ ok: true, ts: Date.now(), tables: results.map((r) => r.name) });
});

/* ==========================================================================
   POST /api/collect — SDK event batch ingest
   ========================================================================== */

app.post("/api/collect", async (c) => {
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return c.json({ error: "payload_too_large", max: MAX_BODY_BYTES }, 413);
  }

  const body = await readJson(c.req.raw, MAX_BODY_BYTES);
  if (!body.ok) {
    if (body.error === "payload_too_large") {
      return c.json({ error: "payload_too_large", max: MAX_BODY_BYTES }, 413);
    }
    return c.json({ error: "invalid_json" }, 400);
  }

  const raw: unknown = body.value;
  if (raw === null) return c.json({ error: "invalid_json" }, 400);

  const isEnvelope = !Array.isArray(raw) && typeof raw === "object" && raw !== null;
  const eventCount = Array.isArray(raw)
    ? raw.length
    : isEnvelope && Array.isArray((raw as { events?: unknown }).events)
      ? (raw as { events: unknown[] }).events.length
      : null;

  if (eventCount !== null && eventCount > MAX_BATCH) {
    return c.json({ error: "batch_too_large", max: MAX_BATCH }, 413);
  }

  let siteKey: string | undefined;
  let events: IncomingEvent[];
  let privacyCounters: Record<string, number> | undefined;

  if (Array.isArray(raw)) {
    const parsed = z.array(eventSchema).max(MAX_BATCH).safeParse(raw);
    if (!parsed.success) return invalidPayload(c, parsed.error.issues);
    events = parsed.data;
  } else {
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) return invalidPayload(c, parsed.error.issues);
    siteKey = parsed.data.site;
    events = parsed.data.events;
    privacyCounters = parsed.data.privacy;
  }

  if (events.length === 0) {
    return c.json({ ok: true, accepted: 0, deduped: 0, sessions: 0 }, 202);
  }

  const attributions: (string | null)[] = [];
  for (const event of events) {
    const attribution = attributionFor(event);
    if (attribution === "too_large") {
      return c.json({ error: "attribution_too_large", max: MAX_ATTRIBUTION_BYTES }, 413);
    }
    attributions.push(attribution);
  }

  try {
    const maxSites = Number(c.env.MAX_SITES ?? 500);
    const resolved = await resolveSite(c.env.DB, c.get("requestOrigin"), siteKey, maxSites);
    if ("error" in resolved) {
      if (resolved.error === "site_limit_reached") {
        return c.json(
          {
            error: "site_limit_reached",
            message: "This deployment does not accept new sites any more.",
            accepted: 0,
          },
          429,
        );
      }
      return c.json({ error: resolved.error }, resolved.status);
    }
    const site = resolved.site;

    // Free-plan write guard: a site may not exceed its daily event budget.
    const now = Date.now();
    const today = todayKey(now);
    const usedToday = site.counter_day === today ? site.events_today : 0;
    if (usedToday + events.length > site.daily_event_limit) {
      return c.json(
        {
          error: "quota_exceeded",
          limit: site.daily_event_limit,
          used: usedToday,
          accepted: 0,
          message: "Daily event limit reached for this site. Events were not stored.",
        },
        429,
      );
    }

    const country = cleanCountry(c.req.header("cf-ipcountry"));
    const ua = cleanUserAgent(c.req.header("user-agent"));
    const { device, browser, os } = parseUserAgent(ua);

    // Goals are only read when the batch can contain a conversion.
    const canConvert = events.some((event) => event.type === "event");
    const goals = canConvert ? await goalsFor(c.env.DB, site.id) : [];

    const statements: D1PreparedStatement[] = [];
    const sessionSeen = new Set<string>();
    // Maps a statement onto the event it belongs to: a release marker is
    // stored in the releases table and is not a measurement.
    const statementEvent: number[] = [];
    let releaseMarkers = 0;

    for (let index = 0; index < events.length; index++) {
      const event = events[index];

      // A release marker: the version and the moment it went live. It is
      // not a measurement, so it does not become an event row.
      if (event.type === "release") {
        const deployedAt = normalizeTs(event.deployedAt ?? event.ts, now);
        await upsertRelease(c.env.DB, site.id, event.version, deployedAt, "sdk");
        releaseMarkers += 1;
        continue;
      }

      const ts = normalizeTs(event.ts, now);
      const path = cleanPath(event.path);
      const referrer = cleanReferrer(event.ref);
      const session = cleanSession(event.session);
      const goal = matchGoal(goals, event, path);

      let metric = "pageview";
      let value: number | null = null;
      let rating: string | null = null;

      if (event.type === "vital") {
        metric = event.metric;
        value = event.value;
        rating = event.rating ?? null;
      } else if (event.type === "event") {
        metric = event.name;
        value = event.value ?? null;
      } else if (event.type === "error") {
        // JavaScript errors are measurements of their own: they are counted
        // per page and compared around a release.
        metric = "js_error";
      }

      statements.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO events
            (site_id, ts, metric, value, rating, path, country, ua, session_id, metric_id,
             attribution, referrer, utm_source, utm_medium, utm_campaign, device, browser, os, goal, release)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          site.id,
          ts,
          metric,
          value,
          rating,
          path,
          country,
          ua,
          session,
          event.id ?? null,
          attributions[index] ?? null,
          referrer,
          cleanTag(event.utm?.source),
          cleanTag(event.utm?.medium),
          cleanTag(event.utm?.campaign),
          device,
          browser,
          os,
          goal ? goal.name : null,
          cleanRelease(event.release),
        ),
      );
      statementEvent.push(index);

      if (session) sessionSeen.add(session);
    }

    // One row per session keeps visitor/session counts cheap.
    for (const session of sessionSeen) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO sessions
            (site_id, session_id, started_at, last_seen_at, pageviews, events, country, device, browser, os, referrer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (site_id, session_id) DO UPDATE SET
             last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
             pageviews = pageviews + excluded.pageviews,
             events = events + excluded.events`,
        ).bind(
          site.id,
          session,
          now,
          now,
          events.filter((event) => event.type === "pageview" && event.session === session).length,
          events.filter((event) => event.session === session).length,
          country,
          device,
          browser,
          os,
          null,
        ),
      );
    }

    // Daily counter, so the quota check costs no extra query.
    statements.push(
      c.env.DB.prepare(
        `UPDATE sites
            SET events_today = CASE WHEN counter_day = ? THEN events_today + ? ELSE ? END,
                counter_day = ?
          WHERE id = ?`,
      ).bind(today, statementEvent.length, statementEvent.length, today, site.id),
    );

    // The Privacy Gate counters: only how many payloads were blocked.
    if (privacyCounters && Object.keys(privacyCounters).length) {
      await addPrivacyCounters(c.env.DB, site.id, privacyCounters).catch(() => undefined);
    }

    const results = await c.env.DB.batch(statements);
    let accepted = 0;
    let deduped = 0;
    let failed = 0;
    for (let index = 0; index < statementEvent.length; index++) {
      const changes = results[index]?.meta.changes ?? 0;
      if (changes > 0) {
        accepted += changes;
        continue;
      }
      // A vital with a metric id is a duplicate (web-vitals can report twice);
      // anything else means the row was not written.
      const event = events[statementEvent[index]];
      if (event?.id) deduped += 1;
      else failed += 1;
    }
    if (failed > 0) console.error("collect_partial_write", { site: site.public_id, failed });

    return c.json(
      {
        ok: failed === 0,
        accepted,
        deduped,
        failed,
        releases: releaseMarkers,
        sessions: sessionSeen.size,
        site: site.public_id,
        ...(resolved.created ? { created: true } : {}),
      },
      failed === 0 ? 202 : 207,
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "site_limit_reached") {
      return c.json(
        {
          error: "site_limit_reached",
          message: "This deployment does not accept new sites any more.",
          accepted: 0,
        },
        429,
      );
    }
    console.error("collect_failed", error);
    // Nothing was written — say so instead of pretending the batch succeeded.
    return c.json({ error: "storage_error", accepted: 0 }, 500);
  }
});

/** Returns the attribution JSON for an event, or "too_large". */
function attributionFor(event: IncomingEvent): string | null | "too_large" {
  const payload =
    event.type === "vital"
      ? cleanAttribution(event.attribution)
      : event.type === "event"
        ? cleanProps(event.props ?? event.attribution)
        : event.type === "error"
          ? cleanErrorDetail(event)
          : undefined;
  if (payload === undefined) return null;
  if (jsonSize(payload) > MAX_ATTRIBUTION_BYTES) return "too_large";
  return JSON.stringify(payload);
}

/* ==========================================================================
   Analytics reports
   ========================================================================== */

type ReportSite = { site: Site | null; error?: "unknown_site" | "site_required" | "origin_mismatch" };

/** Resolve the site for a read-only report without ever creating one. */
/**
 * Resolve the site for a read-only report.
 *
 * Isolation: a site key only unlocks its own origin. Without a matching
 * origin the request is refused (403) — otherwise anyone who learns a site
 * id could read another tenant's traffic. Requests without an origin (server
 * to server) may not use the `site` parameter at all.
 */
async function reportSite(c: Context<AppEnv>): Promise<ReportSite> {
  const requestOrigin = c.get("requestOrigin");
  const siteKey = c.req.query("site");
  if (siteKey) {
    const key = siteKey.trim();
    const byKey = await siteByKey(c.env.DB, key);
    if (byKey) {
      if (!requestOrigin || byKey.origin !== requestOrigin) {
        return { site: null, error: "origin_mismatch" };
      }
      return { site: byKey };
    }
    const origin = siteKeyToOrigin(key, requestOrigin);
    if (origin) {
      const byOrigin = await siteByOrigin(c.env.DB, origin);
      if (byOrigin) {
        if (!requestOrigin || byOrigin.origin !== requestOrigin) {
          return { site: null, error: "origin_mismatch" };
        }
        return { site: byOrigin };
      }
    }
    return { site: null, error: "unknown_site" };
  }
  if (!requestOrigin) return { site: null, error: "site_required" };
  return { site: await siteByOrigin(c.env.DB, requestOrigin) };
}

/** A report may not cross an origin boundary. */
function reportError(c: Context<AppEnv>, error: string | undefined) {
  if (error === "origin_mismatch") {
    return c.json({ error: "origin_mismatch" }, 403);
  }
  return null;
}

/** Resolve the report site and turn an isolation failure into a 403. */
async function resolveReportSite(c: Context<AppEnv>): Promise<{ site: Site | null; response?: Response }> {
  const resolved = await reportSite(c);
  return { site: resolved.site, response: reportError(c, resolved.error) ?? undefined };
}

app.get("/api/analytics/summary", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) {
    return c.json({
      ok: true,
      range,
      generatedAt: now,
      site: null,
      empty: true,
      totals: { pageviews: 0, visitors: 0, sessions: 0, events: 0, customEvents: 0, conversions: 0, goals: 0 },
      series: emptySeries(buckets, bucketMs, from),
      topPages: [],
      referrers: [],
      campaigns: [],
      devices: [],
      goals: [],
      customEvents: [],
      countries: [],
      realtime: { events: 0, activeSessions: 0, topPages: [] },
    });
  }

  // The summary runs a dozen queries, so it is cached for a minute per data
  // centre instead of being recomputed on every console poll.
  // `?fresh=1` bypasses the cache (ops / tests).
  const cache = caches.default;
  const cacheKey = new Request(`https://dynamic.internal/api/analytics/${site.id}/${range}`);
  if (c.req.query("fresh") !== "1") {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const payload = await analyticsSummary(c.env.DB, site, range);
  const result = c.json(payload, 200);
  result.headers.set("Cache-Control", "public, max-age=60");
  await cache.put(cacheKey, result.clone());
  return result;
});

app.get("/api/analytics/timeseries", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) {
    return c.json({ ok: true, range, series: emptySeries(buckets, bucketMs, from) });
  }

  const [eventRows, sessionRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT CAST(ts / ? AS INTEGER) AS bucket, metric, COUNT(*) AS n
         FROM events WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY bucket, metric`,
    )
      .bind(bucketMs, site.id, from, now)
      .all<{ bucket: number; metric: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT CAST(started_at / ? AS INTEGER) AS bucket, COUNT(*) AS n
         FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY bucket`,
    )
      .bind(bucketMs, site.id, from, now)
      .all<{ bucket: number; n: number }>(),
  ]);

  const series = emptySeries(buckets, bucketMs, from);
  const firstBucket = Math.floor(from / bucketMs);
  for (const row of eventRows.results) {
    const index = row.bucket - firstBucket;
    if (index < 0 || index >= series.length) continue;
    series[index].events += row.n;
    if (row.metric === "pageview") series[index].pageviews += row.n;
  }
  for (const row of sessionRows.results) {
    const index = row.bucket - firstBucket;
    if (index < 0 || index >= series.length) continue;
    series[index].visitors = row.n;
  }
  return c.json({ ok: true, range, series });
});

app.get("/api/analytics/pages", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const limit = parseLimit(c.req.query("limit"), 25, 100);
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, pages: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT path, COUNT(*) AS n FROM events
      WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND path IS NOT NULL
      GROUP BY path ORDER BY n DESC LIMIT ?`,
  )
    .bind(site.id, from, now, limit)
    .all<{ path: string; n: number }>();
  return c.json({ ok: true, range, pages: results });
});

app.get("/api/analytics/referrers", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const limit = parseLimit(c.req.query("limit"), 25, 100);
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, referrers: [], campaigns: [] });

  const [referrerRows, campaignRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT referrer, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND referrer IS NOT NULL
        GROUP BY referrer ORDER BY n DESC LIMIT ?`,
    )
      .bind(site.id, from, now, limit)
      .all<{ referrer: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, COUNT(*) AS n
         FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND utm_campaign IS NOT NULL
        GROUP BY utm_source, utm_medium, utm_campaign ORDER BY n DESC LIMIT ?`,
    )
      .bind(site.id, from, now, limit)
      .all<{ source: string | null; medium: string | null; campaign: string | null; n: number }>(),
  ]);

  return c.json({ ok: true, range, referrers: referrerRows.results, campaigns: campaignRows.results });
});

app.get("/api/analytics/devices", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, devices: [], browsers: [], os: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT device, browser, os, COUNT(*) AS n FROM events
      WHERE site_id = ? AND ts >= ? AND ts < ?
      GROUP BY device, browser, os ORDER BY n DESC LIMIT 25`,
  )
    .bind(site.id, from, now)
    .all<{ device: string; browser: string; os: string; n: number }>();

  const devices = new Map<string, number>();
  const browsers = new Map<string, number>();
  const oses = new Map<string, number>();
  for (const row of results) {
    devices.set(row.device, (devices.get(row.device) ?? 0) + row.n);
    browsers.set(row.browser, (browsers.get(row.browser) ?? 0) + row.n);
    oses.set(row.os, (oses.get(row.os) ?? 0) + row.n);
  }
  const toList = (map: Map<string, number>) =>
    [...map.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);

  return c.json({ ok: true, range, devices: toList(devices), browsers: toList(browsers), os: toList(oses) });
});

app.get("/api/analytics/events", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const limit = parseLimit(c.req.query("limit"), 25, 100);
  const name = c.req.query("name");
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, events: [] });

  const statement = name
    ? c.env.DB.prepare(
        `SELECT metric AS name, COUNT(*) AS n FROM events
          WHERE site_id = ? AND ts >= ? AND ts < ?
            AND metric NOT IN ('pageview','LCP','INP','CLS','FCP','TTFB')
            AND metric = ?
          GROUP BY metric ORDER BY n DESC LIMIT ?`,
      )
    : c.env.DB.prepare(
        `SELECT metric AS name, COUNT(*) AS n FROM events
          WHERE site_id = ? AND ts >= ? AND ts < ?
            AND metric NOT IN ('pageview','LCP','INP','CLS','FCP','TTFB')
          GROUP BY metric ORDER BY n DESC LIMIT ?`,
      );
  const bound = name
    ? statement.bind(site.id, from, now, name, limit)
    : statement.bind(site.id, from, now, limit);
  const { results } = await bound.all<{ name: string; n: number }>();
  return c.json({ ok: true, range, events: results });
});

app.get("/api/analytics/goals", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, goals: [] });

  const [goalRows, definitions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT goal AS name, COUNT(*) AS n, SUM(COALESCE(value, 0)) AS value FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND goal IS NOT NULL
        GROUP BY goal ORDER BY n DESC LIMIT 25`,
    )
      .bind(site.id, from, now)
      .all<{ name: string; n: number; value: number }>(),
    goalsFor(c.env.DB, site.id),
  ]);

  return c.json({
    ok: true,
    range,
    goals: goalRows.results,
    definitions: definitions.map((goal) => ({
      name: goal.name,
      label: goal.label,
      path: goal.path,
      value: goal.value,
    })),
  });
});

app.get("/api/analytics/realtime", async (c) => {
  const now = Date.now();
  const since = now - 30 * 60_000;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) {
    return c.json({ ok: true, window: "30m", events: 0, activeSessions: 0, topPages: [] });
  }

  const [countRows, sessionRows, pageRows] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND ts >= ?").bind(site.id, since).all<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT session_id) AS n FROM sessions WHERE site_id = ? AND last_seen_at >= ?",
    )
      .bind(site.id, since)
      .all<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT path, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND path IS NOT NULL
        GROUP BY path ORDER BY n DESC LIMIT 5`,
    )
      .bind(site.id, since)
      .all<{ path: string; n: number }>(),
  ]);

  return c.json({
    ok: true,
    window: "30m",
    events: countRows.results[0]?.n ?? 0,
    activeSessions: sessionRows.results[0]?.n ?? 0,
    topPages: pageRows.results,
  });
});

app.get("/api/analytics/sessions", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) {
    return c.json({ ok: true, range, sessions: 0, visitors: 0, avgPagesPerSession: 0, bounceRate: 0 });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT COUNT(*) AS sessions,
            SUM(CASE WHEN pageviews <= 1 THEN 1 ELSE 0 END) AS bounced,
            SUM(pageviews) AS pageviews
       FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?`,
  )
    .bind(site.id, from, now)
    .all<{ sessions: number; bounced: number; pageviews: number }>();

  const row = results[0];
  const sessions = row?.sessions ?? 0;
  const bounced = row?.bounced ?? 0;
  const pageviews = row?.pageviews ?? 0;
  return c.json({
    ok: true,
    range,
    sessions,
    visitors: sessions,
    avgPagesPerSession: sessions ? Number((pageviews / sessions).toFixed(2)) : 0,
    bounceRate: sessions ? Number((bounced / sessions).toFixed(3)) : 0,
  });
});

/* ==========================================================================
   RUM reports
   ========================================================================== */

app.get("/api/rum/summary", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) {
    return c.json({
      ok: true,
      range,
      metrics: VITAL_METRIC_LIST.map((metric) => ({
        metric,
        samples: 0,
        avg: null,
        p50: null,
        p75: null,
        good: 0,
        needsImprovement: 0,
        poor: 0,
        sufficient: false,
        sampled: false,
        note: "No data yet.",
      })),
    });
  }

  // The percentile scan is the most expensive query in the app, so the result
  // is cached for five minutes (per data centre). `?fresh=1` bypasses it.
  const cache = caches.default;
  const cacheKey = new Request(`https://dynamic.internal/api/rum/${site.id}/${range}`);
  if (c.req.query("fresh") !== "1") {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const payload = await rumSummary(c.env.DB, site.id, range);
  const result = c.json(payload, 200);
  result.headers.set("Cache-Control", "public, max-age=300");
  await cache.put(cacheKey, result.clone());
  return result;
});

app.get("/api/rum/timeseries", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const metric = (c.req.query("metric") ?? "LCP").toUpperCase();
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, metric, series: [] });

  const { results } = await c.env.DB.prepare(
    `WITH vals AS (
       SELECT CAST(ts / ? AS INTEGER) AS bucket, value FROM events
        WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
     ),
     ranked AS (
       SELECT bucket, value,
              ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY value) AS rn,
              COUNT(*) OVER (PARTITION BY bucket) AS cnt
         FROM vals
     )
     SELECT bucket,
            MAX(cnt) AS samples,
            AVG(value) AS avg,
            MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INT) + 1 THEN value END) AS p75
       FROM ranked GROUP BY bucket ORDER BY bucket`,
  )
    .bind(bucketMs, site.id, metric, from, now)
    .all<{ bucket: number; samples: number; avg: number | null; p75: number | null }>();

  const firstBucket = Math.floor(from / bucketMs);
  const series = Array.from({ length: buckets }, (_, index) => {
    const bucket = firstBucket + index;
    const row = results.find((entry) => entry.bucket === bucket);
    const samples = row?.samples ?? 0;
    return {
      t: bucket * bucketMs,
      samples,
      avg: row?.avg ?? null,
      p75: samples >= MIN_P75_SAMPLES ? row?.p75 ?? null : null,
    };
  });

  return c.json({ ok: true, range, metric, series });
});

app.get("/api/rum/pages", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const metric = (c.req.query("metric") ?? "LCP").toUpperCase();
  const limit = parseLimit(c.req.query("limit"), 15, 50);
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, metric, pages: [] });

  const { results } = await c.env.DB.prepare(
    `WITH vals AS (
       SELECT path, value FROM events
        WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL AND path IS NOT NULL
     ),
     ranked AS (
       SELECT path, value,
              ROW_NUMBER() OVER (PARTITION BY path ORDER BY value) AS rn,
              COUNT(*) OVER (PARTITION BY path) AS cnt
         FROM vals
     )
     SELECT path,
            MAX(cnt) AS samples,
            AVG(value) AS avg,
            MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INT) + 1 THEN value END) AS p75
       FROM ranked GROUP BY path ORDER BY avg DESC LIMIT ?`,
  )
    .bind(site.id, metric, from, now, limit)
    .all<{ path: string; samples: number; avg: number | null; p75: number | null }>();

  return c.json({
    ok: true,
    range,
    metric,
    pages: results.map((row) => ({
      ...row,
      p75: row.samples >= MIN_P75_SAMPLES ? row.p75 : null,
    })),
  });
});

app.get("/api/rum/devices", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const metric = (c.req.query("metric") ?? "LCP").toUpperCase();
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) return c.json({ ok: true, range, metric, devices: [] });

  const { results } = await c.env.DB.prepare(
    `WITH vals AS (
       SELECT device, browser, value FROM events
        WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
     ),
     ranked AS (
       SELECT device, browser, value,
              ROW_NUMBER() OVER (PARTITION BY device, browser ORDER BY value) AS rn,
              COUNT(*) OVER (PARTITION BY device, browser) AS cnt
         FROM vals
     )
     SELECT device, browser,
            MAX(cnt) AS samples,
            AVG(value) AS avg,
            MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INT) + 1 THEN value END) AS p75
       FROM ranked GROUP BY device, browser ORDER BY samples DESC LIMIT 20`,
  )
    .bind(site.id, metric, from, now)
    .all<{ device: string; browser: string; samples: number; avg: number | null; p75: number | null }>();

  return c.json({
    ok: true,
    range,
    metric,
    devices: results.map((row) => ({
      ...row,
      p75: row.samples >= MIN_P75_SAMPLES ? row.p75 : null,
    })),
  });
});

/* ==========================================================================
   Admin API — guarded, separate from the public ingest endpoints
   ========================================================================== */

app.use("/api/admin/*", async (c, next) => {
  // The admin surface is token protected; the limiter keeps a stolen or
  // guessed token from being brute forced.
  const limit = rateLimit(`admin:${clientIp(c) || "unknown"}`, 30, 60_000);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfter);

  const expected = c.env.ADMIN_API_KEY;
  if (!expected) return c.json({ error: "admin_not_configured" }, 503);
  const header = c.req.header("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? "";
  if (token.length !== expected.length) return unauthorized(c);
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ token.charCodeAt(index);
  }
  if (diff !== 0) return unauthorized(c);
  await next();
});

app.get("/api/admin/sites", async (c) => {
  // The counters are capped estimates: a full COUNT over every event of every
  // site would read millions of rows and burn the daily D1 budget.
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.public_id, s.name, s.origin, s.created_at, s.retention_days, s.daily_event_limit,
            s.events_today, s.counter_day,
            (SELECT COUNT(*) FROM (SELECT 1 FROM events e WHERE e.site_id = s.id LIMIT 1000)) AS events_estimate,
            (SELECT COUNT(*) FROM (SELECT 1 FROM sessions ss WHERE ss.site_id = s.id LIMIT 1000)) AS sessions_estimate
       FROM sites s ORDER BY s.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ ok: true, sites: results });
});

const createSiteSchema = z.object({
  name: z.string().min(1).max(120),
  origin: z.string().min(1).max(253),
});

app.post("/api/admin/sites", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSiteSchema.safeParse(body);
  if (!parsed.success) return invalidPayload(c, parsed.error.issues);

  const origin = normalizeOrigin(parsed.data.origin);
  if (!origin) return c.json({ error: "invalid_origin" }, 400);

  const existing = await siteByOrigin(c.env.DB, origin);
  if (existing) return c.json({ ok: true, site: existing.public_id, created: false });

  const publicId = `site_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO sites (public_id, name, origin, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(publicId, parsed.data.name.slice(0, 120), origin, Date.now())
    .run();
  return c.json({ ok: true, site: publicId, created: true }, 201);
});

app.get("/api/admin/sites/:id", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  const [events, sessions, goals] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = ?").bind(site.id).all<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE site_id = ?").bind(site.id).all<{ n: number }>(),
    goalsFor(c.env.DB, site.id),
  ]);
  return c.json({
    ok: true,
    site,
    events: events.results[0]?.n ?? 0,
    sessions: sessions.results[0]?.n ?? 0,
    goals,
  });
});

const patchSiteSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  retention_days: z.number().int().min(1).max(365).optional(),
  daily_event_limit: z.number().int().min(1).max(100000).optional(),
});

app.patch("/api/admin/sites/:id", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = patchSiteSchema.safeParse(body);
  if (!parsed.success) return invalidPayload(c, parsed.error.issues);

  await c.env.DB.prepare(
    `UPDATE sites SET name = COALESCE(?, name),
                      retention_days = COALESCE(?, retention_days),
                      daily_event_limit = COALESCE(?, daily_event_limit)
      WHERE id = ?`,
  )
    .bind(
      parsed.data.name ?? null,
      parsed.data.retention_days ?? null,
      parsed.data.daily_event_limit ?? null,
      site.id,
    )
    .run();
  return c.json({ ok: true });
});

const goalSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_.:-]+$/, "Use letters, numbers, _, ., : or - only"),
  label: z.string().max(120).optional(),
  path: z.string().max(512).optional(),
  value: z.number().nonnegative().max(1_000_000_000).optional(),
});

app.get("/api/admin/sites/:id/goals", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, goals: await goalsFor(c.env.DB, site.id) });
});

app.post("/api/admin/sites/:id/goals", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = goalSchema.safeParse(body);
  if (!parsed.success) return invalidPayload(c, parsed.error.issues);

  const publicId = `goal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await c.env.DB.prepare(
    "INSERT INTO goals (site_id, public_id, name, label, path, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      site.id,
      publicId,
      parsed.data.name,
      parsed.data.label ?? null,
      parsed.data.path ? cleanPath(parsed.data.path) : null,
      parsed.data.value ?? null,
      Date.now(),
    )
    .run();
  return c.json({ ok: true, goal: publicId }, 201);
});

app.delete("/api/admin/sites/:id/goals/:goal", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  const result = await c.env.DB.prepare("DELETE FROM goals WHERE site_id = ? AND public_id = ?")
    .bind(site.id, c.req.param("goal"))
    .run();
  return c.json({ ok: true, deleted: result.meta.changes ?? 0 });
});

app.post("/api/admin/sites/:id/purge", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { older_than_days?: number };
  const days = Math.min(365, Math.max(1, Number(body.older_than_days ?? site.retention_days)));
  const cutoff = Date.now() - days * 86400_000;

  const [events, sessions] = await Promise.all([
    c.env.DB.prepare("DELETE FROM events WHERE site_id = ? AND ts < ?").bind(site.id, cutoff).run(),
    c.env.DB.prepare("DELETE FROM sessions WHERE site_id = ? AND started_at < ?").bind(site.id, cutoff).run(),
  ]);
  return c.json({
    ok: true,
    cutoff,
    deletedEvents: events.meta.changes ?? 0,
    deletedSessions: sessions.meta.changes ?? 0,
  });
});

/**
 * GET /api/admin/sites/:id/export — data portability (KVKK madde 11 / GDPR 20).
 * Bounded pages: ?limit (max 1000) and ?offset keep the response and the D1
 * read cost predictable.
 */
app.get("/api/admin/sites/:id/export", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);

  const limit = parseLimit(c.req.query("limit"), 500, 1000);
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);

  const [sessions, events, goals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT session_id, started_at, last_seen_at, pageviews, events, country, device, browser, os, referrer
         FROM sessions WHERE site_id = ? ORDER BY started_at LIMIT ? OFFSET ?`,
    )
      .bind(site.id, limit, offset)
      .all(),
    c.env.DB.prepare(
      `SELECT ts, metric, value, rating, path, country, ua, session_id, metric_id, goal,
              attribution, referrer, utm_source, utm_medium, utm_campaign, device, browser, os
         FROM events WHERE site_id = ? ORDER BY ts LIMIT ? OFFSET ?`,
    )
      .bind(site.id, limit, offset)
      .all(),
    goalsFor(c.env.DB, site.id),
  ]);

  const eventCount = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = ?")
    .bind(site.id)
    .all<{ n: number }>();

  return c.json({
    ok: true,
    exportedAt: Date.now(),
    site: {
      id: site.public_id,
      name: site.name,
      origin: site.origin,
      createdAt: site.created_at ?? null,
      retentionDays: site.retention_days,
    },
    totals: {
      events: eventCount.results[0]?.n ?? 0,
      sessions: sessions.results.length,
    },
    sessions: sessions.results,
    events: events.results,
    goals,
    pagination: { limit, offset, nextOffset: offset + limit },
  });
});

/**
 * DELETE /api/admin/sites/:id — right to erasure (KVKK madde 7 / GDPR 17).
 * Requires ?confirm=<public id> so a wrong call cannot wipe a site.
 */
app.delete("/api/admin/sites/:id", async (c) => {
  const site = await siteById(c.env.DB, Number(c.req.param("id")));
  if (!site) return c.json({ error: "not_found" }, 404);
  if (c.req.query("confirm") !== site.public_id) {
    return c.json(
      {
        error: "confirmation_required",
        message: `Append ?confirm=${site.public_id} to erase this site and all of its data.`,
      },
      400,
    );
  }

  const [events, sessions, goals] = await Promise.all([
    c.env.DB.prepare("DELETE FROM events WHERE site_id = ?").bind(site.id).run(),
    c.env.DB.prepare("DELETE FROM sessions WHERE site_id = ?").bind(site.id).run(),
    c.env.DB.prepare("DELETE FROM goals WHERE site_id = ?").bind(site.id).run(),
  ]);
  await c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(site.id).run();

  return c.json({
    ok: true,
    erased: {
      site: site.public_id,
      events: events.meta.changes ?? 0,
      sessions: sessions.meta.changes ?? 0,
      goals: goals.meta.changes ?? 0,
    },
  });
});

/* ==========================================================================
   Super admin API — session based, for the /dashboard panel
   ========================================================================== */

/**
 * The super admin panel works with the browser session instead of the admin
 * token: the panel needs a signed in person, the token is for automation.
 *
 * The role lives on the user row and can never be set by the client, so the
 * check below is the only way into the surface.
 */
async function requireSuperAdmin(c: Context<AppEnv>) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return { error: "unauthorized" as const, status: 401 as const };
  if (user.role !== "admin") return { error: "forbidden" as const, status: 403 as const };
  return { user };
}

app.use("/api/super/*", async (c, next) => {
  const limit = rateLimit(`super:${clientIp(c) || "unknown"}`, 60, 60_000);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfter);
  const guard = await requireSuperAdmin(c);
  if ("error" in guard) return c.json({ error: guard.error }, guard.status);
  c.set("adminUser", guard.user);
  await next();
});

/** The numbers the panel opens with. */
app.get("/api/super/overview", async (c) => {
  const [users, admins, sites, events, sessions, recentUsers, recentSites] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM user").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'admin'").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM sites").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT id, name, email, emailVerified, role, createdAt FROM user ORDER BY createdAt DESC LIMIT 8",
    ).all(),
    c.env.DB.prepare(
      `SELECT s.public_id AS publicId, s.name, s.origin, s.created_at AS createdAt, s.events_today AS eventsToday, u.email AS owner
         FROM sites s LEFT JOIN projects p ON p.hostname = s.origin
         LEFT JOIN user u ON u.id = p.user_id
        ORDER BY s.created_at DESC LIMIT 8`,
    ).all(),
  ]);
  return c.json({
    ok: true,
    totals: {
      users: users?.n ?? 0,
      admins: admins?.n ?? 0,
      sites: sites?.n ?? 0,
      events: events?.n ?? 0,
      sessions: sessions?.n ?? 0,
    },
    recentUsers: recentUsers.results ?? [],
    recentSites: recentSites.results ?? [],
  });
});

/** Every account, newest first. */
app.get("/api/super/users", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, email, emailVerified, role, createdAt,
            (SELECT COUNT(*) FROM projects p WHERE p.user_id = user.id) AS projects
       FROM user ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all();
  return c.json({ ok: true, users: results, pagination: { limit, offset } });
});

const roleSchema = z.object({ role: z.enum(["user", "admin"]) });

/** Promotes or demotes an account. */
app.post("/api/super/users/:id/role", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) return invalidPayload(c, parsed.error.issues);

  const id = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT id, role FROM user WHERE id = ?")
    .bind(id)
    .first<{ id: string; role: string }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  // An admin may not demote the last admin - that would lock the panel out.
  if (target.role === "admin" && parsed.data.role !== "admin") {
    const { n } = (await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user WHERE role = 'admin'",
    ).first<{ n: number }>()) ?? { n: 0 };
    if ((n ?? 0) <= 1) {
      return c.json({ error: "last_admin" }, 400);
    }
  }

  await c.env.DB.prepare("UPDATE user SET role = ? WHERE id = ?")
    .bind(parsed.data.role, id)
    .run();
  return c.json({ ok: true, id, role: parsed.data.role });
});

/** Every site of every account. */
app.get("/api/super/sites", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.public_id AS publicId, s.name, s.origin, s.created_at AS createdAt,
            s.events_today AS eventsToday, s.daily_event_limit AS dailyEventLimit,
            s.retention_days AS retentionDays, u.email AS owner
       FROM sites s
       LEFT JOIN projects p ON p.hostname = s.origin
       LEFT JOIN user u ON u.id = p.user_id
      ORDER BY s.created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ ok: true, sites: results });
});

/** Erases a site and all of its data (right to erasure). */
app.delete("/api/super/sites/:publicId", async (c) => {
  const publicId = c.req.param("publicId");
  const site = await c.env.DB.prepare("SELECT id FROM sites WHERE public_id = ?")
    .bind(publicId)
    .first<{ id: number }>();
  if (!site) return c.json({ error: "not_found" }, 404);

  const [events, sessions, goals] = await Promise.all([
    c.env.DB.prepare("DELETE FROM events WHERE site_id = ?").bind(site.id).run(),
    c.env.DB.prepare("DELETE FROM sessions WHERE site_id = ?").bind(site.id).run(),
    c.env.DB.prepare("DELETE FROM goals WHERE site_id = ?").bind(site.id).run(),
  ]);
  await c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(site.id).run();
  return c.json({
    ok: true,
    erased: {
      site: publicId,
      events: events.meta.changes ?? 0,
      sessions: sessions.meta.changes ?? 0,
      goals: goals.meta.changes ?? 0,
    },
  });
});

/* ==========================================================================
   Media — Cloudinary delivery + guarded uploads
   ========================================================================== */

const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // Cloudinary free plan: 10 MB per image
const MEDIA_FOLDER = "dynamic/uploads";

type CloudinaryCreds = { cloudName: string; apiKey: string; apiSecret: string };

/** Parses "cloudinary://<key>:<secret>@<cloud>". Placeholder values are rejected. */
function parseCloudinaryUrl(value: string | undefined): CloudinaryCreds | null {
  if (!value) return null;
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(value.trim());
  if (!m) return null;
  const apiKey = decodeURIComponent(m[1]);
  const apiSecret = decodeURIComponent(m[2]);
  if (!apiKey || !apiSecret || /[<>]/.test(apiKey) || /[<>]/.test(apiSecret)) return null;
  return { apiKey, apiSecret, cloudName: m[3] };
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function tokenMatches(expected: string | undefined, given: string): boolean {
  if (!expected || expected.length < 16) return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function bearerToken(header: string | undefined): string {
  if (!header) return "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : "";
}

/** GET /api/media/config — public delivery configuration. */
app.get("/api/media/config", (c) => {
  const creds = parseCloudinaryUrl(c.env.CLOUDINARY_URL);
  const cloudName = c.env.CLOUDINARY_CLOUD_NAME ?? creds?.cloudName ?? null;
  return c.json({
    enabled: Boolean(creds),
    cloudName,
    uploadKey: c.env.CLOUDINARY_UPLOAD_KEY ?? creds?.apiKey ?? null,
    deliveryBase: cloudName ? `https://res.cloudinary.com/${cloudName}/image/upload` : null,
    folder: MEDIA_FOLDER,
  });
});

/** POST /api/media/signature — signed parameters for a direct browser upload. */
app.post("/api/media/signature", async (c) => {
  if (!c.env.MEDIA_UPLOAD_TOKEN) return c.json({ error: "media_not_configured" }, 503);
  if (!tokenMatches(c.env.MEDIA_UPLOAD_TOKEN, bearerToken(c.req.header("authorization")))) {
    return unauthorized(c);
  }
  const creds = parseCloudinaryUrl(c.env.CLOUDINARY_URL);
  if (!creds) return c.json({ error: "media_not_configured" }, 503);

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha1Hex(`folder=${MEDIA_FOLDER}&timestamp=${timestamp}${creds.apiSecret}`);
  return c.json({
    cloudName: creds.cloudName,
    apiKey: creds.apiKey,
    timestamp,
    folder: MEDIA_FOLDER,
    signature,
  });
});

/** POST /api/media/upload — server-side proxy upload. */
app.post("/api/media/upload", async (c) => {
  if (!c.env.MEDIA_UPLOAD_TOKEN) return c.json({ error: "media_not_configured" }, 503);
  if (!tokenMatches(c.env.MEDIA_UPLOAD_TOKEN, bearerToken(c.req.header("authorization")))) {
    return unauthorized(c);
  }
  const creds = parseCloudinaryUrl(c.env.CLOUDINARY_URL);
  if (!creds) return c.json({ error: "media_not_configured" }, 503);

  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
    return c.json({ error: "payload_too_large", max: MAX_MEDIA_BYTES }, 413);
  }

  const contentType = (c.req.header("content-type") ?? "").split(";")[0].trim();
  if (contentType && !contentType.startsWith("image/")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }

  const body = await readBinary(c.req.raw, MAX_MEDIA_BYTES);
  if (!body.ok) {
    if (body.error === "too_large") {
      return c.json({ error: "payload_too_large", max: MAX_MEDIA_BYTES }, 413);
    }
    return c.json({ error: "empty_body" }, 400);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await sha1Hex(`folder=${MEDIA_FOLDER}&timestamp=${timestamp}${creds.apiSecret}`);

  const form = new FormData();
  form.append("file", new Blob([body.bytes], { type: contentType || "image/png" }), "upload");
  form.append("api_key", creds.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", MEDIA_FOLDER);
  form.append("signature", signature);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`,
      { method: "POST", body: form },
    );
    const payload = (await response.json()) as {
      public_id?: string;
      secure_url?: string;
      width?: number;
      height?: number;
      format?: string;
      bytes?: number;
      error?: { message?: string };
    };
    if (!response.ok || !payload.secure_url) {
      console.error("cloudinary_upload_failed", response.status, payload.error?.message);
      return c.json({ error: "upload_failed" }, 502);
    }
    return c.json(
      {
        ok: true,
        publicId: payload.public_id ?? null,
        url: payload.secure_url,
        width: payload.width ?? null,
        height: payload.height ?? null,
        format: payload.format ?? null,
        bytes: payload.bytes ?? null,
      },
      201,
    );
  } catch (error) {
    console.error("cloudinary_upload_error", error);
    return c.json({ error: "upload_failed" }, 502);
  }
});

/* ==========================================================================
   Compatibility: /api/stats mirrors the analytics summary
   ========================================================================== */

app.get("/api/stats", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const { site, response } = await resolveReportSite(c);
  if (response) return response;
  if (!site) {
    return c.json({
      ok: true,
      range,
      generatedAt: now,
      site: null,
      totals: { pageviews: 0, visitors: 0, events: 0, custom: 0 },
      vitals: [],
      series: emptySeries(bucketCount(range), RANGES[range].bucketMs, from),
      topPages: [],
      topCountries: [],
      slowPages: [],
      recent: [],
    });
  }

  const [pageRows, countryRows, vitalRows, ratingRows, slowRows, recentRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT path, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND path IS NOT NULL
        GROUP BY path ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ path: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT country, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND country IS NOT NULL
        GROUP BY country ORDER BY n DESC LIMIT 6`,
    )
      .bind(site.id, from, now)
      .all<{ country: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT metric, AVG(value) AS avg, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND metric IN ('LCP','INP','CLS','FCP','TTFB')
        GROUP BY metric`,
    )
      .bind(site.id, from, now)
      .all<{ metric: string; avg: number | null; n: number }>(),
    c.env.DB.prepare(
      `SELECT metric, rating, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND metric IN ('LCP','INP','CLS','FCP','TTFB')
        GROUP BY metric, rating`,
    )
      .bind(site.id, from, now)
      .all<{ metric: string; rating: string | null; n: number }>(),
    c.env.DB.prepare(
      `SELECT path, AVG(value) AS avg, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND metric = 'LCP' AND path IS NOT NULL
        GROUP BY path ORDER BY avg DESC LIMIT 6`,
    )
      .bind(site.id, from, now)
      .all<{ path: string; avg: number; n: number }>(),
    c.env.DB.prepare(
      `SELECT ts, metric, value, rating, path, country, ua FROM events
        WHERE site_id = ? ORDER BY ts DESC LIMIT 12`,
    )
      .bind(site.id)
      .all<{
        ts: number;
        metric: string;
        value: number | null;
        rating: string | null;
        path: string | null;
        country: string | null;
        ua: string | null;
      }>(),
  ]);

  return c.json({
    ok: true,
    range,
    generatedAt: now,
    site: { id: site.public_id, name: site.name, origin: site.origin },
    totals: {
      pageviews: pageRows.results.reduce((sum, row) => sum + row.n, 0),
      visitors: 0,
      events: 0,
      custom: 0,
    },
    vitals: VITAL_METRIC_LIST.map((metric) => {
      const row = vitalRows.results.find((entry) => entry.metric === metric);
      return {
        metric,
        avg: row?.avg ?? null,
        samples: row?.n ?? 0,
        ratings: {
          good: ratingRows.results.find((r) => r.metric === metric && r.rating === "good")?.n ?? 0,
          "needs-improvement":
            ratingRows.results.find((r) => r.metric === metric && r.rating === "needs-improvement")?.n ?? 0,
          poor: ratingRows.results.find((r) => r.metric === metric && r.rating === "poor")?.n ?? 0,
        },
      };
    }),
    series: [],
    topPages: pageRows.results,
    topCountries: countryRows.results,
    slowPages: slowRows.results,
    recent: recentRows.results,
  });
});

/* ==========================================================================
   Fallbacks
   ========================================================================== */

/* ==========================================================================
   Application API — authentication, projects, DNS verification
   ========================================================================== */

/** The product application is served from its own origin (app.*). */
function isAppHost(hostname: string): boolean {
  return hostname === "app.dynamic.crty-dev.com" || hostname.startsWith("app.");
}

/** CORS for the credentialed application API (same origin in production). */
app.use("/api/projects/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (origin && allowedOrigins(c.env).includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "content-type, authorization");
    c.header("Access-Control-Max-Age", "600");
    return c.body(null, 204);
  }
  await next();
});

const authCors = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  const origin = c.req.header("origin");
  if (origin && allowedOrigins(c.env).includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  // The Better Auth dashboard calls this endpoint straight from the browser,
  // so the preflight has to be answered here.
  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      c.req.header("access-control-request-headers") ?? "content-type, authorization",
    );
    c.header("Access-Control-Max-Age", "600");
    return c.body(null, 204);
  }
  await next();
};

// The base path is matched as well: the dashboard probes /api/auth directly.
app.use("/api/auth", authCors);
app.use("/api/auth/*", authCors);

/**
 * Better Auth handles registration, login, verification mails, password reset
 * and sessions. The instance is created per Worker isolate and cached.
 */
const authHandler = async (c: Context<AppEnv>) => {
  const auth = createAuth(c.env);
  // Remember the execution context of this request so that the mail adapter
  // can send in the background (the answer must not be delayed by the mail).
  try {
    rememberExecutionContext(c.req.raw, c.executionCtx);
  } catch {
    /* no execution context (tests, preview) */
  }
  const response = await auth.handler(c.req.raw);

  // The handler returns a raw Response, so the CORS headers have to be set on
  // it directly (the Better Auth dashboard calls this endpoint from a browser).
  const origin = c.req.header("origin");
  if (origin && allowedOrigins(c.env).includes(origin)) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
};

/**
 * Which social providers are configured. The client uses it to decide whether
 * to show the "GitHub / Google ile devam et" buttons - without credentials a
 * provider stays invisible instead of failing.
 *
 * Registered before the Better Auth catch-all so it is not swallowed by it.
 */
app.get("/api/auth/providers", (c) =>
  c.json({ providers: enabledSocialProviders(c.env) }),
);

/**
 * Whether the deployment can send mail.
 *
 * The console uses it to tell the visitor that the verification mail cannot
 * be sent (and that the address check is therefore not enforced) instead of
 * silently swallowing the error.
 */
app.get("/api/auth/mail-status", (c) => {
  const { mail } = config(c.env);
  return c.json({
    ok: true,
    enabled: mail.enabled,
    verificationRequired: mail.enabled,
  });
});

/**
 * The base path is not a Better Auth route (it answers 404), but the
 * dashboard probes it to check the connection - so it gets a small descriptor.
 */
app.get("/api/auth", (c) =>
  c.json({
    ok: true,
    service: "better-auth",
    basePath: "/api/auth",
    health: "/api/auth/ok",
  }),
);

app.all("/api/auth", authHandler);
app.all("/api/auth/*", authHandler);

/** Website projects + DNS verification (ownership scoped). */
app.route("/api/projects", createProjectsApp());

/** Local development mail outbox - never mounted in production. */
app.get("/api/dev/mailbox", (c) => {
  if (!config(c.env).isDev) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, mails: readOutbox() });
});

/** Unknown API routes stay JSON instead of falling through to the SPA. */
app.all("/api", (c) => c.json({ error: "not_found" }, 404));
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/**
 * Everything else is a static asset.
 *
 * The marketing site and the product application are two SPAs in one Worker:
 * the app is built into `dist/app` and served on the app.* host (or under
 * the /app path in local development).
 */
app.on(["GET", "HEAD"], "*", async (c) => {
  const url = new URL(c.req.url);
  const appRequest =
    isAppHost(url.hostname) || url.pathname === "/app" || url.pathname.startsWith("/app/");

  // The assets binding runs with not_found_handling: none, so the Worker
  // decides what a client side route means: the app shell for app.*, the
  // marketing shell for everything else.
  let path = appRequest ? url.pathname.replace(/^\/app/, "") : url.pathname;
  if (path === "") path = "/";
  if (!/\.[a-z0-9]+$/i.test(path)) path = "/index.html";

  const target = new URL(`${appRequest ? "/app" : ""}${path}`, url);
  const response = await c.env.ASSETS.fetch(new Request(target, { method: c.req.method }));
  if (response.status !== 404) return response;

  const shell = new URL(`${appRequest ? "/app" : ""}/index.html`, url);
  return c.env.ASSETS.fetch(new Request(shell, { method: c.req.method }));
});

/**
 * Daily retention job: deletes events older than the site retention window.
 * One statement per site keeps the write cost predictable on the Free plan.
 */
export async function scheduled(
  _controller: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(
    (async () => {
      const { results } = await env.DB.prepare(
        "SELECT id, retention_days FROM sites WHERE retention_days > 0 LIMIT 50",
      ).all<{ id: number; retention_days: number }>();

      for (const site of results) {
        const cutoff = Date.now() - site.retention_days * 86400_000;
        await env.DB.prepare("DELETE FROM events WHERE site_id = ? AND ts < ?").bind(site.id, cutoff).run();
        await env.DB.prepare("DELETE FROM sessions WHERE site_id = ? AND started_at < ?")
          .bind(site.id, cutoff)
          .run();
      }
    })(),
  );
}

export default app;
