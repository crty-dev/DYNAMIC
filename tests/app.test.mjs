import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PORT = Number(process.env.DYNAMIC_APP_TEST_PORT ?? 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:5174";
/** Unique per run so the local D1 never collides with an earlier run. */
const RUN = Date.now().toString(36);
const email = (name) => `${name}-${RUN}@dynamic.local`;

/* ------------------------------------------------------------- test tools */

/** A tiny cookie jar so every request carries the session cookie. */
function createJar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
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

let dev;
let dns;
const dnsState = { records: {} };

before(async () => {
  // A local DNS-over-HTTPS mock so the verification flow is deterministic.
  dns = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const name = url.searchParams.get("name") ?? "";
    const answers = dnsState.records[name] ?? [];
    res.writeHead(200, { "content-type": "application/dns-json" });
    res.end(
      JSON.stringify({
        Status: answers.length ? 0 : 3,
        Question: [{ name, type: 16 }],
        Answer: answers.map((data) => ({ name, type: 16, data })),
      }),
    );
  });
  await new Promise((resolve) => dns.listen(0, "127.0.0.1", resolve));
  const dnsPort = dns.address().port;

  const migrate = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "dynamic", "--local"],
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
      "--var",
      `DNS_RESOLVER_URL:http://127.0.0.1:${dnsPort}/dns-query`,
      "--var",
      "AUTH_RATE_LIMIT_MAX:1000",
      "--var",
      "PROJECT_VERIFY_INTERVAL_MS:0",
      // The super admin account of this run. The address is promoted when it
      // signs in, so the panel can be tested end to end.
      "--var",
      `ADMIN_EMAILS:admin-${RUN}@dynamic.local`,
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
  dns?.close();
});

async function api(route, { jar, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      // Better Auth parses every non-GET body as JSON.
      ...(method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" }),
      ...(jar ? { cookie: jar.header() } : {}),
      origin: ORIGIN,
      ...headers,
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
  return { status: response.status, payload, response };
}

async function register(address, password = "SuperSecret!2026", name = "Test User") {
  const jar = createJar();
  const result = await api("/api/auth/sign-up/email", {
    jar,
    method: "POST",
    body: { email: address, password, name },
  });
  return { jar, result };
}

async function verify(address) {
  const mails = await api("/api/dev/mailbox");
  const mail = mails.payload.mails.find(
    (entry) => entry.to === address && entry.subject.includes("doğrulayın"),
  );
  assert.ok(mail, "a verification mail must be queued");
  const token = /verify-email\?token=([^&\s]+)/.exec(mail.text)[1];
  const result = await api(`/api/auth/verify-email?token=${token}`);
  assert.equal(result.status, 200, JSON.stringify(result.payload).slice(0, 200));
  return token;
}

async function signIn(jar, address, password = "SuperSecret!2026") {
  const result = await api("/api/auth/sign-in/email", {
    jar,
    method: "POST",
    body: { email: address, password },
  });
  return result;
}

async function mailbox() {
  const { payload } = await api("/api/dev/mailbox");
  return payload.mails ?? [];
}

/** A registered + verified account with an open session. */
async function verifiedAccount(name) {
  const address = email(name);
  const { jar, result } = await register(address);
  assert.equal(result.status, 200, JSON.stringify(result.payload).slice(0, 200));
  await verify(address);
  const login = await signIn(jar, address);
  assert.equal(login.status, 200, JSON.stringify(login.payload).slice(0, 200));
  return { jar, address };
}

/** The id of an account inside the super admin user list. */
function normalRowId(users, address) {
  const row = (users.payload.users ?? []).find((u) => u.email === address);
  assert.ok(row, `${address} must be listed`);
  return row.id;
}

/* ------------------------------------------------------------------ tests */

describe("DYNAMIC application API", () => {
  it("registers a user but does not create a session before the e-mail is verified", async () => {
    const address = email("owner");
    const { result } = await register(address);
    assert.equal(result.status, 200, JSON.stringify(result.payload).slice(0, 200));
    assert.equal(result.payload.user.emailVerified, false);
    assert.equal(result.payload.token, null, "no session may be created before the verification");

    const mails = await mailbox();
    const verification = mails.find((mail) => mail.to === address);
    assert.ok(verification, "a verification mail must be queued");
    assert.match(verification.text, /verify-email\?token=/);
  });

  it("refuses to sign in while the e-mail is unverified", async () => {
    const address = email("unverified");
    await register(address);
    const signInResult = await signIn(createJar(), address);
    assert.equal(signInResult.status, 403, JSON.stringify(signInResult.payload).slice(0, 200));
    assert.equal(signInResult.payload.code, "EMAIL_NOT_VERIFIED");
  });

  it("reports whether the deployment can send mail", async () => {
    const result = await api("/api/auth/mail-status");
    assert.equal(result.status, 200);
    // The test server has no mail provider, so the address check is off.
    assert.equal(result.payload.enabled, false);
    assert.equal(result.payload.verificationRequired, false);
  });

  it("lists the social providers that are configured", async () => {
    // The test server has no OAuth credentials, so no provider may show up.
    const result = await api("/api/auth/providers");
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload.providers, []);
  });

  it("keeps the super admin surface behind the role", async () => {
    // Without a session nothing is exposed.
    const anonymous = await api("/api/super/overview");
    assert.equal(anonymous.status, 401);

    // A normal account is authenticated but not an admin.
    const normal = await verifiedAccount("normal");
    const normalCall = await api("/api/super/overview", { jar: normal.jar });
    assert.equal(normalCall.status, 403);

    // The address in ADMIN_EMAILS is promoted when it signs in.
    const admin = await verifiedAccount("admin");
    const overview = await api("/api/super/overview", { jar: admin.jar });
    assert.equal(overview.status, 200, JSON.stringify(overview.payload).slice(0, 200));
    assert.ok(overview.payload.totals.users >= 2);
    assert.ok(overview.payload.totals.admins >= 1);

    const users = await api("/api/super/users", { jar: admin.jar });
    assert.equal(users.status, 200);
    const adminRow = users.payload.users.find((u) => u.email === admin.address);
    assert.ok(adminRow, "the admin account must be listed");
    assert.equal(adminRow.role, "admin");

    // A second account can be promoted and demoted again.
    const promote = await api(`/api/super/users/${normalRowId(users, normal.address)}/role`, {
      jar: admin.jar,
      method: "POST",
      body: { role: "admin" },
    });
    assert.equal(promote.status, 200, JSON.stringify(promote.payload).slice(0, 200));

    const demote = await api(`/api/super/users/${normalRowId(users, normal.address)}/role`, {
      jar: admin.jar,
      method: "POST",
      body: { role: "user" },
    });
    assert.equal(demote.status, 200);
  });

  it("verifies the e-mail, opens a secure session and signs out again", async () => {    const address = email("verified");
    const { jar } = await register(address);
    await verify(address);

    const login = await signIn(jar, address);
    assert.equal(login.status, 200, JSON.stringify(login.payload).slice(0, 400));
    assert.equal(login.payload.user.emailVerified, true);

    const cookie = login.response.headers
      .getSetCookie()
      .find((entry) => entry.includes("session_token"));
    assert.ok(cookie, "a session cookie must be set");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const session = await api("/api/auth/get-session", { jar });
    assert.equal(session.status, 200);
    assert.equal(session.payload.user.email, address);

    const out = await api("/api/auth/sign-out", { jar, method: "POST", body: {} });
    assert.equal(out.status, 200);
    const signedOut = await api("/api/auth/get-session", { jar });
    assert.equal(signedOut.payload, null, "the session must be gone after signing out");
  });

  it("accepts a password reset token once and rejects the reuse", async () => {
    const address = email("reset");
    const { jar } = await register(address);
    await verify(address);

    const requested = await api("/api/auth/request-password-reset", {
      method: "POST",
      body: { email: address, redirectTo: "/reset-password" },
    });
    assert.equal(requested.status, 200, JSON.stringify(requested.payload).slice(0, 200));

    const mails = await mailbox();
    const mail = mails.find((entry) => entry.to === address && entry.subject.includes("sıfırlama"));
    assert.ok(mail, "a reset mail must be queued");
    const token = /reset-password\/([^?&\s]+)/.exec(mail.text)?.[1];
    assert.ok(token, `the reset mail must contain a token link: ${mail.text.slice(0, 200)}`);

    const first = await api("/api/auth/reset-password", {
      jar,
      method: "POST",
      body: { newPassword: "AnotherSecret!2026", token },
    });
    assert.equal(first.status, 200, JSON.stringify(first.payload).slice(0, 200));

    const reuse = await api("/api/auth/reset-password", {
      jar,
      method: "POST",
      body: { newPassword: "ThirdSecret!2026", token },
    });
    assert.equal(reuse.status, 400, "a reset token may only be used once");
  });

  it("rejects an invalid reset token", async () => {
    const { jar } = await register(email("invalid"));
    const result = await api("/api/auth/reset-password", {
      jar,
      method: "POST",
      body: { newPassword: "AnotherSecret!2026", token: "not-a-real-token" },
    });
    assert.equal(result.status, 400);
  });

  it("requires a session for the project API", async () => {
    const list = await api("/api/projects");
    assert.equal(list.status, 401);
    const create = await api("/api/projects", {
      method: "POST",
      body: { name: "Anonim", hostname: "anon.example.dev" },
    });
    assert.equal(create.status, 401);
  });

  it("creates a project with a DNS record and keeps it isolated", async () => {
    const owner = await verifiedAccount("projects");
    const created = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "Blog", hostname: `Blog-${RUN}.CRTY-DEV.com` },
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload).slice(0, 200));
    const project = created.payload.project;
    assert.equal(project.hostname, `blog-${RUN}.crty-dev.com`, "the hostname must be normalised");
    assert.equal(project.status, "pending");
    assert.equal(project.record.type, "TXT");
    assert.equal(project.record.name, `_dynamic-verification.blog-${RUN}.crty-dev.com`);
    assert.match(project.record.value, /^dynamic-verification=[0-9a-f]{48}$/);

    const list = await api("/api/projects", { jar: owner.jar });
    assert.equal(list.payload.projects.length, 1);

    // Another account may not see or touch the project.
    const intruder = await verifiedAccount("intruder");
    const otherList = await api("/api/projects", { jar: intruder.jar });
    assert.equal(otherList.payload.projects.length, 0, "projects must not leak across accounts");
    const read = await api(`/api/projects/${project.id}`, { jar: intruder.jar });
    assert.equal(read.status, 404);
    const remove = await api(`/api/projects/${project.id}?confirm=${project.id}`, {
      jar: intruder.jar,
      method: "DELETE",
    });
    assert.equal(remove.status, 404);
  });

  it("rejects an invalid or duplicate hostname", async () => {
    const owner = await verifiedAccount("hostnames");

    const invalid = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "IP", hostname: "127.0.0.1" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.payload.error, "invalid_hostname");

    const first = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "Tek", hostname: `tek-${RUN}.crty-dev.com` },
    });
    assert.equal(first.status, 201);

    const duplicate = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "Tek 2", hostname: `tek-${RUN}.crty-dev.com` },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.payload.error, "hostname_taken");
  });

  it("verifies a domain only when the TXT record matches", async () => {
    const owner = await verifiedAccount("dns");
    const created = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "DNS", hostname: `dns-${RUN}.crty-dev.com` },
    });
    const project = created.payload.project;

    // 1) the record is missing
    const missing = await api(`/api/projects/${project.id}/verify`, {
      jar: owner.jar,
      method: "POST",
    });
    assert.equal(missing.status, 200, JSON.stringify(missing.payload).slice(0, 300));
    assert.equal(missing.status, 200);
    assert.equal(missing.payload.project.status, "pending");
    assert.ok(missing.payload.project.error, "a missing record must be reported");
    assert.equal(missing.payload.project.attempts, 1, JSON.stringify(missing.payload).slice(0, 400));

    // 2) the record exists but has the wrong value
    dnsState.records[project.record.name] = ['"dynamic-verification=wrong-token"'];
    const wrong = await api(`/api/projects/${project.id}/verify`, {
      jar: owner.jar,
      method: "POST",
    });
    assert.equal(wrong.payload.project.status, "pending");
    assert.equal(wrong.payload.project.error, "record_not_found");

    // 3) the correct record verifies the project
    dnsState.records[project.record.name] = [`"${project.record.value}"`];
    const verified = await api(`/api/projects/${project.id}/verify`, {
      jar: owner.jar,
      method: "POST",
    });
    assert.equal(verified.payload.project.status, "verified");
    assert.equal(verified.payload.project.verifiedAt !== null, true);

    // 4) the verification is rate limited (20 checks per hour)
    let limited = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await api(`/api/projects/${project.id}/verify`, {
        jar: owner.jar,
        method: "POST",
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    assert.ok(limited, "the verification must be rate limited");
    assert.equal(limited.payload.error, "rate_limited");
  });

  it("deletes a project only with an explicit confirmation", async () => {
    const owner = await verifiedAccount("delete");
    const created = await api("/api/projects", {
      jar: owner.jar,
      method: "POST",
      body: { name: "Sil", hostname: `sil-${RUN}.crty-dev.com` },
    });
    const project = created.payload.project;

    const refused = await api(`/api/projects/${project.id}`, {
      jar: owner.jar,
      method: "DELETE",
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.payload.error, "confirmation_required");

    const deleted = await api(`/api/projects/${project.id}?confirm=${project.id}`, {
      jar: owner.jar,
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
    const list = await api("/api/projects", { jar: owner.jar });
    assert.equal(list.payload.projects.length, 0);
  });
});

/* ------------------------------------------------------- production config */

describe("production configuration", () => {
  it("declares the public variables the application needs", () => {
    const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    for (const key of [
      "APP_URL",
      "MARKETING_URL",
      "MAX_SITES",
      "CLOUDINARY_CLOUD_NAME",
      "AUTH_IP_HEADERS",
    ]) {
      assert.ok(wrangler.includes(key), `wrangler.jsonc must declare ${key}`);
    }
  });

  it("documents every secret without committing one", () => {
    const example = fs.readFileSync(path.join(ROOT, ".dev.vars.example"), "utf8");
    for (const key of [
      "BETTER_AUTH_SECRET",
      "MEDIA_UPLOAD_TOKEN",
      "ADMIN_API_KEY",
      "CLOUDINARY_URL",
    ]) {
      assert.ok(example.includes(key), `.dev.vars.example must document ${key}`);
    }
    const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout;
    assert.ok(!tracked.includes(".dev.vars\n"), "the real .dev.vars must never be tracked");
  });
});
