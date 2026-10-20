import { useMemo } from "react";
import {
  Activity,
  BarChart3,
  LayoutDashboard,
  Lock,
  Settings,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

type Pt = { x: number; y: number };

/** Convert a point series to a smooth SVG path (catmull-rom → cubic bezier). */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  const p = (i: number): Pt => pts[Math.max(0, Math.min(pts.length - 1, i))];
  let d = `M ${p(0).x.toFixed(1)} ${p(0).y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const c1x = p1.x + ((p2.x - p0.x) / 6) * 1;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * 1;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * 1;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * 1;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const W = 640;
const H = 230;
const SERIES = [196, 186, 191, 170, 176, 154, 160, 130, 141, 114, 124, 98, 106, 80, 87, 62];

const REFERRERS = [
  ["Direct", 42],
  ["github.com", 23],
  ["x.com", 18],
  ["Hacker News", 11],
] as const;

const PAGES = [
  ["/", 44],
  ["/sdk", 21],
  ["/blog/analytics", 18],
  ["/docs", 12],
] as const;

function BarRows({
  rows,
  max,
  suffix,
}: {
  rows: readonly (readonly [string, number])[];
  max: number;
  suffix?: string;
}) {
  return (
    <div className="bars">
      {rows.map(([label, v]) => (
        <div key={label} className="bars__row">
          <span className="bars__label">{label}</span>
          <span className="bars__track">
            <span className="bars__fill" style={{ ["--w" as string]: `${Math.round((v / max) * 100)}%` }} />
          </span>
          <span className="bars__val">
            {v}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The hero product mock — a DYNAMIC Console dashboard built from markup so
 * every element can carry brand styling and entrance animations (no raster
 * screenshot of someone else's product). Numbers are illustrative demo data.
 */
export default function DashMock() {
  const pts = useMemo<Pt[]>(
    () => SERIES.map((y, i) => ({ x: (i / (SERIES.length - 1)) * (W - 12) + 6, y })),
    [],
  );
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];

  return (
    <div className="dash">
      <div className="dash__chrome">
        <span className="dash__dot dash__dot--a" aria-hidden />
        <span className="dash__dot dash__dot--b" aria-hidden />
        <span className="dash__dot dash__dot--c" aria-hidden />
        <span className="dash__url">
          <Lock size={10} strokeWidth={2.4} aria-hidden /> app.dynamic.crty-dev.com
        </span>
        <span className="dash__demo">demo data</span>
      </div>

      <div className="dash__body">
        <div className="dash__side" aria-hidden>
          <span className="dash__branddot" title="DYNAMIC" />
          <span className="dash__nav is-active" title="Overview">
            <LayoutDashboard size={17} strokeWidth={1.9} />
          </span>
          <span className="dash__nav" title="Analytics">
            <BarChart3 size={17} strokeWidth={1.9} />
          </span>
          <span className="dash__nav" title="RUM">
            <Activity size={17} strokeWidth={1.9} />
          </span>
          <span className="dash__nav" title="Settings">
            <Settings size={17} strokeWidth={1.9} />
          </span>
        </div>

        <div className="dash__main">
          <div className="dash__head">
            <span className="dash__title">Overview</span>
            <span className="dash__range" aria-hidden>
              <span>24h</span>
              <span className="is-active">7d</span>
              <span>30d</span>
            </span>
          </div>

          <div className="dash__kpis">
            <div className="kpi">
              <span className="kpi__label">Visitors</span>
              <span className="kpi__row">
                <span className="kpi__value">20,342</span>
                <span className="kpi__delta">
                  <TrendingUp size={11} strokeWidth={2.6} aria-hidden /> 12.4%
                </span>
              </span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Pageviews</span>
              <span className="kpi__row">
                <span className="kpi__value">86,102</span>
                <span className="kpi__delta">
                  <TrendingUp size={11} strokeWidth={2.6} aria-hidden /> 8.1%
                </span>
              </span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Avg LCP</span>
              <span className="kpi__row">
                <span className="kpi__value">1.2 s</span>
                <span className="kpi__delta">
                  <TrendingDown size={11} strokeWidth={2.6} aria-hidden /> 0.3 s
                </span>
              </span>
            </div>
            <div className="kpi">
              <span className="kpi__label">Bounce</span>
              <span className="kpi__row">
                <span className="kpi__value">38.2%</span>
                <span className="kpi__delta">
                  <TrendingDown size={11} strokeWidth={2.6} aria-hidden /> 1.8%
                </span>
              </span>
            </div>
          </div>

          <div className="dash__chart">
            <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
              <defs>
                <linearGradient id="dash-line" x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#1d72fc" />
                  <stop offset="1" stopColor="#24d2cd" />
                </linearGradient>
                <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#24d2cd" stopOpacity="0.30" />
                  <stop offset="0.7" stopColor="#1d72fc" stopOpacity="0.10" />
                  <stop offset="1" stopColor="#1d72fc" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[48, 100, 152, 204].map((gy) => (
                <line key={gy} x1="0" x2={W} y1={gy} y2={gy} stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
              ))}
              <path className="dash__area" d={`${line} L ${last.x + 6} 208 L 6 208 Z`} fill="url(#dash-area)" />
              <path
                className="dash__line"
                d={line}
                fill="none"
                stroke="url(#dash-line)"
                strokeWidth="3"
                strokeLinecap="round"
                pathLength={1}
              />
              <circle className="dash__pulse-ring" cx={last.x} cy={last.y} r="5" />
              <circle className="dash__pulse" cx={last.x} cy={last.y} r="4.2" />
            </svg>
            <div className="dash__tip" aria-hidden>
              <b>20,342</b>
              <span>visitors · today</span>
            </div>
          </div>

          <div className="dash__gridmem">
            <div className="dash__panel">
              <span className="dash__panel-h">Top referrers</span>
              <BarRows rows={REFERRERS} max={45} suffix="%" />
            </div>
            <div className="dash__panel">
              <span className="dash__panel-h">Top pages</span>
              <BarRows rows={PAGES} max={46} suffix="%" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
