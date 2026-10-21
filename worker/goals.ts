/** A named conversion of a site. */
export type Goal = {
  id: number;
  public_id: string;
  name: string;
  label: string | null;
  path: string | null;
  value: number | null;
};

/**
 * The goals of a site.
 *
 * A goal is a named conversion: it matches an event by its name (or a path)
 * and the ingest writes the goal name into the event row. The definitions live
 * in their own module because the console and the admin API both need them.
 */
export async function goalsFor(db: D1Database, siteId: number): Promise<Goal[]> {
  const { results } = await db
    .prepare(
      `SELECT id, public_id, name, label, path, value FROM goals
        WHERE site_id = ? ORDER BY id DESC LIMIT 50`,
    )
    .bind(siteId)
    .all<Goal>();
  return results;
}
