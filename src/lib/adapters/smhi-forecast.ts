import type { Forecast, ForecastPoint } from "../types";
import { phenomenonFromSymbol } from "../weather/phenomena";

export type SmhiForecastRaw = {
  createdTime: string;
  referenceTime: string;
  geometry: { coordinates: [number, number] };
  timeSeries: Array<{
    time: string;
    intervalParametersStartTime?: string;
    data: Record<string, number>;
  }>;
};

const MISSING = 9999;

function num(d: Record<string, number>, key: string): number | undefined {
  const v = d[key];
  return typeof v === "number" && v !== MISSING && v !== -9 ? v : undefined;
}

export function normalizeSmhiForecast(raw: SmhiForecastRaw): Forecast {
  const points: ForecastPoint[] = raw.timeSeries.map((ts) => {
    const d = ts.data;
    const cloudBaseRaw = d.cloud_base_altitude;
    const visKm = num(d, "visibility_in_air");
    const symbolCode = num(d, "symbol_code");
    const thunder = num(d, "thunderstorm_probability");
    let phenomenon = phenomenonFromSymbol(symbolCode);
    // Åska lyfts fram även när symbolen visar regn, om sannolikheten är hög.
    if (thunder !== undefined && thunder >= 40 && phenomenon?.kind !== "åska") {
      phenomenon = { kind: "åska", label: `Risk för åska (${Math.round(thunder)} %)`, code: String(symbolCode ?? "") };
    }
    return {
      timestamp: ts.time,
      intervalStart: ts.intervalParametersStartTime,
      temperatureC: num(d, "air_temperature"),
      relativeHumidity: num(d, "relative_humidity"),
      windDirectionDeg: num(d, "wind_from_direction"),
      windSpeedMs: num(d, "wind_speed"),
      windGustMs: num(d, "wind_speed_of_gust"),
      visibilityM: visKm !== undefined ? Math.min(10000, Math.round(visKm * 1000)) : undefined,
      // 9999 = inga moln → undefined, men molnighet 0 säger samma sak.
      cloudBaseM: cloudBaseRaw !== undefined && cloudBaseRaw !== MISSING ? cloudBaseRaw : undefined,
      cloudCoverOktas: num(d, "cloud_area_fraction"),
      lowCloudCoverOktas: num(d, "low_type_cloud_area_fraction"),
      midCloudCoverOktas: num(d, "medium_type_cloud_area_fraction"),
      highCloudCoverOktas: num(d, "high_type_cloud_area_fraction"),
      precipitationMm: num(d, "precipitation_amount_mean"),
      precipitationMaxMm: num(d, "precipitation_amount_max"),
      precipitationMedianMm: num(d, "precipitation_amount_median"),
      precipitationProbability: num(d, "probability_of_precipitation"),
      thunderProbability: thunder,
      symbolCode,
      phenomenon,
    };
  });
  const [lon, lat] = raw.geometry.coordinates;
  return {
    source: "SMHI",
    model: "snow1g",
    createdTime: raw.createdTime,
    referenceTime: raw.referenceTime,
    latitude: lat,
    longitude: lon,
    points,
  };
}
