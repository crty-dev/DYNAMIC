import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

describe("production build", () => {
  it("builds the site, the SDK and the worker bundle", () => {
    const build = spawnSync(
      process.execPath,
      [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    // The HTML shell ships the SDK and the app entry.
    const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    assert.match(html, /\/js\/dynamic\.js/);
    assert.match(html, /data-site=/);
    assert.match(html, /\/assets\/index-[^"]+\.js/);

    // The SDK is a small standalone bundle.
    const sdkPath = path.join(DIST, "js", "dynamic.js");
    assert.ok(fs.existsSync(sdkPath), "dist/js/dynamic.js should exist");
    const sdk = fs.readFileSync(sdkPath);
    const sdkGzip = zlib.gzipSync(sdk).length;
    assert.ok(sdkGzip < 30 * 1024, `SDK should stay small, got ${sdkGzip} bytes gzip`);

    // The public entry stays a reasonable size.
    const assets = fs.readdirSync(path.join(DIST, "assets"));
    const entry = assets.find((file) => /^index-.*\.js$/.test(file));
    assert.ok(entry, "an index bundle should exist");
    const entryGzip = zlib.gzipSync(fs.readFileSync(path.join(DIST, "assets", entry))).length;
    assert.ok(entryGzip < 180 * 1024, `entry bundle should stay under 180 KB gzip, got ${entryGzip}`);
  });
});
