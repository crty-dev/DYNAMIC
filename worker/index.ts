import { Hono } from "hono";

type Bindings = {
  /** Cloudflare D1 binding (Free plan) — migrations/: 0001_init.sql */
  DB: D1Database;
  /** Static assets binding (dist/) */
  ASSETS: unknown;
};

const app = new Hono<{ Bindings: Bindings }>();

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
 * POST /api/collect — SDK/SDK event batch alımı.
 * Faz 2'de gerçek persist (db.batch) gelecek; şimdilik şema doğrulaması + ack.
 */
app.post("/api/collect", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!Array.isArray(body)) return c.json({ error: "expected_array" }, 400);
  if (body.length === 0) return c.json({ ok: true, accepted: 0 }, 200);
  if (body.length > 64) return c.json({ error: "batch_too_large", max: 64 }, 413);
  for (const item of body) {
    if (typeof item !== "object" || item === null) {
      return c.json({ error: "invalid_item" }, 400);
    }
  }
  return c.json({ ok: true, accepted: body.length }, 202);
});

export default app;
