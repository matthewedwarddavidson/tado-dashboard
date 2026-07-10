import type { Zone, ZoneState } from "../api";

export interface SparkData {
  temp: number[];
  humidity: number[];
}

interface Props {
  zone: Zone;
  state: ZoneState | null;
  colour?: string;
  sparkData?: SparkData;
}

function Sparkline({
  values,
  color,
  w = 72,
  h = 22,
}: {
  values: number[];
  color: string;
  w?: number;
  h?: number;
}) {
  if (values.length < 2) return <div style={{ width: w, height: h }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;

  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - pad - ((v - min) / range) * (h - pad * 2),
  }));

  // Build a smooth cubic bezier path (monotone-style) matching the main chart.
  const d = points.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    const prev = points[i - 1];
    const cpX = ((prev.x + pt.x) / 2).toFixed(1);
    return `${acc} C ${cpX},${prev.y.toFixed(1)} ${cpX},${pt.y.toFixed(1)} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }, "");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function fmt(celsius: number) {
  return `${celsius.toFixed(1)}°C`;
}

export function ZoneCard({ zone, state, colour = "#3b82f6", sparkData }: Props) {
  const temp     = state?.sensorDataPoints?.insideTemperature?.celsius;
  const humidity = state?.sensorDataPoints?.humidity?.percentage;
  const heating  = state?.activityDataPoints?.heatingPower?.percentage;
  const setPoint = state?.setting?.temperature?.celsius;
  const power    = state?.setting?.power;

  return (
    <div
      className="bg-white rounded-2xl shadow w-60 shrink-0 overflow-hidden"
      style={{ borderLeft: `4px solid ${colour}` }}
    >
      <div className="px-4 py-3 flex flex-col gap-2.5">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-gray-400">
          {zone.name}
        </h2>

        {state == null ? (
          <p className="text-gray-300 text-sm">Loading…</p>
        ) : (
          <>
            {/* Temperature */}
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold leading-none" style={{ color: colour }}>
                  {temp != null ? fmt(temp) : "—"}
                </span>
                {setPoint != null && power === "ON" && (
                  <span className="text-xs text-gray-400 ml-0.5">→ {fmt(setPoint)}</span>
                )}
              </div>
              {sparkData && <Sparkline values={sparkData.temp} color={colour} />}
            </div>

            {/* Humidity */}
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>💧 {humidity != null ? `${humidity.toFixed(0)}%` : "—"}</span>
              {sparkData && (
                <Sparkline values={sparkData.humidity} color="#06b6d4" h={16} />
              )}
            </div>

            {/* Heating — only when relevant */}
            {heating != null && heating > 0 && (
              <div className="text-sm text-gray-500">🔥 {heating.toFixed(0)}%</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
