import { createAuthClient } from "better-auth/react";
import { sentinelClient } from "@better-auth/infra/client";
import { BETTER_AUTH_KV_URL } from "./infra";

/**
 * The Better Auth client.
 *
 * It lives outside the console so that the super admin panel (which is served
 * from the marketing origin) and the console (which is served from /app) talk
 * to the same API with the same session cookie.
 */

/**
 * API origin.
 *
 * In production the app and the API share the origin (app.dynamic.crty-dev.com
 * serves both the SPA and /api/*), so a relative URL is enough. Local
 * development points the app at the local Worker (wrangler dev).
 */
export const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN && import.meta.env.VITE_API_ORIGIN !== ""
    ? import.meta.env.VITE_API_ORIGIN
    : typeof window !== "undefined"
      ? window.location.origin
      : "";

export const authClient = createAuthClient({
  baseURL: API_ORIGIN,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
  plugins: [
    // The project scoped identify URL keeps the fingerprints out of the
    // global bucket that every project on the platform shares.
    sentinelClient({ identifyUrl: BETTER_AUTH_KV_URL }),
  ],
});

/**
 * The social providers the server has credentials for. The buttons only show
 * up when the provider is really configured, so nobody sees a button that
 * would fail.
 */
export async function fetchSocialProviders(): Promise<string[]> {
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/providers`, {
      credentials: "include",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { providers?: unknown };
    return Array.isArray(payload.providers)
      ? payload.providers.filter((p): p is string => typeof p === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Where the application is mounted on this origin: "/" on the app domain,
 * "/app" when it is served from the marketing origin.
 */
export const APP_BASE_PATH =
  typeof window !== "undefined" && /^\/app(\/|$)/.test(window.location.pathname) ? "/app" : "";
