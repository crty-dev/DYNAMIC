import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

export type StatsRange = "24h" | "7d" | "30d";

export type VitalRating = "good" | "needs-improvement" | "poor";

export type Stats = {
  ok: boolean;
  range: StatsRange;
  generatedAt?: number;
  site: { id: string; name: string; origin: string } | null;
  totals: { pageviews: number; visitors: number; events: number; custom: number };
  vitals: {
    metric: string;
    avg: number | null;
    samples: number;
    ratings: { good: number; "needs-improvement": number; poor: number };
  }[];
  series: { t: number; pageviews: number; visitors: number; events: number }[];
  topPages: { path: string; n: number }[];
  topCountries: { country: string | null; n: number }[];
  slowPages: { path: string; avg: number; n: number }[];
  recent: {
    ts: number;
    metric: string;
    value: number | null;
    rating: string | null;
    path: string | null;
    country: string | null;
    ua: string | null;
  }[];
};

export const RANGE_LABELS: Record<StatsRange, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};

/* ------------------------------------------------------------- formatters */

export const fmtInt = (n: number): string => n.toLocaleString("en-US");

/** Web-vital formatting: CLS is unitless, the rest is ms (seconds above 1 s). */
export function fmtMetric(metric: string, value: number | null): string {
  if (value == null) return "—";
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

export function fmtStamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

/** Short user-agent label for the event stream. */
export function uaLabel(ua: string | null): string {
  if (!ua) return "—";
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

/* ------------------------------------------------------------------ query */

export function useStats(range: StatsRange) {
  return useQuery({
    queryKey: ["stats", range],
    queryFn: async (): Promise<Stats> => {
      const response = await fetch(`/api/stats?range=${range}`);
      if (!response.ok) throw new Error(`stats_failed_${response.status}`);
      return (await response.json()) as Stats;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/* ---------------------------------------------------------------- context */

export type ConsoleContextValue = {
  range: StatsRange;
  setRange: (range: StatsRange) => void;
  stats?: Stats;
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
