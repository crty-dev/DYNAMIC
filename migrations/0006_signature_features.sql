-- DYNAMIC v6 — Change Radar, Privacy Gate and Fix-to-Proof.
--
-- Three features share one data model:
--   releases        : the version markers a developer publishes
--   events.release  : the measurements that belong to a release
--   insights        : the issues Fix-to-Proof found and their state
--   privacy_counters: how many payloads the Privacy Gate blocked, per category
--
-- Nothing here stores source code, commit messages or credentials: a
-- release is a version string and a timestamp, nothing else.

-- 1) Release markers -------------------------------------------------------
CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  version TEXT NOT NULL,
  deployed_at INTEGER NOT NULL,          -- when the release went live (ms)
  created_at INTEGER NOT NULL,           -- when DYNAMIC saw it (ms)
  source TEXT NOT NULL DEFAULT 'sdk'     -- sdk | manual
);

-- The same version is only stored once per site: the SDK may repeat a
-- marker on every page view, the marker itself stays a single point.
CREATE UNIQUE INDEX IF NOT EXISTS idx_releases_site_version ON releases (site_id, version);
CREATE INDEX IF NOT EXISTS idx_releases_site_deployed ON releases (site_id, deployed_at);

-- 2) Events carry the release they were measured in ------------------------
ALTER TABLE events ADD COLUMN release TEXT;
CREATE INDEX IF NOT EXISTS idx_events_site_release_ts ON events (site_id, release, ts);

-- 3) Fix-to-Proof: the issues and their state ------------------------------
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  fingerprint TEXT NOT NULL,       -- stable id of the issue (kind + scope)
  kind TEXT NOT NULL,              -- lcp | inp | cls | ttfb | errors
  scope TEXT NOT NULL,             -- "all" or a path / device / browser
  title TEXT NOT NULL,
  severity TEXT NOT NULL,          -- critical | warning | info
  status TEXT NOT NULL DEFAULT 'open', -- open | investigating | fixed | dismissed
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  evidence TEXT,                   -- JSON snapshot of the measurement
  release_id INTEGER REFERENCES releases(id),
  updated_at INTEGER NOT NULL
);

-- One row per issue per site: the state survives a new measurement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_site_fingerprint ON insights (site_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_insights_site_status ON insights (site_id, status);

-- 4) Privacy Gate counters -------------------------------------------------
-- Only counts, never a value: the console shows how much was blocked.
CREATE TABLE IF NOT EXISTS privacy_counters (
  site_id INTEGER NOT NULL REFERENCES sites(id),
  category TEXT NOT NULL,          -- email | token | creditcard | ...
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, category)
);
