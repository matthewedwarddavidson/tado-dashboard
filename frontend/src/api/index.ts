// Types matching the tado API v2 response shapes used by our backend proxy.

export interface AuthStatus {
  status: "authenticated" | "unauthenticated" | "pending";
  verificationUri?: string;
  userCode?: string;
  expiresIn?: number;
}

export interface Home {
  id: number;
  name: string;
}

export interface User {
  name: string;
  email: string;
  homes: Home[];
}

export interface Zone {
  id: number;
  name: string;
  type: "HEATING" | "AIR_CONDITIONING" | "HOT_WATER";
}

export interface TemperatureValue {
  celsius: number;
  fahrenheit: number;
}

export interface ZoneState {
  tadoMode: string;
  sensorDataPoints: {
    insideTemperature: { celsius: number; fahrenheit: number; timestamp: string };
    humidity: { percentage: number; timestamp: string };
  };
  activityDataPoints: {
    heatingPower?: { percentage: number; timestamp: string };
  };
  setting: {
    type: string;
    power: string;
    temperature?: TemperatureValue;
  };
}

export interface DataPoint<T> {
  timestamp: string;
  value: T;
}

export interface DataInterval<T> {
  from: string;
  to: string;
  value: T;
}

export type ZoneSetting = { type: string; power: string; temperature?: TemperatureValue };

export interface DayReport {
  zoneType: string;
  interval?: { from: string; to: string };
  measuredData: {
    insideTemperature?: { dataPoints: DataPoint<TemperatureValue>[] };
    humidity?: { dataPoints: Array<{ timestamp: string; value: number }> };
  };
  settings?: {
    dataPoints?: DataPoint<ZoneSetting>[];
    dataIntervals?: DataInterval<ZoneSetting>[];
  };
  callForHeat?: {
    dataPoints?: DataPoint<string>[];
    dataIntervals?: DataInterval<string>[];
  };
  weather?: {
    // Raw tado structure: time-keyed slots ("04:00", "08:00", etc.)
    slots?: Record<string, unknown>;
    // Normalised by mergeDayReports into chartable data points
    outsideTemperaturePoints?: DataPoint<TemperatureValue>[];
  };
}

/** Merges an ordered array of DayReports into a single report for charting. */
export function mergeDayReports(reports: DayReport[]): DayReport {
  if (reports.length === 0) throw new Error("No reports to merge");
  return {
    zoneType: reports[0].zoneType,
    measuredData: {
      insideTemperature: {
        dataPoints: reports.flatMap(
          (r) => r.measuredData?.insideTemperature?.dataPoints ?? []
        ),
      },
      humidity: {
        dataPoints: reports.flatMap(
          (r) => r.measuredData?.humidity?.dataPoints ?? []
        ),
      },
    },
    settings: {
      dataIntervals: reports.flatMap((r) => r.settings?.dataIntervals ?? []),
      dataPoints:    reports.flatMap((r) => r.settings?.dataPoints ?? []),
    },
    callForHeat: {
      dataIntervals: reports.flatMap((r) => r.callForHeat?.dataIntervals ?? []),
      dataPoints:    reports.flatMap((r) => r.callForHeat?.dataPoints ?? []),
    },
    weather: {
      // Convert time-keyed slots ("04:00" etc.) into chartable data points.
      // Use interval.to's date so the times land on the correct calendar day.
      outsideTemperaturePoints: reports.flatMap((r) => {
        // tado wraps the time-keyed entries in a nested .slots object
        const slots = (r.weather?.slots as Record<string, unknown> | undefined)?.slots as
          Record<string, { state?: string; temperature?: TemperatureValue }> | undefined;
        const date  = r.interval?.to?.substring(0, 10);
        if (!slots || !date) return [];
        return Object.entries(slots)
          .filter(([key]) => /^\d{2}:\d{2}$/.test(key))
          .flatMap(([time, slot]) =>
            slot?.temperature
              ? [{ timestamp: `${date}T${time}:00.000Z`, value: slot.temperature }]
              : []
          );
      }),
    },
  };
}

export interface WeatherReport {
  outsideTemperature: { celsius: number; fahrenheit: number; timestamp: string };
  solarIntensity: { percentage: number; timestamp: string };
  weatherState: { value: string; timestamp: string };
}

// --- API fetch helpers ---

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getAuthStatus: () => apiFetch<AuthStatus>("/api/auth/status"),

  startAuth: (): Promise<AuthStatus> =>
    fetch("/api/auth/start", { method: "POST" }).then((r) => r.json()),

  getMe: () => apiFetch<User>("/api/me"),

  getZones: (homeId: number) =>
    apiFetch<Zone[]>(`/api/homes/${homeId}/zones`),

  getZoneState: (homeId: number, zoneId: number) =>
    apiFetch<ZoneState>(`/api/homes/${homeId}/zones/${zoneId}/state`),

  getZoneDayReport: (homeId: number, zoneId: number, date: string) =>
    apiFetch<DayReport>(`/api/homes/${homeId}/zones/${zoneId}/day-report?date=${date}`),

  getWeather: (homeId: number) =>
    apiFetch<WeatherReport>(`/api/homes/${homeId}/weather`),
};
