import { Hono, type Context } from "hono";
import { z } from "zod";
import { createAuth } from "./auth";
import { analyticsSummary, resolveRange, rumSummary } from "./analytics";
import { lookupTxt, normalizeHostname, verificationRecord } from "./dns";
import { config, type AppEnv } from "./env";
import { rateLimit } from "./rate-limit";
import { siteByKey, siteByOrigin } from "./sites";
import { goalsFor } from "./goals";
import { RADAR_SCAN_LIMIT } from "./signature";
import {
  errorCounts,
  listInsights,
  listReleases,
  metricSamples,
  metricTimeline,
  plainSamples,
  privacyCounters,
  releaseById,
  updateInsightState,
  upsertInsight,
  upsertRelease,
} from "./signature";
import {
  compareErrorRate,
  compareMetric,
  segmentationScopes,
  MIN_WINDOW_SAMPLES,
  type Comparison,
} from "./release-rules";
import { assessFix, evaluateIssues, percentileOf, type VitalReading } from "./insight-rules";
import { classifyValue, isSensitiveKey, redactUrl, GATE_RULES } from "../src/lib/privacy-rules";

/** A goal path: the path only, without the query string. */
function cleanGoalPath(value: string): string {
  const path = value.split("?")[0].split("#")[0].trim();
  return path.slice(0, 512) || "/";
}

/* ==========================================================================
   Website projects

   Every read and write is scoped to the authenticated user id that comes
   from the session cookie - the client never sends an owner id.
   ========================================================================== */

export type Project = {
  id: number;
  public_id: string;
  user_id: string;
  name: string;
  hostname: string;
  verification_token: string;
  verification_status: "pending" | "verifying" | "verified";
  verification_error: string | null;
  verification_attempts: number;
  verified_at: number | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
};

const PROJECT_COLUMNS =
  "id, public_id, user_id, name, hostname, verification_token, verification_status, verification_error, verification_attempts, verified_at, last_checked_at, created_at, updated_at";

/** Verification is deliberately slow: one DNS lookup every 10 s, 20 per hour. */
const VERIFY_MAX_PER_HOUR = 20;
const PROJECT_CREATE_PER_HOUR = 10;

/** A cryptographically random, project specific token. */
function newVerificationToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function projectView(project: Project, appUrl: string) {
  return {
    id: project.public_id,
    name: project.name,
    hostname: project.hostname,
    status: project.verification_status,
    error: project.verification_error,
    attempts: project.verification_attempts,
    verifiedAt: project.verified_at,
    lastCheckedAt: project.last_checked_at,
    createdAt: project.created_at,
    record: verificationRecord(project.hostname, project.verification_token),
    // The endpoint is absolute: the site that installs the snippet is usually
    // not the deployment that serves the SDK, so the events must go to this
    // deployment and not to the origin of the visitor's page.
    script: `<script async src="${appUrl}/js/dynamic.js" data-site="${project.public_id}" data-endpoint="${appUrl}/api/collect"></script>`,
  };
}

export function createProjectsApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Resolves the signed-in user, or null. */
  async function currentUser(c: Context<AppEnv>) {
    const auth = createAuth(c.env);
    try {
      const result = await auth.api.getSession({ headers: c.req.raw.headers });
      const user = result?.user;
      return user ? { id: user.id, email: user.email, name: user.name, verified: user.emailVerified } : null;
    } catch {
      return null;
    }
  }

  /**
   * A write needs a proven address.
   *
   * The console sends an unverified account to the verification page, but the
   * client is not the boundary: without this check anybody could create a
   * project or a goal with an address they do not own.
   */
  async function requireVerified(c: Context<AppEnv>) {
    const user = await currentUser(c);
    if (!user) return { error: "unauthorized" as const, status: 401 as const };
    if (!user.verified) return { error: "email_unverified" as const, status: 403 as const };
    return { user };
  }

  async function ownedProject(c: Context<AppEnv>, id: string) {
    const user = await currentUser(c);
    if (!user) return { error: "unauthorized" as const };
    const project = await c.env.DB.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE public_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(id, user.id)
      .first<Project>();
    if (!project) return { error: "not_found" as const };
    return { user, project };
  }

  /* ------------------------------------------------------------- list/read */

  app.get("/", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const { results } = await c.env.DB.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(user.id)
      .all<Project>();
    const { appUrl } = config(c.env);
    return c.json({ ok: true, projects: results.map((project) => projectView(project, appUrl)) });
  });

  app.get("/:id", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return found.error === "unauthorized"
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "not_found" }, 404);
    }
    const { appUrl } = config(c.env);
    return c.json({ ok: true, project: projectView(found.project, appUrl) });
  });

  /* ---------------------------------------------------------------- create */

  const createSchema = z.object({
    name: z.string().min(1).max(80),
    hostname: z.string().min(3).max(253),
  });

  app.post("/", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const user = guard.user;

    const limit = rateLimit(`project:create:${user.id}`, PROJECT_CREATE_PER_HOUR, 3600_000);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfter));
      return c.json({ error: "rate_limited", retryAfter: limit.retryAfter }, 429);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_payload", issues: parsed.error.issues.map((issue) => issue.message) },
        400,
      );
    }

    const hostname = normalizeHostname(parsed.data.hostname);
    if (!hostname.ok) {
      return c.json({ error: "invalid_hostname", message: hostname.reason }, 400);
    }

    // One project per hostname: a verified domain can never be claimed twice.
    const taken = await c.env.DB.prepare(
      "SELECT public_id FROM projects WHERE hostname = ? LIMIT 1",
    )
      .bind(hostname.hostname)
      .first<{ public_id: string }>();
    if (taken) {
      return c.json(
        { error: "hostname_taken", message: "Bu alan adı zaten bir projeye bağlı." },
        409,
      );
    }

    const origin = `https://${hostname.hostname}`;
    const token = newVerificationToken();
    const now = Date.now();

    // The site may already exist: the SDK reports before the project is
    // created, and the ingest writes the site row for that origin. The
    // project then adopts the existing site id, otherwise the console would
    // look for a site that was never written (the insert below would be
    // ignored because the origin is unique) and show no data at all.
    const existingSite = await siteByOrigin(c.env.DB, origin);
    const publicId = existingSite?.public_id ?? `site_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    await c.env.DB.prepare(
      `INSERT INTO projects
        (public_id, user_id, name, hostname, verification_token, verification_status,
         verification_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
      .bind(publicId, user.id, parsed.data.name.trim(), hostname.hostname, token, now, now)
      .run();

    // The analytics site is created together with the project so the SDK can
    // report straight away. If the site already exists (the ingest created
    // it), the project has adopted its id and nothing has to be written.
    if (!existingSite) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO sites (public_id, name, origin, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(publicId, parsed.data.name.trim(), origin, now)
        .run();
    }

    const project = await c.env.DB.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE public_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(publicId, user.id)
      .first<Project>();

    const { appUrl } = config(c.env);
    return c.json({ ok: true, project: projectView(project as Project, appUrl) }, 201);
  });

  /* ---------------------------------------------------------------- rename */

  app.patch("/:id", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return found.error === "unauthorized"
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "not_found" }, 404);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_payload" }, 400);

    await c.env.DB.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(parsed.data.name.trim(), Date.now(), found.project.id, found.user.id)
      .run();
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------------- goals */

  /**
   * The goals of a project. A goal is a named conversion: it matches an
   * event by its name (or a path for a page goal) and the ingest writes the
   * goal into the event row.
   */
  app.get("/:id/goals", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json(
        { error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404,
      );
    }
    const site = await siteByKey(c.env.DB, found.project.public_id);
    if (!site) return c.json({ ok: true, goals: [] });
    return c.json({ ok: true, goals: await goalsFor(c.env.DB, site.id) });
  });

  const goalSchema = z.object({
    name: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.:-]+$/, "Sadece harf, rakam, _, ., : ve - kullanın"),
    label: z.string().max(120).optional(),
    path: z.string().max(512).optional(),
    value: z.number().nonnegative().max(1_000_000_000).optional(),
  });

  app.post("/:id/goals", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json(
        { error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404,
      );
    }
    const body = await c.req.json().catch(() => null);
    const parsed = goalSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_payload" }, 400);

    const site = await siteByKey(c.env.DB, found.project.public_id);
    if (!site) return c.json({ error: "site_not_found" }, 404);

    // A site may not collect an unbounded number of goals: the ingest would
    // have to compare every event against all of them.
    const existing = await goalsFor(c.env.DB, site.id);
    if (existing.length >= 25) {
      return c.json({ error: "too_many_goals", limit: 25 }, 429);
    }

    const publicId = `goal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await c.env.DB.prepare(
      "INSERT INTO goals (site_id, public_id, name, label, path, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        site.id,
        publicId,
        parsed.data.name,
        parsed.data.label ?? null,
        parsed.data.path ? cleanGoalPath(parsed.data.path) : null,
        parsed.data.value ?? null,
        Date.now(),
      )
      .run();
    return c.json({ ok: true, goal: publicId }, 201);
  });

  app.delete("/:id/goals/:goal", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json(
        { error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404,
      );
    }
    const site = await siteByKey(c.env.DB, found.project.public_id);
    if (!site) return c.json({ error: "not_found" }, 404);
    const result = await c.env.DB.prepare(
      "DELETE FROM goals WHERE public_id = ? AND site_id = ?",
    )
      .bind(c.req.param("goal"), site.id)
      .run();
    if (!result.meta.changes) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------------- delete */

  app.delete("/:id", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return found.error === "unauthorized"
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "not_found" }, 404);
    }
    if (c.req.query("confirm") !== found.project.public_id) {
      return c.json(
        {
          error: "confirmation_required",
          message: `Silmek için ?confirm=${found.project.public_id} gönderin.`,
        },
        400,
      );
    }

    // The project, its analytics site and every event/session it collected.
    const site = await c.env.DB.prepare("SELECT id FROM sites WHERE public_id = ? LIMIT 1")
      .bind(found.project.public_id)
      .first<{ id: number }>();

    if (site) {
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM events WHERE site_id = ?").bind(site.id),
        c.env.DB.prepare("DELETE FROM sessions WHERE site_id = ?").bind(site.id),
        c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(site.id),
      ]);
    }
    await c.env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
      .bind(found.project.id, found.user.id)
      .run();

    return c.json({ ok: true, deleted: found.project.public_id });
  });

  /* ------------------------------------------------------------- verify */

  app.post("/:id/verify", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return found.error === "unauthorized"
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "not_found" }, 404);
    }
    const project = found.project;

    // Bounded retries: no hammering of the resolver.
    const now = Date.now();
    const minInterval = Number(c.env.PROJECT_VERIFY_INTERVAL_MS ?? 10_000);
    if (project.last_checked_at && now - project.last_checked_at < minInterval) {
      const retryAfter = Math.ceil((minInterval - (now - project.last_checked_at)) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "too_soon", retryAfter }, 429);
    }
    const hourly = rateLimit(
      `project:verify:${project.public_id}`,
      VERIFY_MAX_PER_HOUR,
      3600_000,
    );
    if (!hourly.allowed) {
      c.header("Retry-After", String(hourly.retryAfter));
      return c.json({ error: "rate_limited", retryAfter: hourly.retryAfter }, 429);
    }

    // pending -> verifying (visible state), then a single DNS lookup.
    await c.env.DB.prepare(
      "UPDATE projects SET verification_status = 'verifying', last_checked_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(now, now, project.id)
      .run();

    const record = verificationRecord(project.hostname, project.verification_token);
    const lookup = await lookupTxt(record.name, record.value, c.env.DNS_RESOLVER_URL);

    let status: Project["verification_status"] = "pending";
    let error: string | null = null;
    if (lookup.found) {
      status = "verified";
    } else if (lookup.error) {
      error = lookup.error;
    } else {
      error = "record_not_found";
    }

    await c.env.DB.prepare(
      `UPDATE projects
          SET verification_status = ?, verification_error = ?, verification_attempts = verification_attempts + 1,
              verified_at = CASE WHEN ? = 'verified' THEN ? ELSE verified_at END,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(status, error, status, now, now, project.id)
      .run();

    const updated = await c.env.DB.prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? LIMIT 1`,
    )
      .bind(project.id)
      .first<Project>();

    const { appUrl } = config(c.env);
    return c.json({
      ok: true,
      project: projectView(updated as Project, appUrl),
      checkedAt: now,
    });
  });

  /* ================================================================ releases
     Change Radar: the release markers of a site and the comparison of the
     measurements around them.
     ==================================================================== */

  /** The windows the radar can compare. */
  const RADAR_WINDOWS: Record<string, { ms: number; label: string }> = {
    "1h": { ms: 3600_000, label: "1 saat" },
    "6h": { ms: 6 * 3600_000, label: "6 saat" },
    "24h": { ms: 24 * 3600_000, label: "24 saat" },
    "7d": { ms: 7 * 86400_000, label: "7 gün" },
  };

  const releaseSchema = z.object({
    version: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._+-]+$/, "Sadece harf, rakam, ., _, + ve - kullanın"),
    deployedAt: z.number().int().positive().optional(),
  });

  /** Resolves the site of a project — every data query is scoped by it. */
  async function siteOfProject(c: Context<AppEnv>, publicId: string) {
    const site = await siteByKey(c.env.DB, publicId);
    return site ?? null;
  }

  app.get("/:id/releases", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    const site = await siteOfProject(c, found.project.public_id);
    if (!site) return c.json({ ok: true, releases: [] });
    const releases = await listReleases(c.env.DB, site.id);
    return c.json({
      ok: true,
      releases: releases.map((release) => ({
        id: release.id,
        version: release.version,
        deployedAt: release.deployed_at,
        firstSeenAt: release.created_at,
        source: release.source,
      })),
    });
  });

  /** A release marker that is set by hand (the SDK sends its own). */
  app.post("/:id/releases", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = releaseSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_payload", issues: parsed.error.issues.map((i) => i.message) }, 400);
    }
    const site = await siteOfProject(c, found.project.public_id);
    if (!site) return c.json({ error: "site_not_found" }, 404);

    const now = Date.now();
    const deployedAt = parsed.data.deployedAt ?? now;
    const release = await upsertRelease(
      c.env.DB,
      site.id,
      parsed.data.version,
      Math.min(deployedAt, now + 3600_000),
      "manual",
    );
    return c.json(
      {
        ok: true,
        release: {
          id: release.id,
          version: release.version,
          deployedAt: release.deployed_at,
          firstSeenAt: release.created_at,
          source: release.source,
        },
      },
      201,
    );
  });

  /**
   * The Change Radar: the release markers, the metrics before and after a
   * release and the changes that were detected.
   */
  app.get("/:id/radar", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    // The radar is the most expensive read of the console (several window
    // queries per metric), so it is rate limited like the other reports.
    const limit = rateLimit(`radar:${found.user.id}`, 20, 60_000);
    if (!limit.allowed) {
      return c.json({ error: "rate_limited", retryAfter: limit.retryAfter }, 429);
    }
    const site = await siteOfProject(c, found.project.public_id);
    if (!site) {
      return c.json({ ok: true, release: null, metrics: [], segments: [], errors: null, timeline: [] });
    }

    const windowKey = c.req.query("window") ?? "24h";
    const windowMs = RADAR_WINDOWS[windowKey]?.ms ?? RADAR_WINDOWS["24h"]!.ms;
    const windowLabel = RADAR_WINDOWS[windowKey]?.label ?? "24 saat";

    // The radar is the most expensive read of the console, so the answer is
    // cached. ?fresh=1 asks for a new one.
    const cache = caches.default;
    const cacheKey = new Request(
      `https://dynamic.internal/api/radar/${site.id}/${windowKey}/${c.req.query("release") ?? "latest"}`,
    );
    if (c.req.query("fresh") !== "1") {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const releases = await listReleases(c.env.DB, site.id);
    const requested = c.req.query("release");
    const release = requested
      ? releases.find((item) => String(item.id) === requested)
      : releases[0];
    if (!release) {
      return c.json({
        ok: true,
        release: null,
        releases: [],
        metrics: [],
        segments: [],
        errors: null,
        timeline: [],
        empty: true,
        message:
          "Henüz bir sürüm işareti yok. Uygulamanızda dynamic.release('sürüm') çağırın veya buradan elle işaretleyin.",
      });
    }

    const releaseTs = release.deployed_at;
    const from = releaseTs - windowMs;
    const to = releaseTs + windowMs;

    const metricNames = ["LCP", "INP", "CLS", "FCP", "TTFB"];
    const samples = new Map<string, Awaited<ReturnType<typeof metricSamples>>>();
    for (const metric of metricNames) {
      samples.set(metric, await metricSamples(c.env.DB, site.id, metric, from, to));
    }

    const metrics: Comparison[] = metricNames.map((metric) =>
      compareMetric(metric, samples.get(metric) ?? [], releaseTs, windowMs),
    );
    const sampled = metricNames.some(
      (metric) => (samples.get(metric) ?? []).length >= RADAR_SCAN_LIMIT,
    );

    // The dimensions are only shown when they are measurable on both sides.
    const segments: { scope: string; metrics: Comparison[] }[] = [];
    const allSamples = metricNames.flatMap((metric) => samples.get(metric) ?? []);
    for (const scope of segmentationScopes(allSamples, releaseTs, windowMs)) {
      if (scope.scope === "all") continue;
      const scoped: Comparison[] = [];
      for (const metric of metricNames) {
        const metricSamplesForScope = (samples.get(metric) ?? []).filter(scope.filter);
        const comparison = compareMetric(
          metric,
          metricSamplesForScope,
          releaseTs,
          windowMs,
          scope.scope,
        );
        if (comparison.verdict !== "insufficient_data" || comparison.before.samples > 0) {
          scoped.push(comparison);
        }
      }
      if (scoped.length) segments.push({ scope: scope.scope, metrics: scoped });
    }

    const beforeErrors = await errorCounts(c.env.DB, site.id, from, releaseTs);
    const afterErrors = await errorCounts(c.env.DB, site.id, releaseTs, to);
    const errors = compareErrorRate(beforeErrors, afterErrors);

    const bucketMs = windowMs <= 6 * 3600_000 ? 3600_000 : 86400_000;
    const timeline = {
      bucketMs,
      metrics: Object.fromEntries(
        await Promise.all(
          metricNames.map(async (metric) => [
            metric,
            await metricTimeline(c.env.DB, site.id, metric, from, to, bucketMs),
          ]),
        ),
      ),
    };

    const payload = c.json({
      ok: true,
      release: {
        id: release.id,
        version: release.version,
        deployedAt: release.deployed_at,
        firstSeenAt: release.created_at,
        source: release.source,
      },
      releases: releases.map((item) => ({
        id: item.id,
        version: item.version,
        deployedAt: item.deployed_at,
        source: item.source,
      })),
      window: windowKey,
      windowLabel,
      windowMs,
      minSamples: MIN_WINDOW_SAMPLES,
      metrics,
      segments,
      errors,
      timeline,
      // A correlation is not a causation: the radar only says "the numbers
      // changed around this release", never "the release caused it".
      note: "Sürüm işareti ile ölçümler arasındaki ilişki nedensellik kanıtı değildir; eşzamanlı başka değişiklikler de etkili olabilir.",
      // Honest about the scan: when a window holds more samples than the
      // budget allows, the percentiles are calculated over the newest ones.
      sampled: sampled,
      ...(sampled
        ? {
            sampleNote: `Pencere başına en fazla ${RADAR_SCAN_LIMIT} ölçüm tarandı; yüzdelikler en yeni ölçümler üzerinden hesaplandı.`,
          }
        : {}),
    });
    payload.headers.set("Cache-Control", "private, max-age=300");
    await cache.put(cacheKey, payload.clone());
    return payload;
  });

  /* =========================================================== fix-to-proof */

  const insightStateSchema = z.object({
    status: z.enum(["open", "investigating", "fixed", "dismissed"]),
    releaseId: z.number().int().positive().nullable().optional(),
  });

  /**
   * The recommendations of a site.
   *
   * The list is recomputed from the measurements on every call and merged
   * with the stored state, so an issue the owner dismissed does not come
   * back, and a new measurement updates the evidence.
   */
  app.get("/:id/insights", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    const site = await siteOfProject(c, found.project.public_id);
    if (!site) {
      return c.json({ ok: true, issues: [], period: "7d", empty: true });
    }

    const range = resolveRange(c.req.query("range"));
    const { windowMs } = { windowMs: range === "24h" ? 86400_000 : range === "90d" ? 90 * 86400_000 : 7 * 86400_000 };
    const now = Date.now();
    const from = now - windowMs;
    const previousFrom = from - windowMs;

    const metricNames = ["LCP", "INP", "CLS", "FCP", "TTFB"];
    const vitals: VitalReading[] = [];
    for (const metric of metricNames) {
      const current = await plainSamples(c.env.DB, site.id, metric, from, now);
      const values = current.map((sample) => sample.value);
      const sufficient = values.length >= 20;
      vitals.push({
        metric,
        samples: values.length,
        p75: sufficient ? percentileOf(values) : null,
        p50: sufficient ? percentileOf(values, 0.5) : null,
        avg: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        sufficient,
      });
    }

    const currentErrors = await errorCounts(c.env.DB, site.id, from, now);
    const previousErrors = await errorCounts(c.env.DB, site.id, previousFrom, from);
    const currentRate = currentErrors.total ? currentErrors.errors / currentErrors.total : 0;
    const previousRate = previousErrors.total ? previousErrors.errors / previousErrors.total : 0;

    const issues = evaluateIssues({
      vitals,
      errors: {
        errors: currentErrors.errors,
        total: currentErrors.total,
        rate: currentRate,
        previousRate,
      },
      period: range,
    });

    // The state of an issue survives a new measurement.
    const stored = await listInsights(c.env.DB, site.id);
    const storedByFingerprint = new Map(stored.map((row) => [row.fingerprint, row]));
    for (const issue of issues) {
      await upsertInsight(
        c.env.DB,
        site.id,
        {
          fingerprint: issue.fingerprint,
          kind: issue.kind,
          scope: issue.scope,
          title: issue.title,
          severity: issue.severity,
          evidence: JSON.stringify({ ...issue, period: range }),
        },
        now,
      );
    }

    const releases = await listReleases(c.env.DB, site.id);
    const releasesById = new Map(releases.map((row) => [row.id, row]));

    const payload = await Promise.all(issues.map(async (issue) => {
      const row = storedByFingerprint.get(issue.fingerprint);
      const status = row?.status ?? "open";
      const releaseId = row?.release_id ?? null;
      const release = releaseId ? releasesById.get(releaseId) ?? null : null;

      // A fix that is linked to a release is compared with the data around it.
      let assessment = null;
      if (release && status === "fixed") {
        const metric = issue.kind.toUpperCase();
        const before = await plainSamples(
          c.env.DB,
          site.id,
          metric,
          release.deployed_at - 86400_000,
          release.deployed_at,
        );
        const after = await plainSamples(
          c.env.DB,
          site.id,
          metric,
          release.deployed_at,
          release.deployed_at + 86400_000,
        );
        assessment = assessFix(before, after);
      }

      return {
        ...issue,
        status,
        releaseId,
        releaseVersion: release?.version ?? null,
        firstSeenAt: row?.first_seen_at ?? now,
        lastSeenAt: row?.last_seen_at ?? now,
        assessment,
      };
    }));

    // The issues the owner dismissed are kept, but they are not repeated as
    // new findings.
    const dismissed = stored
      .filter((row) => row.status === "dismissed" || row.status === "investigating")
      .filter((row) => !payload.some((issue) => issue.fingerprint === row.fingerprint))
      .map((row) => ({
        fingerprint: row.fingerprint,
        kind: row.kind,
        scope: row.scope,
        title: row.title,
        severity: row.severity,
        status: row.status,
        releaseId: row.release_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        assessment: null,
      }));

    return c.json({
      ok: true,
      period: range,
      issues: [...payload, ...dismissed],
      empty: payload.length === 0 && dismissed.length === 0,
      minSamples: 20,
      note: "Öneriler ölçülen verilerden türetilir; hiçbir öneri sitenizin kodunu değiştirmez.",
    });
  });

  /** The owner marks an issue: under investigation, fixed or dismissed. */
  app.patch("/:id/insights/:fingerprint", async (c) => {
    const guard = await requireVerified(c);
    if ("error" in guard) return c.json({ error: guard.error }, guard.status);
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = insightStateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_payload", issues: parsed.error.issues.map((i) => i.message) }, 400);
    }
    const site = await siteOfProject(c, found.project.public_id);
    if (!site) return c.json({ error: "site_not_found" }, 404);

    let releaseId: number | null = null;
    if (parsed.data.releaseId) {
      const release = await releaseById(c.env.DB, site.id, parsed.data.releaseId);
      if (!release) return c.json({ error: "release_not_found" }, 404);
      releaseId = release.id;
    }

    const changed = await updateInsightState(
      c.env.DB,
      site.id,
      c.req.param("fingerprint"),
      parsed.data.status,
      releaseId,
      Date.now(),
    );
    if (!changed) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, status: parsed.data.status, releaseId });
  });

  /* =========================================================== privacy gate */

  /** What the Privacy Gate blocked, the rules and the configuration state. */
  app.get("/:id/privacy", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    const site = await siteOfProject(c, found.project.public_id);
    if (!site) {
      return c.json({ ok: true, counters: [], rules: GATE_RULES, total: 0 });
    }
    const counters = await privacyCounters(c.env.DB, site.id);
    const total = counters.reduce((sum, row) => sum + (row.count ?? 0), 0);
    return c.json({
      ok: true,
      rules: GATE_RULES,
      counters: counters.map((row) => ({
        category: row.category,
        count: row.count,
        updatedAt: row.updated_at,
      })),
      total,
      // The server validates every payload again, independent of the SDK.
      serverSide: true,
      note: "Değerler hiçbir zaman sunucuya gönderilmez; yalnızca kaç adet engellendiği sayılır.",
    });
  });

  /**
   * A synthetic test of the server side validation.
   *
   * The values are fabricated, they are never stored, and the answer says
   * what would happen with them. This is the test the owner can run to see
   * whether the rules behave as documented.
   */
  app.post("/:id/privacy/test", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return c.json({ error: found.error === "unauthorized" ? "unauthorized" : "not_found" },
        found.error === "unauthorized" ? 401 : 404);
    }
    const cases: { label: string; props: Record<string, unknown> }[] = [
      { label: "e-posta değeri", props: { mail: "jane@example.com" } },
      { label: "bearer token", props: { auth: "Bearer abcdefghijklmnopqrst" } },
      { label: "uzun hex", props: { ref: "9f8e7d6c5b4a39281706f5e4d3c2b1a0" } },
      { label: "kredi kartı", props: { card: "4242 4242 4242 4242" } },
      { label: "sorgu parametresi", props: { to: "https://site.com/x?token=secretvalue" } },
      { label: "parola alanı", props: { password: "hunter2" } },
      { label: "güvenli sayaç", props: { items: 3, currency: "TRY" } },
    ];

    const samples = cases.map((item) => {
      const blockedByKey = Object.keys(item.props).filter((key) => isSensitiveKey(key));
      const blockedByValue = Object.entries(item.props)
        .filter(([key, value]) => !isSensitiveKey(key) && typeof value === "string" && classifyValue(value))
        .map(([key]) => key);
      const redactedUrl = Object.entries(item.props).find(
        ([, value]) => typeof value === "string" && value.startsWith("http"),
      );
      return {
        label: item.label,
        blocked: blockedByKey.length > 0 || blockedByValue.length > 0,
        blockedByKey,
        blockedByValue,
        redactedUrl: redactedUrl
          ? { url: redactUrl(redactedUrl[1] as string).url, fields: redactUrl(redactedUrl[1] as string).redacted }
          : null,
      };
    });

    return c.json({
      ok: true,
      total: samples.length,
      blocked: samples.filter((sample) => sample.blocked).length,
      samples,
      note: "Bu değerler uydurmadır; hiçbir yere gönderilmez ve saklanmaz.",
    });
  });

  /* ---------------------------------------------------------------- stats */

  app.get("/:id/stats", async (c) => {    const found = await ownedProject(c, c.req.param("id"));
    if ("error" in found) {
      return found.error === "unauthorized"
        ? c.json({ error: "unauthorized" }, 401)
        : c.json({ error: "not_found" }, 404);
    }
    const range = resolveRange(c.req.query("range"));
    const site = await c.env.DB.prepare(
      "SELECT id, public_id, name, origin, created_at, retention_days, daily_event_limit, events_today, counter_day FROM sites WHERE public_id = ? LIMIT 1",
    )
      .bind(found.project.public_id)
      .first<{
        id: number;
        public_id: string;
        name: string;
        origin: string;
        created_at: number;
        retention_days: number;
        daily_event_limit: number;
        events_today: number;
        counter_day: string | null;
      }>();

    if (!site) {
      return c.json({
        ok: true,
        installed: false,
        summary: null,
        rum: null,
      });
    }

    const [summary, rum] = await Promise.all([
      analyticsSummary(c.env.DB, site, range),
      rumSummary(c.env.DB, site.id, range),
    ]);

    return c.json({ ok: true, installed: true, summary, rum });
  });

  return app;
}
