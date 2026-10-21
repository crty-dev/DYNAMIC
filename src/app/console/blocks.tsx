import { fmtInt, fmtMetric } from "../api";

/**
 * The dashboard blocks of the console.
 *
 * They read the numbers the project stats endpoint already returns
 * (`summary` + `rum`), so the page needs exactly one request.
 */

export type Summary = {
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
  campaigns: { source: string | null; medium: string | null; campaign: string | null; n: number }[];
  goals: { name: string; n: number; value: number }[];
  customEvents: { name: string; n: number }[];
  realtime: { events: number; activeSessions: number; topPages: { path: string; n: number }[] };
};

export type RumMetrics = {
  metric: string;
  samples: number;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  sufficient: boolean;
  note?: string;
}[];

/* ------------------------------------------------------------------- kpis */

export function KpiCards({ summary }: { summary: Summary }) {
  const items = [
    { label: "Ziyaretçi", value: summary.totals.visitors, hint: "tekil oturum" },
    { label: "Sayfa görüntüleme", value: summary.totals.pageviews, hint: "tüm sayfalar" },
    { label: "Event", value: summary.totals.events, hint: `${summary.totals.customEvents} özel` },
    { label: "Dönüşüm", value: summary.totals.conversions, hint: "hedef eşleşmesi" },
  ];
  return (
    <div className="grid-4">
      {items.map((item) => (
        <div className="kpi" key={item.label}>
          <span>{item.label}</span>
          <b>{fmtInt(item.value)}</b>
          <small>{item.hint}</small>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- breakdowns */

function share(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** A ranked list with a share bar - used for pages, referrers, devices. */
export function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: number; hint?: string }[];
  empty?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="card stack">
      <h3 className="card__title">{title}</h3>
      {rows.length === 0 ? (
        <p className="card__text">{empty ?? "Henüz veri yok."}</p>
      ) : (
        <ul className="bars">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="bars__top">
                <span className="bars__label" title={row.label}>
                  {row.label}
                </span>
                <span className="bars__value">
                  {fmtInt(row.value)}
                  <em>{share(row.value, total)}%</em>
                </span>
              </div>
              {row.hint ? <small className="bars__hint">{row.hint}</small> : null}
              <div className="bars__track">
                <div className="bars__fill" style={{ width: `${share(row.value, total)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ vitals */

/** The thresholds of the Web Vitals (good / needs improvement). */
const VITAL_LIMITS: Record<string, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export function WebVitals({ metrics }: { metrics: RumMetrics }) {
  const order = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  const rows = order
    .map((metric) => metrics.find((entry) => entry.metric === metric))
    .filter((entry): entry is RumMetrics[number] => Boolean(entry));

  return (
    <div className="card stack">
      <h3 className="card__title">Web Vitals</h3>
      <div className="vitals">
        {rows.map((metric) => {
          const limits = VITAL_LIMITS[metric.metric] ?? { good: 0, poor: 0 };
          // A percentile is only shown when there is enough data for it.
          const value = metric.sufficient ? metric.p75 : null;
          const state =
            value === null
              ? "unknown"
              : value <= limits.good
                ? "good"
                : value <= limits.poor
                  ? "fair"
                  : "poor";
          return (
            <div className="vital" key={metric.metric} data-state={state}>
              <span className="vital__name">{metric.metric}</span>
              {value === null ? (
                <span className="vital__value vital__value--none">yeterli veri yok</span>
              ) : (
                <span className="vital__value">{fmtMetric(metric.metric, value)}</span>
              )}
              <small className="vital__meta">
                {metric.sufficient
                  ? `p75 · ${fmtInt(metric.samples)} örnek`
                  : `${fmtInt(metric.samples)} örnek`}
              </small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- realtime */

export function Realtime({ summary }: { summary: Summary }) {
  const { events, activeSessions, topPages } = summary.realtime;
  return (
    <div className="card stack">
      <h3 className="card__title">Son 30 dakika</h3>
      <div className="realtime">
        <div>
          <b>{fmtInt(events)}</b>
          <span>event</span>
        </div>
        <div>
          <b>{fmtInt(activeSessions)}</b>
          <span>aktif oturum</span>
        </div>
      </div>
      {topPages.length ? (
        <ul className="list list--tight">
          {topPages.map((row) => (
            <li className="row" key={row.path} style={{ justifyContent: "space-between" }}>
              <span className="mono">{row.path}</span>
              <span className="faint mono">{fmtInt(row.n)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card__text">Şu anda trafik yok.</p>
      )}
    </div>
  );
}
