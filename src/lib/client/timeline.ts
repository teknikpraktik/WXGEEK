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

/** Parametrar som kan väljas som huvudvisualisering. */
export type PlotParam = "temperature" | "wind" | "pressure" | "visibility" | "cloudBase" | "precipitation";

export const PLOT_PARAMS: Array<{ key: PlotParam; label: string; unit: string }> = [
  { key: "temperature", label: "Temperatur", unit: "°C" },
  { key: "wind", label: "Vind", unit: "m/s" },
  { key: "pressure", label: "Lufttryck", unit: "hPa" },
  { key: "visibility", label: "Sikt", unit: "km" },
  { key: "cloudBase", label: "Molnbas", unit: "m" },
  { key: "precipitation", label: "Nederbörd", unit: "mm/h" },
];

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
// Plotdata
// ---------------------------------------------------------------------------

export type CloudBlock = Span & { baseM: number; cover: CloudLayer["cover"] | "MODEL"; opacity: number };
export type Bar = Span & { v: number; max?: number };
export type Arrow = { t: number; deg: number; speed?: number; forecast: boolean };

export type PlotData = {
  param: PlotParam;
  unit: string;
  domain: [number, number];
  ticks: number[];
  scale: "linear" | "sqrt";
  observed: Pt[][];
  forecast: Pt[][];
  /** Byar (vind) */
  observedSecondary?: Pt[];
  forecastSecondary?: Pt[][];
  observedBars?: Bar[];
  forecastBars?: Bar[];
  observedClouds?: CloudBlock[];
  forecastClouds?: CloudBlock[];
  arrows?: Arrow[];
  /** Kort text när data saknas för en sida */
  observedMissing?: string;
  forecastMissing?: string;
  formatTick: (v: number) => string;
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

function niceTicks([lo, hi]: [number, number], count = 4): number[] {
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

export function buildPlot(bundle: WeatherBundle, param: PlotParam, now: number): PlotData {
  const unit = PLOT_PARAMS.find((p) => p.key === param)!.unit;
  const noObs = (k: ParamKey, what: string) =>
    stationFor(bundle, k) ? undefined : `Ingen ${what} i närheten`;
  const noFc = bundle.forecast ? undefined : "Prognos saknas";

  switch (param) {
    case "temperature": {
      const o = obsPoints(bundle, "temperature", (x) => x.temperatureC);
      const f = fcstPoints(bundle, (x) => x.temperatureC, now);
      const domain = niceDomain([...o, ...f].map((p) => p.v), 6);
      return {
        param, unit, domain, ticks: niceTicks(domain), scale: "linear",
        observed: segments(o, OBS_GAP), forecast: segments(f, FCST_GAP),
        observedMissing: noObs("temperature", "temperaturmätning"), forecastMissing: noFc,
        formatTick: (v) => `${v}°`.replace("-", "−"),
      };
    }
    case "pressure": {
      const o = obsPoints(bundle, "pressure", (x) => x.pressureHpa);
      const f = fcstPoints(bundle, (x) => x.pressureHpa, now);
      const domain = niceDomain([...o, ...f].map((p) => p.v), 8, 0.15);
      return {
        param, unit, domain, ticks: niceTicks(domain), scale: "linear",
        observed: segments(o, OBS_GAP), forecast: segments(f, FCST_GAP),
        observedMissing: noObs("pressure", "tryckmätning"), forecastMissing: noFc,
        formatTick: (v) => String(Math.round(v)),
      };
    }
    case "wind": {
      const o = obsPoints(bundle, "wind", (x) => x.windSpeedMs);
      const og = obsPoints(bundle, "gust", (x) => x.windGustMs);
      const f = fcstPoints(bundle, (x) => x.windSpeedMs, now);
      const fg = fcstPoints(bundle, (x) => x.windGustMs, now);
      const max = Math.max(8, ...[...o, ...og, ...f, ...fg].map((p) => p.v));
      const domain: [number, number] = [0, Math.ceil((max * 1.1) / 2) * 2];
      const windStation = stationFor(bundle, "wind");
      const arrows: Arrow[] = [];
      let lastT = -Infinity;
      for (const x of windStation?.observations ?? []) {
        const t = ts(x);
        // Glesa ut till ungefär en pil per timme.
        if (x.windDirectionDeg !== undefined && t - lastT >= 55 * 60 * 1000) {
          arrows.push({ t, deg: x.windDirectionDeg, speed: x.windSpeedMs, forecast: false });
          lastT = t;
        }
      }
      for (const p of bundle.forecast?.points ?? []) {
        const t = ts(p);
        if (t >= now && p.windDirectionDeg !== undefined && t - lastT >= 55 * 60 * 1000) {
          arrows.push({ t, deg: p.windDirectionDeg, speed: p.windSpeedMs, forecast: true });
          lastT = t;
        }
      }
      return {
        param, unit, domain, ticks: niceTicks(domain), scale: "linear",
        observed: segments(o, OBS_GAP), forecast: segments(f, FCST_GAP),
        observedSecondary: og, forecastSecondary: segments(fg, FCST_GAP), arrows,
        observedMissing: noObs("wind", "vindmätning"), forecastMissing: noFc,
        formatTick: (v) => String(v),
      };
    }
    case "visibility": {
      const o = obsPoints(bundle, "visibility", (x) => x.visibilityM && Math.min(10000, x.visibilityM) / 1000);
      const f = fcstPoints(bundle, (x) => x.visibilityM && Math.min(10000, x.visibilityM) / 1000, now);
      return {
        param, unit, domain: [0, 10.5], ticks: [0, 2, 5, 10], scale: "linear",
        observed: segments(o, OBS_GAP), forecast: segments(f, FCST_GAP),
        observedMissing: noObs("visibility", "siktobservation"), forecastMissing: noFc,
        formatTick: (v) => (v >= 10 ? "≥10" : String(v)),
      };
    }
    case "cloudBase": {
      const s = stationFor(bundle, "cloudBase");
      const obs = s?.observations ?? [];
      const step = stepOf(obs);
      const observedClouds: CloudBlock[] = [];
      for (const x of obs) {
        const t = ts(x);
        const span = { t0: t - step / 2, t1: t + step / 2 };
        if (x.cloudLayers?.length) {
          for (const l of x.cloudLayers) {
            observedClouds.push({ ...span, baseM: l.baseM, cover: l.cover, opacity: COVER_OPACITY[l.cover] });
          }
        } else if (x.cloudBaseM !== undefined) {
          // SMHI anger bara lägsta molnbas, inte täckningsgrad.
          observedClouds.push({ ...span, baseM: x.cloudBaseM, cover: "MODEL", opacity: 0.6 });
        }
      }
      const forecastClouds: CloudBlock[] = [];
      for (const p of bundle.forecast?.points ?? []) {
        const t = ts(p);
        if (t < now - 30 * 60 * 1000 || p.cloudBaseM === undefined) continue;
        const oktas = p.lowCloudCoverOktas ?? p.cloudCoverOktas ?? 4;
        forecastClouds.push({
          t0: t - HOUR / 2, t1: t + HOUR / 2, baseM: p.cloudBaseM, cover: "MODEL",
          opacity: 0.15 + (Math.max(oktas, p.cloudCoverOktas ?? 0) / 8) * 0.6,
        });
      }
      return {
        param, unit, domain: [0, 3000], ticks: [0, 300, 1000, 2000, 3000], scale: "sqrt",
        observed: [], forecast: [], observedClouds, forecastClouds,
        observedMissing: noObs("cloudBase", "molnbasobservation"), forecastMissing: noFc,
        formatTick: (v) => (v >= 1000 ? `${v / 1000} km` : `${v}`),
      };
    }
    case "precipitation": {
      const s = stationFor(bundle, "precipitation");
      const observedBars: Bar[] = (s?.observations ?? []).flatMap((x) =>
        x.precipitationMm === undefined ? [] : [{ t0: ts(x) - HOUR, t1: ts(x), v: x.precipitationMm }],
      );
      const forecastBars: Bar[] = (bundle.forecast?.points ?? []).flatMap((p) => {
        const t1 = ts(p);
        const t0 = p.intervalStart ? Date.parse(p.intervalStart) : t1 - HOUR;
        if (t1 < now || p.precipitationMm === undefined || t1 - t0 > HOUR) return [];
        return [{ t0, t1, v: p.precipitationMm, max: p.precipitationMaxMm }];
      });
      const max = Math.max(2, ...observedBars.map((b) => b.v), ...forecastBars.map((b) => b.max ?? b.v));
      const domain: [number, number] = [0, Math.ceil(max * 1.1)];
      return {
        param, unit, domain, ticks: niceTicks(domain, 3), scale: "linear",
        observed: [], forecast: [], observedBars, forecastBars,
        observedMissing: noObs("precipitation", "nederbördsmätare"), forecastMissing: noFc,
        formatTick: (v) => String(v).replace(".", ","),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Händelser (väderfenomen) längs tidslinjen
// ---------------------------------------------------------------------------

export type EventBlock = Span & { group: "regn" | "snö" | "dimma" | "åska"; label: string; forecast: boolean };

export function buildEvents(bundle: WeatherBundle, now: number): EventBlock[] {
  const out: EventBlock[] = [];
  const s = stationFor(bundle, "phenomena");
  if (s) {
    const step = stepOf(s.observations);
    for (const o of s.observations) {
      const p = o.weatherPhenomena?.[0];
      if (!p) continue;
      const t = ts(o);
      out.push({ t0: t - step / 2, t1: t + step / 2, group: PHENOMENON_GROUP[p.kind], label: p.label, forecast: false });
    }
  }
  for (const p of bundle.forecast?.points ?? []) {
    const t = ts(p);
    if (t < now || !p.phenomenon) continue;
    out.push({ t0: t - HOUR / 2, t1: t + HOUR / 2, group: PHENOMENON_GROUP[p.phenomenon.kind], label: p.phenomenon.label, forecast: true });
  }
  return out;
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
  dewPoint: Reading<number>;
  humidity: Reading<number>;
  wind: Reading<{ deg?: number; variable?: boolean; speed?: number }>;
  gust: Reading<number | undefined>;
  pressure: Reading<number>;
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
      dewPoint: null,
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
    dewPoint: pickObs(bundle, "dewPoint", t, mode, (o) => o.dewPointC),
    humidity: pickObs(bundle, "humidity", t, mode, (o) => o.relativeHumidity),
    wind,
    gust,
    pressure: pickObs(bundle, "pressure", t, mode, (o) => o.pressureHpa),
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
