/**
 * The data access of the three signature features: Change Radar, Privacy
 * Gate and Fix-to-Proof. Every query is scoped by `site_id`, so a tenant
 * can only ever read its own rows.
 */
import type { DimensionedSample, Sample } from "./release-rules";

export type ReleaseRow = {
  id: number;
  site_id: number;
  version: string;
  deployed_at: number;
  created_at: number;
  source: string;
};

/** The release markers of a site, newest first. */
export async function listReleases(db: D1Database, siteId: number): Promise<ReleaseRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, site_id, version, deployed_at, created_at, source
         FROM releases WHERE site_id = ? ORDER BY deployed_at DESC LIMIT 50`,
    )
    .bind(siteId)
    .all<ReleaseRow>();
  return results;
}

/** The release with a given id (scoped to the site). */
export async function releaseById(
  db: D1Database,
  siteId: number,
  id: number,
): Promise<ReleaseRow | null> {
  return await db
    .prepare(
      `SELECT id, site_id, version, deployed_at, created_at, source
         FROM releases WHERE id = ? AND site_id = ? LIMIT 1`,
    )
    .bind(id, siteId)
    .first<ReleaseRow>();
}

/**
 * Stores a release marker.
 *
 * The first time a version is seen its deployment moment is kept: the SDK
 * repeats the marker on every page view, but the release stays one point in
 * time.
 */
export async function upsertRelease(
  db: D1Database,
  siteId: number,
  version: string,
  deployedAt: number,
  source: string,
): Promise<ReleaseRow> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO releases (site_id, version, deployed_at, created_at, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (site_id, version) DO NOTHING`,
    )
    .bind(siteId, version, deployedAt, now, source)
    .run();
  const row = await db
    .prepare(
      `SELECT id, site_id, version, deployed_at, created_at, source
         FROM releases WHERE site_id = ? AND version = ? LIMIT 1`,
    )
    .bind(siteId, version)
    .first<ReleaseRow>();
  if (!row) throw new Error("release_not_stored");
  return row;
}

/** The measurements of one metric in a time window, with their dimensions. */
/**
 * The number of samples the radar reads per metric and window.
 *
 * The Free plan allows five million rows a day, so a dashboard that reads
 * every sample of every metric would eat the daily budget with a handful of
 * views. The p75 of the most recent 5,000 samples is stable, and the response
 * says when a scan was truncated.
 */
export const RADAR_SCAN_LIMIT = 5000;

/**
 * The measurements of one metric in a window, with their dimensions.
 */
export async function metricSamples(
  db: D1Database,
  siteId: number,
  metric: string,
  from: number,
  to: number,
  limit = RADAR_SCAN_LIMIT,
): Promise<DimensionedSample[]> {
  const { results } = await db
    .prepare(
      `SELECT ts, value, path, device, browser
         FROM events
        WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
        ORDER BY ts DESC LIMIT ?`,
    )
    .bind(siteId, metric, from, to, limit)
    .all<{ ts: number; value: number; path: string | null; device: string | null; browser: string | null }>();
  return results.map((row) => ({
    ts: row.ts,
    value: row.value,
    path: row.path ?? null,
    device: row.device ?? null,
    browser: row.browser ?? null,
  }));
}

/** The error count and the total number of measurements in a window. */
export async function errorCounts(
  db: D1Database,
  siteId: number,
  from: number,
  to: number,
): Promise<{ errors: number; total: number }> {
  const { results } = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN metric = 'js_error' THEN 1 ELSE 0 END) AS errors,
         COUNT(*) AS total
       FROM events WHERE site_id = ? AND ts >= ? AND ts < ?`,
    )
    .bind(siteId, from, to)
    .all<{ errors: number | null; total: number }>();
  const row = results[0];
  return { errors: row?.errors ?? 0, total: row?.total ?? 0 };
}

/** The measurements of a metric without the dimensions (for the fix check). */
export async function plainSamples(
  db: D1Database,
  siteId: number,
  metric: string,
  from: number,
  to: number,
  limit = RADAR_SCAN_LIMIT,
): Promise<Sample[]> {
  const { results } = await db
    .prepare(
      `SELECT ts, value FROM events
        WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
        ORDER BY ts DESC LIMIT ?`,
    )
    .bind(siteId, metric, from, to, limit)
    .all<{ ts: number; value: number }>();
  return results;
}

/* ---------------------------------------------------------------- privacy */

/** The Privacy Gate counters of a site. */
export async function privacyCounters(db: D1Database, siteId: number) {
  const { results } = await db
    .prepare(
      `SELECT category, count, updated_at FROM privacy_counters
        WHERE site_id = ? ORDER BY count DESC`,
    )
    .bind(siteId)
    .all<{ category: string; count: number; updated_at: number }>();
  return results;
}

/** Adds the counters of one batch to the stored ones. */
export async function addPrivacyCounters(
  db: D1Database,
  siteId: number,
  counters: Record<string, number>,
): Promise<void> {
  const entries = Object.entries(counters).filter(
    ([, value]) => Number.isFinite(value) && value > 0,
  );
  if (!entries.length) return;
  const now = Date.now();
  await db.batch(
    entries.map(([category, value]) =>
      db
        .prepare(
          `INSERT INTO privacy_counters (site_id, category, count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (site_id, category) DO UPDATE SET
             count = count + excluded.count,
             updated_at = excluded.updated_at`,
        )
        .bind(siteId, category.slice(0, 32), Math.floor(value), now),
    ),
  );
}

/* --------------------------------------------------------------- insights */
export type TimelinePoint = {
  t: number;
  samples: number;
  p75: number | null;
  avg: number | null;
};

/**
 * The per bucket p75 of a metric — the timeline of the Change Radar.
 *
 * The percentile is calculated in SQL (window function), so no rows are
 * transferred to the Worker.
 */
export async function metricTimeline(
  db: D1Database,
  siteId: number,
  metric: string,
  from: number,
  to: number,
  bucketMs: number,
  limit = RADAR_SCAN_LIMIT,
): Promise<TimelinePoint[]> {
  const { results } = await db
    .prepare(
      `WITH vals AS (
         SELECT CAST(ts / ? AS INTEGER) AS bucket, value FROM events
          WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
          LIMIT ?
       ),
       ranked AS (
         SELECT bucket, value,
                ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY value) AS rn,
                COUNT(*) OVER (PARTITION BY bucket) AS cnt
           FROM vals
       )
       SELECT bucket, MAX(cnt) AS samples, AVG(value) AS avg,
              MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INT) + 1 THEN value END) AS p75
         FROM ranked GROUP BY bucket ORDER BY bucket`,
    )
    .bind(bucketMs, siteId, metric, from, to, limit)
    .all<{ bucket: number; samples: number; avg: number | null; p75: number | null }>();
  return results.map((row) => ({
    t: row.bucket * bucketMs,
    samples: row.samples ?? 0,
    p75: row.p75 ?? null,
    avg: row.avg ?? null,
  }));
}

export type InsightRow = {
  id: number;
  site_id: number;
  fingerprint: string;
  kind: string;
  scope: string;
  title: string;
  severity: string;
  status: string;
  first_seen_at: number;
  last_seen_at: number;
  evidence: string | null;
  release_id: number | null;
  updated_at: number;
};

/** The stored issues of a site. */
export async function listInsights(db: D1Database, siteId: number): Promise<InsightRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, site_id, fingerprint, kind, scope, title, severity, status,
              first_seen_at, last_seen_at, evidence, release_id, updated_at
         FROM insights WHERE site_id = ? ORDER BY last_seen_at DESC LIMIT 100`,
    )
    .bind(siteId)
    .all<InsightRow>();
  return results;
}

/** Stores an issue, keeping the state of an issue that is already known. */
export async function upsertInsight(
  db: D1Database,
  siteId: number,
  issue: {
    fingerprint: string;
    kind: string;
    scope: string;
    title: string;
    severity: string;
    evidence: string;
  },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO insights
         (site_id, fingerprint, kind, scope, title, severity, status,
          first_seen_at, last_seen_at, evidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
       ON CONFLICT (site_id, fingerprint) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         title = excluded.title,
         severity = excluded.severity,
         evidence = excluded.evidence,
         updated_at = excluded.updated_at`,
    )
    .bind(
      siteId,
      issue.fingerprint,
      issue.kind,
      issue.scope,
      issue.title,
      issue.severity,
      now,
      now,
      issue.evidence,
      now,
    )
    .run();
}

/** Changes the state of an issue (scoped to the site). */
export async function updateInsightState(
  db: D1Database,
  siteId: number,
  fingerprint: string,
  status: string,
  releaseId: number | null,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE insights SET status = ?, release_id = ?, updated_at = ?
        WHERE site_id = ? AND fingerprint = ?`,
    )
    .bind(status, releaseId, now, siteId, fingerprint)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
