import type { Site } from "./env";

/* ==========================================================================
   Analytics aggregates — shared by the public report endpoints and the
   authenticated project endpoints.
   ========================================================================== */

export const RANGES = {
  "24h": { windowMs: 24 * 3600_000, bucketMs: 3600_000, buckets: 24 },
  "7d": { windowMs: 7 * 86400_000, bucketMs: 86400_000, buckets: 7 },
  "30d": { windowMs: 30 * 86400_000, bucketMs: 86400_000, buckets: 30 },
  "90d": { windowMs: 90 * 86400_000, bucketMs: 86400_000, buckets: 90 },
} as const;

export type RangeKey = keyof typeof RANGES;

export const MIN_P75_SAMPLES = 20;

/**
 * Percentile window size. The scan is bounded to the most recent N samples so
 * a busy site cannot burn the daily D1 row budget with one dashboard poll.
 * When the cap is hit the response says so (`sampled: true`).
 */
export const RUM_SCAN_LIMIT = 20000;

export function resolveRange(value: string | undefined): RangeKey {
  const key = (value ?? "7d").toLowerCase();
  return key in RANGES ? (key as RangeKey) : "7d";
}

/** Number of buckets: the full window plus the current (partial) bucket. */
export function bucketCount(range: RangeKey): number {
  const { windowMs, bucketMs } = RANGES[range];
  return Math.ceil(windowMs / bucketMs) + 1;
}

export function emptySeries(buckets: number, bucketMs: number, from: number) {
  const first = Math.floor(from / bucketMs);
  return Array.from({ length: buckets }, (_, index) => ({
    t: (first + index) * bucketMs,
    pageviews: 0,
    visitors: 0,
    events: 0,
  }));
}

const VITAL_METRIC_LIST = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export { VITAL_METRIC_LIST };

/**
 * The full analytics summary for one site. Every query is scoped by
 * `site_id` and a time window, and every breakdown is LIMIT-ed.
 */
export async function analyticsSummary(
  db: D1Database,
  site: Site,
  range: RangeKey,
): Promise<Record<string, unknown>> {
  const { windowMs, bucketMs } = RANGES[range];
  const buckets = bucketCount(range);
  const now = Date.now();
  const from = now - windowMs;

  const [
    metricRows,
    sessionRows,
    seriesRows,
    sessionSeries,
    pageRows,
    referrerRows,
    campaignRows,
    deviceRows,
    goalRows,
    customRows,
    countryRows,
    liveCount,
    liveSessions,
    livePages,
  ] = await Promise.all([
    db.prepare(
      `SELECT metric, COUNT(*) AS n,
              SUM(CASE WHEN goal IS NOT NULL THEN 1 ELSE 0 END) AS conversions
         FROM events WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY metric`,
    )
      .bind(site.id, from, now)
      .all<{ metric: string; n: number; conversions: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT session_id) AS visitors FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ?",
    )
      .bind(site.id, from, now)
      .all<{ n: number; visitors: number }>(),
    db.prepare(
      `SELECT CAST(ts / ? AS INTEGER) AS bucket, metric, COUNT(*) AS n
         FROM events WHERE site_id = ? AND ts >= ? AND ts < ? GROUP BY bucket, metric`,
    )
      .bind(bucketMs, site.id, from, now)
      .all<{ bucket: number; metric: string; n: number }>(),
    db.prepare(
      `SELECT CAST(started_at / ? AS INTEGER) AS bucket, COUNT(*) AS n
         FROM sessions WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY bucket`,
    )
      .bind(bucketMs, site.id, from, now)
      .all<{ bucket: number; n: number }>(),
    db.prepare(
      `SELECT path, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND path IS NOT NULL
        GROUP BY path ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ path: string; n: number }>(),
    db.prepare(
      `SELECT referrer, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND referrer IS NOT NULL
        GROUP BY referrer ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ referrer: string; n: number }>(),
    db.prepare(
      `SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, COUNT(*) AS n
         FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND ts < ? AND utm_campaign IS NOT NULL
        GROUP BY utm_source, utm_medium, utm_campaign ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ source: string | null; medium: string | null; campaign: string | null; n: number }>(),
    db.prepare(
      `SELECT device, browser, os, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ?
        GROUP BY device, browser, os ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ device: string; browser: string; os: string; n: number }>(),
    db.prepare(
      `SELECT goal AS name, COUNT(*) AS n, SUM(COALESCE(value, 0)) AS value FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND goal IS NOT NULL
        GROUP BY goal ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ name: string; n: number; value: number }>(),
    db.prepare(
      `SELECT metric AS name, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ?
          AND metric NOT IN ('pageview','LCP','INP','CLS','FCP','TTFB')
        GROUP BY metric ORDER BY n DESC LIMIT 10`,
    )
      .bind(site.id, from, now)
      .all<{ name: string; n: number }>(),
    db.prepare(
      `SELECT country, COUNT(*) AS n FROM events
        WHERE site_id = ? AND ts >= ? AND ts < ? AND country IS NOT NULL
        GROUP BY country ORDER BY n DESC LIMIT 6`,
    )
      .bind(site.id, from, now)
      .all<{ country: string; n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND ts >= ?").bind(site.id, now - 30 * 60_000).all<{ n: number }>(),
    db.prepare(
      "SELECT COUNT(DISTINCT session_id) AS n FROM sessions WHERE site_id = ? AND last_seen_at >= ?",
    )
      .bind(site.id, now - 30 * 60_000)
      .all<{ n: number }>(),
    db.prepare(
      `SELECT path, COUNT(*) AS n FROM events
        WHERE site_id = ? AND metric = 'pageview' AND ts >= ? AND path IS NOT NULL
        GROUP BY path ORDER BY n DESC LIMIT 5`,
    )
      .bind(site.id, now - 30 * 60_000)
      .all<{ path: string; n: number }>(),
  ]);

  const totals = {
    pageviews: 0,
    visitors: 0,
    sessions: 0,
    events: 0,
    customEvents: 0,
    conversions: 0,
    goals: 0,
  };
  for (const row of metricRows.results) {
    totals.events += row.n;
    totals.conversions += row.conversions ?? 0;
    if (row.metric === "pageview") totals.pageviews += row.n;
    else if (!VITAL_METRIC_LIST.includes(row.metric as (typeof VITAL_METRIC_LIST)[number])) {
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

  return {
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
  };
}

export type VitalStats = {
  metric: string;
  samples: number;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  good: number;
  needsImprovement: number;
  poor: number;
  sufficient: boolean;
  sampled: boolean;
  note?: string;
};

/**
 * Percentiles are computed in SQL with a window function (no row transfer).
 * When there are too few samples the percentile stays null on purpose —
 * an invented number is worse than "not enough data".
 */
export async function vitalStats(
  db: D1Database,
  siteId: number,
  metric: string,
  from: number,
  now: number,
): Promise<VitalStats> {
  const { results } = await db
    .prepare(
      `WITH vals AS (
         SELECT value, rating FROM events
          WHERE site_id = ? AND metric = ? AND ts >= ? AND ts < ? AND value IS NOT NULL
          ORDER BY ts DESC
          LIMIT ?
       ),
       ranked AS (
         SELECT value, rating,
                ROW_NUMBER() OVER (ORDER BY value) AS rn,
                COUNT(*) OVER () AS cnt
           FROM vals
       )
       SELECT MAX(cnt) AS samples,
              AVG(value) AS avg,
              MAX(CASE WHEN rn = CAST((cnt - 1) * 0.50 AS INT) + 1 THEN value END) AS p50,
              MAX(CASE WHEN rn = CAST((cnt - 1) * 0.75 AS INT) + 1 THEN value END) AS p75,
              SUM(CASE WHEN rating = 'good' THEN 1 ELSE 0 END) AS good,
              SUM(CASE WHEN rating = 'needs-improvement' THEN 1 ELSE 0 END) AS ni,
              SUM(CASE WHEN rating = 'poor' THEN 1 ELSE 0 END) AS poor
         FROM ranked`,
    )
    .bind(siteId, metric, from, now, RUM_SCAN_LIMIT)
    .all<{
      samples: number;
      avg: number | null;
      p50: number | null;
      p75: number | null;
      good: number | null;
      ni: number | null;
      poor: number | null;
    }>();

  const row = results[0];
  const samples = row?.samples ?? 0;
  const sufficient = samples >= MIN_P75_SAMPLES;
  const sampled = samples >= RUM_SCAN_LIMIT;

  return {
    metric,
    samples,
    avg: row?.avg ?? null,
    p50: sufficient ? row?.p50 ?? null : null,
    p75: sufficient ? row?.p75 ?? null : null,
    good: row?.good ?? 0,
    needsImprovement: row?.ni ?? 0,
    poor: row?.poor ?? 0,
    sufficient,
    sampled,
    ...(sampled
      ? {
          note: `Computed over the most recent ${RUM_SCAN_LIMIT} samples (older ones are not scanned).`,
        }
      : sufficient
        ? {}
        : { note: `At least ${MIN_P75_SAMPLES} samples are needed for a percentile; ${samples} collected.` }),
  };
}

/** RUM summary for one site (same shape as /api/rum/summary). */
export async function rumSummary(db: D1Database, siteId: number, range: RangeKey) {
  const { windowMs } = RANGES[range];
  const now = Date.now();
  const from = now - windowMs;
  const metrics = await Promise.all(
    VITAL_METRIC_LIST.map((metric) => vitalStats(db, siteId, metric, from, now)),
  );
  return {
    ok: true,
    range,
    generatedAt: now,
    minSamples: MIN_P75_SAMPLES,
    sampleLimit: RUM_SCAN_LIMIT,
    metrics,
  };
}
