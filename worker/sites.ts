import type { Site } from "./env";

/**
 * The site (analytics project) queries.
 *
 * They live in their own module because both the ingest and the project
 * API need them: a project has to adopt the site that the ingest already
 * created for its domain, otherwise the console would look for a site row
 * that was never written.
 */

const SITE_COLUMNS =
  "id, public_id, name, origin, created_at, retention_days, daily_event_limit, events_today, counter_day";

export async function siteByOrigin(db: D1Database, origin: string): Promise<Site | null> {
  return db
    .prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE origin = ? LIMIT 1`)
    .bind(origin)
    .first<Site>();
}

export async function siteByKey(db: D1Database, key: string): Promise<Site | null> {
  return db
    .prepare(`SELECT ${SITE_COLUMNS} FROM sites WHERE public_id = ? LIMIT 1`)
    .bind(key)
    .first<Site>();
}
