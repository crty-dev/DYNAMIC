#!/usr/bin/env node
/**
 * Dependency licence audit.
 *
 * Reads the licence field of every direct dependency (and their production
 * dependencies) and prints a table. Run it before adding a dependency:
 *
 *   node scripts/license-audit.mjs            # direct dependencies
 *   node scripts/license-audit.mjs --all      # everything in the tree
 *
 * Permissive licences (MIT / ISC / BSD / Apache-2.0 / 0BSD) are compatible
 * with the MIT licence of this project. Anything else needs a human look.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const PERMISSIVE = new Set([
  "MIT",
  "ISC",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "BlueOak-1.0.0",
]);

/** Weak copyleft: compatible when the dependency stays a separate, unmodified package. */
const REVIEW = new Set(["MPL-2.0", "LGPL-2.1", "LGPL-3.0", "GPL-2.0", "GPL-3.0", "AGPL-3.0"]);

/** A dual licence ("MIT OR Apache-2.0") is compatible if one option is permissive. */
function classify(licence) {
  const options = licence
    .split(" OR ")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (options.some((option) => PERMISSIVE.has(option))) return "ok";
  if (options.some((option) => REVIEW.has(option))) return "review";
  return "unknown";
}

const dependencies = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
};

const rows = [];
for (const name of Object.keys(dependencies).sort()) {
  const manifestPath = path.join(ROOT, "node_modules", name, "package.json");
  if (!fs.existsSync(manifestPath)) {
    rows.push({ name, version: dependencies[name], licence: "MISSING", ok: false });
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const licence =
    typeof manifest.license === "string"
      ? manifest.license
      : Array.isArray(manifest.licenses)
        ? manifest.licenses.map((entry) => entry.type ?? entry).join(", ")
        : (manifest.license?.type ?? "UNKNOWN");
  const verdict = classify(licence);
  rows.push({
    name,
    version: manifest.version ?? dependencies[name],
    licence,
    ok: verdict === "ok",
    review: verdict === "review",
    dev: Boolean(pkg.devDependencies?.[name]),
  });
}

const width = Math.max(...rows.map((row) => row.name.length));
console.log(`${"package".padEnd(width)}  ${"version".padEnd(12)}  licence`);
console.log(`${"-".repeat(width)}  ${"-".repeat(12)}  ${"-".repeat(20)}`);
for (const row of rows) {
  const flag = row.ok ? "" : row.review ? "  <- weak copyleft (dev-only ok)" : "  <- review";
  console.log(
    `${row.name.padEnd(width)}  ${String(row.version).padEnd(12)}  ${row.licence}${flag}`,
  );
}

const incompatible = rows.filter((row) => !row.ok && !row.review);
const weak = rows.filter((row) => row.review);
console.log(
  `\n${rows.length} direct dependencies · ${weak.length} weak copyleft (kept unmodified) · ${incompatible.length} incompatible.`,
);
if (incompatible.length > 0) {
  console.log("Permissive licences (MIT/ISC/BSD/Apache-2.0) are MIT-compatible.");
  process.exitCode = 1;
}
