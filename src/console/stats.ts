import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

export type StatsRange = "24h" | "7d" | "30d" | "90d";

export const RANGE_LABELS: Record<StatsRange, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
};

export type AnalyticsSummary = {
  ok: boolean;
  range: StatsRange;
  generatedAt?: number;
  empty?: boolean;
  site: { id: string; name: string; origin: string } | null;
  totals: {
    pageviews: number;
    visitors: number;
    sessions: number;
    events: number;
    customEvents: number;
    conversions: number;
    goals: number;
  };
  series: { t: number; pageviews: number; visitors: number; events: number }[];
  topPages: { path: string; n: number }[];
  referrers: { referrer: string; n: number }[];
  campaigns: { source: string | null; medium: string | null; campaign: string | null; n: number }[];
  devices: { device: string; browser: string; os: string; n: number }[];
  goals: { name: string; n: number; value: number }[];
  customEvents: { name: string; n: number }[];
  countries: { country: string; n: number }[];
  realtime: { events: number; activeSessions: number; topPages: { path: string; n: number }[] };
};

export type RumMetric = {
  metric: string;
  samples: number;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  good: number;
  needsImprovement: number;
  poor: number;
  sufficient: boolean;
  note?: string;
};

export type RumSummary = {
  ok: boolean;
  range: StatsRange;
  minSamples: number;
  metrics: RumMetric[];
};

export type RumPage = { path: string; samples: number; avg: number | null; p75: number | null };

/* ------------------------------------------------------------- formatters */

export const fmtInt = (n: number): string => n.toLocaleString("en-US");

export function fmtMetric(metric: string, value: number | null): string {
  if (value == null) return "—";
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

export function fmtBucket(ts: number, range: StatsRange): string {
  const date = new Date(ts);
  if (range === "24h") {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

export function ratingClass(rating: string | null): string {
  if (rating === "good") return "console__pill--good";
  if (rating === "poor") return "console__pill--poor";
  if (rating === "needs-improvement") return "console__pill--mid";
  return "";
}

/* ------------------------------------------------------------------ query */

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return (await response.json()) as T;
}

export function useAnalytics(range: StatsRange) {
  return useQuery({
    queryKey: ["analytics", range],
    queryFn: () => getJson<AnalyticsSummary>(`/api/analytics/summary?range=${range}`),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useRum(range: StatsRange) {
  return useQuery({
    queryKey: ["rum", range],
    queryFn: () => getJson<RumSummary>(`/api/rum/summary?range=${range}`),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useRumPages(range: StatsRange, metric: string) {
  return useQuery({
    queryKey: ["rum-pages", range, metric],
    queryFn: () => getJson<{ pages: RumPage[] }>(`/api/rum/pages?range=${range}&metric=${metric}`),
    staleTime: 30_000,
  });
}

/* ---------------------------------------------------------------- context */

export type ConsoleContextValue = {
  range: StatsRange;
  setRange: (range: StatsRange) => void;
  analytics?: AnalyticsSummary;
  rum?: RumSummary;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  query: string;
  setQuery: (value: string) => void;
};

export const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function useConsole(): ConsoleContextValue {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error("ConsoleContext is missing");
  return value;
}
