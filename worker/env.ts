/**
 * Shared Worker bindings and runtime configuration.
 *
 * Everything here is configured through Wrangler (`vars`) or the Worker
 * secret store — no secret is ever bundled into the client.
 */
export type Bindings = {
  /** Cloudflare D1 binding (Free plan) — migrations/: 0001..0004 */
  DB: D1Database;
  /** Static assets binding (dist/) */
  ASSETS: Fetcher;
  /** Better Auth signing secret (32+ chars). */
  BETTER_AUTH_SECRET?: string;
  /** Better Auth API key for the @better-auth/infra dashboard plugin. */
  BETTER_AUTH_API_KEY?: string;
  /** Public URL of the product application (https://app.dynamic.crty-dev.com). */
  APP_URL?: string;
  /** Public URL of the marketing website. */
  MARKETING_URL?: string;
  /** Base URL used by Better Auth (defaults to the marketing website). */
  AUTH_BASE_URL?: string;
  /** Sender address for transactional mail. */
  MAIL_FROM?: string;
  /** Transactional mail provider endpoint (e.g. https://api.resend.com/emails). */
  MAIL_PROVIDER_URL?: string;
  /** Bearer token for the mail provider. */
  MAIL_PROVIDER_TOKEN?: string;
  /** Cloudflare Turnstile secret key (bot protection, optional). */
  TURNSTILE_SECRET_KEY?: string;
  /** Cloudflare Turnstile site key (public, sent to the browser). */
  TURNSTILE_SITE_KEY?: string;
  /** GitHub OAuth app - client id. Enables the "GitHub ile devam et" button. */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth app - client secret. */
  GITHUB_CLIENT_SECRET?: string;
  /** Google OAuth client - client id. */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client - client secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Comma separated addresses that are promoted to super admin when they
   * sign in. This is the bootstrap for the first administrator; the panel
   * can promote everybody else afterwards.
   */
  ADMIN_EMAILS?: string;
  /** DNS-over-HTTPS resolver used for the TXT verification. */
  DNS_RESOLVER_URL?: string;
  /** Enables the local mail outbox + relaxed dev behaviour. Never in production. */
  DEV_MODE?: string;
  /** Minimum seconds between two DNS verification attempts (default 10). */
  PROJECT_VERIFY_INTERVAL_MS?: string;
  /** Raises the per-path auth rate limits (self-hosting, tests). */
  AUTH_RATE_LIMIT_MAX?: string;
  /**
   * Forces the address verification on or off.
   *
   * By default it follows the mail capability: with a provider every account
   * has to prove its address, without one the requirement would lock everybody
   * out of their own console. "1" forces it on, "0" turns it off.
   */
  AUTH_REQUIRE_EMAIL_VERIFICATION?: string;
  /**
   * Header the client IP is read from. Cloudflare overwrites `cf-connecting-ip`
   * at the edge, so it is the only header a visitor cannot influence.
   * Self-hosters behind nginx should use `x-real-ip`.
   */
  AUTH_IP_HEADERS?: string;
  /**
   * Trusted reverse proxies (IPs or CIDR ranges). Only needed when the client
   * IP header carries a forwarded chain: Better Auth then walks the chain from
   * the right and takes the first address that is not a trusted hop.
   */
  AUTH_TRUSTED_PROXIES?: string;
  /** Maximum number of self-serve analytics sites. */
  MAX_SITES?: string;
  /** Cloudinary credential — "cloudinary://<key>:<secret>@<cloud>". Secret: wrangler secret put. */
  CLOUDINARY_URL?: string;
  /** Public cloud name (also in wrangler vars). */
  CLOUDINARY_CLOUD_NAME?: string;
  /** Public upload API key. */
  CLOUDINARY_UPLOAD_KEY?: string;
  /** Bearer token that guards the media upload/signature endpoints. */
  MEDIA_UPLOAD_TOKEN?: string;
  /** Bearer token that guards every /api/admin/* route. */
  ADMIN_API_KEY?: string;
};

export type Site = {
  id: number;
  public_id: string;
  name: string;
  origin: string;
  created_at: number;
  retention_days: number;
  daily_event_limit: number;
  events_today: number;
  counter_day: string | null;
};

export type Variables = {
  /** Browser origin (Origin header) or referer origin; null for server-side calls. */
  requestOrigin: string | null;
  /** The signed in super admin, set by the /api/super/* guard. */
  adminUser?: { id?: string; role?: string };
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

/** Splits a comma separated list into trimmed, non empty entries. */
function list(value: string | undefined, fallback: string[]): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
}

/** Resolved runtime configuration with safe defaults. */
export function config(env: Bindings) {
  const appUrl = (env.APP_URL ?? "https://app.dynamic.crty-dev.com").replace(/\/+$/, "");
  const marketingUrl = (env.MARKETING_URL ?? "https://dynamic.crty-dev.com").replace(/\/+$/, "");
  const authBaseUrl = (env.AUTH_BASE_URL ?? marketingUrl).replace(/\/+$/, "");
  return {
    appUrl,
    marketingUrl,
    authBaseUrl,
    isDev: env.DEV_MODE === "1",
    maxSites: Number(env.MAX_SITES ?? 500),
    turnstile: {
      secretKey: env.TURNSTILE_SECRET_KEY ?? null,
      siteKey: env.TURNSTILE_SITE_KEY ?? null,
    },
    mail: {
      from: env.MAIL_FROM ?? "DYNAMIC <no-reply@crty-dev.com>",
      providerUrl: env.MAIL_PROVIDER_URL ?? null,
      providerToken: env.MAIL_PROVIDER_TOKEN ?? null,
      // Without a provider no mail leaves the Worker, so the address
      // verification cannot be enforced either.
      enabled: Boolean(env.MAIL_PROVIDER_URL && env.MAIL_PROVIDER_TOKEN),
    },
    ipAddress: {
      // Cloudflare replaces `cf-connecting-ip` with the real visitor address.
      // The Better Auth default (`x-forwarded-for`) is appended to by
      // Cloudflare, so a visitor that sends its own header turns it into a
      // chain that Better Auth refuses to trust - the request would end up in
      // one shared bucket instead of its own.
      headers: list(env.AUTH_IP_HEADERS, ["cf-connecting-ip"]),
      trustedProxies: list(env.AUTH_TRUSTED_PROXIES, []),
    },
    authSecret: env.BETTER_AUTH_SECRET ?? null,
  };
}

/** Origins that may talk to the API with credentials. */
export function allowedOrigins(env: Bindings): string[] {
  const { appUrl, marketingUrl, authBaseUrl } = config(env);
  return [
    appUrl,
    marketingUrl,
    authBaseUrl,
    // The Better Auth dashboard calls /api/auth straight from the browser.
    "https://dash.better-auth.com",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
  ];
}
