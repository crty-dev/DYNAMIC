-- DYNAMIC v1 schema (Cloudflare D1)
-- Erken faz: temel tablolar + indeksler. row-read ekonomisi için dar selectler.

CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  ts INTEGER NOT NULL,
  metric TEXT NOT NULL,           -- LCP | INP | CLS | FCP | TTFB | custom
  value REAL,
  rating TEXT,                    -- good | needs-improvement | poor
  path TEXT,
  country TEXT,
  ua TEXT,
  session_id TEXT,
  metric_id TEXT,                 -- web-vitals id (dedup / aggregation)
  attribution TEXT                -- JSON blob (web-vitals attribution build)
);

CREATE INDEX idx_events_site_ts ON events (site_id, ts);
CREATE INDEX idx_events_site_metric_ts ON events (site_id, metric, ts);
CREATE INDEX idx_events_metric_id ON events (metric_id);

CREATE TABLE session_cache (
  hash TEXT PRIMARY KEY,
  site_id INTEGER NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX idx_session_cache_site_ts ON session_cache (site_id, ts);
