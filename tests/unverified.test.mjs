import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resetTestDatabase, TEST_CONFIG } from "./helpers/server.mjs";

/**
 * An account that has not proven its address may look, but it may not change
 * anything: the console sends it to the verification page, and the server
 * refuses the write routes as well. The client is not the boundary.
 *
 * The test server runs with the verification switched off
 * (AUTH_REQUIRE_EMAIL_VERIFICATION=0), otherwise an unverified account could
 * not sign in at all and the guard would be unreachable.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = Number(process.env.DYNAMIC_UNVERIFIED_TEST_PORT ?? 8795);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:5174";
const RUN = Date.now().toString(36);

let dev;

before(async () => {
  resetTestDatabase();
  const migrate = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "dynamic-test", "--local", "--config", TEST_CONFIG],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);

  dev = spawn(
    process.execPath,
    [
      WRANGLER,
      "dev",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--config",
      TEST_CONFIG,
      "--var",
      "DEV_MODE:1",
      "--var",
      "AUTH_REQUIRE_EMAIL_VERIFICATION:0",
      "--var",
      "AUTH_RATE_LIMIT_MAX:1000",
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

function createJar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies.entries()]
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    },
    capture(response) {
      for (const cookie of response.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || /expires=thu, 01 jan 1970/i.test(cookie)) cookies.delete(key);
        else cookies.set(key, value);
      }
    },
  };
}

async function api(route, { jar, method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      ...(method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" }),
      ...(jar ? { cookie: jar.header() } : {}),
      origin: ORIGIN,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  jar?.capture(response);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { status: response.status, payload };
}

describe("an account that did not verify its address", () => {
  it("may sign in but may not change anything", async () => {
    const address = `unverified-${RUN}@dynamic.local`;
    const jar = createJar();

    const registered = await api("/api/auth/sign-up/email", {
      jar,
      method: "POST",
      body: { email: address, password: "SuperSecret!2026", name: "Unverified" },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered.payload).slice(0, 200));
    assert.equal(registered.payload.user.emailVerified, false);

    const login = await api("/api/auth/sign-in/email", {
      jar,
      method: "POST",
      body: { email: address, password: "SuperSecret!2026" },
    });
    assert.equal(login.status, 200, JSON.stringify(login.payload).slice(0, 200));

    // Reading is allowed: the account may see its own (empty) list.
    const list = await api("/api/projects", { jar });
    assert.equal(list.status, 200);
    assert.deepEqual(list.payload.projects, []);

    // Writing is not: no project, no goal, no release marker.
    const create = await api("/api/projects", {
      jar,
      method: "POST",
      body: { name: "Kurumsal", hostname: `unverified-${RUN}.example.com` },
    });
    assert.equal(create.status, 403, JSON.stringify(create.payload).slice(0, 200));
    assert.equal(create.payload.error, "email_unverified");

    const release = await api("/api/projects/whatever/releases", {
      jar,
      method: "POST",
      body: { version: "1.0.0" },
    });
    assert.equal(release.status, 403);
    assert.equal(release.payload.error, "email_unverified");
  });
});
