import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetTestDatabase, TEST_CONFIG } from "./helpers/server.mjs";

import {
  compareErrorRate,
  compareMetric,
  MIN_WINDOW_SAMPLES,
  segmentationScopes,
  splitWindows,
  stats,
} from "../worker/release-rules.ts";
import { assessFix, evaluateIssues } from "../worker/insight-rules.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = Number(process.env.DYNAMIC_SIGNATURE_TEST_PORT ?? 8793);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:5174";
const RUN = Date.now().toString(36);
const email = (name) => `${name}-${RUN}@dynamic.local`;

/* ============================================================ pure rules */

describe("Change Radar - comparison rules", () => {
  const now = 1_800_000_000_000;
  const windowMs = 86_400_000;

  /** `count` samples before and after the release. */
  function samples(beforeValue, afterValue, count = 30) {
    const list = [];
    for (let index = 0; index < count; index++) {
      list.push({ ts: now - 3600_000 + index * 1000, value: beforeValue });
      list.push({ ts: now + 3600_000 + index * 1000, value: afterValue });
    }
    return list;
  }

  it("splits the samples at the release boundary", () => {
    const { before: beforeSamples, after: afterSamples } = splitWindows(
      [
        { ts: now - 1000, value: 1 },
        { ts: now, value: 2 },
        { ts: now + 1000, value: 3 },
      ],
      now,
      windowMs,
    );
    assert.equal(beforeSamples.length, 1);
    assert.equal(afterSamples.length, 2, "the release moment itself belongs to the new window");
  });

  it("detects a regression with enough samples", () => {
    const comparison = compareMetric("LCP", samples(1000, 3000), now, windowMs);
    assert.equal(comparison.verdict, "regression");
    assert.equal(comparison.before.samples, 30);
    assert.equal(comparison.after.samples, 30);
    assert.ok(comparison.delta > 0);
    assert.ok(comparison.reason.includes("p75"));
  });

  it("detects an improvement", () => {
    const comparison = compareMetric("LCP", samples(3000, 1000), now, windowMs);
    assert.equal(comparison.verdict, "improvement");
    assert.ok(comparison.delta < 0);
  });

  it("keeps a small change stable", () => {
    const comparison = compareMetric("LCP", samples(2000, 2100), now, windowMs);
    assert.equal(comparison.verdict, "stable");
  });

  it("never declares a regression on a small sample", () => {
    const comparison = compareMetric("LCP", samples(1000, 9000, 5), now, windowMs);
    assert.equal(comparison.verdict, "insufficient_data");
    assert.ok(comparison.reason.includes(String(MIN_WINDOW_SAMPLES)));
  });

  it("never declares a regression when only one side has data", () => {
    const onlyBefore = samples(1000, 1000).filter((sample) => sample.ts < now);
    const comparison = compareMetric("LCP", onlyBefore, now, windowMs);
    assert.equal(comparison.verdict, "insufficient_data");
  });

  it("compares the error rate", () => {
    const comparison = compareErrorRate({ errors: 2, total: 100 }, { errors: 30, total: 100 });
    assert.equal(comparison.verdict, "regression");
    const improved = compareErrorRate({ errors: 30, total: 100 }, { errors: 2, total: 100 });
    assert.equal(improved.verdict, "improvement");
  });

  it("does not judge an error rate with too few errors", () => {
    const comparison = compareErrorRate({ errors: 1, total: 100 }, { errors: 2, total: 100 });
    assert.equal(comparison.verdict, "insufficient_data");
  });

  it("only offers a dimension that is measurable on both sides", () => {
    const list = [];
    for (let index = 0; index < 30; index++) {
      // "/a" is measured on both sides, "/b" only before the release.
      list.push({ ts: now - 3600_000 + index * 1000, value: 1000, path: "/a", device: "mobile", browser: "chrome" });
      list.push({ ts: now + 3600_000 + index * 1000, value: 3000, path: "/a", device: "mobile", browser: "chrome" });
      list.push({ ts: now - 3600_000 + index * 1000, value: 1000, path: "/b", device: "desktop", browser: "chrome" });
    }
    const names = new Set(segmentationScopes(list, now, windowMs).map((scope) => scope.scope));
    assert.ok(names.has("all"));
    assert.ok(names.has("path:/a"), "a path with samples on both sides must be offered");
    assert.ok(!names.has("path:/b"), "a path with one side only must be skipped");
  });

  it("computes the percentiles of a window", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const reading = stats(values.map((value) => ({ ts: 0, value })));
    assert.equal(reading.samples, 100);
    assert.equal(reading.p50, 50);
    assert.equal(reading.p75, 75);
  });
});

describe("Fix-to-Proof - rules", () => {
  const healthy = {
    metric: "LCP",
    samples: 40,
    p75: 1200,
    p50: 900,
    avg: 1000,
    sufficient: true,
  };

  it("does not report a healthy metric", () => {
    const issues = evaluateIssues({
      vitals: [healthy],
      errors: { errors: 0, total: 100, rate: 0, previousRate: 0 },
      period: "7d",
    });
    assert.equal(issues.length, 0);
  });

  it("reports a metric above the poor threshold with its evidence", () => {
    const issues = evaluateIssues({
      vitals: [{ ...healthy, p75: 3200 }],
      errors: { errors: 0, total: 100, rate: 0, previousRate: 0 },
      period: "7d",
    });
    assert.equal(issues.length, 1);
    const issue = issues[0];
    assert.equal(issue.kind, "lcp");
    assert.equal(issue.fingerprint, "lcp:all");
    assert.ok(issue.reason.includes("7d"), "the period must be part of the reason");
    assert.equal(issue.samples, 40);
    assert.ok(issue.guidance.length > 0, "the developer needs a direction");
  });

  it("does not report a metric with too few samples", () => {
    const issues = evaluateIssues({
      vitals: [{ ...healthy, p75: 9000, samples: 4 }],
      errors: { errors: 0, total: 100, rate: 0, previousRate: 0 },
      period: "7d",
    });
    assert.equal(issues.length, 0);
  });

  it("reports a rising error rate", () => {
    const issues = evaluateIssues({
      vitals: [healthy],
      errors: { errors: 30, total: 100, rate: 0.3, previousRate: 0.05 },
      period: "7d",
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, "errors");
  });

  it("does not repeat the same issue twice", () => {
    const input = {
      vitals: [{ ...healthy, p75: 3200 }],
      errors: { errors: 0, total: 100, rate: 0, previousRate: 0 },
      period: "7d",
    };
    const first = evaluateIssues(input);
    const second = evaluateIssues(input);
    assert.equal(first[0].fingerprint, second[0].fingerprint);
  });

  it("calls a fix improved only when the numbers prove it", () => {
    const beforeValues = Array.from({ length: 30 }, () => ({ value: 3000 }));
    const afterValues = Array.from({ length: 30 }, () => ({ value: 1200 }));
    const assessment = assessFix(beforeValues, afterValues);
    assert.equal(assessment.outcome, "improved");
    assert.ok(assessment.delta < 0);
    assert.ok(assessment.reason.length > 0);
  });

  it("calls a fix inconclusive when the change is too small", () => {
    const beforeValues = Array.from({ length: 30 }, () => ({ value: 3000 }));
    const afterValues = Array.from({ length: 30 }, () => ({ value: 2950 }));
    assert.equal(assessFix(beforeValues, afterValues).outcome, "inconclusive");
  });

  it("calls a fix insufficient when a side has no data", () => {
    const assessment = assessFix([{ value: 3000 }], Array.from({ length: 30 }, () => ({ value: 100 })));
    assert.equal(assessment.outcome, "insufficient_data");
  });

  it("calls a fix regressed when the numbers got worse", () => {
    const beforeValues = Array.from({ length: 30 }, () => ({ value: 1000 }));
    const afterValues = Array.from({ length: 30 }, () => ({ value: 4000 }));
    assert.equal(assessFix(beforeValues, afterValues).outcome, "regressed");
  });
});

/* ========================================================== integration */

let dev;

before(async () => {
  resetTestDatabase();
  const migrate = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "dynamic-test", "--local", "--config", TEST_CONFIG],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);

  dev = spawn(
    process.execPath,
    [
      WRANGLER,
      "dev",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--config",
      TEST_CONFIG,
      "--var",
      "DEV_MODE:1",
      "--var",
      "AUTH_RATE_LIMIT_MAX:1000",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  dev.stdout?.on("data", (chunk) => {
    if (process.env.DYNAMIC_DEBUG) process.stdout.write(chunk);
  });
  dev.stderr?.on("data", (chunk) => {
    if (process.env.DYNAMIC_DEBUG) process.stderr.write(chunk);
  });

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
  dev?.kill();
});

function createJar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    capture(response) {
      for (const cookie of response.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || /expires=thu, 01 jan 1970/i.test(cookie)) cookies.delete(key);
        else cookies.set(key, value);
      }
    },
  };
}

async function api(route, { jar, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      ...(method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" }),
      ...(jar ? { cookie: jar.header() } : {}),
      origin: ORIGIN,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  jar?.capture(response);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { status: response.status, payload };
}

async function verifiedAccount(name) {
  const address = email(name);
  const jar = createJar();
  const password = "SuperSecret!2026";
  const register = await api("/api/auth/sign-up/email", {
    jar,
    method: "POST",
    body: { email: address, password, name: "Test User" },
  });
  assert.equal(register.status, 200, JSON.stringify(register.payload).slice(0, 200));

  const mails = await api("/api/dev/mailbox");
  const mail = mails.payload.mails?.find((entry) => entry.to === address);
  assert.ok(mail, "a verification mail must be queued");
  const token = /verify-email\?token=([^&\s]+)/.exec(mail.text)[1];
  await api(`/api/auth/verify-email?token=${token}`);

  const login = await api("/api/auth/sign-in/email", {
    jar,
    method: "POST",
    body: { email: address, password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.payload).slice(0, 200));
  return { jar, address };
}

/** Sends a batch to the collect endpoint of a site. */
async function collect(origin, events, extra = {}) {
  const response = await fetch(`${BASE}/api/collect`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ events, ...extra }),
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

describe("Change Radar - the API", () => {
  it("stores a release marker and compares the measurements around it", async () => {
    const { jar } = await verifiedAccount("radar");
    const hostname = `radar-${RUN}.example.com`;
    const created = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Radar", hostname },
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload).slice(0, 200));
    const projectId = created.payload.project.id;

    const origin = `https://${hostname}`;
    const releaseTs = Date.now() - 3600_000;

    const events = [];
    for (let index = 0; index < 30; index++) {
      events.push({
        type: "vital",
        metric: "LCP",
        value: 1000,
        path: "/pricing",
        ts: releaseTs - 3600_000 + index * 1000,
        session: `s_before_${index}`,
      });
      events.push({
        type: "vital",
        metric: "LCP",
        value: 3200,
        path: "/pricing",
        ts: releaseTs + 60_000 + index * 1000,
        session: `s_after_${index}`,
      });
    }
    events.push({
      type: "release",
      version: "2026.10.1",
      deployedAt: releaseTs,
      ts: releaseTs,
      session: "s_marker",
    });

    const collected = await collect(origin, events);
    assert.equal(collected.status, 202, JSON.stringify(collected.payload).slice(0, 200));

    const releases = await api(`/api/projects/${projectId}/releases`, { jar });
    assert.equal(releases.status, 200);
    assert.equal(releases.payload.releases.length, 1, "the marker must be stored once");
    assert.equal(releases.payload.releases[0].version, "2026.10.1");

    const radar = await api(`/api/projects/${projectId}/radar?window=24h`, { jar });
    assert.equal(radar.status, 200, JSON.stringify(radar.payload).slice(0, 200));
    assert.equal(radar.payload.release.version, "2026.10.1");

    const lcp = radar.payload.metrics.find((metric) => metric.metric === "LCP");
    assert.ok(lcp, "LCP must be compared");
    assert.equal(lcp.verdict, "regression", JSON.stringify(lcp));
    assert.equal(lcp.before.samples, 30);
    assert.equal(lcp.after.samples, 30);
    assert.ok(radar.payload.timeline.metrics.LCP.length > 0, "the timeline must have points");
    assert.ok(radar.payload.note.length > 0, "the radar must state that it is not a causation");
  });

  it("answers with an empty state when no release was marked", async () => {
    const { jar } = await verifiedAccount("radar-empty");
    const created = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Empty", hostname: `radar-empty-${RUN}.example.com` },
    });
    const radar = await api(`/api/projects/${created.payload.project.id}/radar`, { jar });
    assert.equal(radar.status, 200);
    assert.equal(radar.payload.release, null);
    assert.equal(radar.payload.empty, true);
    assert.ok(radar.payload.message.length > 0, "the empty state must explain itself");
  });

  it("keeps the radar of one project away from another", async () => {
    const owner = await verifiedAccount("radar-owner");
    const stranger = await verifiedAccount("radar-stranger");
    const mine = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "Mine", hostname: `radar-mine-${RUN}.example.com` },
    });
    assert.equal(mine.status, 201);

    // Another account must not read the project of the first one.
    const foreign = await api(`/api/projects/${mine.payload.project.id}/radar`, {
      jar: stranger.jar,
    });
    assert.equal(foreign.status, 404, "another tenant's project must not be readable");
    assert.equal(foreign.payload.error, "not_found");
  });

  it("limits how often the radar may be read", async () => {
    const { jar } = await verifiedAccount("radar-limit");
    const created = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Limit", hostname: `radar-limit-${RUN}.example.com` },
    });
    const projectId = created.payload.project.id;

    // The radar is the most expensive read of the console, so it answers
    // 429 instead of scanning the database again and again.
    let limited = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await api(`/api/projects/${projectId}/radar?window=24h&fresh=1`, { jar });
      if (response.status === 429) {
        limited = response;
        break;
      }
      assert.equal(response.status, 200, JSON.stringify(response.payload).slice(0, 120));
    }
    assert.ok(limited, "the radar must be rate limited");
    assert.equal(limited.payload.error, "rate_limited");
  });
});

describe("Fix-to-Proof - the API", () => {
  it("turns a slow metric into a recommendation and keeps its state", async () => {
    const { jar } = await verifiedAccount("insights");
    const hostname = `insights-${RUN}.example.com`;
    const created = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Insights", hostname },
    });
    const projectId = created.payload.project.id;
    const origin = `https://${hostname}`;

    const releaseTs = Date.now() - 3600_000;
    const events = [];
    for (let index = 0; index < 30; index++) {
      events.push({
        type: "vital",
        metric: "LCP",
        value: 3400,
        path: "/",
        ts: releaseTs - 600_000 + index * 1000,
        session: `s_${index}`,
      });
    }
    events.push({
      type: "release",
      version: "2026.10.2",
      deployedAt: releaseTs,
      ts: releaseTs,
      session: "s_marker",
    });
    await collect(origin, events);

    const insights = await api(`/api/projects/${projectId}/insights?range=24h`, { jar });
    assert.equal(insights.status, 200, JSON.stringify(insights.payload).slice(0, 200));
    const issue = insights.payload.issues.find((entry) => entry.kind === "lcp");
    assert.ok(issue, "the slow LCP must be reported");
    assert.equal(issue.status, "open");
    assert.ok(issue.guidance.length > 0, "the recommendation must be actionable");
    assert.ok(issue.reason.includes("24h"), "the reason must name the period");

    // The owner marks it as under investigation.
    const investigating = await api(`/api/projects/${projectId}/insights/${issue.fingerprint}`, {
      jar,
      method: "PATCH",
      body: { status: "investigating" },
    });
    assert.equal(investigating.status, 200, JSON.stringify(investigating.payload).slice(0, 200));

    // ... and links the fix to a release.
    const releases = await api(`/api/projects/${projectId}/releases`, { jar });
    const releaseId = releases.payload.releases[0].id;
    const fixed = await api(`/api/projects/${projectId}/insights/${issue.fingerprint}`, {
      jar,
      method: "PATCH",
      body: { status: "fixed", releaseId },
    });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.payload).slice(0, 200));

    const refreshed = await api(`/api/projects/${projectId}/insights?range=24h`, { jar });
    const stored = refreshed.payload.issues.find((entry) => entry.fingerprint === issue.fingerprint);
    assert.equal(stored.status, "fixed");
    assert.equal(stored.releaseVersion, "2026.10.2");
    assert.ok(stored.assessment, "a linked fix must be checked against the data");
    assert.ok(
      ["improved", "regressed", "inconclusive", "insufficient_data"].includes(
        stored.assessment.outcome,
      ),
      "the outcome must be one of the known ones",
    );
  });

  it("answers with an empty list when nothing is wrong", async () => {
    const { jar } = await verifiedAccount("insights-empty");
    const created = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Healthy", hostname: `insights-ok-${RUN}.example.com` },
    });
    const insights = await api(`/api/projects/${created.payload.project.id}/insights`, { jar });
    assert.equal(insights.status, 200);
    assert.equal(insights.payload.empty, true);
  });
});

describe("Privacy Gate - the API", () => {
  it("counts the blocked payloads and answers a synthetic test", async () => {
    const { jar } = await verifiedAccount("privacy");
    const hostname = `privacy-${RUN}.example.com`;
    const created = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Privacy", hostname },
    });
    const projectId = created.payload.project.id;

    await collect(
      `https://${hostname}`,
      [{ type: "pageview", path: "/", ts: Date.now(), session: "s_privacy_1" }],
      { privacy: { email: 3, token: 1 } },
    );

    const privacy = await api(`/api/projects/${projectId}/privacy`, { jar });
    assert.equal(privacy.status, 200);
    assert.equal(privacy.payload.total, 4, "the counters must be summed up");
    const emailCounter = privacy.payload.counters.find((row) => row.category === "email");
    assert.equal(emailCounter.count, 3);
    assert.ok(privacy.payload.rules.sensitiveKeys, "the rules must be visible");

    const test = await api(`/api/projects/${projectId}/privacy/test`, { jar, method: "POST" });
    assert.equal(test.status, 200);
    assert.ok(test.payload.blocked > 0, "the fabricated values must be blocked");
    assert.ok(
      test.payload.samples.some((sample) => sample.blockedByKey.includes("password")),
      "the password field must be reported as blocked",
    );
  });

  it("drops the sensitive values of a payload on the server as well", async () => {
    const hostname = `privacy-server-${RUN}.example.com`;
    await collect(`https://${hostname}`, [
      {
        type: "event",
        name: "signup",
        path: "/",
        ts: Date.now(),
        session: "s_server_1",
        props: { email: "leak@example.com", plan: "pro" },
      },
    ]);
    const summary = await fetch(`${BASE}/api/analytics/summary?range=24h`, {
      headers: { origin: `https://${hostname}`, referer: `https://${hostname}/` },
    });
    const payload = await summary.json();
    const custom = payload.customEvents.find((entry) => entry.name === "signup");
    assert.ok(custom, "the event must be stored");
    const raw = JSON.stringify(payload);
    assert.ok(!raw.includes("leak@example.com"), "the e-mail must never reach the database");
  });
});
