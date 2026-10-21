import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSandbox } from "./helpers/sdk-sandbox.mjs";

/**
 * The release marker is a point in time, not a per-page-view event: a
 * snippet that calls `dynamic.release()` on every page view must not write a
 * row per page view.
 */
describe("SDK — release marker", () => {
  it("sends the marker once per version and session", async () => {
    const sessionStorage = new Map();
    const localStorage = new Map();
    const first = createSandbox({ sessionStorage, localStorage });

    first.win.dynamic.release("2026.10.4");
    await first.win.dynamic.flush();
    const markers = first.sent.flatMap((request) =>
      request.body.events.filter((event) => event.type === "release"),
    );
    assert.equal(markers.length, 1, "the marker must be sent once");
    assert.equal(markers[0].version, "2026.10.4");

    // The same page calls it again (a snippet in every template).
    first.win.dynamic.release("2026.10.4");
    await first.win.dynamic.flush();
    const again = first.sent.flatMap((request) =>
      request.body.events.filter((event) => event.type === "release"),
    );
    assert.equal(again.length, 1, "the marker must not be repeated");
  });

  it("tags the following measurements with the release", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.release("2026.10.4");
    win.dynamic.page();
    await win.dynamic.flush();

    const pageviews = sent[0].body.events.filter((event) => event.type === "pageview");
    // The first pageview comes from the auto start (before the release);
    // the one after the marker must carry the version.
    assert.equal(pageviews.at(-1)?.release, "2026.10.4", "the pageview must carry the release");
  });

  it("rejects an invalid version", async () => {
    const { win, sent } = createSandbox();
    win.dynamic.release("not a version!");
    win.dynamic.release("");
    await win.dynamic.flush();

    const markers = sent.flatMap((request) =>
      request.body.events.filter((event) => event.type === "release"),
    );
    assert.equal(markers.length, 0, "an invalid version must not be sent");
  });

  it("reads the release from the script tag", async () => {
    const { win, sent } = createSandbox({ release: "2026.10.5" });
    win.dynamic.page();
    await win.dynamic.flush();

    const pageview = sent[0].body.events.find((event) => event.type === "pageview");
    assert.equal(pageview?.release, "2026.10.5");
  });
});
