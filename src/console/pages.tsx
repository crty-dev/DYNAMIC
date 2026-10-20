import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  Crosshair,
  Gauge,
  Globe2,
  ListTree,
  MousePointerClick,
  Search,
  Settings as SettingsIcon,
  Target,
  Timer,
  Zap,
} from "lucide-react";
import {
  fmtBucket,
  fmtInt,
  fmtMetric,
  useConsole,
  useRumPages,
  type AnalyticsSummary,
  type RumMetric,
} from "./stats";

/* ------------------------------------------------------------------ shared */

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="console__empty">
      <strong>{title}</strong>
      {hint}
    </div>
  );
}

function Kpi({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: React.ReactNode;
}) {
  return (
    <article className="console__card">
      <p className="console__kpi-label">{label}</p>
      <p className="console__kpi-value">{value}</p>
      {meta ? <p className="console__kpi-meta">{meta}</p> : null}
    </article>
  );
}

function TableCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="console__card console__card--flush">
      <header className="console__card-head">
        <h2>
          {icon}
          {title}
        </h2>
        {action}
      </header>
      <div className="console__table-wrap">{children}</div>
    </section>
  );
}

function TrafficChart({
  analytics,
  height = 260,
}: {
  analytics: AnalyticsSummary;
  height?: number;
}) {
  const data = useMemo(
    () =>
      analytics.series.map((point) => ({
        label: fmtBucket(point.t, analytics.range),
        visitors: point.visitors,
        pageviews: point.pageviews,
      })),
    [analytics.series, analytics.range],
  );

  if (analytics.totals.events === 0) {
    return (
      <EmptyState
        title="No traffic yet"
        hint="Install the SDK and the first pageview draws the chart."
      />
    );
  }

  return (
    <>
      <div className="console__chart" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="console-visitors" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#23d8ca" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#23d8ca" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="console-pageviews" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1d70fd" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#1d70fd" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(32,169,222,0.10)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#7f99ad", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={18}
            />
            <YAxis
              tick={{ fill: "#7f99ad", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={46}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#081827",
                border: "1px solid rgba(35,216,202,0.44)",
                borderRadius: 8,
                fontSize: 12,
                color: "#f2f8ff",
              }}
              labelStyle={{ color: "#a9bfd2" }}
            />
            <Area
              type="monotone"
              dataKey="pageviews"
              stroke="#1d70fd"
              strokeWidth={2}
              fill="url(#console-pageviews)"
            />
            <Area
              type="monotone"
              dataKey="visitors"
              stroke="#23d8ca"
              strokeWidth={2}
              fill="url(#console-visitors)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="console__legend">
        <span>
          <i /> Visitors
        </span>
        <span>
          <i className="is-blue" /> Pageviews
        </span>
      </div>
    </>
  );
}

function CountTable({
  rows,
  label,
  empty,
}: {
  rows: { label: string; n: number }[];
  label: string;
  empty: string;
}) {
  if (rows.length === 0) return <EmptyState title={empty} hint="Nothing recorded in this window." />;
  const max = Math.max(1, ...rows.map((row) => row.n));
  return (
    <table className="console__table">
      <thead>
        <tr>
          <th>{label}</th>
          <th style={{ textAlign: "right" }}>Events</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>
              <span className="mono">{row.label}</span>
              <span className="console__meter">
                <i style={{ width: `${Math.round((row.n / max) * 100)}%` }} />
              </span>
            </td>
            <td className="num">{fmtInt(row.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopPagesTable({ analytics }: { analytics: AnalyticsSummary }) {
  if (analytics.topPages.length === 0) {
    return (
      <EmptyState title="No pageviews yet" hint="Send a pageview from the SDK to fill this table." />
    );
  }
  const max = Math.max(1, ...analytics.topPages.map((row) => row.n));
  return (
    <table className="console__table">
      <thead>
        <tr>
          <th>Path</th>
          <th style={{ textAlign: "right" }}>Views</th>
        </tr>
      </thead>
      <tbody>
        {analytics.topPages.map((row) => (
          <tr key={row.path}>
            <td>
              <span className="mono">{row.path}</span>
              <span className="console__meter">
                <i style={{ width: `${Math.round((row.n / max) * 100)}%` }} />
              </span>
            </td>
            <td className="num">{fmtInt(row.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DevicePanel({ analytics }: { analytics: AnalyticsSummary }) {
  const totals = new Map<string, number>();
  for (const row of analytics.devices) {
    totals.set(row.device, (totals.get(row.device) ?? 0) + row.n);
  }
  const rows = [...totals.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  if (rows.length === 0) return <EmptyState title="No device data" hint="Devices come from the User-Agent." />;
  const total = rows.reduce((sum, row) => sum + row.n, 0) || 1;
  return (
    <div>
      {rows.map((row) => (
        <div className="console__vital" key={row.name}>
          <div className="console__vital-head">
            <b>{row.name}</b>
            <span>{Math.round((row.n / total) * 100)}%</span>
          </div>
          <div className="console__bar">
            <i className="is-good" style={{ width: `${(row.n / total) * 100}%` }} />
          </div>
          <div className="console__vital-meta">
            <span>{fmtInt(row.n)} events</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GoalsPanel({ analytics }: { analytics: AnalyticsSummary }) {
  if (analytics.goals.length === 0) {
    return (
      <EmptyState
        title="No conversions yet"
        hint="Define a goal in the admin API and match it with a custom event."
      />
    );
  }
  return (
    <table className="console__table">
      <thead>
        <tr>
          <th>Goal</th>
          <th style={{ textAlign: "right" }}>Conversions</th>
          <th style={{ textAlign: "right" }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {analytics.goals.map((goal) => (
          <tr key={goal.name}>
            <td className="mono">{goal.name}</td>
            <td className="num">{fmtInt(goal.n)}</td>
            <td className="num">{fmtInt(Math.round(goal.value))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VitalCard({ metric }: { metric: RumMetric }) {
  const total = metric.good + metric.needsImprovement + metric.poor || 1;
  return (
    <article className="console__card">
      <p className="console__kpi-label">{metric.metric}</p>
      <p className="console__kpi-value">
        {metric.p75 !== null ? fmtMetric(metric.metric, metric.p75) : "—"}
      </p>
      <p className="console__kpi-meta">
        {metric.sufficient ? (
          <>
            p75 · {fmtInt(metric.samples)} samples · avg {fmtMetric(metric.metric, metric.avg)}
          </>
        ) : (
          <span className="console__kpi-insufficient">{metric.note}</span>
        )}
      </p>
      <div className="console__bar" style={{ marginTop: 12 }}>
        <i className="is-good" style={{ width: `${(metric.good / total) * 100}%` }} />
        <i className="is-mid" style={{ width: `${(metric.needsImprovement / total) * 100}%` }} />
        <i className="is-poor" style={{ width: `${(metric.poor / total) * 100}%` }} />
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- overview */

export function Overview() {
  const { analytics, rum, isLoading } = useConsole();
  if (!analytics) {
    return (
      <div className="console__grid console__grid--kpi">
        {isLoading ? "Loading…" : "No data"}
      </div>
    );
  }

  const lcp = rum?.metrics.find((metric) => metric.metric === "LCP");

  return (
    <>
      <div className="console__grid console__grid--kpi">
        <Kpi
          label="Visitors"
          value={fmtInt(analytics.totals.visitors)}
          meta={`${fmtInt(analytics.totals.sessions)} sessions`}
        />
        <Kpi label="Pageviews" value={fmtInt(analytics.totals.pageviews)} meta="tracked pages" />
        <Kpi
          label="Events"
          value={fmtInt(analytics.totals.events)}
          meta={`${fmtInt(analytics.totals.customEvents)} custom`}
        />
        <Kpi
          label="Conversions"
          value={fmtInt(analytics.totals.conversions)}
          meta={`${fmtInt(analytics.totals.goals)} goal hits`}
        />
      </div>

      <div className="console__grid console__grid--3">
        <section className="console__card">
          <header className="console__card-head">
            <h2>
              <Activity size={16} aria-hidden />
              Traffic
            </h2>
            <span>{analytics.range}</span>
          </header>
          <div className="console__card-body">
            <TrafficChart analytics={analytics} />
          </div>
        </section>

        <section className="console__card console__card--flush">
          <header className="console__card-head">
            <h2>
              <Crosshair size={16} aria-hidden />
              Realtime
            </h2>
            <span>last 30 min</span>
          </header>
          <div className="console__card-body">
            <div className="console__realtime">
              <div>
                <p className="console__kpi-label">Events</p>
                <p className="console__kpi-value">{fmtInt(analytics.realtime.events)}</p>
              </div>
              <div>
                <p className="console__kpi-label">Active sessions</p>
                <p className="console__kpi-value">{fmtInt(analytics.realtime.activeSessions)}</p>
              </div>
            </div>
            <div className="console__legend">
              {analytics.realtime.topPages.map((row) => (
                <span key={row.path}>
                  <i /> {row.path} · {fmtInt(row.n)}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="console__grid console__grid--2">
        <TableCard title="Top pages" icon={<ListTree size={16} aria-hidden />}>
          <TopPagesTable analytics={analytics} />
        </TableCard>
        <TableCard title="Devices" icon={<Globe2 size={16} aria-hidden />}>
          <div className="console__card-body">
            <DevicePanel analytics={analytics} />
          </div>
        </TableCard>
      </div>

      <div className="console__grid console__grid--2">
        <TableCard title="Referrers" icon={<ArrowUpRight size={16} aria-hidden />}>
          <CountTable
            label="Referrer"
            empty="No referrer data"
            rows={analytics.referrers.map((row) => ({ label: row.referrer, n: row.n }))}
          />
        </TableCard>
        <TableCard title="Conversions" icon={<Target size={16} aria-hidden />}>
          <GoalsPanel analytics={analytics} />
        </TableCard>
      </div>

      <div className="console__grid console__grid--kpi">
        {rum?.metrics.slice(0, 4).map((metric) => (
          <Kpi
            key={metric.metric}
            label={`${metric.metric} p75`}
            value={metric.sufficient ? fmtMetric(metric.metric, metric.p75) : "—"}
            meta={
              metric.sufficient
                ? `${fmtInt(metric.samples)} samples`
                : "not enough data for a percentile"
            }
          />
        ))}
        {lcp ? null : null}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- analytics */

export function Analytics() {
  const { analytics } = useConsole();
  if (!analytics) return null;
  return (
    <>
      <div className="console__grid console__grid--kpi">
        <Kpi label="Pageviews" value={fmtInt(analytics.totals.pageviews)} />
        <Kpi label="Visitors" value={fmtInt(analytics.totals.visitors)} />
        <Kpi label="Custom events" value={fmtInt(analytics.totals.customEvents)} />
        <Kpi label="Conversions" value={fmtInt(analytics.totals.conversions)} />
      </div>
      <div className="console__grid">
        <section className="console__card">
          <header className="console__card-head">
            <h2>
              <ArrowUpRight size={16} aria-hidden />
              Visitors & pageviews
            </h2>
            <span>{analytics.range}</span>
          </header>
          <div className="console__card-body">
            <TrafficChart analytics={analytics} height={300} />
          </div>
        </section>
      </div>
      <div className="console__grid console__grid--2">
        <TableCard title="Referrers" icon={<ArrowUpRight size={16} aria-hidden />}>
          <CountTable
            label="Referrer"
            empty="No referrer data"
            rows={analytics.referrers.map((row) => ({ label: row.referrer, n: row.n }))}
          />
        </TableCard>
        <TableCard title="Campaigns" icon={<Target size={16} aria-hidden />}>
          <CountTable
            label="Campaign"
            empty="No UTM campaigns"
            rows={analytics.campaigns.map((row) => ({
              label: [row.source, row.medium, row.campaign].filter(Boolean).join(" · ") || "—",
              n: row.n,
            }))}
          />
        </TableCard>
      </div>
      <div className="console__grid console__grid--2">
        <TableCard title="Countries" icon={<Globe2 size={16} aria-hidden />}>
          <CountTable
            label="Country"
            empty="No country data"
            rows={analytics.countries.map((row) => ({ label: row.country, n: row.n }))}
          />
        </TableCard>
        <TableCard title="Custom events" icon={<MousePointerClick size={16} aria-hidden />}>
          <CountTable
            label="Event"
            empty="No custom events"
            rows={analytics.customEvents.map((row) => ({ label: row.name, n: row.n }))}
          />
        </TableCard>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- rum */

export function Rum() {
  const { rum, range } = useConsole();
  const [metric, setMetric] = useState("LCP");
  const pages = useRumPages(range, metric);
  if (!rum) return null;

  return (
    <>
      <div className="console__grid console__grid--kpi">
        {rum.metrics.map((entry) => (
          <VitalCard key={entry.metric} metric={entry} />
        ))}
      </div>

      <div className="console__grid console__grid--3">
        <section className="console__card console__card--flush">
          <header className="console__card-head">
            <h2>
              <Timer size={16} aria-hidden />
              Slowest paths ({metric})
            </h2>
            <div className="console__range" role="group" aria-label="Metric">
              {rum.metrics.map((entry) => (
                <button
                  key={entry.metric}
                  type="button"
                  className={metric === entry.metric ? "is-active" : undefined}
                  onClick={() => setMetric(entry.metric)}
                >
                  {entry.metric}
                </button>
              ))}
            </div>
          </header>
          {!pages.data || pages.data.pages.length === 0 ? (
            <EmptyState title="No samples" hint="Vital samples arrive with the next pageview." />
          ) : (
            <table className="console__table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th style={{ textAlign: "right" }}>Samples</th>
                  <th style={{ textAlign: "right" }}>Avg</th>
                  <th style={{ textAlign: "right" }}>p75</th>
                </tr>
              </thead>
              <tbody>
                {pages.data.pages.map((row) => (
                  <tr key={row.path}>
                    <td className="mono">{row.path}</td>
                    <td className="num">{fmtInt(row.samples)}</td>
                    <td className="num">{fmtMetric(metric, row.avg)}</td>
                    <td className="num">{row.p75 === null ? "—" : fmtMetric(metric, row.p75)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="console__card">
          <header className="console__card-head">
            <h2>
              <Gauge size={16} aria-hidden />
              How to read this
            </h2>
          </header>
          <div className="console__card-body">
            <p className="console__note">
              These are <strong>field data</strong> collected in real browsers with the Google
              web-vitals library — no lab numbers are mixed in. A percentile is only shown once
              enough samples exist ({rum.minSamples}+); before that the card stays empty instead of
              showing a made-up number.
            </p>
            <div className="console__legend">
              <span>
                <i /> good
              </span>
              <span>
                <i className="is-blue" /> needs improvement
              </span>
              <span>
                <i className="is-red" /> poor
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- events */

export function Events() {
  const { analytics, query, setQuery } = useConsole();
  if (!analytics) return null;
  const needle = query.trim().toLowerCase();
  const rows = analytics.customEvents.filter((row) => row.name.toLowerCase().includes(needle));

  return (
    <div className="console__grid">
      <div className="console__filter">
        <label className="console__search console__search--inline">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Filter events by name"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter custom events"
          />
        </label>
      </div>
      <TableCard
        title="Custom events"
        icon={<MousePointerClick size={16} aria-hidden />}
        action={<span>{rows.length} shown</span>}
      >
        <CountTable
          label="Event"
          empty={needle ? "Nothing matches" : "No custom events"}
          rows={rows.map((row) => ({ label: row.name, n: row.n }))}
        />
      </TableCard>
    </div>
  );
}

/* ------------------------------------------------------------------ pages */

export function Pages() {
  const { analytics } = useConsole();
  if (!analytics) return null;
  return (
    <div className="console__grid console__grid--2">
      <TableCard title="Top paths" icon={<ListTree size={16} aria-hidden />}>
        <TopPagesTable analytics={analytics} />
      </TableCard>
      <TableCard title="Countries" icon={<Globe2 size={16} aria-hidden />}>
        <CountTable
          label="Country"
          empty="No country data"
          rows={analytics.countries.map((row) => ({ label: row.country, n: row.n }))}
        />
      </TableCard>
    </div>
  );
}

/* --------------------------------------------------------------- settings */

export function Settings() {
  const { analytics } = useConsole();
  const site = analytics?.site ?? null;
  return (
    <div className="console__grid console__grid--2">
      <section className="console__card">
        <header className="console__card-head">
          <h2>
            <SettingsIcon size={16} aria-hidden />
            Site
          </h2>
        </header>
        <div className="console__card-body">
          <dl className="console__kv">
            <div>
              <dt>Site key</dt>
              <dd className="mono">{site?.id ?? "—"}</dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd className="mono">{site?.origin ?? "—"}</dd>
            </div>
            <div>
              <dt>Collect</dt>
              <dd className="mono">POST /api/collect</dd>
            </div>
            <div>
              <dt>Analytics</dt>
              <dd className="mono">GET /api/analytics/summary</dd>
            </div>
            <div>
              <dt>RUM</dt>
              <dd className="mono">GET /api/rum/summary</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="console__card">
        <header className="console__card-head">
          <h2>
            <Zap size={16} aria-hidden />
            Install the SDK
          </h2>
        </header>
        <div className="console__card-body">
          {/* The snippet is rendered as text, so the closing tag needs no escaping. */}
          <pre className="console__code">{`<script
  async
  src="https://dynamic.crty-dev.com/js/dynamic.js"
  data-site="${site?.id ?? "your-site-key"}"
></script>`}</pre>
          <p className="console__note">
            Analytics and Web Vitals in one snippet. No cookies, no personal data; the session id
            rotates and the visitor can opt out with{" "}
            <code>dynamic.optOut()</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
