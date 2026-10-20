import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.DYNAMIC_TEST_PORT ?? 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

/** A fresh origin per run keeps the local D1 free of previous test data. */
let ORIGIN = "";
let OTHER_ORIGIN = "";

function devVar(key) {
  const file = path.join(ROOT, ".dev.vars");
  if (!fs.existsSync(file)) return "";
  const match = new RegExp(`^${key}=(.+)$`, "m").exec(fs.readFileSync(file, "utf8"));
  return match ? match[1].trim() : "";
}

const ADMIN = devVar("ADMIN_API_KEY");

let server;

before(async () => {
  const run = Date.now().toString(36);
  ORIGIN = `https://test-${run}.dynamic.local`;
  OTHER_ORIGIN = `https://other-${run}.dynamic.local`;

  const migrate = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "dynamic", "--local"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (migrate.status !== 0) {
    throw new Error(`migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }

  server = spawn(
    process.execPath,
    [WRANGLER, "dev", "--port", String(PORT), "--ip", "127.0.0.1"],
    { cwd: ROOT, stdio: "ignore" },
  );

  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("wrangler dev did not become ready");
});

after(() => {
  server?.kill();
});

/* ------------------------------------------------------------------ helpers */

function collect(events, options = {}) {
  return fetch(`${BASE}/api/collect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? ORIGIN,
      ...(options.site ? { "x-site": options.site } : {}),
    },
    body: JSON.stringify(options.raw ? events : { site: options.site, events }),
  });
}

function summary(origin = ORIGIN, range = "7d") {
  return fetch(`${BASE}/api/analytics/summary?range=${range}`, {
    headers: { origin, referer: `${origin}/` },
  });
}

async function admin(pathname, init = {}) {
  return fetch(`${BASE}/api/admin${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
      ...(init.headers ?? {}),
    },
  });
}

/* -------------------------------------------------------------------- tests */

describe("DYNAMIC API", () => {
  it("reports health", async () => {
    const response = await fetch(`${BASE}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.tables));
  });

  it("rejects a malformed payload", async () => {
    const response = await collect([{ type: "nope" }]);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "invalid_payload");
    assert.ok(body.issues.length > 0);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await fetch(`${BASE}/api/collect`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{not json",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_json");
  });

  it("rejects a batch larger than the limit", async () => {
    const events = Array.from({ length: 65 }, () => ({ type: "pageview", path: "/" }));
    const response = await collect(events);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "batch_too_large");
  });

  it("stores a valid batch and reports what was written", async () => {
    const response = await collect([
      {
        type: "pageview",
        path: "/pricing?utm_source=news",
        session: "s_test_session_0001",
        ref: "https://news.ycombinator.com/item?id=1",
        utm: { source: "news", medium: "social", campaign: "spring" },
      },
      {
        type: "vital",
        metric: "LCP",
        value: 1234,
        rating: "good",
        id: "v_lcp_0001",
        path: "/pricing",
        session: "s_test_session_0001",
      },
      {
        type: "event",
        name: "signup",
        value: 12,
        props: { plan: "free", email: "drop@example.com" },
        path: "/pricing",
        session: "s_test_session_0001",
      },
    ]);
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.accepted, 3);
    assert.equal(body.deduped, 0);
    assert.equal(body.sessions, 1);
    assert.ok(body.site);
  });

  it("dedupes a repeated web-vitals metric id", async () => {
    const event = {
      type: "vital",
      metric: "CLS",
      value: 0.04,
      rating: "good",
      id: "v_cls_dedupe",
      path: "/pricing",
      session: "s_test_session_0001",
    };
    const first = await collect([event]);
    assert.equal(first.status, 202);
    assert.equal((await first.json()).accepted, 1);

    const second = await collect([event]);
    const body = await second.json();
    assert.equal(body.accepted, 0);
    assert.equal(body.deduped, 1);
  });

  it("reports analytics for the site", async () => {
    const response = await summary();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(body.site);
    assert.equal(body.totals.pageviews, 1);
    assert.equal(body.totals.visitors, 1);
    assert.equal(body.totals.sessions, 1);
    assert.equal(body.totals.customEvents, 1);
    assert.equal(body.topPages[0].path, "/pricing");
    assert.equal(body.referrers[0].referrer, "news.ycombinator.com");
    assert.equal(body.campaigns[0].campaign, "spring");
    assert.ok(body.devices.length > 0);
    assert.equal(body.series.length, 7);
  });

  it("keeps sites isolated", async () => {
    const response = await summary(OTHER_ORIGIN);
    const body = await response.json();
    assert.equal(body.site, null);
    assert.equal(body.totals.pageviews, 0);
    assert.deepEqual(body.topPages, []);
  });

  it("refuses a site key that belongs to another origin", async () => {
    const other = await collect([{ type: "pageview", path: "/x" }], { origin: OTHER_ORIGIN });
    const otherSite = (await other.json()).site;
    assert.ok(otherSite);

    const response = await collect([{ type: "pageview", path: "/x" }], { site: otherSite });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "origin_mismatch");
  });

  it("reports Web Vitals without inventing a percentile", async () => {
    const response = await fetch(`${BASE}/api/rum/summary?range=7d`, {
      headers: { origin: ORIGIN, referer: `${ORIGIN}/` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const lcp = body.metrics.find((metric) => metric.metric === "LCP");
    assert.equal(lcp.samples, 1);
    assert.equal(lcp.p75, null, "p75 must stay empty with too few samples");
    assert.equal(lcp.sufficient, false);
    assert.match(lcp.note, /samples/i);
    assert.equal(lcp.good, 1);
  });

  it("guards the admin API with a bearer token", async () => {
    const response = await fetch(`${BASE}/api/admin/sites`);
    assert.equal(response.status, 401);
  });

  it("lists sites for an admin", async () => {
    const response = await admin("/sites");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.sites));
    assert.ok(body.sites.length > 0);
  });

  it("tracks a goal as a conversion", async () => {
    const sites = await (await admin("/sites")).json();
    const site = sites.sites.find((entry) => entry.origin === ORIGIN);
    assert.ok(site, "the test site should exist");

    const goal = await admin(`/sites/${site.id}/goals`, {
      method: "POST",
      body: JSON.stringify({ name: "signup", label: "Sign up" }),
    });
    assert.equal(goal.status, 201);

    await collect([
      {
        type: "event",
        name: "signup",
        path: "/welcome",
        session: "s_test_session_0001",
        value: 9,
      },
    ]);

    const body = await (await summary()).json();
    assert.equal(body.totals.conversions, 1);
    assert.equal(body.goals[0].name, "signup");
    assert.equal(body.goals[0].value, 9);
  });

  it("answers with a clear error when the daily quota is reached", async () => {
    const sites = await (await admin("/sites")).json();
    const site = sites.sites.find((entry) => entry.origin === ORIGIN);
    const used = Math.max(1, site.events);

    const patch = await admin(`/sites/${site.id}`, {
      method: "PATCH",
      body: JSON.stringify({ daily_event_limit: used }),
    });
    assert.equal(patch.status, 200);

    const response = await collect([{ type: "pageview", path: "/over-quota" }]);
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.equal(body.error, "quota_exceeded");
    assert.equal(body.accepted, 0);

    await admin(`/sites/${site.id}`, {
      method: "PATCH",
      body: JSON.stringify({ daily_event_limit: 25000 }),
    });
  });

  it("purges events older than the retention window", async () => {
    const sites = await (await admin("/sites")).json();
    const site = sites.sites.find((entry) => entry.origin === ORIGIN);
    const response = await admin(`/sites/${site.id}/purge`, {
      method: "POST",
      body: JSON.stringify({ older_than_days: 1 }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.deletedEvents, "number");
  });
});
