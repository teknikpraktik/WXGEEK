import "server-only";
import { fetchJson } from "./http";
import { geometryContains, pointInRing } from "../geo";
import type { WeatherWarning } from "../types";

// ---------------------------------------------------------------------------
// SMHI impact-based weather warnings (IBWW) and aviation SIGMETs (NOAA AWC)
// ---------------------------------------------------------------------------

type IbwwText = { sv?: string; en?: string; code?: string };
type IbwwArea = {
  id: number;
  approximateStart?: string;
  approximateEnd?: string;
  areaName?: IbwwText;
  warningLevel?: IbwwText;
  eventDescription?: IbwwText;
  descriptions?: Array<{ title?: IbwwText; text?: IbwwText }>;
  area?: { geometry?: { type: string; coordinates: unknown } };
};
type IbwwWarning = { id: number; event?: IbwwText & { mhoClassification?: IbwwText }; warningAreas?: IbwwArea[] };

type AwcSigmet = {
  firId?: string;
  firName?: string;
  seriesId?: string;
  validTimeFrom: number;
  validTimeTo: number;
  hazard?: string;
  qualifier?: string;
  base?: number | null;
  top?: number | null;
  coords?: Array<{ lat: number; lon: number }>;
  rawSigmet?: string;
};

const LEVEL_RANK: Record<string, number> = { RED: 3, ORANGE: 2, YELLOW: 1, MESSAGE: 0 };
/**
 * Bara vädervarningar (meteorologi): hydrologi (vattenbrist, höga flöden, översvämning),
 * oceanografi (havsvattenstånd) och brandrisk visas inte. Både SMHI:s klassning och
 * händelsekoden kontrolleras, så att nya icke-meteorologiska händelser också faller bort.
 */
const NON_WEATHER_CLASS = new Set(["HYD", "OCE"]);
const NON_WEATHER_EVENT = new Set(["WATER_SHORTAGE", "HIGH_FLOW", "FLOODING", "LOW_SEA_LEVEL", "HIGH_SEALEVEL", "FIRE"]);
const isWeatherEvent = (e: IbwwWarning["event"]) =>
  !NON_WEATHER_CLASS.has(e?.mhoClassification?.code ?? "") && !NON_WEATHER_EVENT.has(e?.code ?? "");
const HAZARD: Record<string, string> = {
  TS: "Thunderstorms",
  TURB: "Turbulence",
  ICE: "Icing",
  MTW: "Mountain wave",
  VA: "Volcanic ash",
  TC: "Tropical cyclone",
  DS: "Dust storm",
  SS: "Sandstorm",
  RDOACT: "Radioactive cloud",
};

/** SMHI weather warnings whose area contains the point and that overlap [from, to]. */
export async function smhiWarningsAt(lat: number, lon: number, from: number, to: number): Promise<WeatherWarning[]> {
  const data = await fetchJson<IbwwWarning[]>("https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json", {
    revalidate: 300,
  });
  const out: WeatherWarning[] = [];
  for (const w of data ?? []) {
    if (!isWeatherEvent(w.event)) continue;
    for (const a of w.warningAreas ?? []) {
      if (!geometryContains(a.area?.geometry, lon, lat)) continue;
      const start = a.approximateStart ? Date.parse(a.approximateStart) : undefined;
      const end = a.approximateEnd ? Date.parse(a.approximateEnd) : undefined;
      if ((start !== undefined && start > to) || (end !== undefined && end < from)) continue;
      const incident = a.descriptions?.find((d) => d.title?.code === "INCIDENT")?.text;
      out.push({
        id: `smhi-${a.id}`,
        source: "SMHI",
        level: (a.warningLevel?.code as WeatherWarning["level"]) ?? "MESSAGE",
        title: a.eventDescription?.en ?? w.event?.en ?? a.eventDescription?.sv ?? "Warning",
        area: a.areaName?.en ?? a.areaName?.sv,
        from: a.approximateStart,
        to: a.approximateEnd,
        text: incident?.en ?? incident?.sv,
      });
    }
  }
  return out.sort((x, y) => (LEVEL_RANK[y.level] ?? 0) - (LEVEL_RANK[x.level] ?? 0));
}

/** SIGMETs for the Swedish FIR (ESAA) or whose area contains the point, valid within [from, to]. */
export async function sigmetsAt(lat: number, lon: number, from: number, to: number): Promise<WeatherWarning[]> {
  const data = await fetchJson<AwcSigmet[]>("https://aviationweather.gov/api/data/isigmet?format=json", { revalidate: 300 });
  return (data ?? [])
    .filter((s) => s.validTimeTo * 1000 > from && s.validTimeFrom * 1000 < to)
    .filter((s) => {
      const ring = (s.coords ?? []).map((c) => [c.lon, c.lat]);
      return ring.length >= 3 ? pointInRing(lon, lat, ring) : s.firId === "ESAA";
    })
    .map((s) => ({
      id: `sigmet-${s.firId}-${s.seriesId}-${s.validTimeFrom}`,
      source: "SIGMET" as const,
      level: "SIGMET" as const,
      title: `${s.qualifier ? `${s.qualifier === "SEV" ? "Severe" : s.qualifier === "EMBD" ? "Embedded" : s.qualifier} ` : ""}${HAZARD[s.hazard ?? ""] ?? s.hazard ?? "SIGMET"}`,
      area: s.firName ?? s.firId,
      from: new Date(s.validTimeFrom * 1000).toISOString(),
      to: new Date(s.validTimeTo * 1000).toISOString(),
      text: s.rawSigmet?.replace(/\s+/g, " ").trim(),
    }));
}
