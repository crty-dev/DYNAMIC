import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The auth rate limiter buckets requests per client IP, so the IP header
 * configuration decides whether a visitor can be tracked at all.
 *
 * The Worker reads the address from `cf-connecting-ip` (Cloudflare overwrites
 * it at the edge). A visitor controlled `x-forwarded-for` must therefore never
 * influence the bucket, otherwise the limit could be bypassed.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = Number(process.env.DYNAMIC_AUTH_TEST_PORT ?? 8792);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:5174";

let dev;

before(async () => {
  await assertPortFree();
  const migrate = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "dynamic", "--local"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);

  // Two attempts per minute and IP: small enough to observe the limit.
  dev = spawn(
    process.execPath,
    [
      WRANGLER,
      "dev",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--var",
      "AUTH_RATE_LIMIT_MAX:2",
    ],
    { cwd: ROOT, stdio: "ignore" },
  );

  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("wrangler dev did not become ready");
});

after(() => {
  dev?.kill();
});

/** A failed sign in: the request still counts towards the rate limit. */
async function signIn(headers = {}) {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...headers,
    },
    body: JSON.stringify({
      email: `nobody-${Math.random().toString(36).slice(2)}@dynamic.local`,
      password: "SuperSecret!2026",
    }),
  });
  return response.status;
}

/** Refuses to start when the port is already in use. */
async function assertPortFree() {
  try {
    const response = await fetch(`${BASE}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok || response.status === 404) {
      throw new Error(
        `Port ${PORT} is already in use - stop the other dev server first.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("already in use")) throw error;
    // Nothing is listening: the port is free.
  }
}

describe("auth rate limiting", () => {
  it("counts every client IP in its own bucket", async () => {
    const ip = "198.51.100.10";
    assert.equal(await signIn({ "cf-connecting-ip": ip }), 401);
    assert.equal(await signIn({ "cf-connecting-ip": ip }), 401);
    assert.equal(await signIn({ "cf-connecting-ip": ip }), 429);

    // A different address starts with a full budget.
    assert.equal(await signIn({ "cf-connecting-ip": "198.51.100.11" }), 401);
  });

  it("ignores a visitor supplied x-forwarded-for header", async () => {
    const ip = "198.51.100.12";
    assert.equal(await signIn({ "cf-connecting-ip": ip }), 401);
    assert.equal(await signIn({ "cf-connecting-ip": ip }), 401);
    assert.equal(await signIn({ "cf-connecting-ip": ip }), 429);

    // The spoofed header points at the exhausted bucket. If it were trusted
    // the request would be blocked as well - it must not be.
    assert.equal(await signIn({ "x-forwarded-for": ip }), 401);
  });
});
