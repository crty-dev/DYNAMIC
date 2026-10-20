import { createAuthClient } from "better-auth/react";
import { sentinelClient } from "@better-auth/infra/client";
import { BETTER_AUTH_KV_URL } from "../lib/infra";

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

/* --------------------------------------------------------------- projects */

export type VerificationStatus = "pending" | "verifying" | "verified";

export type Project = {
  id: string;
  name: string;
  hostname: string;
  status: VerificationStatus;
  error: string | null;
  attempts: number;
  verifiedAt: number | null;
  lastCheckedAt: number | null;
  createdAt: number;
  record: { type: "TXT"; name: string; value: string };
  script: string;
};

export type ProjectStats = {
  installed: boolean;
  summary: {
    totals: {
      pageviews: number;
      visitors: number;
      sessions: number;
      events: number;
      customEvents: number;
      conversions: number;
    };
    series: { t: number; pageviews: number; visitors: number }[];
    topPages: { path: string; n: number }[];
    referrers: { referrer: string; n: number }[];
    countries: { country: string; n: number }[];
  } | null;
  rum: {
    metrics: {
      metric: string;
      samples: number;
      avg: number | null;
      p50: number | null;
      p75: number | null;
      sufficient: boolean;
      note?: string;
    }[];
  } | null;
};

export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(
      typeof payload?.message === "string"
        ? payload.message
        : `İstek başarısız (${status}).`,
    );
    this.status = status;
    this.payload = payload ?? {};
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { message: text.slice(0, 200) };
    }
  }

  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

export const projectsApi = {
  list: () => request<{ ok: boolean; projects: Project[] }>("/api/projects"),
  get: (id: string) => request<{ ok: boolean; project: Project }>(`/api/projects/${id}`),
  create: (name: string, hostname: string) =>
    request<{ ok: boolean; project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, hostname }),
    }),
  rename: (id: string, name: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}?confirm=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  verify: (id: string) =>
    request<{ ok: boolean; project: Project; checkedAt: number }>(
      `/api/projects/${id}/verify`,
      { method: "POST" },
    ),
  stats: (id: string, range: string) =>
    request<ProjectStats>(`/api/projects/${id}/stats?range=${range}`),
};

/* ------------------------------------------------------------- formatters */

export const fmtInt = (value: number): string => value.toLocaleString("tr-TR");

export function fmtDate(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function fmtMetric(metric: string, value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}
