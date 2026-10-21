/**
 * Change Radar — the comparison rules.
 *
 * The module is free of any runtime dependency (no D1, no Hono) so the
 * statistics can be tested directly. The file only uses erasable TypeScript
 * syntax, which keeps it importable from the node test runner.
 */

/** A measurement with its timestamp. */
export type Sample = { ts: number; value: number };

/** A measurement with the dimensions it was broken down by. */
export type DimensionedSample = Sample & {
  path: string | null;
  device: string | null;
  browser: string | null;
};

export type Verdict = "regression" | "improvement" | "stable" | "insufficient_data";

export type Stats = {
  samples: number;
  p50: number | null;
  p75: number | null;
  avg: number | null;
};

export type Comparison = {
  metric: string;
  scope: string;
  before: Stats;
  after: Stats;
  /** Difference of the p75 values (after - before). */
  delta: number | null;
  /** Relative change of the p75 values, e.g. 0.25 for +25 %. */
  relative: number | null;
  verdict: Verdict;
  reason: string;
};

/** A metric is only compared when both windows have enough samples. */
export const MIN_WINDOW_SAMPLES = 20;

/**
 * The thresholds per metric: a change counts as a regression when the p75
 * got worse by at least `absolute` milliseconds (or `relative` of its
 * previous value) and both windows hold enough samples.
 */
export const THRESHOLDS: Record<string, { absolute: number; relative: number }> = {
  LCP: { absolute: 200, relative: 0.2 },
  INP: { absolute: 100, relative: 0.25 },
  CLS: { absolute: 0.05, relative: 0.25 },
  FCP: { absolute: 150, relative: 0.2 },
  TTFB: { absolute: 150, relative: 0.25 },
};

/** The error rate counts as a change from this relative difference on. */
export const ERROR_RATE_THRESHOLD = 0.5;
/** …but at least this many errors must be involved. */
export const ERROR_RATE_MIN_EVENTS = 5;

/** Percentile of a sorted list (nearest rank). */
export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

/** The statistics of one window. */
export function stats(samples: Sample[]): Stats {
  const values = samples.map((sample) => sample.value).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { samples: 0, p50: null, p75: null, avg: null };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    avg: sum / values.length,
  };
}

/** Splits the samples into the window before and the window after a release. */
export function splitWindows(
  samples: Sample[],
  releaseTs: number,
  windowMs: number,
): { before: Sample[]; after: Sample[] } {
  const before: Sample[] = [];
  const after: Sample[] = [];
  for (const sample of samples) {
    if (sample.ts < releaseTs && sample.ts >= releaseTs - windowMs) {
      before.push(sample);
    } else if (sample.ts >= releaseTs && sample.ts < releaseTs + windowMs) {
      after.push(sample);
    }
  }
  return { before, after };
}

/**
 * Compares one metric around a release.
 *
 * The verdict is never guessed: without enough samples on both sides the
 * result is "insufficient_data", never a regression.
 */
export function compareMetric(
  metric: string,
  samples: Sample[],
  releaseTs: number,
  windowMs: number,
  scope = "all",
): Comparison {
  const { before, after } = splitWindows(samples, releaseTs, windowMs);
  const beforeStats = stats(before);
  const afterStats = stats(after);

  const base: Comparison = {
    metric,
    scope,
    before: beforeStats,
    after: afterStats,
    delta: null,
    relative: null,
    verdict: "insufficient_data",
    reason: "",
  };

  if (beforeStats.samples < MIN_WINDOW_SAMPLES || afterStats.samples < MIN_WINDOW_SAMPLES) {
    return {
      ...base,
      reason: `Her iki pencerede en az ${MIN_WINDOW_SAMPLES} ölçüm gerekir (önce: ${beforeStats.samples}, sonra: ${afterStats.samples}).`,
    };
  }

  const beforeP75 = beforeStats.p75 as number;
  const afterP75 = afterStats.p75 as number;
  const delta = afterP75 - beforeP75;
  const relative = beforeP75 === 0 ? null : delta / beforeP75;
  const threshold = THRESHOLDS[metric] ?? { absolute: 0, relative: 0.25 };

  let verdict: Verdict = "stable";
  let reason = "Değişim eşiğin altında.";

  const worseByAbsolute = Math.abs(delta) >= threshold.absolute;
  const worseByRelative = relative !== null && Math.abs(relative) >= threshold.relative;

  if (delta > 0 && (worseByAbsolute || worseByRelative)) {
    verdict = "regression";
    reason = `p75 ${formatDelta(metric, delta)} arttı (${formatPercent(relative)}).`;
  } else if (delta < 0 && (worseByAbsolute || worseByRelative)) {
    verdict = "improvement";
    reason = `p75 ${formatDelta(metric, delta)} azaldı (${formatPercent(relative)}).`;
  }

  return { ...base, delta, relative, verdict, reason };
}

/**
 * Compares the error rate of the two windows.
 *
 * The rate is the share of the measurements that were errors, so a site
 * with more traffic is not punished for having more errors.
 */
export function compareErrorRate(
  before: { errors: number; total: number },
  after: { errors: number; total: number },
  scope = "all",
): Comparison {
  const beforeRate = before.total > 0 ? before.errors / before.total : 0;
  const afterRate = after.total > 0 ? after.errors / after.total : 0;
  const delta = afterRate - beforeRate;
  const relative = beforeRate === 0 ? null : afterRate === 0 ? -1 : delta / beforeRate;

  const base: Comparison = {
    metric: "errors",
    scope,
    before: { samples: before.total, p50: null, p75: null, avg: beforeRate },
    after: { samples: after.total, p50: null, p75: null, avg: afterRate },
    delta,
    relative,
    verdict: "insufficient_data",
    reason: "",
  };

  const involved = Math.max(before.errors, after.errors);
  if (involved < ERROR_RATE_MIN_EVENTS) {
    return {
      ...base,
      reason: `Hata oranını değerlendirmek için en az ${ERROR_RATE_MIN_EVENTS} hata gerekir (bulunan: ${involved}).`,
    };
  }

  if (Math.abs(relative ?? 0) >= ERROR_RATE_THRESHOLD) {
    return {
      ...base,
      verdict: delta > 0 ? "regression" : "improvement",
      reason: `Hata oranı ${formatPercent(relative)} değişti (${formatPercent(beforeRate)} → ${formatPercent(afterRate)}).`,
    };
  }
  return { ...base, verdict: "stable", reason: "Hata oranı anlamlı biçimde değişmedi." };
}

/** "all" plus every dimension that holds enough samples on both sides. */
export function segmentationScopes(
  samples: DimensionedSample[],
  releaseTs: number,
  windowMs: number,
): { scope: string; filter: (sample: DimensionedSample) => boolean }[] {
  const scopes: { scope: string; filter: (sample: DimensionedSample) => boolean }[] = [
    { scope: "all", filter: () => true },
  ];

  const dimensions: { name: string; read: (sample: DimensionedSample) => string | null }[] = [
    { name: "path", read: (sample) => sample.path },
    { name: "device", read: (sample) => sample.device },
    { name: "browser", read: (sample) => sample.browser },
  ];

  for (const dimension of dimensions) {
    const values = new Set<string>();
    for (const sample of samples) {
      const value = dimension.read(sample);
      if (value) values.add(value);
    }
    for (const value of values) {
      const matching = samples.filter((sample) => dimension.read(sample) === value);
      const { before, after } = splitWindows(matching, releaseTs, windowMs);
      // Only a dimension that is measurable on both sides is worth showing.
      if (before.length < MIN_WINDOW_SAMPLES || after.length < MIN_WINDOW_SAMPLES) continue;
      scopes.push({
        scope: `${dimension.name}:${value}`,
        filter: (sample) => dimension.read(sample) === value,
      });
    }
  }
  return scopes;
}

/** The p75 change formatted for a message. */
export function formatDelta(metric: string, delta: number): string {
  const sign = delta > 0 ? "+" : "";
  if (metric === "CLS") return `${sign}${delta.toFixed(3)}`;
  return `${sign}${Math.round(delta)} ms`;
}

/** A relative change as a percentage. */
export function formatPercent(relative: number | null): string {
  if (relative === null) return "%0";
  const sign = relative > 0 ? "+" : "";
  return `%${sign}${Math.round(relative * 100)}`;
}
