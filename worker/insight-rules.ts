/**
 * Fix-to-Proof — the diagnostic rules.
 *
 * Every recommendation is derived from a measurement that exists in the
 * database. The rules are deterministic (no model, no external service) so
 * the same data always produces the same advice, and every recommendation
 * carries the evidence it was built from.
 *
 * The module is free of runtime dependencies so the rules can be tested
 * directly. Only erasable TypeScript syntax is used.
 */

/** The measurement a rule looks at. */
export type VitalReading = {
  metric: string;
  samples: number;
  p75: number | null;
  p50: number | null;
  avg: number | null;
  sufficient: boolean;
};

export type ErrorReading = {
  errors: number;
  total: number;
  rate: number;
  previousRate: number;
};

export type IssueSeverity = "critical" | "warning" | "info";

export type IssueKind = "lcp" | "inp" | "cls" | "ttfb" | "errors";

export type Issue = {
  /** Stable id of the issue — the state is stored under it. */
  fingerprint: string;
  kind: IssueKind;
  /** "all" or a path / device / browser that the issue was measured on. */
  scope: string;
  title: string;
  severity: IssueSeverity;
  /** The measurement that produced the issue. */
  measurement: string;
  /** The measured value, formatted for a human. */
  value: string;
  /** The sample size the decision was based on. */
  samples: number;
  /** Why this is an issue. */
  reason: string;
  /** What the developer can do about it. */
  guidance: string[];
  /** A code example — only when the context is known. */
  code?: { language: string; label: string; snippet: string };
  /** True when the advice is general and not tied to a known root cause. */
  general: boolean;
};

export type IssueInput = {
  vitals: VitalReading[];
  errors: ErrorReading;
  /** The path the measurement was taken on ("all" for the whole site). */
  scope?: string;
  /** The period the measurement covers. */
  period: string;
  /** The number of samples a rule needs before it speaks. */
  minSamples?: number;
};

/** A metric is only judged when the sample size allows it. */
export const DEFAULT_MIN_SAMPLES = 20;

/** The "poor" thresholds of the Web Vitals specification (75th percentile). */
export const POOR_THRESHOLDS: Record<string, number> = {
  LCP: 2500,
  INP: 200,
  CLS: 0.1,
  FCP: 3000,
  TTFB: 800,
};

function metricLabel(metric: string): string {
  if (metric === "LCP") return "Largest Contentful Paint";
  if (metric === "INP") return "Interaction to Next Paint";
  if (metric === "CLS") return "Cumulative Layout Shift";
  if (metric === "TTFB") return "Time to First Byte";
  if (metric === "FCP") return "First Contentful Paint";
  return metric;
}

function formatValue(metric: string, value: number): string {
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

/** The severity of a metric that is above the poor threshold. */
function severityFor(metric: string, value: number): IssueSeverity {
  const threshold = POOR_THRESHOLDS[metric] ?? 0;
  if (!threshold) return "info";
  if (value >= threshold * 2) return "critical";
  if (value >= threshold * 1.3) return "warning";
  return "info";
}

/**
 * The deterministic guidance per metric.
 *
 * The advice is deliberately generic: DYNAMIC measures the symptom, it does
 * not read the customer's source code, so it cannot claim a root cause. The
 * code examples are marked as general suggestions.
 */
function guidanceFor(metric: string, scope: string): { lines: string[]; code?: Issue["code"] } {
  const scopeHint = scope === "all" ? "" : ` (${scope} sayfasında)`;
  if (metric === "LCP") {
    return {
      lines: [
        `En büyük içerik öğesi${scopeHint} geç yükleniyor.`,
        "Ana görseli doğrudan <img> olarak yazın, CSS arka planı olarak değil (preload edilemez).",
        "Kaynak sunucusundan önce bir CDN uç noktası ya da uygun boyutta bir görsel kullanın.",
        "Sunucu yanıt süresini (TTFB) düşürün — LCP çoğu zaman TTFB ile sınırlıdır.",
      ],
      code: {
        language: "html",
        label: "Genel öneri: ana görseli preload edin",
        snippet:
          '<link rel="preload" as="image" href="/hero.avif" fetchpriority="high" type="image/avif">\n<img src="/hero.avif" alt="" width="1200" height="630" fetchpriority="high" decoding="async">',
      },
    };
  }
  if (metric === "INP") {
    return {
      lines: [
        `Etkileşim gecikmesi yüksek${scopeHint}.`,
        "Kullanıcı etkileşimlerini ağır JavaScript ile bloklamayın; işi bir worker veya küçük bir paket ile taşıyın.",
        "Ağır listeleri (uzun görevler) zamanlayıcıya ya da requestIdleCallback'e bırakın.",
        "Üçüncü taraf betikleri asenkron yükleyin ve etkileşimden önce yüklenmelerini engelleyin.",
      ],
    };
  }
  if (metric === "CLS") {
    return {
      lines: [
        `Düzen kayması var${scopeHint}.`,
        "Görsellere genişlik/yükseklik verin, kayan içerik için yer ayırın.",
        "Reklam ve banner alanlarının yüksekliğini sabitleyin.",
        "Yazı tipi yüklenirken satır yüksekliğinin değişmesini (FOUT) önleyin.",
      ],
      code: {
        language: "css",
        label: "Genel öneri: görsel için boyut sabitleyin",
        snippet: ".hero img { width: 100%; height: auto; aspect-ratio: 16 / 9; }",
      },
    };
  }
  if (metric === "TTFB") {
    return {
      lines: [
        `Sunucu yanıt süresi yüksek${scopeHint}.`,
        "Sunucu tarafı önbellekleme ve bir CDN katmanı kullanın.",
        "İlk istekteki sorguları azaltın; gereksiz veri çekmelerini kaldırın.",
        "Sunucu ile veritabanı arasında yuvarlama sayıları (N+1) olup olmadığını kontrol edin.",
      ],
    };
  }
  return {
    lines: [
      `Hata oranı arttı${scopeHint}.`,
      "Hataların en sık tekrar eden imzasını bulup düzeltin; her hata için ayrı bir iş kuralı yazmayın.",
      "Hata sınırlarında olmayan hataları da toplayın — yalnızca konsoldaki hatalar görünür.",
    ],
  };
}

/**
 * Evaluates the measurements and returns the issues that are worth acting on.
 *
 * A rule only speaks when the sample size allows it: with five measurements
 * a p75 is noise, not a finding.
 */
export function evaluateIssues(input: IssueInput): Issue[] {
  const minSamples = input.minSamples ?? DEFAULT_MIN_SAMPLES;
  const scope = input.scope ?? "all";
  const issues: Issue[] = [];

  for (const reading of input.vitals) {
    if (!reading.sufficient || reading.samples < minSamples) continue;
    if (reading.p75 === null) continue;
    const threshold = POOR_THRESHOLDS[reading.metric];
    if (!threshold) continue;
    if (reading.p75 <= threshold) continue;

    const guidance = guidanceFor(reading.metric, scope);
    issues.push({
      fingerprint: `${reading.metric.toLowerCase()}:${scope}`,
      kind: reading.metric.toLowerCase() as IssueKind,
      scope,
      title: `${metricLabel(reading.metric)} yavaş (p75 ${formatValue(reading.metric, reading.p75)})`,
      severity: severityFor(reading.metric, reading.p75),
      measurement: `${metricLabel(reading.metric)} p75`,
      value: formatValue(reading.metric, reading.p75),
      samples: reading.samples,
      reason: `p75 ${formatValue(reading.metric, reading.p75)}, "poor" eşiği ${formatValue(reading.metric, threshold)} üzerinde (${input.period}).`,
      guidance: guidance.lines,
      ...(guidance.code ? { code: guidance.code } : {}),
      general: true,
    });
  }

  const { errors, total, rate, previousRate } = input.errors;
  if (errors >= 5 && total > 0 && previousRate > 0 && rate >= previousRate * 1.5) {
    const guidance = guidanceFor("errors", scope);
    issues.push({
      fingerprint: `errors:${scope}`,
      kind: "errors",
      scope,
      title: `Hata oranı arttı (%${(rate * 100).toFixed(1)})`,
      severity: rate >= previousRate * 2 ? "critical" : "warning",
      measurement: "Hata oranı",
      value: `%${(rate * 100).toFixed(1)}`,
      samples: total,
      reason: `Hata oranı önceki dönemin %${(previousRate * 100).toFixed(1)} değerinden %${(rate * 100).toFixed(1)} değerine çıktı (${errors} hata / ${total} ölçüm, ${input.period}).`,
      guidance: guidance.lines,
      general: true,
    });
  }

  return issues;
}

/** The outcome of a fix that was reported. */
export type FixOutcome = "improved" | "regressed" | "inconclusive" | "insufficient_data";

export type FixAssessment = {
  outcome: FixOutcome;
  before: number | null;
  after: number | null;
  delta: number | null;
  samples: { before: number; after: number };
  reason: string;
};

/**
 * Compares the measurement before and after the release a fix was
 * associated with.
 *
 * A fix is only "improved" when the number actually got better by a
 * meaningful margin and both windows hold enough samples — a click on a
 * button is never a proof.
 */
export function assessFix(
  beforeSamples: { value: number }[],
  afterSamples: { value: number }[],
  options: { minSamples?: number; thresholdAbsolute?: number; thresholdRelative?: number } = {},
): FixAssessment {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const thresholdAbsolute = options.thresholdAbsolute ?? 0;
  const thresholdRelative = options.thresholdRelative ?? 0.05;

  const before = beforeSamples.length ? percentileOf(beforeSamples.map((s) => s.value)) : null;
  const after = afterSamples.length ? percentileOf(afterSamples.map((s) => s.value)) : null;

  const base: FixAssessment = {
    outcome: "insufficient_data",
    before,
    after,
    delta: null,
    samples: { before: beforeSamples.length, after: afterSamples.length },
    reason: "",
  };

  if (beforeSamples.length < minSamples || afterSamples.length < minSamples) {
    return {
      ...base,
      reason: `Düzeltmeyi değerlendirmek için her iki dönemde en az ${minSamples} ölçüm gerekir (önce: ${beforeSamples.length}, sonra: ${afterSamples.length}).`,
    };
  }
  if (before === null || after === null) {
    return { ...base, reason: "Ölçümler okunamadı." };
  }

  const delta = after - before;
  const relative = before === 0 ? null : delta / before;
  // A change only counts when it is meaningful: a relative change of at
  // least `thresholdRelative`, or — when the previous value was zero — an
  // absolute change of at least `thresholdAbsolute`.
  const meaningful =
    relative !== null
      ? Math.abs(relative) >= thresholdRelative
      : Math.abs(delta) >= thresholdAbsolute;

  if (!meaningful) {
    return {
      ...base,
      delta,
      outcome: "inconclusive",
      reason: `Değişim anlamlı değil (${Math.round(delta)} ms, ${relative === null ? "%0" : `%${Math.round(relative * 100)}`}).`,
    };
  }
  return {
    ...base,
    delta,
    outcome: delta < 0 ? "improved" : "regressed",
    reason: `p75 ${Math.round(delta)} ms ${delta < 0 ? "iyileşti" : "kötüleşti"}.`,
  };
}

/** Percentile of a list of numbers (nearest rank). */
export function percentileOf(values: number[], fraction = 0.75): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}
