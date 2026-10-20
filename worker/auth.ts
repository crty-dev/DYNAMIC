import { betterAuth, type BetterAuthOptions } from "better-auth";
import { captcha } from "better-auth/plugins";
import { dash } from "@better-auth/infra";
import { config, type Bindings } from "./env";
import { sendMail } from "./mailer";

/**
 * Better Auth configuration for Cloudflare Workers + D1.
 *
 * - The D1 binding is passed directly: the official adapter detects a D1
 *   database and uses its own SQLite dialect (no extra kysely dialect needed).
 * - Password hashing and session tokens are handled by Better Auth
 *   (scrypt + signed cookies) - nothing is hand rolled here.
 * - Mail delivery goes through the pluggable adapter in `mailer.ts`.
 * - Cloudflare Turnstile is enabled only when a secret key is configured.
 */

type MailTarget = { user: { email: string; name?: string | null }; url: string };

/**
 * Builds the Better Auth options for the given bindings.
 *
 * Exported so the tests can assert the security relevant options (IP header,
 * joins, trusted origins) without starting a Worker.
 */
export function buildAuthOptions(env: Bindings): BetterAuthOptions {
  const { appUrl, authBaseUrl, authSecret, turnstile, ipAddress } = config(env);
  const infraApiKey = env.BETTER_AUTH_API_KEY ?? "";
  const limitMax = Number(env.AUTH_RATE_LIMIT_MAX ?? 0) || null;
  const plugins: NonNullable<BetterAuthOptions["plugins"]> = turnstile.secretKey
    ? [
        captcha({
          provider: "cloudflare-turnstile",
          secretKey: turnstile.secretKey,
          endpoints: ["/sign-in/email", "/sign-up/email", "/request-password-reset"],
        }),
      ]
    : [];

  return {
    appName: "DYNAMIC",
    baseURL: authBaseUrl,
    basePath: "/api/auth",
    secret: authSecret ?? "",
    database: env.DB,
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }: MailTarget) => {
        await sendMail(env, {
          to: user.email,
          subject: "DYNAMIC hesabınızı doğrulayın",
          text: [
            `Merhaba ${user.name ?? ""},`.trim(),
            "",
            "Hesabınızı doğrulamak için aşağıdaki bağlantıyı kullanın:",
            url,
            "",
            "Bu bağlantı 1 saat geçerlidir. Talep etmediyseniz bu e-postayı yok sayabilirsiniz.",
            "— DYNAMIC",
          ].join("\n"),
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }: MailTarget) => {
        await sendMail(env, {
          to: user.email,
          subject: "DYNAMIC şifre sıfırlama",
          text: [
            `Merhaba ${user.name ?? ""},`.trim(),
            "",
            "Yeni bir şifre belirlemek için aşağıdaki bağlantıyı kullanın:",
            url,
            "",
            "Bu bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir.",
            "Talep etmediyseniz bu e-postayı yok sayabilirsiniz.",
            "— DYNAMIC",
          ].join("\n"),
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    advanced: {
      cookiePrefix: "dynamic",
      useSecureCookies: true,
      crossSubDomainCookies: { enabled: false },
      ipAddress: {
        // The client IP is read from a header the visitor cannot influence
        // (`cf-connecting-ip` on Cloudflare). Without this the default
        // `x-forwarded-for` is used, which Cloudflare appends to - a visitor
        // that sends its own header would then be unresolvable and share one
        // bucket with every other unresolvable request.
        ipAddressHeaders: ipAddress.headers,
        ...(ipAddress.trustedProxies.length > 0
          ? { trustedProxies: ipAddress.trustedProxies }
          : {}),
      },
      database: {
        generateId: () => crypto.randomUUID(),
        // The Kysely adapter (D1 dialect included) performs native joins, so
        // /get-session and friends need one query instead of several.
        joins: true,
      },
    },
    trustedOrigins: [
      appUrl,
      authBaseUrl,
      "https://dash.better-auth.com",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
    ],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      storage: "memory",
      // Self-hosters (and the test suite) can relax the per-path limits.
      customRules: {
        "/sign-in/email": { window: 60, max: limitMax ?? 10 },
        "/sign-up/email": { window: 60, max: limitMax ?? 5 },
        "/request-password-reset": { window: 60, max: limitMax ?? 5 },
        "/send-verification-email": { window: 60, max: limitMax ?? 5 },
      },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: true },
    },
    plugins: [
      ...plugins,
      // The dashboard plugin is only mounted when an API key is configured, so
      // the application keeps working without it.
      ...(infraApiKey ? [dash({ apiKey: infraApiKey })] : []),
    ],
  };
}

type AuthInstance = ReturnType<typeof betterAuth<BetterAuthOptions>>;

let cached: { key: string; auth: AuthInstance } | null = null;

/**
 * The Better Auth instance for this isolate. A missing secret must not
 * silently produce an insecure instance.
 */
export function createAuth(env: Bindings): AuthInstance {
  const { authSecret } = config(env);
  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET is missing or too short. Run: npx wrangler secret put BETTER_AUTH_SECRET",
    );
  }
  if (cached && cached.key === authSecret) return cached.auth;
  const auth = betterAuth(buildAuthOptions(env));
  cached = { key: authSecret, auth };
  return auth;
}

export type Auth = AuthInstance;
