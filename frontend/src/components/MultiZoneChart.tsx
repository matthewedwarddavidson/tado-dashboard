import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { DayReport, DataInterval, ZoneSetting, Zone } from "../api";

export type SeriesKey = "measured" | "setPoint" | "humidity" | "heating";

interface SeriesConfig {
  label: string;
  axis: "temp" | "pct";
  strokeDasharray?: string;
}

export const SERIES_CONFIG: Record<SeriesKey, SeriesConfig> = {
  measured: { label: "Measured °C", axis: "temp" },
  setPoint: { label: "Set point °C", axis: "temp", strokeDasharray: "4 2" },
  humidity: { label: "Humidity %",   axis: "pct",  strokeDasharray: "1 4" },
  heating:  { label: "Heating %",    axis: "pct",  strokeDasharray: "6 2" },
};

export const ZONE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];

interface Props {
  zones: Zone[];
  reports: Record<number, DayReport>;
  visibleSeries: Set<SeriesKey>;
  from: string;
  to: string;
  zoneColors: Record<number, string>;
}

function atInterval<T>(intervals: DataInterval<T>[], ts: string): T | undefined {
  return intervals.find((i) => i.from <= ts && ts < i.to)?.value;
}

function heatLevel(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  return value === "NONE" ? 0 : value === "LOW" ? 33 : value === "MEDIUM" ? 66 : 100;
}

type ChartRow = Record<string, string | number | undefined>;

function buildChartData(
  zones: Zone[],
  reports: Record<number, DayReport>,
  from: string,
  to: string
): ChartRow[] {
  const zonesWithData = zones.filter((z) => reports[z.id]);
  if (zonesWithData.length === 0) return [];

  // Pre-build per-zone lookup maps so we don't iterate inside the timestamp loop
  const zoneMaps = zonesWithData.map((zone) => {
    const report = reports[zone.id];
    const tempPoints = report.measuredData?.insideTemperature?.dataPoints ?? [];
    const humidPoints = report.measuredData?.humidity?.dataPoints ?? [];
    return {
      zoneId: zone.id,
      tempByTs:  new Map(tempPoints.map((dp) => [dp.timestamp, dp.value?.celsius])),
      humidByTs: new Map(humidPoints.map((dp) => [dp.timestamp, dp.value * 100])),
      settingIntervals: (report.settings?.dataIntervals ?? []) as DataInterval<ZoneSetting>[],
      heatIntervals:    (report.callForHeat?.dataIntervals ?? []) as DataInterval<string>[],
    };
  });

  // Collect timestamps, filtered to the [from, to] range
  const fromMs = new Date(from).getTime();
  const toMs   = new Date(to).getTime();
  const allTimestamps = new Set<string>();
  for (const { tempByTs, humidByTs } of zoneMaps) {
    for (const ts of tempByTs.keys()) {
      const ms = parseISO(ts).getTime();
      if (ms >= fromMs && ms <= toMs) allTimestamps.add(ts);
    }
    for (const ts of humidByTs.keys()) {
      const ms = parseISO(ts).getTime();
      if (ms >= fromMs && ms <= toMs) allTimestamps.add(ts);
    }
  }

  return [...allTimestamps].sort().map((ts) => {
    const row: ChartRow = {
      time: ts, // keep raw ISO for sorting; formatted in XAxis tickFormatter
    };

    for (const { zoneId, tempByTs, humidByTs, settingIntervals, heatIntervals } of zoneMaps) {
      const measured = tempByTs.get(ts);
      const humidity = humidByTs.get(ts);
      const setting  = atInterval(settingIntervals, ts);
      const hl       = heatLevel(atInterval(heatIntervals, ts));

      if (measured != null) row[`${zoneId}_measured`] = measured;
      if (humidity != null) row[`${zoneId}_humidity`] = humidity;
      if (setting?.power === "ON" && setting.temperature) {
        row[`${zoneId}_setPoint`] = setting.temperature.celsius;
      }
      if (hl != null) row[`${zoneId}_heating`] = hl;
    }

    return row;
  });
}

export function MultiZoneChart({ zones, reports, visibleSeries, from, to, zoneColors }: Props) {
  const zonesWithData = zones.filter((z) => reports[z.id]);
  const data = buildChartData(zonesWithData, reports, from, to);

  const multiDay = from.substring(0, 10) !== to.substring(0, 10);
  const tickFormatter = (ts: string) =>
    multiDay
      ? format(parseISO(ts), "dd/MM HH:mm")
      : format(parseISO(ts), "HH:mm");

  // Show ~12 ticks regardless of data density
  const tickInterval = Math.max(0, Math.floor(data.length / 12) - 1);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="time"
            tickFormatter={tickFormatter}
            tick={{ fontSize: 11 }}
            interval={tickInterval}
          />
          <YAxis yAxisId="temp" domain={["auto", "auto"]} unit="°C" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value, name) => {
              const num = typeof value === "number" ? value : Number(value);
              const label = String(name);
              return label.endsWith("°C")
                ? [`${num.toFixed(1)}°C`, label]
                : [`${num.toFixed(0)}%`, label];
            }}
          />
          <Legend />
          {zonesWithData.flatMap((zone) =>
            (Object.entries(SERIES_CONFIG) as [SeriesKey, SeriesConfig][])
              .filter(([key]) => visibleSeries.has(key))
              .map(([key, config]) => (
                <Line
                  key={`${zone.id}_${key}`}
                  yAxisId={config.axis}
                  type={key === "setPoint" || key === "heating" ? "stepAfter" : "monotone"}
                  dataKey={`${zone.id}_${key}`}
                  name={`${zone.name} – ${config.label}`}
                  stroke={zoneColors[zone.id]}
                  strokeDasharray={config.strokeDasharray}
                  strokeWidth={key === "measured" ? 2 : 1.5}
                  dot={false}
                  connectNulls
                />
              ))
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
