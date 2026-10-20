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
};

type AppEnv = { Bindings: Bindings; Variables: Variables };

const app = new Hono<AppEnv>();

const MAX_BATCH = 64;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_ATTRIBUTION_BYTES = 4 * 1024;
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

const VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
const RATINGS = ["good", "needs-improvement", "poor"] as const;

const baseEventShape = {
  /** Epoch milliseconds; seconds are accepted and normalized. Defaults to server time. */
  ts: z.number().int().nonnegative().optional(),
  /** Pathname only — query strings and fragments are stripped before storage. */
  path: z.string().max(1024).optional(),
  /** Anonymous, rotating session id from the SDK. */
  session: z.string().max(64).optional(),
  /** web-vitals metric id, used later for dedup/aggregation. */
  id: z.string().max(64).optional(),
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
    props: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const envelopeSchema = z.object({
  /** Optional public site key or hostname. Falls back to the request origin. */
  site: z.string().min(1).max(253).optional(),
  events: z.array(eventSchema).max(MAX_BATCH),
});

type IncomingEvent = z.infer<typeof eventSchema>;

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

function cleanUserAgent(value: string | undefined): string | null {
  if (!value) return null;
  const ua = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512);
  return ua || null;
}

function cleanCountry(value: string | undefined): string | null {
  const country = (value ?? "").trim().toUpperCase();
  // XX = unknown, T1 = Tor; neither is a real ISO country code.
  if (!/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1") return null;
  return country;
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

/** Returns the JSON string for an event's optional attribution payload. */
function attributionFor(event: IncomingEvent): string | null | "too_large" {
  const payload =
    event.type === "vital"
      ? event.attribution
      : event.type === "event"
        ? (event.props ?? event.attribution)
        : undefined;
  if (payload === undefined) return null;
  if (jsonSize(payload) > MAX_ATTRIBUTION_BYTES) return "too_large";
  return JSON.stringify(payload);
}

async function siteByOrigin(db: D1Database, origin: string): Promise<Site | null> {
  return db
    .prepare("SELECT id, public_id, name, origin FROM sites WHERE origin = ? LIMIT 1")
    .bind(origin)
    .first<Site>();
}

async function siteByKey(db: D1Database, key: string): Promise<Site | null> {
  return db
    .prepare("SELECT id, public_id, name, origin FROM sites WHERE public_id = ? LIMIT 1")
    .bind(key)
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
    if (requestOrigin && requestOrigin !== keyOrigin) {
      return { error: "origin_mismatch", status: 403 };
    }

    const byOrigin = await siteByOrigin(db, keyOrigin);
    if (byOrigin) return { site: byOrigin, created: false };
    return registerSite(db, keyOrigin);
  }

  if (!requestOrigin) return { error: "site_required", status: 400 };
  const existing = await siteByOrigin(db, requestOrigin);
  if (existing) return { site: existing, created: false };
  return registerSite(db, requestOrigin);
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

/**
 * CORS + origin capture for the collect endpoint.
 * Preflights are answered without touching D1; the POST resolves the site.
 */
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

  await next();
});

/**
 * GET /api/health — smoke test; D1 binding'in çalıştığını doğrular.
 */
app.get("/api/health", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name LIMIT 10",
  ).all<{ name: string }>();
  return c.json({ ok: true, ts: Date.now(), tables: results.map((r) => r.name) });
});

/**
 * POST /api/collect — SDK event batch ingest.
 *
 * Body: `{ site?: string, events: Event[] }` or a bare `Event[]`.
 * Site resolution: `site` public key/hostname when supplied, otherwise the
 * browser Origin/Referer. Unknown origins are registered on first write.
 */
app.post("/api/collect", async (c) => {
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return c.json({ error: "payload_too_large", max: MAX_BODY_BYTES }, 413);
  }

  const body = await readJson(c.req.raw, MAX_BODY_BYTES);
  if (!body.ok) {
    if (body.error === "payload_too_large") {
      return c.json({ error: body.error, max: MAX_BODY_BYTES }, 413);
    }
    return c.json({ error: body.error }, 400);
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
    return c.json({ ok: true, accepted: 0 }, 202);
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

    const now = Date.now();
    const country = cleanCountry(c.req.header("cf-ipcountry"));
    const ua = cleanUserAgent(c.req.header("user-agent"));

    const statements = events.map((event, index) => {
      const attribution = attributions[index] ?? null;
      let metric: string;
      let value: number | null = null;
      let rating: string | null = null;

      if (event.type === "vital") {
        metric = event.metric;
        value = event.value;
        rating = event.rating ?? null;
      } else if (event.type === "event") {
        metric = event.name;
      } else {
        metric = "pageview";
      }

      return c.env.DB.prepare(
        `INSERT INTO events
          (site_id, ts, metric, value, rating, path, country, ua, session_id, metric_id, attribution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        resolved.site.id,
        normalizeTs(event.ts, now),
        metric,
        value,
        rating,
        cleanPath(event.path),
        country,
        ua,
        event.session ?? null,
        event.id ?? null,
        attribution,
      );
    });

    await c.env.DB.batch(statements);

    return c.json(
      {
        ok: true,
        accepted: events.length,
        site: resolved.site.public_id,
        ...(resolved.created ? { created: true } : {}),
      },
      202,
    );
  } catch (error) {
    console.error("collect_failed", error);
    return c.json({ error: "storage_error" }, 500);
  }
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
  // "<API_SECRET>" style placeholders are not credentials.
  if (!apiKey || !apiSecret || /[<>]/.test(apiKey) || /[<>]/.test(apiSecret)) return null;
  return { apiKey, apiSecret, cloudName: m[3] };
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish comparison for the admin upload token. */
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

/** Reads a binary body with a hard size cap. */
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

/**
 * GET /api/media/config — public delivery configuration.
 * The API secret is never exposed; only the cloud name and upload key are.
 */
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

/**
 * POST /api/media/signature — signed parameters for a direct browser upload.
 * Requires: Authorization: Bearer <MEDIA_UPLOAD_TOKEN>.
 */
app.post("/api/media/signature", async (c) => {
  if (!c.env.MEDIA_UPLOAD_TOKEN) return c.json({ error: "media_not_configured" }, 503);
  if (!tokenMatches(c.env.MEDIA_UPLOAD_TOKEN, bearerToken(c.req.header("authorization")))) {
    return c.json({ error: "unauthorized" }, 401);
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

/**
 * POST /api/media/upload — server-side proxy upload.
 * Requires: Authorization: Bearer <MEDIA_UPLOAD_TOKEN>. Body: raw image bytes.
 */
app.post("/api/media/upload", async (c) => {
  if (!c.env.MEDIA_UPLOAD_TOKEN) return c.json({ error: "media_not_configured" }, 503);
  if (!tokenMatches(c.env.MEDIA_UPLOAD_TOKEN, bearerToken(c.req.header("authorization")))) {
    return c.json({ error: "unauthorized" }, 401);
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
   Stats — read-only aggregation for the Console
   ========================================================================== */

const STATS_RANGES = {
  "24h": { windowMs: 24 * 3600_000, bucketMs: 3600_000, buckets: 24 },
  "7d": { windowMs: 7 * 86400_000, bucketMs: 86400_000, buckets: 7 },
  "30d": { windowMs: 30 * 86400_000, bucketMs: 86400_000, buckets: 30 },
} as const;

type StatsRange = keyof typeof STATS_RANGES;

type CountRow = { n: number };
type BucketRow = { bucket: number; metric: string; n: number };
type PathRow = { path: string; n: number };
type CountryRow = { country: string | null; n: number };
type MetricRow = { metric: string; avg: number | null; n: number };
type RatingRow = { metric: string; rating: string | null; n: number };
type EventRow = {
  ts: number;
  metric: string;
  value: number | null;
  rating: string | null;
  path: string | null;
  country: string | null;
  ua: string | null;
};

const VITAL_METRIC_LIST = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

/**
 * The console reads the site of the visiting origin, so /api/stats resolves
 * the same way /api/collect does: Origin header first, Referer as fallback.
 */
app.use("/api/stats", async (c, next) => {
  const rawOrigin = c.req.header("origin");
  const corsOrigin = rawOrigin ? normalizeOrigin(rawOrigin) : null;
  const requestOrigin = corsOrigin ?? normalizeOrigin(c.req.header("referer") ?? "");
  c.set("requestOrigin", requestOrigin);
  if (corsOrigin) {
    c.header("Access-Control-Allow-Origin", corsOrigin);
    c.header("Vary", "Origin");
  }
  await next();
});

/** Read-only site lookup — never registers a new site from a GET. */
async function findSite(
  db: D1Database,
  requestOrigin: string | null,
  siteKey: string | undefined,
): Promise<Site | null> {
  if (siteKey) {
    const key = siteKey.trim();
    const byKey = await siteByKey(db, key);
    if (byKey) return byKey;
    const origin = siteKeyToOrigin(key, requestOrigin);
    if (origin) return siteByOrigin(db, origin);
    return null;
  }
  if (!requestOrigin) return null;
  return siteByOrigin(db, requestOrigin);
}

/**
 * GET /api/stats — console aggregates for one site.
 *
 * Query: `?range=24h|7d|30d` and optional `?site=<public id|hostname>`.
 * Unknown origins return an empty payload (the console shows an empty state)
 * instead of creating a site; only /api/collect registers sites.
 */
app.get("/api/stats", async (c) => {
  const rawRange = (c.req.query("range") ?? "7d").toLowerCase();
  const range: StatsRange =
    rawRange in STATS_RANGES ? (rawRange as StatsRange) : "7d";
  const { windowMs, bucketMs, buckets } = STATS_RANGES[range];

  const site = await findSite(c.env.DB, c.get("requestOrigin"), c.req.query("site"));

  if (!site) {
    return c.json({
      ok: true,
      range,
      site: null,
      totals: { pageviews: 0, visitors: 0, events: 0, custom: 0 },
      vitals: [],
      ratings: [],
      series: [],
      topPages: [],
      topCountries: [],
      slowPages: [],
      recent: [],
    });
  }

  const now = Date.now();
  const from = now - windowMs;
  const siteId = site.id;

  const [
    pageviews,
    visitors,
    events,
    custom,
    seriesRows,
    visitorRows,
    pathRows,
    countryRows,
    vitalRows,
    ratingRows,
    slowRows,
    recentRows,
  ] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND metric = 'pageview' AND ts >= ?",
    )
      .bind(siteId, from)
      .first<CountRow>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE site_id = ? AND session_id IS NOT NULL AND ts >= ?",
    )
      .bind(siteId, from)
      .first<CountRow>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND ts >= ?")
      .bind(siteId, from)
      .first<CountRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND metric <> 'pageview'
          AND metric NOT IN ('LCP','INP','CLS','FCP','TTFB')`,
    )
      .bind(siteId, from)
      .first<CountRow>(),
    c.env.DB.prepare(
      `SELECT CAST(ts / ? AS INTEGER) AS bucket, metric, COUNT(*) AS n
         FROM events WHERE site_id = ? AND ts >= ? GROUP BY bucket, metric`,
    )
      .bind(bucketMs, siteId, from)
      .all<BucketRow>(),
    c.env.DB.prepare(
      `SELECT CAST(ts / ? AS INTEGER) AS bucket, COUNT(DISTINCT session_id) AS visitors
         FROM events WHERE site_id = ? AND ts >= ? AND session_id IS NOT NULL GROUP BY bucket`,
    )
      .bind(bucketMs, siteId, from)
      .all<{ bucket: number; visitors: number }>(),
    c.env.DB.prepare(
      `SELECT path, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND path IS NOT NULL
        GROUP BY path ORDER BY n DESC LIMIT 10`,
    )
      .bind(siteId, from)
      .all<PathRow>(),
    c.env.DB.prepare(
      `SELECT country, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND country IS NOT NULL
        GROUP BY country ORDER BY n DESC LIMIT 6`,
    )
      .bind(siteId, from)
      .all<CountryRow>(),
    c.env.DB.prepare(
      `SELECT metric, AVG(value) AS avg, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND metric IN ('LCP','INP','CLS','FCP','TTFB')
        GROUP BY metric`,
    )
      .bind(siteId, from)
      .all<MetricRow>(),
    c.env.DB.prepare(
      `SELECT metric, rating, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND metric IN ('LCP','INP','CLS','FCP','TTFB')
        GROUP BY metric, rating`,
    )
      .bind(siteId, from)
      .all<RatingRow>(),
    c.env.DB.prepare(
      `SELECT path, AVG(value) AS avg, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND metric = 'LCP' AND path IS NOT NULL
        GROUP BY path ORDER BY avg DESC LIMIT 6`,
    )
      .bind(siteId, from)
      .all<{ path: string; avg: number; n: number }>(),
    c.env.DB.prepare(
      `SELECT ts, metric, value, rating, path, country, ua FROM events
        WHERE site_id = ? ORDER BY ts DESC LIMIT 12`,
    )
      .bind(siteId)
      .all<EventRow>(),
  ]);

  // Fill the time series so gaps render as zero instead of missing points.
  const firstBucket = Math.floor(from / bucketMs);
  const series = Array.from({ length: buckets }, (_, i) => {
    const bucket = firstBucket + i;
    return {
      t: bucket * bucketMs,
      pageviews: 0,
      visitors: 0,
      events: 0,
    };
  });
  for (const row of seriesRows.results) {
    const index = row.bucket - firstBucket;
    if (index < 0 || index >= series.length) continue;
    const point = series[index];
    point.events += row.n;
    if (row.metric === "pageview") point.pageviews += row.n;
  }
  for (const row of visitorRows.results) {
    const index = row.bucket - firstBucket;
    if (index < 0 || index >= series.length) continue;
    series[index].visitors = row.visitors;
  }

  const vitals = VITAL_METRIC_LIST.map((metric) => {
    const row = vitalRows.results.find((r) => r.metric === metric);
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
  });

  return c.json({
    ok: true,
    range,
    generatedAt: now,
    site: { id: site.public_id, name: site.name, origin: site.origin },
    totals: {
      pageviews: pageviews?.n ?? 0,
      visitors: visitors?.n ?? 0,
      events: events?.n ?? 0,
      custom: custom?.n ?? 0,
    },
    vitals,
    series,
    topPages: pathRows.results,
    topCountries: countryRows.results,
    slowPages: slowRows.results,
    recent: recentRows.results,
  });
});

/** Unknown API routes stay JSON instead of falling through to the SPA. */
app.all("/api", (c) => c.json({ error: "not_found" }, 404));
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/** Everything else is a static asset; SPA fallback serves index.html. */
app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
