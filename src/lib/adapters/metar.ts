import type { CloudCover, CloudLayer, WeatherObservation } from "../types";
import { parseMetarWeather } from "../weather/phenomena";

/** AWC:s JSON-format för en METAR (endast fält vi använder). */
export type AwcMetar = {
  icaoId: string;
  obsTime: number;
  temp?: number | null;
  wdir?: number | "VRB" | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: number | string | null;
  wxString?: string | null;
  rawOb: string;
  lat: number;
  lon: number;
  name?: string;
  clouds?: Array<{ cover: string; base: number | null; type?: string | null }>;
};

export const KT_TO_MS = 0.514444;
export const FT_TO_M = 0.3048;
const SM_TO_M = 1609.344;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Omräkning av knop → m/s med en decimal (avrundas vidare i UI). */
export const ktToMs = (kt: number) => round1(kt * KT_TO_MS);

/** Tolkar sikt ur rå METAR/TAF: "9999", "0800", "CAVOK", "P6SM", "1/2SM". */
export function parseVisibilityFromRaw(raw: string): { m: number; atLeast: boolean } | null {
  const tokens = raw.split(/\s+/);
  // Hoppa över stations-id och tid så att t.ex. "1200Z" inte tolkas.
  for (const t of tokens.slice(2)) {
    if (t === "CAVOK") return { m: 10000, atLeast: true };
    if (/^\d{4}$/.test(t)) {
      const m = parseInt(t, 10);
      return m >= 9999 ? { m: 10000, atLeast: true } : { m, atLeast: false };
    }
    // 4-siffrig sikt med riktning, t.ex. 4000NE – vi tar värdet.
    if (/^\d{4}(N|NE|E|SE|S|SW|W|NW)$/.test(t)) return { m: parseInt(t.slice(0, 4), 10), atLeast: false };
    const sm = t.match(/^(P)?(\d+)(?:\/(\d+))?SM$/);
    if (sm) {
      const v = sm[3] ? parseInt(sm[2], 10) / parseInt(sm[3], 10) : parseInt(sm[2], 10);
      return { m: Math.round(v * SM_TO_M), atLeast: Boolean(sm[1]) };
    }
    if (t === "RMK" || t === "TEMPO" || t === "BECMG" || t === "NOSIG") break;
  }
  return null;
}

/** AWC:s visib i statute miles som reserv när rå-METAR inte kan tolkas. */
export function visibFromAwc(v: number | string | null | undefined): { m: number; atLeast: boolean } | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const plus = v.endsWith("+");
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return null;
    return plus && n >= 6 ? { m: 10000, atLeast: true } : { m: Math.round(n * SM_TO_M), atLeast: plus };
  }
  return { m: Math.round(v * SM_TO_M), atLeast: false };
}

const COVERS: CloudCover[] = ["FEW", "SCT", "BKN", "OVC"];

export function normalizeClouds(
  clouds: AwcMetar["clouds"],
  raw: string,
): { layers: CloudLayer[]; noSignificantCloud: boolean; clearSky: boolean } {
  const layers: CloudLayer[] = [];
  let noSignificantCloud = /\b(CAVOK|NSC|SKC|CLR|NCD)\b/.test(raw);
  for (const c of clouds ?? []) {
    if (COVERS.includes(c.cover as CloudCover) && c.base !== null && c.base !== undefined) {
      layers.push({
        cover: c.cover as CloudCover,
        baseM: Math.round(c.base * FT_TO_M),
        type: c.type === "CB" || c.type === "TCU" ? c.type : undefined,
      });
    } else if (["CAVOK", "NSC", "SKC", "CLR", "NCD"].includes(c.cover)) {
      noSignificantCloud = true;
    }
  }
  // Vertikal sikt (VV) – himlen skymd, t.ex. i dimma. AWC:s JSON tar inte alltid med den.
  const vv = raw.match(/\bVV(\d{3})\b/);
  if (vv && !layers.some((l) => l.cover === "VV")) {
    layers.push({ cover: "VV", baseM: Math.round(parseInt(vv[1], 10) * 100 * FT_TO_M) });
  }
  // CB/TCU från rå-METAR om AWC inte satt typ.
  for (const m of raw.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)\b/g)) {
    const base = Math.round(parseInt(m[2], 10) * 100 * FT_TO_M);
    const l = layers.find((x) => x.cover === m[1] && Math.abs(x.baseM - base) < 5);
    if (l) l.type = m[3] as "CB" | "TCU";
  }
  layers.sort((a, b) => a.baseM - b.baseM);
  return {
    layers,
    noSignificantCloud: noSignificantCloud && layers.length === 0,
    clearSky: layers.length === 0 && /\b(CAVOK|SKC|CLR)\b/.test(raw),
  };
}

export function normalizeMetar(m: AwcMetar, distanceKm?: number): WeatherObservation {
  const raw = m.rawOb;
  const vis = parseVisibilityFromRaw(raw) ?? visibFromAwc(m.visib);
  const { layers, noSignificantCloud, clearSky } = normalizeClouds(m.clouds, raw);
  const variable = m.wdir === "VRB";
  const obs: WeatherObservation = {
    timestamp: new Date(m.obsTime * 1000).toISOString(),
    source: "METAR",
    stationId: m.icaoId,
    stationName: m.name ? cleanAwcName(m.name) : undefined,
    latitude: m.lat,
    longitude: m.lon,
    distanceKm,
    temperatureC: m.temp ?? undefined,
    windDirectionDeg: typeof m.wdir === "number" ? m.wdir : undefined,
    windVariable: variable || undefined,
    windSpeedMs: typeof m.wspd === "number" ? ktToMs(m.wspd) : undefined,
    windGustMs: typeof m.wgst === "number" ? ktToMs(m.wgst) : undefined,
    visibilityM: vis?.m,
    visibilityAtLeast: vis?.atLeast || undefined,
    cloudLayers: layers,
    cloudBaseM: layers[0]?.baseM,
    noSignificantCloud: noSignificantCloud || undefined,
    clearSky: clearSky || undefined,
    weatherPhenomena: parseMetarWeather(m.wxString),
    raw,
  };
  return obs;
}

/** "Karlstad Arpt, S, SE" → "Karlstad flygplats" */
export function cleanAwcName(name: string): string {
  const first = name.split(",")[0].trim();
  return first
    .replace(/\s+(Arpt|Airport|Intl|Aerodrome|Ab|AFB)\b\.?/gi, "")
    .replace(/\//g, " / ")
    .replace(/\s+/g, " ")
    .trim()
    .concat(" flygplats");
}
