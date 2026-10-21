export {
  API_ORIGIN,
  APP_BASE_PATH,
  authClient,
  consoleUrl,
  fetchMailStatus,
  fetchSocialProviders,
} from "../lib/auth-client";

import { API_ORIGIN } from "../lib/auth-client";

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
    devices: { device: string; browser: string; os: string; n: number }[];
    campaigns: {
      source: string | null;
      medium: string | null;
      campaign: string | null;
      n: number;
    }[];
    goals: { name: string; n: number; value: number }[];
    customEvents: { name: string; n: number }[];
    realtime: {
      events: number;
      activeSessions: number;
      topPages: { path: string; n: number }[];
    };
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

/** A named conversion of a site. */
export type Goal = {
  id: number;
  public_id: string;
  name: string;
  label: string | null;
  path: string | null;
  value: number | null;
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
  goals: (id: string) => request<{ ok: boolean; goals: Goal[] }>(`/api/projects/${id}/goals`),
  createGoal: (
    id: string,
    goal: { name: string; label?: string; path?: string },
  ) =>
    request<{ ok: boolean; goal: string }>(`/api/projects/${id}/goals`, {
      method: "POST",
      body: JSON.stringify(goal),
    }),
  deleteGoal: (id: string, goal: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${id}/goals/${encodeURIComponent(goal)}`,
      { method: "DELETE" },
    ),
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
