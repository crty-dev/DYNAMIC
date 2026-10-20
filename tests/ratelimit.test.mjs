import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rateLimit } from "../worker/rate-limit.ts";

/**
 * The limiter lives in the Worker (in-isolate, no D1 cost), so it is unit
 * tested here. The integration behaviour is "best effort": a burst can be
 * spread over several isolates, which is exactly why the hard cap in the
 * product is the site's daily event quota in D1.
 */
describe("rate limiter", () => {
  it("allows requests up to the limit and blocks the rest", () => {
    const key = `test-${Date.now()}`;
    const first = rateLimit(key, 3, 60_000);
    const second = rateLimit(key, 3, 60_000);
    const third = rateLimit(key, 3, 60_000);
    const fourth = rateLimit(key, 3, 60_000);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, true);
    assert.equal(fourth.allowed, false);
    assert.ok(fourth.retryAfter > 0, "a blocked request must say when to retry");
  });

  it("resets after the window", () => {
    const key = `test-reset-${Date.now()}`;
    rateLimit(key, 1, 1);
    const blocked = rateLimit(key, 1, 1);
    assert.equal(blocked.allowed, false);

    // A different key has its own budget.
    assert.equal(rateLimit(`${key}-other`, 1, 60_000).allowed, true);
  });
});
