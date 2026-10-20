import { Hono, type Context } from "hono";
import { z } from "zod";

type Bindings = {
  /** Cloudflare D1 binding (Free plan) — migrations/: 0001_init.sql */
  DB: D1Database;
  /** Static assets binding (dist/) */
  ASSETS: Fetcher;
};

type Variables = {
  /** Browser origin (Origin header) or referer origin; null for server-side calls. */
  requestOrigin: string | null;
};

type Site = {
  id: number;
  public_id: string;
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
    .prepare("SELECT id, public_id, origin FROM sites WHERE origin = ? LIMIT 1")
    .bind(origin)
    .first<Site>();
}

async function siteByKey(db: D1Database, key: string): Promise<Site | null> {
  return db
    .prepare("SELECT id, public_id, origin FROM sites WHERE public_id = ? LIMIT 1")
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

/** Unknown API routes stay JSON instead of falling through to the SPA. */
app.all("/api", (c) => c.json({ error: "not_found" }, 404));
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/** Everything else is a static asset; SPA fallback serves index.html. */
app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
