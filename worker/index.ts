import { Hono, type Context } from "hono";
import { z } from "zod";

type Bindings = {
  /** Cloudflare D1 binding (Free plan) — migrations/: 0001_init.sql */
  DB: D1Database;
  /** Static assets binding (dist/) */
  ASSETS: Fetcher;
  /** Cloudinary credential — "cloudinary://<key>:<secret>@<cloud>". Secret: wrangler secret put. */
  CLOUDINARY_URL?: string;
  /** Public cloud name (also in wrangler vars). */
  CLOUDINARY_CLOUD_NAME?: string;
  /** Public upload API key. */
  CLOUDINARY_UPLOAD_KEY?: string;
  /** Bearer token that guards the media upload/signature endpoints. */
  MEDIA_UPLOAD_TOKEN?: string;
  /** Bearer token that guards every /api/admin/* route. */
  ADMIN_API_KEY?: string;
};

type Variables = {
  /** Browser origin (Origin header) or referer origin; null for server-side calls. */
  requestOrigin: string | null;
};

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

type AppEnv = { Bindings: Bindings; Variables: Variables };

const app = new Hono<AppEnv>();

/* ==========================================================================
   Limits — sized for the Cloudflare Free plan
   ========================================================================== */

const MAX_BATCH = 64;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_ATTRIBUTION_BYTES = 4 * 1024;
const MAX_PROPS = 8;
const MAX_PROP_VALUE = 200;
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;
const MIN_P75_SAMPLES = 20;

const VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
const RATINGS = ["good", "needs-improvement", "poor"] as const;

/** Range → window, bucket size and bucket count. */
const RANGES = {
  "24h": { windowMs: 24 * 3600_000, bucketMs: 3600_000, buckets: 24 },
  "7d": { windowMs: 7 * 86400_000, bucketMs: 86400_000, buckets: 7 },
  "30d": { windowMs: 30 * 86400_000, bucketMs: 86400_000, buckets: 30 },
  "90d": { windowMs: 90 * 86400_000, bucketMs: 86400_000, buckets: 90 },
} as const;

type RangeKey = keyof typeof RANGES;

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
};

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseEventShape,
    type: z.literal("pageview"),
  }),
  z.object({
    ...baseEventShape,
    type: z.literal("vital"),
    metric: z.enum(VITAL_METRICS),
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
]);

const envelopeSchema = z.object({
  /** Optional public site key or hostname. Falls back to the request origin. */
  site: z.string().min(1).max(253).optional(),
  events: z.array(eventSchema).max(MAX_BATCH),
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

/** Keep only safe, short props — personal data never reaches D1. */
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

async function siteByOrigin(db: D1Database, origin: string): Promise<Site | null> {
  return db
    .prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE origin = ? LIMIT 1`)
    .bind(origin)
    .first<Site>();
}

async function siteByKey(db: D1Database, key: string): Promise<Site | null> {
  return db
    .prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE public_id = ? LIMIT 1`)
    .bind(key)
    .first<Site>();
}

async function siteById(db: D1Database, id: number): Promise<Site | null> {
  return db
    .prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<Site>();
}

/** v1 is self-serve: the first valid collect from a new origin creates its site. */
async function registerSite(db: D1Database, origin: string): Promise<{ site: Site; created: boolean }> {
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
  | { error: "site_required" | "unknown_site" | "origin_mismatch"; status: 400 | 403 | 404 };

async function resolveSite(
  db: D1Database,
  requestOrigin: string | null,
  siteKey: string | undefined,
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
    return registerSite(db, keyOrigin);
  }

  if (!requestOrigin) return { error: "site_required", status: 400 };
  const existing = await siteByOrigin(db, requestOrigin);
  if (existing) return { site: existing, created: false };
  return registerSite(db, requestOrigin);
}

/* ==========================================================================
   Goals
   ========================================================================== */

type Goal = {
  id: number;
  public_id: string;
  name: string;
  label: string | null;
  path: string | null;
  value: number | null;
};

/** Goals of a site — only queried when a batch can actually convert. */
async function goalsFor(db: D1Database, siteId: number): Promise<Goal[]> {
  const { results } = await db
    .prepare("SELECT id, public_id, name, label, path, value FROM goals WHERE site_id = ?")
    .bind(siteId)
    .all<Goal>();
  return results;
}

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

function resolveRange(value: string | undefined): RangeKey {
  const key = (value ?? "7d").toLowerCase();
  return key in RANGES ? (key as RangeKey) : "7d";
}

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

/* ==========================================================================
   Rate limiting — best effort, in-isolate, no D1 cost
   ========================================================================== */

/**
 * The Free plan must not pay a D1 write per request, so the hot path is
 * protected by an in-memory sliding window. It is per-isolate and therefore
 * best effort: the hard, global cap is the site's daily event quota in D1.
 * Put a Cloudflare rate limiting rule in front of /api/collect for a global
 * limit (see docs/DEPLOYMENT.md).
 */
type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    if (rateBuckets.size > 5000) {
      for (const [entryKey, entry] of rateBuckets) {
        if (entry.resetAt <= now) rateBuckets.delete(entryKey);
      }
    }
    return { allowed: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** The visitor IP as seen by the edge (empty string for server-to-server calls). */
function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    ""
  );
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

  if (Array.isArray(raw)) {
    const parsed = z.array(eventSchema).max(MAX_BATCH).safeParse(raw);
    if (!parsed.success) return invalidPayload(c, parsed.error.issues);
    events = parsed.data;
  } else {
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) return invalidPayload(c, parsed.error.issues);
    siteKey = parsed.data.site;
    events = parsed.data.events;
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
    const resolved = await resolveSite(c.env.DB, c.get("requestOrigin"), siteKey);
    if ("error" in resolved) {
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
    const eventStatementCount = events.length;
    const sessionSeen = new Set<string>();

    for (let index = 0; index < events.length; index++) {
      const event = events[index];
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
      }

      statements.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO events
            (site_id, ts, metric, value, rating, path, country, ua, session_id, metric_id,
             attribution, referrer, utm_source, utm_medium, utm_campaign, device, browser, os, goal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ),
      );

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
      ).bind(today, events.length, events.length, today, site.id),
    );

    const results = await c.env.DB.batch(statements);
    let accepted = 0;
    let deduped = 0;
    let failed = 0;
    for (let index = 0; index < eventStatementCount; index++) {
      const changes = results[index]?.meta.changes ?? 0;
      if (changes > 0) {
        accepted += changes;
        continue;
      }
      // A vital with a metric id is a duplicate (web-vitals can report twice);
      // anything else means the row was not written.
      if (events[index].id) deduped += 1;
      else failed += 1;
    }
    if (failed > 0) console.error("collect_partial_write", { site: site.public_id, failed });

    return c.json(
      {
        ok: failed === 0,
        accepted,
        deduped,
        failed,
        sessions: sessionSeen.size,
        site: site.public_id,
        ...(resolved.created ? { created: true } : {}),
      },
      failed === 0 ? 202 : 207,
    );
  } catch (error) {
    console.error("collect_failed", error);
    // Nothing was written — say so instead of pretending the batch succeeded.
    return c.json({ error: "storage_error", accepted: 0 }, 500);
  }
});

/** Returns the attribution JSON for an event, or "too_large". */
function attributionFor(event: IncomingEvent): string | null | "too_large" {
  const payload =
    event.type === "vital"
      ? event.attribution
      : event.type === "event"
        ? cleanProps(event.props ?? event.attribution)
        : undefined;
  if (payload === undefined) return null;
  if (jsonSize(payload) > MAX_ATTRIBUTION_BYTES) return "too_large";
  return JSON.stringify(payload);
}

/* ==========================================================================
   Analytics reports
   ========================================================================== */

type ReportSite = { site: Site | null; error?: string };

/** Resolve the site for a read-only report without ever creating one. */
async function reportSite(c: Context<AppEnv>): Promise<ReportSite> {
  const siteKey = c.req.query("site");
  if (siteKey) {
    const byKey = await siteByKey(c.env.DB, siteKey.trim());
    if (byKey) return { site: byKey };
    const origin = siteKeyToOrigin(siteKey.trim(), c.get("requestOrigin"));
    if (origin) {
      const byOrigin = await siteByOrigin(c.env.DB, origin);
      if (byOrigin) return { site: byOrigin };
    }
    return { site: null, error: "unknown_site" };
  }
  const origin = c.get("requestOrigin");
  if (!origin) return { site: null, error: "site_required" };
  return { site: await siteByOrigin(c.env.DB, origin) };
}

function emptySeries(buckets: number, bucketMs: number, from: number) {
  const first = Math.floor(from / bucketMs);
  return Array.from({ length: buckets }, (_, index) => ({
    t: (first + index) * bucketMs,
    pageviews: 0,
    visitors: 0,
    events: 0,
  }));
}

/**
 * Number of buckets in a window: the full window plus the current (partial)
 * bucket, so "today" is never dropped from the series.
 */
function bucketCount(range: RangeKey): number {
  const { windowMs, bucketMs } = RANGES[range];
  return Math.ceil(windowMs / bucketMs) + 1;
}

app.get("/api/analytics/summary", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;
  const resolved = await reportSite(c);
  const site = resolved.site;

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

  const [metricRows, sessionRows, seriesRows, sessionSeries, pageRows, referrerRows, campaignRows, deviceRows, goalRows, customRows, countryRows, liveCount, liveSessions, livePages] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT metric, COUNT(*) AS n,
                SUM(CASE WHEN goal IS NOT NULL THEN 1 ELSE 0 END) AS conversions
           FROM events WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY metric`,
      )
        .bind(site.id, from, now)
        .all<{ metric: string; n: number; conversions: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT session_id) AS visitors FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?",
      )
        .bind(site.id, from, now)
        .all<{ n: number; visitors: number }>(),
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
      c.env.DB.prepare(
        `SELECT path, COUNT(*) AS n FROM events
          WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND path IS NOT NULL
          GROUP BY path ORDER BY n DESC LIMIT 10`,
      )
        .bind(site.id, from, now)
        .all<{ path: string; n: number }>(),
      c.env.DB.prepare(
        `SELECT referrer, COUNT(*) AS n FROM events
          WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND referrer IS NOT NULL
          GROUP BY referrer ORDER BY n DESC LIMIT 10`,
      )
        .bind(site.id, from, now)
        .all<{ referrer: string; n: number }>(),
      c.env.DB.prepare(
        `SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, COUNT(*) AS n
           FROM events
          WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND utm_campaign IS NOT NULL
          GROUP BY utm_source, utm_medium, utm_campaign ORDER BY n DESC LIMIT 10`,
      )
        .bind(site.id, from, now)
        .all<{ source: string | null; medium: string | null; campaign: string | null; n: number }>(),
      c.env.DB.prepare(
        `SELECT device, browser, os, COUNT(*) AS n FROM events
          WHERE site_id = ? AND ts >= ? AND ts < ?
          GROUP BY device, browser, os ORDER BY n DESC LIMIT 10`,
      )
        .bind(site.id, from, now)
        .all<{ device: string; browser: string; os: string; n: number }>(),
      c.env.DB.prepare(
        `SELECT goal AS name, COUNT(*) AS n, SUM(COALESCE(value, 0)) AS value FROM events
          WHERE site_id = ? AND ts >= ? AND ts < ? AND goal IS NOT NULL
          GROUP BY goal ORDER BY n DESC LIMIT 10`,
      )
        .bind(site.id, from, now)
        .all<{ name: string; n: number; value: number }>(),
      c.env.DB.prepare(
        `SELECT metric AS name, COUNT(*) AS n FROM events
          WHERE site_id = ? AND ts >= ? AND ts < ?
            AND metric NOT IN ('pageview','LCP','INP','CLS','FCP','TTFB')
          GROUP BY metric ORDER BY n DESC LIMIT 10`,
      )
        .bind(site.id, from, now)
        .all<{ name: string; n: number }>(),
      c.env.DB.prepare(
        `SELECT country, COUNT(*) AS n FROM events
          WHERE site_id = ? AND ts >= ? AND ts < ? AND country IS NOT NULL
          GROUP BY country ORDER BY n DESC LIMIT 6`,
      )
        .bind(site.id, from, now)
        .all<{ country: string; n: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND ts >= ?",
      )
        .bind(site.id, now - 30 * 60_000)
        .all<{ n: number }>(),
      c.env.DB.prepare(
        "SELECT COUNT(DISTINCT session_id) AS n FROM sessions WHERE site_id = ? AND last_seen_at >= ?",
      )
        .bind(site.id, now - 30 * 60_000)
        .all<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT path, COUNT(*) AS n FROM events
          WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND path IS NOT NULL
          GROUP BY path ORDER BY n DESC LIMIT 5`,
      )
        .bind(site.id, now - 30 * 60_000)
        .all<{ path: string; n: number }>(),
    ]);

  const totals = { pageviews: 0, visitors: 0, sessions: 0, events: 0, customEvents: 0, conversions: 0, goals: 0 };
  for (const row of metricRows.results) {
    totals.events += row.n;
    totals.conversions += row.conversions ?? 0;
    if (row.metric === "pageview") totals.pageviews += row.n;
    else if (!VITAL_METRICS.includes(row.metric as (typeof VITAL_METRICS)[number])) {
      totals.customEvents += row.n;
    }
  }
  totals.visitors = sessionRows.results[0]?.visitors ?? 0;
  totals.sessions = sessionRows.results[0]?.n ?? 0;

  const series = emptySeries(buckets, bucketMs, from);
  const firstBucket = Math.floor(from / bucketMs);
  for (const row of seriesRows.results) {
    const index = row.bucket - firstBucket;
    if (index < 0 || index >= series.length) continue;
    series[index].events += row.n;
    if (row.metric === "pageview") series[index].pageviews += row.n;
  }
  for (const row of sessionSeries.results) {
    const index = row.bucket - firstBucket;
    if (index < 0 || index >= series.length) continue;
    series[index].visitors = row.n;
  }

  return c.json({
    ok: true,
    range,
    generatedAt: now,
    site: { id: site.public_id, name: site.name, origin: site.origin },
    totals,
    series,
    topPages: pageRows.results,
    referrers: referrerRows.results,
    campaigns: campaignRows.results,
    devices: deviceRows.results,
    goals: goalRows.results,
    customEvents: customRows.results,
    countries: countryRows.results,
    realtime: {
      events: liveCount.results[0]?.n ?? 0,
      activeSessions: liveSessions.results[0]?.n ?? 0,
      topPages: livePages.results,
    },
  });
});

app.get("/api/analytics/timeseries", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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

type VitalStats = {
  metric: string;
  samples: number;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  good: number;
  needsImprovement: number;
  poor: number;
  sufficient: boolean;
  note?: string;
};

/**
 * Percentiles are computed in SQL with a window function (no row transfer).
 * When there are too few samples the percentile stays null on purpose —
 * an invented number is worse than "not enough data".
 */
async function vitalStats(
  db: D1Database,
  siteId: number,
  metric: string,
  from: number,
  now: number,
): Promise<VitalStats> {
  const [ratingRows, percentileRows] = await Promise.all([
    db.prepare(
      `SELECT rating, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
        GROUP BY rating`,
    )
      .bind(siteId, metric, from, now)
      .all<{ rating: string | null; n: number }>(),
    db.prepare(
      `WITH vals AS (
         SELECT value FROM events
          WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
          ORDER BY value
       ),
       ranked AS (
         SELECT value,
                ROW_NUMBER() OVER (ORDER BY value) AS rn,
                COUNT(*) OVER () AS cnt
           FROM vals
       )
       SELECT MAX(cnt) AS samples,
              AVG(value) AS avg,
              MAX(CASE WHEN rn = CAST((cnt - 1) * 0.50 AS INT) + 1 THEN value END) AS p50,
              MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INT) + 1 THEN value END) AS p75
         FROM ranked`,
    )
      .bind(siteId, metric, from, now)
      .all<{ samples: number; avg: number | null; p50: number | null; p75: number | null }>(),
  ]);

  const row = percentileRows.results[0];
  const samples = row?.samples ?? 0;
  const rating = (name: string) =>
    ratingRows.results.find((entry) => entry.rating === name)?.n ?? 0;

  const sufficient = samples >= MIN_P75_SAMPLES;
  return {
    metric,
    samples,
    avg: row?.avg ?? null,
    p50: sufficient ? row?.p50 ?? null : null,
    p75: sufficient ? row?.p75 ?? null : null,
    good: rating("good"),
    needsImprovement: rating("needs-improvement"),
    poor: rating("poor"),
    sufficient,
    ...(sufficient
      ? {}
      : { note: `At least ${MIN_P75_SAMPLES} samples are needed for a percentile; ${samples} collected.` }),
  };
}

app.get("/api/rum/summary", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const now = Date.now();
  const from = now - RANGES[range].windowMs;
  const resolved = await reportSite(c);
  const site = resolved.site;
  if (!site) {
    return c.json({
      ok: true,
      range,
      metrics: VITAL_METRICS.map((metric) => ({
        metric,
        samples: 0,
        avg: null,
        p50: null,
        p75: null,
        good: 0,
        needsImprovement: 0,
        poor: 0,
        sufficient: false,
        note: "No data yet.",
      })),
    });
  }

  const metrics = await Promise.all(
    VITAL_METRICS.map((metric) => vitalStats(c.env.DB, site.id, metric, from, now)),
  );

  return c.json({
    ok: true,
    range,
    generatedAt: now,
    minSamples: MIN_P75_SAMPLES,
    metrics,
  });
});

app.get("/api/rum/timeseries", async (c) => {
  const range = resolveRange(c.req.query("range"));
  const metric = (c.req.query("metric") ?? "LCP").toUpperCase();
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.public_id, s.name, s.origin, s.created_at, s.retention_days, s.daily_event_limit,
            (SELECT COUNT(*) FROM events e WHERE e.site_id = s.id) AS events,
            (SELECT COUNT(*) FROM sessions ss WHERE ss.site_id = s.id) AS sessions
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
              referrer, utm_source, utm_medium, utm_campaign, device, browser, os
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
  const resolved = await reportSite(c);
  const site = resolved.site;
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
    vitals: VITAL_METRICS.map((metric) => {
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

/** Unknown API routes stay JSON instead of falling through to the SPA. */
app.all("/api", (c) => c.json({ error: "not_found" }, 404));
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/** Everything else is a static asset; SPA fallback serves index.html. */
app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));

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
