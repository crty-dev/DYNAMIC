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
  /** Public URL of the product application (https://app.dynamic.crty-dev.com). */
  APP_URL?: string;
  /** Public URL of the marketing website. */
  MARKETING_URL?: string;
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
  /** DNS-over-HTTPS resolver used for the TXT verification. */
  DNS_RESOLVER_URL?: string;
  /** Enables the local mail outbox + relaxed dev behaviour. Never in production. */
  DEV_MODE?: string;
  /** Minimum seconds between two DNS verification attempts (default 10). */
  PROJECT_VERIFY_INTERVAL_MS?: string;
  /** Raises the per-path auth rate limits (self-hosting, tests). */
  AUTH_RATE_LIMIT_MAX?: string;
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
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

/** Resolved runtime configuration with safe defaults. */
export function config(env: Bindings) {
  const appUrl = (env.APP_URL ?? "https://app.dynamic.crty-dev.com").replace(/\/+$/, "");
  const marketingUrl = (env.MARKETING_URL ?? "https://dynamic.crty-dev.com").replace(/\/+$/, "");
  return {
    appUrl,
    marketingUrl,
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
    },
    authSecret: env.BETTER_AUTH_SECRET ?? null,
  };
}

/** Origins that may talk to the API with credentials. */
export function allowedOrigins(env: Bindings): string[] {
  const { appUrl, marketingUrl } = config(env);
  return [
    appUrl,
    marketingUrl,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
  ];
}
