import { betterAuth, type BetterAuthOptions } from "better-auth";
import { captcha } from "better-auth/plugins";
import { dash } from "@better-auth/infra";
import { config, type Bindings } from "./env";
import { sendMail } from "./mailer";
import { executionContextFor } from "./execution";
import { BETTER_AUTH_KV_URL } from "../src/lib/infra";

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
 * The background runner of the request that triggered the mail.
 *
 * The mail is handed to the execution context instead of being awaited: the
 * answer must not arrive later for an address that exists than for one that
 * does not.
 */
function waitUntilFor(request?: Request): ((promise: Promise<unknown>) => void) | undefined {
  const context = executionContextFor(request);
  if (!context) return undefined;
  return (promise) => context.waitUntil(promise);
}

/**
 * The social providers that are configured.
 *
 * A provider is only enabled when both of its credentials are present, so a
 * self-hoster without OAuth apps keeps the plain e-mail login and never sees
 * a broken button.
 */
export function enabledSocialProviders(env: Bindings): string[] {
  const providers: string[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push("google");
  return providers;
}

/** The addresses that are promoted to super admin when they sign in. */
export function adminEmails(env: Bindings): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Promotes a user to super admin when its address is listed in ADMIN_EMAILS.
 *
 * This is the bootstrap for the first administrator: the panel itself can
 * promote everybody else. The write happens once per sign in and only when
 * the role actually changes.
 */
export async function promoteAdmin(env: Bindings, userId: string): Promise<void> {
  try {
    const admins = adminEmails(env);
    if (admins.length === 0) return;
    const row = await env.DB.prepare("SELECT email, role FROM user WHERE id = ?")
      .bind(userId)
      .first<{ email?: string; role?: string }>();
    if (!row?.email) return;
    if (row.role === "admin") return;
    if (!admins.includes(String(row.email).toLowerCase())) return;
    await env.DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(userId).run();
  } catch (error) {
    // A failed promotion must never break the sign in itself.
    console.error("[auth] admin promotion failed", error);
  }
}

/**
 * Builds the Better Auth options for the given bindings.
 *
 * Exported so the tests can assert the security relevant options (IP header,
 * joins, trusted origins) without starting a Worker.
 */
/**
 * Where the authentication errors end up.
 *
 * Better Auth sends OAuth failures (a cancelled consent screen, a denied
 * scope, a broken callback) to its own `/api/auth/error` page, which is a
 * development page and shows a raw error code. The console has a login page
 * that explains the problem in Turkish instead.
 *
 * The console lives on its own origin or, when it shares the marketing
 * origin, under /app - the URL follows that.
 */
function authErrorUrl(env: Bindings): string {
  const { appUrl, authBaseUrl } = config(env);
  try {
    const appOrigin = new URL(appUrl).origin;
    const authOrigin = new URL(authBaseUrl).origin;
    return appOrigin === authOrigin
      ? `${authOrigin}/app/login`
      : `${appOrigin}/login`;
  } catch {
    return `${authBaseUrl}/app/login`;
  }
}

/**
 * Whether an account has to prove its address before it may use the console.
 *
 * The default follows the mail capability: with a provider every account has
 * to verify, without one the requirement would lock everybody out of their own
 * console. AUTH_REQUIRE_EMAIL_VERIFICATION decides it explicitly.
 */
export function requiresVerification(env: Bindings): boolean {
  const explicit = (env.AUTH_REQUIRE_EMAIL_VERIFICATION ?? "").trim();
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  const { mail, isDev } = config(env);
  return mail.enabled || isDev;
}

export function buildAuthOptions(env: Bindings): BetterAuthOptions {
  const { appUrl, authBaseUrl, authSecret, turnstile, ipAddress } = config(env);
  const infraApiKey = env.BETTER_AUTH_API_KEY ?? "";
  const limitMax = Number(env.AUTH_RATE_LIMIT_MAX ?? 0) || null;
  const social = enabledSocialProviders(env);
  const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (social.includes("github")) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    };
  }
  if (social.includes("google")) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    };
  }
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
      // A sign in attempt of an unverified account resends the mail, so a
      // visitor who lost the first mail does not need the form again.
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }: MailTarget, request?: Request) => {
        await sendMail(
          env,
          {
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
            },
          { waitUntil: waitUntilFor(request) },
        );
      },
    },
    emailAndPassword: {
      enabled: true,
      // The verification can only be enforced when a mail provider is
      // configured: without one no address can be proven, and the requirement
      // would lock every new account out of its own console. As soon as a
      // provider is set the verification is enforced again. In development the
      // outbox delivers the mail, so the check stays active there. The
      // operator can decide with AUTH_REQUIRE_EMAIL_VERIFICATION.
      requireEmailVerification: requiresVerification(env),
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }: MailTarget, request?: Request) => {
        await sendMail(
          env,
          {
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
            },
          { waitUntil: waitUntilFor(request) },
        );
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
    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
    onAPIError: {
      // No raw error page in production: the console explains the failure.
      errorURL: authErrorUrl(env),
      onError: (error) => {
        console.error("[auth] api error", error);
      },
    },
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
      additionalFields: {
        // The role is never accepted from the client (input: false), so a
        // visitor cannot promote themselves at sign up. It is returned in the
        // session so the console and the super admin panel can read it.
        role: {
          type: "string",
          defaultValue: "user",
          input: false,
          returned: true,
          required: false,
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // An address in ADMIN_EMAILS is promoted the first time it signs in.
          after: async (session) => {
            await promoteAdmin(env, session.userId);
          },
        },
      },
    },
    plugins: [
      ...plugins,
      // The dashboard plugin is only mounted when an API key is configured, so
      // the application keeps working without it.
      ...(infraApiKey
        ? [
            dash({
              apiKey: infraApiKey,
              // The project scoped KV endpoint of the dashboard, not the
              // global bucket that every project shares.
              kvUrl: BETTER_AUTH_KV_URL,
            }),
          ]
        : []),
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
