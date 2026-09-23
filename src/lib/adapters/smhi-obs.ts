import type { WeatherObservation } from "../types";
import { parseSmhiPresentWeather } from "../weather/phenomena";

/** SMHI metobs-parametrar som Väderlek använder. */
export const SMHI_PARAMS = {
  temperature: 1,
  windDirection: 3,
  windSpeed: 4,
  gust: 21,
  precipitation: 7,
  visibility: 12,
  cloudBase: 36,
  presentWeather: 13,
} as const;

export type SmhiParamName = keyof typeof SMHI_PARAMS;

/** Komprimerad stationspost från `parameter/{p}.json`. */
export type SmhiStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Tidpunkt (ms) för senaste värde */
  updated: number;
};

export type SmhiStationListRaw = {
  station: Array<{
    key: string;
    name: string;
    latitude: number;
    longitude: number;
    active: boolean;
    updated: number;
  }>;
};

export function compactStationList(raw: SmhiStationListRaw): SmhiStation[] {
  return raw.station
    .filter((s) => s.active)
    .map((s) => ({ id: s.key, name: s.name, lat: s.latitude, lon: s.longitude, updated: s.updated }));
}

export type SmhiDataRaw = {
  station?: { key: string; name: string };
  position?: Array<{ latitude: number; longitude: number; from: number; to: number }>;
  value: Array<{ date: number; value: string; quality: string }> | null;
};

export type SmhiValue = { t: number; v: number };

export function parseSmhiValues(raw: SmhiDataRaw | null): SmhiValue[] {
  if (!raw?.value) return [];
  return raw.value
    .map((x) => ({ t: x.date, v: parseFloat(x.value) }))
    .filter((x) => Number.isFinite(x.v));
}

/**
 * Slår ihop SMHI-parametrar från samma station till WeatherObservation per tidpunkt.
 */
export function mergeSmhiStation(
  station: { id: string; name: string; lat: number; lon: number; distanceKm: number },
  series: Partial<Record<SmhiParamName, SmhiValue[]>>,
): WeatherObservation[] {
  const byTime = new Map<number, WeatherObservation>();
  const get = (t: number) => {
    let o = byTime.get(t);
    if (!o) {
      o = {
        timestamp: new Date(t).toISOString(),
        source: "SMHI",
        stationId: station.id,
        stationName: station.name,
        latitude: station.lat,
        longitude: station.lon,
        distanceKm: station.distanceKm,
      };
      byTime.set(t, o);
    }
    return o;
  };

  for (const [name, values] of Object.entries(series) as Array<[SmhiParamName, SmhiValue[]]>) {
    for (const { t, v } of values) {
      const o = get(t);
      switch (name) {
        case "temperature":
          o.temperatureC = v;
          break;
        case "windDirection":
          // SMHI anger 0 vid vindstilla; riktning utan vind saknar mening.
          o.windDirectionDeg = v === 0 ? undefined : v;
          break;
        case "windSpeed":
          o.windSpeedMs = v;
          break;
        case "gust":
          o.windGustMs = v;
          break;
        case "precipitation":
          o.precipitationMm = v;
          break;
        case "visibility":
          // Över 10 km redovisas som "10 km eller mer", i linje med METAR.
          if (v >= 10000) {
            o.visibilityM = 10000;
            o.visibilityAtLeast = true;
          } else o.visibilityM = v;
          break;
        case "cloudBase":
          o.cloudBaseM = v;
          break;
        case "presentWeather":
          o.weatherPhenomena = parseSmhiPresentWeather(v);
          break;
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
