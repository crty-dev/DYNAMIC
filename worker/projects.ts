import { Hono, type Context } from "hono";
import { z } from "zod";
import { createAuth } from "./auth";
import { analyticsSummary, resolveRange, rumSummary } from "./analytics";
import { lookupTxt, normalizeHostname, verificationRecord } from "./dns";
import { config, type AppEnv } from "./env";
import { rateLimit } from "./rate-limit";

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
    script: `<script async src="${appUrl}/js/dynamic.js" data-site="${project.public_id}"></script>`,
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
    const user = await currentUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

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

    const publicId = `site_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const token = newVerificationToken();
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO projects
        (public_id, user_id, name, hostname, verification_token, verification_status,
         verification_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
      .bind(publicId, user.id, parsed.data.name.trim(), hostname.hostname, token, now, now)
      .run();

    // The analytics site is created together with the project so the SDK can
    // report straight away. The id stays the same when the origin is known.
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO sites (public_id, name, origin, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(publicId, parsed.data.name.trim(), `https://${hostname.hostname}`, now)
      .run();

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

  /* ---------------------------------------------------------------- delete */

  app.delete("/:id", async (c) => {
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

  /* ---------------------------------------------------------------- stats */

  app.get("/:id/stats", async (c) => {
    const found = await ownedProject(c, c.req.param("id"));
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
