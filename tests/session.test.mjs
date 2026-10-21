import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSandbox } from "./helpers/sdk-sandbox.mjs";

/**
 * The session id lives in sessionStorage, so a reload inside the same tab
 * must not create a new session — otherwise the visitor count explodes and
 * the session based reports are worthless.
 */
describe("SDK — session continuity", () => {
  it("keeps the session id across a page reload", async () => {
    const sessionStorage = new Map();
    const localStorage = new Map();

    const first = createSandbox({ sessionStorage, localStorage });
    first.win.dynamic.page();
    await first.win.dynamic.flush();
    const firstEvent = first.sent[0].body.events.find((event) => event.type === "pageview");
    assert.ok(firstEvent?.session, "the pageview must carry a session id");

    // A reload: a fresh SDK instance, the same sessionStorage.
    const second = createSandbox({ sessionStorage, localStorage });
    second.win.dynamic.page();
    await second.win.dynamic.flush();
    const secondEvent = second.sent[0].body.events.find((event) => event.type === "pageview");

    assert.equal(
      secondEvent?.session,
      firstEvent.session,
      "the session id must survive the reload",
    );
  });

  it("rotates the session id after the idle time", async () => {
    const sessionStorage = new Map();
    const localStorage = new Map();

    const first = createSandbox({ sessionStorage, localStorage });
    first.win.dynamic.page();
    await first.win.dynamic.flush();
    const firstSession = first.sent[0].body.events.find((event) => event.type === "pageview").session;

    // The stored session is older than the 30 minute idle window.
    const createdAt = Number(sessionStorage.get("dynamic_sid_at"));
    sessionStorage.set("dynamic_sid_at", String(createdAt - 31 * 60 * 1000));

    const second = createSandbox({ sessionStorage, localStorage });
    second.win.dynamic.page();
    await second.win.dynamic.flush();
    const secondSession = second.sent[0].body.events.find((event) => event.type === "pageview").session;

    assert.notEqual(secondSession, firstSession, "an idle session must be rotated");
  });

  it("starts a new session when the storage was cleared", async () => {
    const sessionStorage = new Map();
    const localStorage = new Map();

    const first = createSandbox({ sessionStorage, localStorage });
    first.win.dynamic.page();
    await first.win.dynamic.flush();
    const firstSession = first.sent[0].body.events.find((event) => event.type === "pageview").session;

    sessionStorage.clear();

    const second = createSandbox({ sessionStorage, localStorage });
    second.win.dynamic.page();
    await second.win.dynamic.flush();
    const secondSession = second.sent[0].body.events.find((event) => event.type === "pageview").session;

    assert.notEqual(secondSession, firstSession, "a cleared storage starts a new session");
  });
});
