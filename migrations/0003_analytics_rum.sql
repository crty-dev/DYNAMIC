-- DYNAMIC v2 — analytics + RUM dimensions, sessions, goals, retention & quota.
--
-- Free-plan first: no table stores a row per pageview twice, breakdowns ride on
-- the existing (site_id, ts) index and the session table keeps visitor counts
-- cheap (one row per session instead of COUNT(DISTINCT) over events).

-- 1) Event dimensions. All nullable and short: no query strings, no paths of
--    referrers, no free-form payloads.
ALTER TABLE events ADD COLUMN referrer TEXT;         -- host only, e.g. "news.ycombinator.com"
ALTER TABLE events ADD COLUMN utm_source TEXT;
ALTER TABLE events ADD COLUMN utm_medium TEXT;
ALTER TABLE events ADD COLUMN utm_campaign TEXT;
ALTER TABLE events ADD COLUMN device TEXT;            -- desktop | mobile | tablet | bot
ALTER TABLE events ADD COLUMN browser TEXT;           -- chrome | safari | firefox | edge | other
ALTER TABLE events ADD COLUMN os TEXT;
ALTER TABLE events ADD COLUMN goal TEXT;              -- matched goal name, NULL when not a conversion

-- 2) Dedup: one row per (site, web-vitals metric id). The partial index keeps
--    non-vital events (no metric id) unaffected and still allows many NULLs.
DELETE FROM events
 WHERE metric_id IS NOT NULL
   AND id NOT IN (
     SELECT MIN(id) FROM events WHERE metric_id IS NOT NULL GROUP BY site_id, metric_id
   );

DROP INDEX IF EXISTS idx_events_metric_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_site_metric_id
  ON events (site_id, metric_id) WHERE metric_id IS NOT NULL;

-- 3) Sessions: one row per session. Visitor/session counts and the realtime
--    view read this small table instead of scanning the events table.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  pageviews INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  country TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  referrer TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_site_session ON sessions (site_id, session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_site_started ON sessions (site_id, started_at);

-- 4) Goals: named conversions, matched by event name or by path.
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  public_id TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  path TEXT,
  value REAL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_site_public ON goals (site_id, public_id);
CREATE INDEX IF NOT EXISTS idx_goals_site_name ON goals (site_id, name);

-- 5) Site settings: retention window and the Free-plan daily write guard.
ALTER TABLE sites ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE sites ADD COLUMN daily_event_limit INTEGER NOT NULL DEFAULT 25000;
ALTER TABLE sites ADD COLUMN events_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN counter_day TEXT;
