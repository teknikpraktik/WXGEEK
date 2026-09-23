import "server-only";
import { fetchJson, memoize } from "./http";
import type { AwcMetar } from "../adapters/metar";
import type { AwcTaf } from "../adapters/taf";
import {
  compactStationList,
  parseSmhiValues,
  type SmhiDataRaw,
  type SmhiStation,
  type SmhiStationListRaw,
  type SmhiValue,
} from "../adapters/smhi-obs";
import type { SmhiForecastRaw } from "../adapters/smhi-forecast";

type Bbox = { latMin: number; lonMin: number; latMax: number; lonMax: number };

// Avrundning ger bättre cacheträffar (och avslöjar inte exakt position mot källorna).
const r1 = (n: number) => n.toFixed(1);
const bboxParam = (b: Bbox) => [b.latMin, b.lonMin, b.latMax, b.lonMax].map(r1).join(",");

// ---------------------------------------------------------------------------
// Cache-tider (sekunder). Se docs/architecture.md.
// ---------------------------------------------------------------------------
export const CACHE = {
  metarLatest: 120, // METAR kommer var 30:e min – 2 min håller "NU" färskt
  metarHistory: 300,
  taf: 900, // TAF utfärdas var 3:e/6:e timme, ändringar (AMD) kan komma när som helst
  smhiStationsMs: 60 * 60 * 1000, // stationslistor i minnet (1 h)
  smhiData: 600, // SMHI:s egen max-age
  forecast: 1800, // snow1g körs ungefär varje timme, SMHI anger max-age 3600
  geocode: 86400,
} as const;

// ---------------------------------------------------------------------------
// AWC (METAR/TAF)
// ---------------------------------------------------------------------------
const AWC = "https://aviationweather.gov/api/data";

export async function fetchMetarsInBbox(b: Bbox): Promise<AwcMetar[]> {
  return (await fetchJson<AwcMetar[]>(`${AWC}/metar?bbox=${bboxParam(b)}&format=json`, {
    revalidate: CACHE.metarLatest,
  })) ?? [];
}

export async function fetchMetarHistory(icao: string, hours = 13): Promise<AwcMetar[]> {
  return (await fetchJson<AwcMetar[]>(`${AWC}/metar?ids=${encodeURIComponent(icao)}&format=json&hours=${hours}`, {
    revalidate: CACHE.metarHistory,
  })) ?? [];
}

export async function fetchTafsInBbox(b: Bbox): Promise<AwcTaf[]> {
  return (await fetchJson<AwcTaf[]>(`${AWC}/taf?bbox=${bboxParam(b)}&format=json`, {
    revalidate: CACHE.taf,
  })) ?? [];
}

// ---------------------------------------------------------------------------
// SMHI observationer
// ---------------------------------------------------------------------------
const METOBS = "https://opendata-download-metobs.smhi.se/api/version/1.0";

export function getSmhiStations(param: number): Promise<SmhiStation[]> {
  return memoize(`smhi-stations-${param}`, CACHE.smhiStationsMs, async () => {
    // ~800 kB – för stort för Next.js data cache, därför no-store + minnescache av komprimerad lista.
    const raw = await fetchJson<SmhiStationListRaw>(`${METOBS}/parameter/${param}.json`, {
      revalidate: 0,
      timeoutMs: 12000,
    });
    // Behåll bara stationer som rapporterat de senaste 3 timmarna.
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    return raw ? compactStationList(raw).filter((s) => s.updated >= cutoff) : [];
  });
}

export async function fetchSmhiLatestDay(param: number, stationId: string): Promise<SmhiValue[]> {
  const raw = await fetchJson<SmhiDataRaw>(
    `${METOBS}/parameter/${param}/station/${encodeURIComponent(stationId)}/period/latest-day/data.json`,
    { revalidate: CACHE.smhiData },
  );
  return parseSmhiValues(raw);
}

// ---------------------------------------------------------------------------
// SMHI prognos
// ---------------------------------------------------------------------------
const METFCST = "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1";

export async function fetchSmhiForecast(lat: number, lon: number): Promise<SmhiForecastRaw | null> {
  // Två decimaler ≈ 1 km, finare än modellens rutnät (~2,5 km).
  return fetchJson<SmhiForecastRaw>(
    `${METFCST}/geotype/point/lon/${lon.toFixed(2)}/lat/${lat.toFixed(2)}/data.json`,
    { revalidate: CACHE.forecast },
  );
}
