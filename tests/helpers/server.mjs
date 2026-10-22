import fs from "node:fs";
import path from "node:path";

/**
 * The test server configuration.
 *
 * The tests use a separate local D1 database ("dynamic-test") so they never
 * touch the database a developer works with. Before a run the test database is
 * reset: the tests always start from the same, empty state.
 */

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const TEST_CONFIG = path.join(ROOT, "wrangler.test.jsonc");
const TEST_DB = "dynamic-test";

/** Removes the local state of the test database (and nothing else). */
export function resetTestDatabase() {
  const dir = path.join(ROOT, ".wrangler", "state", "v3", "d1");
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.includes(TEST_DB)) continue;
    const target = path.join(dir, entry);
    if (fs.statSync(target).isDirectory()) {
      for (const file of fs.readdirSync(target)) {
        if (file.includes(TEST_DB)) fs.rmSync(path.join(target, file), { force: true });
      }
    } else {
      fs.rmSync(target, { force: true });
    }
  }
}
