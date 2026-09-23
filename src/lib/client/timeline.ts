import type {
  CloudLayer,
  ForecastPoint,
  ParamKey,
  ParamSelection,
  Phenomenon,
  StationSeries,
  TafPeriod,
  WeatherBundle,
  WeatherObservation,
} from "../types";
import { PHENOMENON_GROUP, symbolLabel } from "../weather/phenomena";

export const HOUR = 3_600_000;
export const PAST_HOURS = 12;
export const FUTURE_HOURS = 36;

export type Pt = { t: number; v: number };
export type Span = { t0: number; t1: number };

// ---------------------------------------------------------------------------
// Uppslag
// ---------------------------------------------------------------------------

export function stationFor(bundle: WeatherBundle, param: ParamKey): StationSeries | undefined {
  const k = bundle.selections[param]?.stationKey;
  return k ? bundle.stations.find((s) => s.key === k) : undefined;
}

const ts = (o: { timestamp: string }) => Date.parse(o.timestamp);

/** Typiskt intervall mellan observationer – används för staplar/segment. */
function stepOf(obs: WeatherObservation[]): number {
  if (obs.length < 2) return HOUR;
  const diffs = obs.slice(1).map((o, i) => ts(o) - ts(obs[i])).sort((a, b) => a - b);
  return Math.min(HOUR, diffs[Math.floor(diffs.length / 2)]);
}

/** Delar en punktserie där glappet är större än maxGap – vi drar aldrig linje över saknade data. */
export function segments(points: Pt[], maxGap: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of points) {
    if (cur.length && p.t - cur[cur.length - 1].t > maxGap) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

function obsPoints(bundle: WeatherBundle, param: ParamKey, get: (o: WeatherObservation) => number | undefined): Pt[] {
  const s = stationFor(bundle, param);
  if (!s) return [];
  return s.observations.flatMap((o) => {
    const v = get(o);
    return v === undefined ? [] : [{ t: ts(o), v }];
  });
}

function fcstPoints(bundle: WeatherBundle, get: (p: ForecastPoint) => number | undefined, now: number): Pt[] {
  if (!bundle.forecast) return [];
  return bundle.forecast.points.flatMap((p) => {
    const t = ts(p);
    const v = get(p);
    // Prognosen börjar vid NU – före NU finns observationer.
    return v === undefined || t < now - 30 * 60 * 1000 ? [] : [{ t, v }];
  });
}

// ---------------------------------------------------------------------------
// Meteogram: alla mått på samma tidsaxel, i smala körfält
// ---------------------------------------------------------------------------

export type PrecipKind = "regn" | "snö";
export type CloudBlock = Span & { baseM: number; cover: CloudLayer["cover"] | "MODEL"; opacity: number };
export type Bar = Span & { v: number; max?: number; kind: PrecipKind };
export type Strip = Span & { kind: PrecipKind; label: string };
export type Arrow = { t: number; deg?: number; variable?: boolean; speed: number; gust?: number; forecast: boolean };
export type Mark = Span & { forecast: boolean; label: string };

export type Meteogram = {
  temp: { observed: Pt[][]; forecast: Pt[][]; domain: [number, number]; ticks: number[] };
  /** Uppmätt nederbörd (SMHI, mm/h) */
  precipObserved: Bar[];
  /** Observerad nederbörd utan mängd (t.ex. "lätt regn" i METAR) */
  precipStrips: Strip[];
  precipForecast: Bar[];
  precipMax: number;
  wind: Arrow[];
  cloudsObserved: CloudBlock[];
  cloudsForecast: CloudBlock[];
  /** Dimma / sikt under 5 km */
  lowVis: Array<Mark & { severe: boolean }>;
  thunder: Mark[];
  pressure: { observed: Pt[][]; forecast: Pt[][]; domain: [number, number] };
  missing: { temp?: string; wind?: string; clouds?: string; pressure?: string; forecast?: string };
};

function niceDomain(values: number[], minSpan: number, pad = 0.1): [number, number] {
  if (values.length === 0) return [0, minSpan];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = Math.max(hi - lo, minSpan);
  const mid = (lo + hi) / 2;
  lo = mid - (span / 2) * (1 + pad);
  hi = mid + (span / 2) * (1 + pad);
  return [lo, hi];
}

function niceTicks([lo, hi]: [number, number], count = 3): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const OBS_GAP = 100 * 60 * 1000;
const FCST_GAP = 3 * HOUR + 1;
const COVER_OPACITY: Record<string, number> = { FEW: 0.22, SCT: 0.42, BKN: 0.68, OVC: 0.9, VV: 0.9 };

const precipKindOf = (p: Phenomenon | undefined): PrecipKind | null => {
  if (!p) return null;
  const g = PHENOMENON_GROUP[p.kind];
  return g === "snö" ? "snö" : g === "regn" || g === "åska" ? "regn" : null;
};

export function buildMeteogram(bundle: WeatherBundle, now: number): Meteogram {
  const fc = (bundle.forecast?.points ?? []).filter((p) => ts(p) >= now - 30 * 60 * 1000);
  const hourlyFc = fc.filter((p) => !p.intervalStart || ts(p) - Date.parse(p.intervalStart) <= HOUR);
  const missing: Meteogram["missing"] = {};
  if (!bundle.forecast) missing.forecast = "Prognos saknas";

  // Temperatur
  const tObs = obsPoints(bundle, "temperature", (x) => x.temperatureC);
  const tFc = fcstPoints(bundle, (x) => x.temperatureC, now);
  const tDomain = niceDomain([...tObs, ...tFc].map((p) => p.v), 6, 0.15);
  if (!stationFor(bundle, "temperature")) missing.temp = "Ingen temperaturmätning i närheten";

  // Väderfenomen (observerat) – används för nederbördstyp, dimma och åska
  const phenObs = stationFor(bundle, "phenomena")?.observations ?? [];
  const phenStep = stepOf(phenObs);
  const precipKindNear = (t: number): PrecipKind | null => {
    for (const o of phenObs) {
      if (Math.abs(ts(o) - t) <= 45 * 60 * 1000) {
        const k = precipKindOf(o.weatherPhenomena?.[0]);
        if (k) return k;
      }
    }
    return null;
  };

  // Nederbörd: uppmätt (SMHI) + observerad utan mängd (väderkod) + prognos
  const precipObserved: Bar[] = (stationFor(bundle, "precipitation")?.observations ?? []).flatMap((x) =>
    x.precipitationMm === undefined || x.precipitationMm <= 0
      ? []
      : [{ t0: ts(x) - HOUR, t1: ts(x), v: x.precipitationMm, kind: precipKindNear(ts(x) - HOUR / 2) ?? "regn" }],
  );
  const precipStrips: Strip[] = [];
  for (const o of phenObs) {
    const p = o.weatherPhenomena?.[0];
    const kind = precipKindOf(p);
    if (!kind || !p) continue;
    const t = ts(o);
    const span = { t0: t - phenStep / 2, t1: t + phenStep / 2 };
    // Remsan visas bara där ingen uppmätt mängd finns.
    if (precipObserved.some((b) => b.t0 < span.t1 && b.t1 > span.t0)) continue;
    precipStrips.push({ ...span, kind, label: p.label });
  }
  const precipForecast: Bar[] = hourlyFc.flatMap((p) => {
    const t1 = ts(p);
    const t0 = p.intervalStart ? Date.parse(p.intervalStart) : t1 - HOUR;
    if (t1 < now || p.precipitationMm === undefined || (p.precipitationMaxMm ?? p.precipitationMm) < 0.05) return [];
    return [{ t0, t1, v: p.precipitationMm, max: p.precipitationMaxMm, kind: precipKindOf(p.phenomenon) ?? "regn" }];
  });
  const precipMax = Math.max(2, ...precipObserved.map((b) => b.v), ...precipForecast.map((b) => b.max ?? b.v));

  // Vind: en pil per timme med medelvind och byar
  const wind: Arrow[] = [];
  const windObs = stationFor(bundle, "wind")?.observations ?? [];
  const gustObs = stationFor(bundle, "gust")?.observations ?? [];
  if (!windObs.length) missing.wind = "Ingen vindmätning i närheten";
  let lastT = -Infinity;
  for (const x of windObs) {
    const t = ts(x);
    if (x.windSpeedMs === undefined || t - lastT < 55 * 60 * 1000) continue;
    const g = gustObs.find((o) => Math.abs(ts(o) - t) <= 35 * 60 * 1000 && o.windGustMs !== undefined);
    wind.push({ t, deg: x.windDirectionDeg, variable: x.windVariable, speed: x.windSpeedMs, gust: g?.windGustMs, forecast: false });
    lastT = t;
  }
  for (const p of hourlyFc) {
    const t = ts(p);
    if (t < now || p.windSpeedMs === undefined || t - lastT < 55 * 60 * 1000) continue;
    wind.push({ t, deg: p.windDirectionDeg, speed: p.windSpeedMs, gust: p.windGustMs, forecast: true });
    lastT = t;
  }

  // Moln
  const cloudObs = stationFor(bundle, "cloudBase")?.observations ?? [];
  const cloudStep = stepOf(cloudObs);
  const cloudsObserved: CloudBlock[] = [];
  for (const x of cloudObs) {
    const t = ts(x);
    const span = { t0: t - cloudStep / 2, t1: t + cloudStep / 2 };
    if (x.cloudLayers?.length) {
      for (const l of x.cloudLayers) cloudsObserved.push({ ...span, baseM: l.baseM, cover: l.cover, opacity: COVER_OPACITY[l.cover] });
    } else if (x.cloudBaseM !== undefined) {
      cloudsObserved.push({ ...span, baseM: x.cloudBaseM, cover: "MODEL", opacity: 0.6 });
    }
  }
  if (!cloudObs.length) missing.clouds = "Ingen molnobservation i närheten";
  const cloudsForecast: CloudBlock[] = hourlyFc.flatMap((p) => {
    if (p.cloudBaseM === undefined) return [];
    const t = ts(p);
    const oktas = Math.max(p.lowCloudCoverOktas ?? 0, p.cloudCoverOktas ?? 4);
    return [{ t0: t - HOUR / 2, t1: t + HOUR / 2, baseM: p.cloudBaseM, cover: "MODEL" as const, opacity: 0.15 + (oktas / 8) * 0.6 }];
  });

  // Låg sikt / dimma och åska
  const lowVis: Meteogram["lowVis"] = [];
  const thunder: Mark[] = [];
  const visObs = stationFor(bundle, "visibility")?.observations ?? [];
  const visStep = stepOf(visObs);
  for (const o of visObs) {
    if (o.visibilityM !== undefined && o.visibilityM < 5000) {
      const t = ts(o);
      lowVis.push({ t0: t - visStep / 2, t1: t + visStep / 2, forecast: false, severe: o.visibilityM < 1000, label: `Sikt ${o.visibilityM} m` });
    }
  }
  for (const o of phenObs) {
    const p = o.weatherPhenomena?.[0];
    const t = ts(o);
    const span = { t0: t - phenStep / 2, t1: t + phenStep / 2 };
    if (p && PHENOMENON_GROUP[p.kind] === "dimma" && !lowVis.some((v) => v.t0 < span.t1 && v.t1 > span.t0)) {
      lowVis.push({ ...span, forecast: false, severe: p.kind === "dimma", label: p.label });
    }
    if (p?.kind === "åska") thunder.push({ ...span, forecast: false, label: p.label });
  }
  for (const p of hourlyFc) {
    const t = ts(p);
    const span = { t0: t - HOUR / 2, t1: t + HOUR / 2 };
    if ((p.visibilityM !== undefined && p.visibilityM < 5000) || p.phenomenon?.kind === "dimma") {
      lowVis.push({
        ...span,
        forecast: true,
        severe: (p.visibilityM ?? 5000) < 1000 || p.phenomenon?.kind === "dimma",
        label: p.phenomenon?.label ?? "Nedsatt sikt",
      });
    }
    if (p.phenomenon?.kind === "åska") thunder.push({ ...span, forecast: true, label: p.phenomenon.label });
  }

  // Lufttryck
  const pObs = obsPoints(bundle, "pressure", (x) => x.pressureHpa);
  const pFc = fcstPoints(bundle, (x) => x.pressureHpa, now);
  if (!stationFor(bundle, "pressure")) missing.pressure = "Ingen tryckmätning";

  return {
    temp: { observed: segments(tObs, OBS_GAP), forecast: segments(tFc, FCST_GAP), domain: tDomain, ticks: niceTicks(tDomain) },
    precipObserved,
    precipStrips,
    precipForecast,
    precipMax,
    wind,
    cloudsObserved,
    cloudsForecast,
    lowVis,
    thunder,
    pressure: {
      observed: segments(pObs, OBS_GAP),
      forecast: segments(pFc, FCST_GAP),
      domain: niceDomain([...pObs, ...pFc].map((p) => p.v), 6, 0.2),
    },
    missing,
  };
}

/** Trycktendens senaste 3 h (hPa) fram till tidpunkten t, från observationerna. */
export function pressureTendency(bundle: WeatherBundle, t: number): number | undefined {
  const s = stationFor(bundle, "pressure");
  if (!s) return undefined;
  const pts = s.observations.filter((o) => o.pressureHpa !== undefined && ts(o) <= t + 10 * 60 * 1000);
  const last = pts.at(-1);
  if (!last || t - ts(last) > 2 * HOUR) return undefined;
  const ref = pts.find((o) => Math.abs(ts(last) - 3 * HOUR - ts(o)) <= 35 * 60 * 1000);
  return ref ? last.pressureHpa! - ref.pressureHpa! : undefined;
}

// ---------------------------------------------------------------------------
// Avläsning vid en tidpunkt
// ---------------------------------------------------------------------------

export type Origin = {
  kind: "METAR" | "SMHI" | "PROGNOS";
  stationId?: string;
  stationName?: string;
  distanceKm?: number;
  timestamp: number;
};

export type Reading<T> = { value: T; origin: Origin } | null;

export type Snapshot = {
  mode: "now" | "observed" | "forecast";
  time: number;
  temperature: Reading<number>;
  humidity: Reading<number>;
  wind: Reading<{ deg?: number; variable?: boolean; speed?: number }>;
  gust: Reading<number | undefined>;
  pressure: Reading<number>;
  /** Förändring senaste 3 h (hPa), endast observerat */
  pressureTrend?: number;
  visibility: Reading<{ m: number; atLeast?: boolean }>;
  cloud: Reading<{ baseM?: number; layers?: CloudLayer[]; nsc?: boolean; oktas?: number }>;
  precipitation: Reading<{ mm: number; max?: number; probability?: number }>;
  phenomena: Reading<Phenomenon[]>;
  /** Symboltext från prognosen, t.ex. "Halvklart" */
  forecastSummary?: string;
  metar?: { raw: string; stationId: string; timestamp: number };
  taf: TafPeriod[];
};

const TOL: Record<"METAR" | "SMHI", number> = { METAR: 35 * 60 * 1000, SMHI: 40 * 60 * 1000 };
/** Vid NU accepteras senaste observation upp till denna ålder – äldre visas som saknad. */
export const NOW_MAX_AGE: Record<"METAR" | "SMHI", number> = { METAR: 2 * HOUR, SMHI: 3 * HOUR };

function pickObs<T>(
  bundle: WeatherBundle,
  param: ParamKey,
  t: number,
  mode: Snapshot["mode"],
  get: (o: WeatherObservation) => T | undefined,
): Reading<T> {
  const s = stationFor(bundle, param);
  if (!s) return null;
  const src = s.station.source;
  let best: WeatherObservation | undefined;
  if (mode === "now") {
    for (let i = s.observations.length - 1; i >= 0; i--) {
      const o = s.observations[i];
      if (get(o) !== undefined) {
        best = o;
        break;
      }
    }
    if (best && t - ts(best) > NOW_MAX_AGE[src]) best = undefined;
  } else {
    let bestD = Infinity;
    for (const o of s.observations) {
      const d = Math.abs(ts(o) - t);
      if (d < bestD && d <= TOL[src] && get(o) !== undefined) {
        best = o;
        bestD = d;
      }
    }
  }
  if (!best) return null;
  return {
    value: get(best) as T,
    origin: {
      kind: src,
      stationId: s.station.stationId,
      stationName: s.station.stationName,
      distanceKm: s.station.distanceKm,
      timestamp: ts(best),
    },
  };
}

function pickForecast(bundle: WeatherBundle, t: number): ForecastPoint | undefined {
  let best: ForecastPoint | undefined;
  let bestD = Infinity;
  for (const p of bundle.forecast?.points ?? []) {
    const d = Math.abs(ts(p) - t);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return bestD <= 40 * 60 * 1000 ? best : undefined;
}

const def = <T,>(v: T | undefined, origin: Origin): Reading<T> => (v === undefined ? null : { value: v, origin });

export function snapshotAt(bundle: WeatherBundle, t: number, now: number): Snapshot {
  const mode: Snapshot["mode"] = Math.abs(t - now) < 10 * 60 * 1000 ? "now" : t < now ? "observed" : "forecast";
  const taf = (bundle.taf?.periods ?? []).filter(
    (p) => p.change !== "BASE" && p.change !== "FM" && Date.parse(p.from) <= t && t < Date.parse(p.to),
  );

  if (mode === "forecast") {
    const p = pickForecast(bundle, t);
    const origin: Origin = { kind: "PROGNOS", timestamp: p ? ts(p) : t };
    const isHourly = p?.intervalStart ? ts(p) - Date.parse(p.intervalStart) <= HOUR : true;
    return {
      mode,
      time: t,
      temperature: def(p?.temperatureC, origin),
      humidity: def(p?.relativeHumidity, origin),
      wind: p?.windSpeedMs !== undefined ? { value: { deg: p.windDirectionDeg, speed: p.windSpeedMs }, origin } : null,
      gust: p ? def(p.windGustMs, origin) : null,
      pressure: def(p?.pressureHpa, origin),
      visibility: p?.visibilityM !== undefined ? { value: { m: p.visibilityM, atLeast: p.visibilityM >= 10000 }, origin } : null,
      cloud: p ? { value: { baseM: p.cloudBaseM, oktas: p.cloudCoverOktas }, origin } : null,
      precipitation:
        p?.precipitationMm !== undefined && isHourly
          ? { value: { mm: p.precipitationMm, max: p.precipitationMaxMm, probability: p.precipitationProbability }, origin }
          : null,
      phenomena: p?.phenomenon ? { value: [p.phenomenon], origin } : null,
      forecastSummary: symbolLabel(p?.symbolCode),
      taf,
    };
  }

  const metarStation = bundle.stations.find((s) => s.station.source === "METAR");
  let metar: Snapshot["metar"];
  if (metarStation) {
    const r = pickObs<string>(bundle, "phenomena", t, mode, (o) => (o.source === "METAR" ? o.raw : undefined));
    const src = r ?? (() => {
      // Om fenomen kommer från SMHI: hämta rå METAR direkt från METAR-stationen.
      const cands = metarStation.observations.filter((o) =>
        mode === "now" ? t - ts(o) <= NOW_MAX_AGE.METAR : Math.abs(ts(o) - t) <= TOL.METAR,
      );
      const o = mode === "now" ? cands.at(-1) : cands.sort((a, b) => Math.abs(ts(a) - t) - Math.abs(ts(b) - t))[0];
      return o?.raw ? { value: o.raw, origin: { kind: "METAR" as const, stationId: o.stationId, timestamp: ts(o) } } : null;
    })();
    if (src) metar = { raw: src.value, stationId: src.origin.stationId!, timestamp: src.origin.timestamp };
  }

  const wind = pickObs(bundle, "wind", t, mode, (o) =>
    o.windSpeedMs === undefined ? undefined : { deg: o.windDirectionDeg, variable: o.windVariable, speed: o.windSpeedMs },
  );
  // Byar: METAR utan G-grupp betyder "inga kraftiga byar rapporterade", inte vindstilla.
  const gustSel = bundle.selections.gust;
  const gust =
    gustSel?.station?.source === "METAR"
      ? pickObs<number | undefined>(bundle, "gust", t, mode, (o) => (o.windSpeedMs !== undefined ? (o.windGustMs ?? NaN) : undefined))
      : pickObs(bundle, "gust", t, mode, (o) => o.windGustMs);
  if (gust && Number.isNaN(gust.value)) gust.value = undefined;

  return {
    mode,
    time: t,
    temperature: pickObs(bundle, "temperature", t, mode, (o) => o.temperatureC),
    humidity: pickObs(bundle, "humidity", t, mode, (o) => o.relativeHumidity),
    wind,
    gust,
    pressure: pickObs(bundle, "pressure", t, mode, (o) => o.pressureHpa),
    pressureTrend: pressureTendency(bundle, t),
    visibility: pickObs(bundle, "visibility", t, mode, (o) =>
      o.visibilityM === undefined ? undefined : { m: o.visibilityM, atLeast: o.visibilityAtLeast },
    ),
    cloud: pickObs(bundle, "cloudBase", t, mode, (o) =>
      o.cloudLayers?.length || o.noSignificantCloud || o.cloudBaseM !== undefined
        ? { baseM: o.cloudBaseM, layers: o.cloudLayers, nsc: o.noSignificantCloud }
        : o.source === "METAR"
          ? { nsc: true }
          : undefined,
    ),
    precipitation: pickObs(bundle, "precipitation", t, mode, (o) =>
      o.precipitationMm === undefined ? undefined : { mm: o.precipitationMm },
    ),
    phenomena: pickObs(bundle, "phenomena", t, mode, (o) => o.weatherPhenomena),
    metar,
    taf: mode === "now" ? taf : [],
  };
}

export function selectionsList(bundle: WeatherBundle): ParamSelection[] {
  return Object.values(bundle.selections);
}
