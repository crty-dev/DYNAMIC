import { useMemo } from "react";
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
  Gauge,
  Globe2,
  ListTree,
  MousePointerClick,
  Search,
  Settings as SettingsIcon,
  Timer,
  Zap,
} from "lucide-react";
import {
  fmtBucket,
  fmtInt,
  fmtMetric,
  fmtStamp,
  ratingClass,
  uaLabel,
  useConsole,
  type Stats,
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

function TrafficChart({ stats, height = 260 }: { stats: Stats; height?: number }) {
  const data = useMemo(
    () =>
      stats.series.map((point) => ({
        label: fmtBucket(point.t, stats.range),
        visitors: point.visitors,
        pageviews: point.pageviews,
      })),
    [stats.series, stats.range],
  );

  if (stats.totals.events === 0) {
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

function TopPagesTable({ stats }: { stats: Stats }) {
  const max = Math.max(1, ...stats.topPages.map((row) => row.n));
  if (stats.topPages.length === 0) {
    return <EmptyState title="No pageviews yet" hint="Send a pageview from the SDK to fill this table." />;
  }
  return (
    <table className="console__table">
      <thead>
        <tr>
          <th>Path</th>
          <th style={{ textAlign: "right" }}>Views</th>
        </tr>
      </thead>
      <tbody>
        {stats.topPages.map((row) => (
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

function CountriesTable({ stats }: { stats: Stats }) {
  if (stats.topCountries.length === 0) {
    return <EmptyState title="No country data" hint="Country is derived from the edge request." />;
  }
  return (
    <table className="console__table">
      <thead>
        <tr>
          <th>Country</th>
          <th style={{ textAlign: "right" }}>Events</th>
        </tr>
      </thead>
      <tbody>
        {stats.topCountries.map((row) => (
          <tr key={row.country ?? "unknown"}>
            <td>{row.country ?? "—"}</td>
            <td className="num">{fmtInt(row.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VitalsPanel({ stats }: { stats: Stats }) {
  const withData = stats.vitals.filter((vital) => vital.samples > 0);
  if (withData.length === 0) {
    return <EmptyState title="No Web Vitals yet" hint="Enable vitals in the SDK to see LCP, INP and CLS." />;
  }
  return (
    <div>
      {withData.map((vital) => {
        const total = vital.ratings.good + vital.ratings["needs-improvement"] + vital.ratings.poor || 1;
        return (
          <div className="console__vital" key={vital.metric}>
            <div className="console__vital-head">
              <b>{vital.metric}</b>
              <span>{fmtMetric(vital.metric, vital.avg)}</span>
            </div>
            <div className="console__bar">
              <i
                className="is-good"
                style={{ width: `${(vital.ratings.good / total) * 100}%` }}
              />
              <i
                className="is-mid"
                style={{ width: `${(vital.ratings["needs-improvement"] / total) * 100}%` }}
              />
              <i className="is-poor" style={{ width: `${(vital.ratings.poor / total) * 100}%` }} />
            </div>
            <div className="console__vital-meta">
              <span>{fmtInt(vital.samples)} samples</span>
              <span>{Math.round((vital.ratings.good / total) * 100)}% good</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentEventsTable({ stats, limit = 12 }: { stats: Stats; limit?: number }) {
  if (stats.recent.length === 0) {
    return <EmptyState title="No events yet" hint="Install the SDK and events land here in real time." />;
  }
  return (
    <table className="console__table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Metric</th>
          <th>Path</th>
          <th className="console__hide-sm">Device</th>
          <th style={{ textAlign: "right" }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {stats.recent.slice(0, limit).map((event, index) => (
          <tr key={`${event.ts}-${index}`}>
            <td className="mono nowrap">{fmtStamp(event.ts)}</td>
            <td>
              <span className={`console__pill ${ratingClass(event.rating)}`}>{event.metric}</span>
            </td>
            <td className="mono">{event.path ?? "—"}</td>
            <td className="console__hide-sm">{uaLabel(event.ua)}</td>
            <td className="num">{fmtMetric(event.metric, event.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------------- overview */

export function Overview() {
  const { stats, isLoading } = useConsole();
  if (!stats) {
    return <div className="console__grid console__grid--kpi">{isLoading ? "Loading…" : "No data"}</div>;
  }

  const lcp = stats.vitals.find((vital) => vital.metric === "LCP");

  return (
    <>
      <div className="console__grid console__grid--kpi">
        <Kpi label="Visitors" value={fmtInt(stats.totals.visitors)} meta="unique sessions" />
        <Kpi label="Pageviews" value={fmtInt(stats.totals.pageviews)} meta="tracked pages" />
        <Kpi label="Events" value={fmtInt(stats.totals.events)} meta={`${fmtInt(stats.totals.custom)} custom`} />
        <Kpi
          label="Avg LCP"
          value={fmtMetric("LCP", lcp?.avg ?? null)}
          meta={`${fmtInt(lcp?.samples ?? 0)} samples`}
        />
      </div>

      <div className="console__grid console__grid--3">
        <section className="console__card">
          <header className="console__card-head">
            <h2>
              <Activity size={16} aria-hidden />
              Traffic
            </h2>
            <span>{stats.range}</span>
          </header>
          <div className="console__card-body">
            <TrafficChart stats={stats} />
          </div>
        </section>

        <section className="console__card console__card--flush">
          <header className="console__card-head">
            <h2>
              <Gauge size={16} aria-hidden />
              Web Vitals
            </h2>
          </header>
          <div className="console__card-body">
            <VitalsPanel stats={stats} />
          </div>
        </section>
      </div>

      <div className="console__grid console__grid--2">
        <TableCard title="Top pages" icon={<ListTree size={16} aria-hidden />}>
          <TopPagesTable stats={stats} />
        </TableCard>
        <TableCard title="Top countries" icon={<Globe2 size={16} aria-hidden />}>
          <CountriesTable stats={stats} />
        </TableCard>
      </div>

      <div className="console__grid">
        <TableCard
          title="Live events"
          icon={<MousePointerClick size={16} aria-hidden />}
          action={<span>{fmtInt(stats.recent.length)} latest</span>}
        >
          <RecentEventsTable stats={stats} />
        </TableCard>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- analytics */

export function Analytics() {
  const { stats } = useConsole();
  if (!stats) return null;
  return (
    <>
      <div className="console__grid console__grid--kpi">
        <Kpi label="Pageviews" value={fmtInt(stats.totals.pageviews)} />
        <Kpi label="Visitors" value={fmtInt(stats.totals.visitors)} />
        <Kpi label="Custom events" value={fmtInt(stats.totals.custom)} />
        <Kpi label="All events" value={fmtInt(stats.totals.events)} />
      </div>
      <div className="console__grid">
        <section className="console__card">
          <header className="console__card-head">
            <h2>
              <ArrowUpRight size={16} aria-hidden />
              Visitors & pageviews
            </h2>
            <span>{stats.range}</span>
          </header>
          <div className="console__card-body">
            <TrafficChart stats={stats} height={300} />
          </div>
        </section>
      </div>
      <div className="console__grid console__grid--2">
        <TableCard title="Top pages" icon={<ListTree size={16} aria-hidden />}>
          <TopPagesTable stats={stats} />
        </TableCard>
        <TableCard title="Top countries" icon={<Globe2 size={16} aria-hidden />}>
          <CountriesTable stats={stats} />
        </TableCard>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- rum */

export function Rum() {
  const { stats } = useConsole();
  if (!stats) return null;
  return (
    <>
      <div className="console__grid console__grid--kpi">
        {stats.vitals.slice(0, 4).map((vital) => (
          <Kpi
            key={vital.metric}
            label={vital.metric}
            value={fmtMetric(vital.metric, vital.avg)}
            meta={`${fmtInt(vital.samples)} samples`}
          />
        ))}
      </div>
      <div className="console__grid console__grid--3">
        <section className="console__card console__card--flush">
          <header className="console__card-head">
            <h2>
              <Timer size={16} aria-hidden />
              Slowest pages (LCP)
            </h2>
          </header>
          {stats.slowPages.length === 0 ? (
            <EmptyState title="No LCP samples" hint="Vitals arrive with the next pageview." />
          ) : (
            <table className="console__table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th style={{ textAlign: "right" }}>Avg LCP</th>
                </tr>
              </thead>
              <tbody>
                {stats.slowPages.map((row) => (
                  <tr key={row.path}>
                    <td className="mono">{row.path}</td>
                    <td className="num">{fmtMetric("LCP", row.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="console__card">
          <header className="console__card-head">
            <h2>
              <Zap size={16} aria-hidden />
              Rating split
            </h2>
          </header>
          <div className="console__card-body">
            <VitalsPanel stats={stats} />
          </div>
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- pages */

export function Pages() {
  const { stats } = useConsole();
  if (!stats) return null;
  return (
    <>
      <div className="console__grid console__grid--2">
        <TableCard title="All paths" icon={<ListTree size={16} aria-hidden />}>
          <TopPagesTable stats={stats} />
        </TableCard>
        <TableCard title="Top countries" icon={<Globe2 size={16} aria-hidden />}>
          <CountriesTable stats={stats} />
        </TableCard>
      </div>
      <div className="console__grid">
        <TableCard title="Slowest paths (LCP)" icon={<Timer size={16} aria-hidden />}>
          {stats.slowPages.length === 0 ? (
            <EmptyState title="No LCP samples" hint="Vitals arrive with the next pageview." />
          ) : (
            <table className="console__table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th style={{ textAlign: "right" }}>Samples</th>
                  <th style={{ textAlign: "right" }}>Avg LCP</th>
                </tr>
              </thead>
              <tbody>
                {stats.slowPages.map((row) => (
                  <tr key={row.path}>
                    <td className="mono">{row.path}</td>
                    <td className="num">{fmtInt(row.n)}</td>
                    <td className="num">{fmtMetric("LCP", row.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- settings */

export function Settings() {
  const { stats, range } = useConsole();
  const site = stats?.site ?? null;
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
              <dt>Window</dt>
              <dd className="mono">{range}</dd>
            </div>
            <div>
              <dt>Collect endpoint</dt>
              <dd className="mono">POST /api/collect</dd>
            </div>
            <div>
              <dt>Stats endpoint</dt>
              <dd className="mono">GET /api/stats</dd>
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
          <pre className="console__code">{`import { dynamic } from "@dynamic/sdk";

dynamic.init({
  site: "${site?.id ?? "your-site-key"}",
  vitals: true,
});`}</pre>
          <p className="console__note">
            One script tag or one npm install. Events are batched, validated on the edge and
            written to D1 — no cookies, no personal data.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ events */

export function Events() {
  const { stats, query, setQuery } = useConsole();
  if (!stats) return null;
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? stats.recent.filter(
        (event) =>
          (event.path ?? "").toLowerCase().includes(needle) ||
          event.metric.toLowerCase().includes(needle) ||
          (event.country ?? "").toLowerCase().includes(needle),
      )
    : stats.recent;

  return (
    <div className="console__grid">
      <div className="console__filter">
        <label className="console__search console__search--inline">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Filter by path, metric or country"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter events"
          />
        </label>
      </div>
      <TableCard
        title="Event stream"
        icon={<MousePointerClick size={16} aria-hidden />}
        action={<span>{rows.length} shown</span>}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            hint="Clear the search box to see the full stream."
          />
        ) : (
          <table className="console__table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Metric</th>
                <th>Path</th>
                <th className="console__hide-sm">Country</th>
                <th className="console__hide-sm">Device</th>
                <th style={{ textAlign: "right" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event, index) => (
                <tr key={`${event.ts}-${index}`}>
                  <td className="mono nowrap">{fmtStamp(event.ts)}</td>
                  <td>
                    <span className={`console__pill ${ratingClass(event.rating)}`}>{event.metric}</span>
                  </td>
                  <td className="mono">{event.path ?? "—"}</td>
                  <td className="console__hide-sm">{event.country ?? "—"}</td>
                  <td className="console__hide-sm">{uaLabel(event.ua)}</td>
                  <td className="num">{fmtMetric(event.metric, event.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
