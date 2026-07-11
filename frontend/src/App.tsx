import { useEffect, useState } from "react";
import { format, eachDayOfInterval, parseISO, subHours } from "date-fns";
import { api, mergeDayReports } from "./api";
import type { Home, Zone, ZoneState, DayReport, WeatherReport, DataPoint, TemperatureValue, OutsideWeather, RateLimit } from "./api";
import { AuthPage } from "./components/AuthPage";
import { ZoneCard } from "./components/ZoneCard";
import type { SparkData } from "./components/ZoneCard";
import { MultiZoneChart, SERIES_CONFIG, ZONE_COLOURS } from "./components/MultiZoneChart";
import type { SeriesKey } from "./components/MultiZoneChart";

type AuthState = "unknown" | "authenticated" | "unauthenticated";

function nowIso(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm");
}

function hoursAgoIso(n: number): string {
  return format(subHours(new Date(), n), "yyyy-MM-dd'T'HH:mm");
}

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

const ALL_SERIES: SeriesKey[] = ["measured", "humidity", "setPoint", "heating", "outside", "outsideHumidity"];

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("unknown");
  const [homes, setHomes] = useState<Home[]>([]);
  const [selectedHome, setSelectedHome] = useState<number | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneStates, setZoneStates] = useState<Record<number, ZoneState>>({});
  const [selectedZones, setSelectedZones] = useState<number[]>([]);
  const [from, setFrom] = useState<string>(hoursAgoIso(24));
  const [to, setTo] = useState<string>(nowIso());
  const [dayReports, setDayReports] = useState<Record<number, DayReport>>({});
  const [visibleSeries, setVisibleSeries] = useState<Set<SeriesKey>>(new Set(ALL_SERIES));
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tabVisible, setTabVisible] = useState(!document.hidden);
  const [rateLimit, setRateLimit] = useState<RateLimit | null>(null);
  const [outsideTemperature, setOutsideTemperature] = useState<DataPoint<TemperatureValue>[]>([]);
  const [outsideHumidity, setOutsideHumidity] = useState<DataPoint<number>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stateRefreshIn, setStateRefreshIn] = useState(30);
  const [chartRefreshIn, setChartRefreshIn] = useState(15 * 60);

  // Pause refresh automatically when the browser tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Check auth status on mount
  useEffect(() => {
    api.getAuthStatus()
      .then((s) => setAuthState(s.status === "authenticated" ? "authenticated" : "unauthenticated"))
      .catch(() => setAuthState("unauthenticated"));
  }, []);

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
    api.getRateLimit().then((r) => { if (r) setRateLimit(r); }).catch(() => {});
  }, [selectedHome, zones]);

  // Live refresh: zone states + weather every 30 seconds (only when autoRefresh is on and tab is visible)
  useEffect(() => {
    if (selectedHome == null || zones.length === 0 || !autoRefresh || !tabVisible) return;
    setStateRefreshIn(30);
    const id = setInterval(() => {
      zones.forEach((zone) => {
        api.getZoneState(selectedHome, zone.id)
          .then((state) => setZoneStates((prev) => ({ ...prev, [zone.id]: state })))
          .catch(() => {});
      });
      api.getWeather(selectedHome).then(setWeather).catch(() => {});
      api.getRateLimit().then((r) => { if (r) setRateLimit(r); }).catch(() => {});
      setStateRefreshIn(30);
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedHome, zones, autoRefresh, tabVisible]);

  // Live chart refresh: advance 'to' every 15 minutes if it is tracking now.
  // Advancing 'to' triggers the day-report effect to re-fetch with updated data.
  useEffect(() => {
    const id = setInterval(() => {
      setTo((prev) => {
        const ageMs = Date.now() - new Date(prev).getTime();
        return ageMs < 16 * 60 * 1000 ? nowIso() : prev;
      });
      setChartRefreshIn(15 * 60);
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // 1-second countdown tick
  useEffect(() => {
    const id = setInterval(() => {
      setStateRefreshIn((n) => Math.max(0, n - 1));
      setChartRefreshIn((n) => Math.max(0, n - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch high-resolution outside temperature from Open-Meteo whenever date range changes
  useEffect(() => {
    if (selectedHome == null) return;
    const fromDate = from.substring(0, 10);
    const toDate   = to.substring(0, 10);
    api.getOutsideWeather(selectedHome, fromDate, toDate)
      .then((data: OutsideWeather) => {
        setOutsideTemperature(data.temperature);
        setOutsideHumidity(data.humidity);
      })
      .catch(() => { setOutsideTemperature([]); setOutsideHumidity([]); });
  }, [selectedHome, from, to]);

  // Load day reports for all selected zones whenever selection or date range changes
  useEffect(() => {
    if (selectedHome == null) return;
    setDayReports({});
    if (selectedZones.length === 0) return;

    const dates = eachDayOfInterval({
      start: parseISO(from),
      end:   parseISO(to),
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
  }, [selectedHome, selectedZones, from, to]);

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
  const isLiveChart = Date.now() - new Date(to).getTime() < 16 * 60 * 1000;

  // Stable colour per zone based on its position in the full zones list
  const zoneColourMap: Record<number, string> = Object.fromEntries(
    zones.map((z, i) => [z.id, ZONE_COLOURS[i % ZONE_COLOURS.length]])
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

  if (authState === "unknown") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (authState !== "authenticated") {
    return <AuthPage />;
  }

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
          <div className="ml-auto text-sm text-gray-500 flex items-center gap-4">
            <span>Outside: {weather.outsideTemperature.celsius.toFixed(1)}°C</span>
            <span>💧 {weather.relativeHumidity.percentage.toFixed(0)}%</span>
            {zones.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-gray-400 border-l pl-4">
                <button
                  onClick={() => setAutoRefresh((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                    autoRefresh ? "bg-green-400" : "bg-gray-300"
                  }`}
                  title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    autoRefresh ? "translate-x-[18px]" : "translate-x-0.5"
                  }`} />
                </button>
                {autoRefresh ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    readings in {fmtCountdown(stateRefreshIn)}
                  </span>
                ) : (
                  <span>paused</span>
                )}
                {rateLimit != null && (
                  <span className={`border-l pl-3 ${
                    rateLimit.remaining === 0 ? "text-red-400" : ""
                  }`}>
                    {rateLimit.remaining === 0
                      ? `⚠️ API limit reached${
                          rateLimit.refillInSecs
                            ? ` — refills in ${fmtCountdown(rateLimit.refillInSecs)}`
                            : ""
                        }`
                      : `${rateLimit.remaining.toLocaleString("en-GB")} req left`}
                  </span>
                )}
              </div>
            )}
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
                    ? { boxShadow: `0 0 0 2px ${zoneColourMap[zone.id]}` }
                    : undefined}
                >
                  <ZoneCard
                    zone={zone}
                    state={zoneStates[zone.id] ?? null}
                    colour={zoneColourMap[zone.id]}
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
              {isLiveChart && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  chart in {fmtCountdown(chartRefreshIn)}
                </span>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <label>From
                  <input
                    type="datetime-local"
                    className="ml-2 border rounded-lg px-3 py-1.5 text-gray-700"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>To
                  <input
                    type="datetime-local"
                    className="ml-2 border rounded-lg px-3 py-1.5 text-gray-700"
                    value={to}
                    min={from}
                    max={nowIso()}
                    onChange={(e) => setTo(e.target.value)}
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
                from={from}
                to={to}
                zoneColours={zoneColourMap}
                outsideTemperature={outsideTemperature}
                outsideHumidity={outsideHumidity}
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
