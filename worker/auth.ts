import { betterAuth, type BetterAuthOptions } from "better-auth";
import { captcha } from "better-auth/plugins";
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

function buildOptions(env: Bindings): BetterAuthOptions {
  const { appUrl, authSecret, turnstile } = config(env);
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
    baseURL: appUrl,
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
      database: { generateId: () => crypto.randomUUID() },
    },
    trustedOrigins: [appUrl, "http://localhost:5174", "http://127.0.0.1:5174"],
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
    plugins,
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
  const auth = betterAuth(buildOptions(env));
  cached = { key: authSecret, auth };
  return auth;
}

export type Auth = AuthInstance;
