import { useEffect, useState } from "react";
import { format, eachDayOfInterval, parseISO } from "date-fns";
import { api, mergeDayReports } from "./api";
import type { Home, Zone, ZoneState, DayReport, WeatherReport } from "./api";
import { ZoneCard } from "./components/ZoneCard";
import type { SparkData } from "./components/ZoneCard";
import { MultiZoneChart, SERIES_CONFIG, ZONE_COLORS } from "./components/MultiZoneChart";
import type { SeriesKey } from "./components/MultiZoneChart";

function today(): string {
  return format(new Date(), "yyyy-MM-dd");
}

const ALL_SERIES: SeriesKey[] = ["measured", "humidity", "setPoint", "heating"];

export default function App() {
  const [homes, setHomes] = useState<Home[]>([]);
  const [selectedHome, setSelectedHome] = useState<number | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneStates, setZoneStates] = useState<Record<number, ZoneState>>({});
  const [selectedZones, setSelectedZones] = useState<number[]>([]);
  const [fromDate, setFromDate] = useState<string>(today());
  const [toDate, setToDate] = useState<string>(today());
  const [dayReports, setDayReports] = useState<Record<number, DayReport>>({});
  const [visibleSeries, setVisibleSeries] = useState<Set<SeriesKey>>(new Set(ALL_SERIES));
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load user + homes on mount
  useEffect(() => {
    api.getMe()
      .then((me) => {
        setHomes(me.homes);
        if (me.homes.length > 0) setSelectedHome(me.homes[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Load zones + weather when home changes
  useEffect(() => {
    if (selectedHome == null) return;
    setZones([]);
    setZoneStates({});
    setSelectedZones([]);
    setDayReports({});
    setWeather(null);

    api.getZones(selectedHome)
      .then((zs) => {
        setZones(zs);
        if (zs.length > 0) setSelectedZones([zs[0].id]);
      })
      .catch((e: Error) => setError(e.message));

    api.getWeather(selectedHome)
      .then(setWeather)
      .catch(() => {/* non-fatal */});
  }, [selectedHome]);

  // Load zone states when zones change
  useEffect(() => {
    if (selectedHome == null || zones.length === 0) return;
    zones.forEach((zone) => {
      api.getZoneState(selectedHome, zone.id)
        .then((state) => setZoneStates((prev) => ({ ...prev, [zone.id]: state })))
        .catch(() => {/* show card without live state */});
    });
  }, [selectedHome, zones]);

  // Load day reports for all selected zones whenever selection or date range changes
  useEffect(() => {
    if (selectedHome == null) return;
    setDayReports({});
    if (selectedZones.length === 0) return;

    const dates = eachDayOfInterval({
      start: parseISO(fromDate),
      end:   parseISO(toDate),
    }).map((d) => format(d, "yyyy-MM-dd"));

    // Accumulate per-zone reports outside React state, then merge once all days arrive
    const accumulated: Record<number, DayReport[]> = {};
    selectedZones.forEach((zoneId) => {
      accumulated[zoneId] = [];
      dates.forEach((date) => {
        api.getZoneDayReport(selectedHome, zoneId, date)
          .then((report) => {
            accumulated[zoneId].push(report);
            if (accumulated[zoneId].length === dates.length) {
              const sorted = [...accumulated[zoneId]].sort(
                (a, b) => (a.interval?.from ?? "").localeCompare(b.interval?.from ?? "")
              );
              setDayReports((prev) => ({ ...prev, [zoneId]: mergeDayReports(sorted) }));
            }
          })
          .catch((e: Error) => setError(e.message));
      });
    });
  }, [selectedHome, selectedZones, fromDate, toDate]);

  const toggleZone = (zoneId: number) => {
    setSelectedZones((prev) =>
      prev.includes(zoneId) ? prev.filter((id) => id !== zoneId) : [...prev, zoneId]
    );
  };

  const toggleSeries = (key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least one series
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const chartZones = zones.filter((z) => selectedZones.includes(z.id));
  const reportsReady = selectedZones.some((id) => dayReports[id]);
  const multiDay = fromDate !== toDate;

  // Stable colour per zone based on its position in the full zones list
  const zoneColorMap: Record<number, string> = Object.fromEntries(
    zones.map((z, i) => [z.id, ZONE_COLORS[i % ZONE_COLORS.length]])
  );

  // Extract thinned sparkline series from each zone's day report
  const getSparkData = (zoneId: number): SparkData | undefined => {
    const report = dayReports[zoneId];
    if (!report) return undefined;
    const thinIndices = (len: number) =>
      Array.from({ length: len }, (_, i) => i).filter(
        (i) => len <= 60 || i % Math.ceil(len / 60) === 0
      );
    const tempPoints  = report.measuredData?.insideTemperature?.dataPoints ?? [];
    const humidPoints = report.measuredData?.humidity?.dataPoints ?? [];
    return {
      temp:     thinIndices(tempPoints.length).map((i) => tempPoints[i].value?.celsius ?? 0),
      humidity: thinIndices(humidPoints.length).map((i) => (humidPoints[i].value as number) * 100),
    };
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      {/* Header */}
      <header className="bg-white shadow-sm px-6 py-4 flex items-center gap-6">
        <h1 className="text-xl font-bold text-gray-800">tado° Dashboard</h1>

        {homes.length > 1 && (
          <select
            className="border rounded-lg px-3 py-1.5 text-sm text-gray-700"
            value={selectedHome ?? ""}
            onChange={(e) => setSelectedHome(Number(e.target.value))}
          >
            {homes.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        )}

        {weather && (
          <div className="ml-auto text-sm text-gray-500 flex gap-4">
            <span>Outside: {weather.outsideTemperature.celsius.toFixed(1)}°C</span>
            <span>☀️ {weather.solarIntensity.percentage.toFixed(0)}%</span>
            <span>{weather.weatherState.value.replace(/_/g, " ")}</span>
          </div>
        )}
      </header>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <main className="px-6 py-6 flex flex-col gap-8">
        {zones.length > 0 && (
          <section>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
              Current readings — click to add/remove from chart
            </p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {zones.map((zone) => (
                <div
                  key={zone.id}
                  onClick={() => toggleZone(zone.id)}
                  className={
                    "cursor-pointer transition-all rounded-2xl " +
                    (selectedZones.includes(zone.id) ? "" : "opacity-50 hover:opacity-80")
                  }
                  style={selectedZones.includes(zone.id)
                    ? { boxShadow: `0 0 0 2px ${zoneColorMap[zone.id]}` }
                    : undefined}
                >
                  <ZoneCard
                    zone={zone}
                    state={zoneStates[zone.id] ?? null}
                    color={zoneColorMap[zone.id]}
                    sparkData={getSparkData(zone.id)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Day report chart */}
        {zones.length > 0 && (
          <section>
            <div className="flex flex-wrap items-center gap-4 mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Day report
              </h2>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <label>From
                  <input
                    type="date"
                    className="ml-2 border rounded-lg px-3 py-1.5 text-gray-700"
                    value={fromDate}
                    max={toDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </label>
                <label>To
                  <input
                    type="date"
                    className="ml-2 border rounded-lg px-3 py-1.5 text-gray-700"
                    value={toDate}
                    min={fromDate}
                    max={today()}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex gap-4 ml-auto">
                {ALL_SERIES.map((key) => (
                  <label key={key} className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visibleSeries.has(key)}
                      onChange={() => toggleSeries(key)}
                      className="rounded"
                    />
                    {SERIES_CONFIG[key].label}
                  </label>
                ))}
              </div>
            </div>
            {selectedZones.length === 0 ? (
              <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-300">
                Select a room above to add it to the chart
              </div>
            ) : reportsReady ? (
              <MultiZoneChart
                zones={chartZones}
                reports={dayReports}
                visibleSeries={visibleSeries}
                multiDay={multiDay}
                zoneColors={zoneColorMap}
              />
            ) : (
              <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-400">
                Loading…
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
