import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtInt } from "../api";

/**
 * The traffic chart of the console.
 *
 * recharts is only used here and the component is loaded lazily, so the
 * charting runtime does not weigh down the first paint of the console.
 */

type Point = { t: number; pageviews: number; visitors: number; events?: number };

function bucketLabel(range: string, ts: number): string {
  const date = new Date(ts);
  if (range === "24h") {
    return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "7d") {
    return date.toLocaleDateString("tr-TR", { weekday: "short" });
  }
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
}

export default function TrafficChart({
  series,
  range,
}: {
  series: Point[];
  range: string;
}) {
  const data = series.map((point) => ({
    ...point,
    label: bucketLabel(range, point.t),
  }));

  return (
    <div className="card stack">
      <h3 className="card__title">Trafik</h3>
      {data.every((point) => point.events === 0 && point.visitors === 0) ? (
        <p className="card__text">Bu aralıkta veri yok.</p>
      ) : (
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="visitorsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#23d8ca" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#23d8ca" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="pageviewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1963ea" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#1963ea" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(32,169,222,0.12)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#7f99ad", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(32,169,222,0.18)" }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: "#7f99ad", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f2740",
                  border: "1px solid rgba(32,169,222,0.28)",
                  borderRadius: 10,
                  color: "#f2f8ff",
                  fontSize: 12,
                }}
                labelStyle={{ color: "#a9bfd2" }}
                formatter={(value, name) => [fmtInt(Number(value ?? 0)), String(name)]}
              />
              <Area
                type="monotone"
                dataKey="pageviews"
                name="Sayfa görüntüleme"
                stroke="#1963ea"
                strokeWidth={2}
                fill="url(#pageviewsFill)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="visitors"
                name="Ziyaretçi"
                stroke="#23d8ca"
                strokeWidth={2}
                fill="url(#visitorsFill)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
