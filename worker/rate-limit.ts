/**
 * Best-effort, in-isolate rate limiting.
 *
 * The Free plan must not pay a D1 write per request, so the hot path is
 * protected by an in-memory window. It is per-isolate and therefore best
 * effort: the hard, global caps are the site's daily event quota in D1 and
 * the Cloudflare rate limiting rule described in docs/DEPLOYMENT.md.
 */
export type RateBucket = { count: number; resetAt: number };

const buckets = new Map<string, RateBucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
    }
    return { allowed: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Clears the window (used by the tests). */
export function resetRateLimits(): void {
  buckets.clear();
}
