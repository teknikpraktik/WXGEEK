import type {
  CloudLayer,
  ForecastPoint,
  ParamKey,
  Phenomenon,
  StationSeries,
  TafPeriod,
  WeatherBundle,
  WeatherObservation,
} from "../types";
import { PHENOMENON_GROUP, symbolLabel } from "../weather/phenomena";
import { isDaylight } from "../sun";

export const HOUR = 3_600_000;
export const PAST_HOURS = 12;

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

/** Typiskt intervall mellan observationer – används för block och remsor. */
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

/** Prognospunkter från NU fram till prognosfönstrets slut (närmaste TAF). */
// ---------------------------------------------------------------------------
// Sammanfogning av observerad temperatur och prognos
//
// Prognosen justeras så att den startar i senaste observerade värde: skillnaden
// mellan observation och (interpolerad) prognos vid observationstiden läggs på
// prognosen och klingar av linjärt under BLEND_MS. Samma justering används i
// diagrammet och i avläsningen.
// ---------------------------------------------------------------------------

const BLEND_MS = 3 * HOUR;
/** Äldre observationer än så här används inte för att justera prognosen. */
const BLEND_MAX_AGE = 2 * HOUR;

/** Senaste observerade temperatur (inom BLEND_MAX_AGE före now). */
function lastObservedTemp(bundle: WeatherBundle, now: number): Pt | undefined {
  const s = stationFor(bundle, "temperature");
  const last = s?.observations.filter((o) => o.temperatureC !== undefined && ts(o) <= now).at(-1);
  if (!last || now - ts(last) > BLEND_MAX_AGE) return undefined;
  return { t: ts(last), v: last.temperatureC! };
}

/** Prognostemperatur linjärt interpolerad vid tidpunkt t (ojusterad). */
function forecastTempAt(bundle: WeatherBundle, t: number): number | undefined {
  const pts = (bundle.forecast?.points ?? []).filter((p) => p.temperatureC !== undefined);
  if (!pts.length) return undefined;
  if (t <= ts(pts[0])) return pts[0].temperatureC;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (t <= ts(b)) {
      const f = (t - ts(a)) / (ts(b) - ts(a));
      return a.temperatureC! + (b.temperatureC! - a.temperatureC!) * f;
    }
  }
  return pts.at(-1)!.temperatureC;
}

/** Returnerar en funktion som justerar en prognostemperatur vid tid t mot senaste observation. */
function tempAdjuster(bundle: WeatherBundle, now: number): { anchor?: Pt; adjust: (t: number, v: number) => number } {
  const anchor = lastObservedTemp(bundle, now);
  const fcAtAnchor = anchor ? forecastTempAt(bundle, anchor.t) : undefined;
  if (!anchor || fcAtAnchor === undefined) return { adjust: (_t, v) => v };
  const offset = anchor.v - fcAtAnchor;
  return {
    anchor,
    adjust: (t, v) => v + offset * Math.max(0, 1 - (t - anchor.t) / BLEND_MS),
  };
}

function forecastWindow(bundle: WeatherBundle, now: number): ForecastPoint[] {
  const until = Date.parse(bundle.forecastUntil);
  return (bundle.forecast?.points ?? []).filter((p) => {
    const t = ts(p);
    const hourly = !p.intervalStart || t - Date.parse(p.intervalStart) <= HOUR;
    return hourly && t >= now - 30 * 60 * 1000 && t <= until;
  });
}

// ---------------------------------------------------------------------------
// Diagram: molnbas (m) och temperatur (°C) i samma yta, nederbörd från molnbasen
// ---------------------------------------------------------------------------

export type PrecipKind = "regn" | "snö";
/** density 0–1: hur stor del av himlen som täcks (FEW → OVC, eller oktas/8). */
export type CloudBlock = Span & { baseM: number; cover: CloudLayer["cover"] | "MODEL"; density: number };
/**
 * Nederbörd som faller från ett moln. `fromM` = molnbasen. Dropparna ritas över hela
 * `drawT0`–`drawT1` (molnets bredd när regnet faller). `atT` = mitten, för temperaturuppslag.
 * mm saknas när bara väderkoden säger att det regnar.
 */
export type Precip = Span & {
  kind: PrecipKind;
  mm?: number;
  fromM?: number;
  atT: number;
  drawT0: number;
  drawT1: number;
  label: string;
};

/** Ackumulerad nederbörd (mm) – vattenansamling vid marken. */
export type WaterSeries = { observed: Pt[]; forecast: Pt[] };
export type Arrow = { t: number; deg?: number; variable?: boolean; speed: number; gust?: number; forecast: boolean };
export type Mark = Span & { forecast: boolean; label: string };

export type ChartData = {
  temp: { observed: Pt[][]; forecast: Pt[][]; domain: [number, number]; ticks: number[] };
  cloudsObserved: CloudBlock[];
  cloudsForecast: CloudBlock[];
  precipObserved: Precip[];
  precipForecast: Precip[];
  water: WaterSeries;
  wind: Arrow[];
  /** Dimma / sikt under 5 km */
  lowVis: Array<Mark & { severe: boolean }>;
  thunder: Mark[];
  /** Klar himmel: CAVOK/SKC/CLR i METAR, eller 0 oktas i prognosen. Sol på dagen, måne på natten. */
  clear: Array<{ t: number; forecast: boolean; day: boolean; label: string }>;
  missing: { temp?: string; wind?: string; clouds?: string; forecast?: string };
};

/** Molnbasaxeln: kvadratrotsskala så att låga moln får mest utrymme. */
export const CLOUD_TOP_M = 3000;
export const CLOUD_TICKS = [0, 300, 1000, 2000, 3000];

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
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const OBS_GAP = 100 * 60 * 1000;
const FCST_GAP = 3 * HOUR + 1;
// Täckningsgrad enligt METAR: FEW 1–2, SCT 3–4, BKN 5–7, OVC 8 oktas.
const COVER_DENSITY: Record<string, number> = { FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1, VV: 1 };

const precipKindOf = (p: Phenomenon | undefined): PrecipKind | null => {
  if (!p) return null;
  const g = PHENOMENON_GROUP[p.kind];
  return g === "snö" ? "snö" : g === "regn" || g === "åska" ? "regn" : null;
};

/** Lägsta molnlager (ej FEW) som överlappar ett tidsintervall. */
function cloudAt(blocks: CloudBlock[], span: Span): CloudBlock | undefined {
  let best: CloudBlock | undefined;
  for (const b of blocks) {
    if (b.t0 < span.t1 && b.t1 > span.t0 && b.cover !== "FEW" && (!best || b.baseM < best.baseM)) best = b;
  }
  return best;
}

/** Var nederbörden faller ifrån: molnet ovanför (hela dess bredd), annars själva intervallet. */
function source(blocks: CloudBlock[], span: Span): { fromM?: number; atT: number; drawT0: number; drawT1: number } {
  const c = cloudAt(blocks, span);
  // Rita under den del av molnet som överlappar regnperioden.
  const t0 = c ? Math.max(c.t0, span.t0) : span.t0;
  const t1 = c ? Math.min(c.t1, span.t1) : span.t1;
  const [d0, d1] = t1 - t0 >= 10 * 60 * 1000 ? [t0, t1] : [span.t0, span.t1];
  return { fromM: c?.baseM, atT: (d0 + d1) / 2, drawT0: d0, drawT1: d1 };
}

export function buildChart(bundle: WeatherBundle, now: number): ChartData {
  const fc = forecastWindow(bundle, now);
  const missing: ChartData["missing"] = {};
  if (!bundle.forecast) missing.forecast = "Prognos saknas";

  // Temperatur
  const tObs = obsPoints(bundle, "temperature", (x) => x.temperatureC);
  // Prognoskurvan börjar i senaste observerade punkt (streckad fram till NU och vidare),
  // så att observerat och prognos sitter ihop utan hopp.
  const { anchor, adjust } = tempAdjuster(bundle, now);
  const tFc = [
    ...(anchor && bundle.forecast ? [anchor] : []),
    ...fc.flatMap((p) =>
      p.temperatureC === undefined || (anchor && ts(p) <= anchor.t)
        ? []
        : [{ t: ts(p), v: Math.round(adjust(ts(p), p.temperatureC) * 10) / 10 }],
    ),
  ];
  const tDomain = niceDomain([...tObs, ...tFc].map((p) => p.v), 6, 0.2);
  if (!stationFor(bundle, "temperature")) missing.temp = "Ingen temperaturmätning i närheten";

  // Moln
  const cloudObs = stationFor(bundle, "cloudBase")?.observations ?? [];
  const cloudStep = stepOf(cloudObs);
  const cloudsObserved: CloudBlock[] = [];
  for (const x of cloudObs) {
    const t = ts(x);
    const span = { t0: t - cloudStep / 2, t1: t + cloudStep / 2 };
    if (x.cloudLayers?.length) {
      for (const l of x.cloudLayers) cloudsObserved.push({ ...span, baseM: l.baseM, cover: l.cover, density: COVER_DENSITY[l.cover] });
    } else if (x.cloudBaseM !== undefined) {
      cloudsObserved.push({ ...span, baseM: x.cloudBaseM, cover: "MODEL", density: 0.6 });
    }
  }
  if (!cloudObs.length) missing.clouds = "Ingen molnobservation i närheten";
  const cloudsForecast: CloudBlock[] = fc.flatMap((p) => {
    if (p.cloudBaseM === undefined) return [];
    const t = ts(p);
    const oktas = Math.max(p.lowCloudCoverOktas ?? 0, p.cloudCoverOktas ?? 4);
    return [{ t0: t - HOUR / 2, t1: t + HOUR / 2, baseM: p.cloudBaseM, cover: "MODEL" as const, density: Math.max(0.15, oktas / 8) }];
  });

  // Väderfenomen (observerat) – nederbördstyp, dimma, åska
  const phenObs = stationFor(bundle, "phenomena")?.observations ?? [];
  const phenStep = stepOf(phenObs);
  const kindNear = (t: number): PrecipKind | null => {
    for (const o of phenObs) {
      if (Math.abs(ts(o) - t) <= 45 * 60 * 1000) {
        const k = precipKindOf(o.weatherPhenomena?.[0]);
        if (k) return k;
      }
    }
    return null;
  };

  // Nederbörd: uppmätt mängd (SMHI) och väderkod (METAR/SMHI), faller från molnbasen
  const precipObserved: Precip[] = [];
  for (const x of stationFor(bundle, "precipitation")?.observations ?? []) {
    if (x.precipitationMm === undefined || x.precipitationMm <= 0) continue;
    const span = { t0: ts(x) - HOUR, t1: ts(x) };
    const kind = kindNear(span.t0 + HOUR / 2) ?? "regn";
    precipObserved.push({ ...span, kind, mm: x.precipitationMm, ...source(cloudsObserved, span), label: kind === "snö" ? "Snö" : "Regn" });
  }
  for (const o of phenObs) {
    const p = o.weatherPhenomena?.[0];
    const kind = precipKindOf(p);
    if (!kind || !p) continue;
    const t = ts(o);
    const span = { t0: t - phenStep / 2, t1: t + phenStep / 2 };
    if (precipObserved.some((b) => b.mm !== undefined && b.t0 < span.t1 && b.t1 > span.t0)) continue;
    precipObserved.push({ ...span, kind, ...source(cloudsObserved, span), label: p.label });
  }
  const precipForecast: Precip[] = fc.flatMap((p) => {
    const t1 = ts(p);
    const t0 = p.intervalStart ? Date.parse(p.intervalStart) : t1 - HOUR;
    if (t1 < now || p.precipitationMm === undefined || p.precipitationMm < 0.1) return [];
    const kind = precipKindOf(p.phenomenon) ?? "regn";
    // Prognosens moln för timmen ritas centrerat på t1 – dropparna täcker samma bredd.
    const from =
      p.cloudBaseM !== undefined
        ? { fromM: p.cloudBaseM, atT: t1, drawT0: t1 - HOUR / 2, drawT1: t1 + HOUR / 2 }
        : { atT: (t0 + t1) / 2, drawT0: t0, drawT1: t1 };
    return [{ t0, t1, kind, mm: p.precipitationMm, ...from, label: p.phenomenon?.label ?? (kind === "snö" ? "Snö" : "Regn") }];
  });

  // Vattenansamling: löpande summa av uppmätt nederbörd, sedan prognosens mängder.
  const water: WaterSeries = { observed: [], forecast: [] };
  const measured = (stationFor(bundle, "precipitation")?.observations ?? []).filter(
    (o) => o.precipitationMm !== undefined && ts(o) <= now,
  );
  let sum = 0;
  if (measured.length) {
    water.observed.push({ t: ts(measured[0]) - HOUR, v: 0 });
    for (const o of measured) {
      sum += o.precipitationMm!;
      water.observed.push({ t: ts(o), v: Math.round(sum * 10) / 10 });
    }
  }
  // Prognosen fortsätter från observerad summa om mätningen är färsk, annars från noll vid NU.
  const lastMeasured = water.observed.at(-1);
  const startV = lastMeasured && now - lastMeasured.t <= 2 * HOUR ? lastMeasured.v : 0;
  const startT = lastMeasured && now - lastMeasured.t <= 2 * HOUR ? lastMeasured.t : now;
  if (bundle.forecast) {
    let acc = startV;
    water.forecast.push({ t: startT, v: acc });
    for (const p of fc) {
      const t = ts(p);
      if (t <= startT || p.precipitationMm === undefined) continue;
      acc += p.precipitationMm;
      water.forecast.push({ t, v: Math.round(acc * 10) / 10 });
    }
  }

  // Nederbörd vid minusgrader är snö, oavsett vad väderkoden säger.
  const tempNear = (t: number): number | undefined => {
    let best: Pt | undefined;
    for (const p of [...tObs, ...tFc]) {
      if (Math.abs(p.t - t) <= 45 * 60 * 1000 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p;
    }
    return best?.v;
  };
  for (const p of [...precipObserved, ...precipForecast]) {
    const temp = tempNear(p.atT);
    if (p.kind === "regn" && temp !== undefined && temp < 0) {
      p.kind = "snö";
      p.label = p.label.replace(/regnskurar/i, "Snöbyar").replace(/regn/i, "snö");
      if (!/snö/i.test(p.label)) p.label = "Snö";
    }
  }

  // Vind: en pil per timme
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
  for (const p of fc) {
    const t = ts(p);
    if (t < now || p.windSpeedMs === undefined || t - lastT < 55 * 60 * 1000) continue;
    wind.push({ t, deg: p.windDirectionDeg, speed: p.windSpeedMs, gust: p.windGustMs, forecast: true });
    lastT = t;
  }

  // Låg sikt / dimma och åska
  const lowVis: ChartData["lowVis"] = [];
  const thunder: Mark[] = [];

  // Klar himmel – en symbol per timme som mest
  const clear: ChartData["clear"] = [];
  const { latitude: lat, longitude: lon } = bundle.location;
  let lastClear = -Infinity;
  for (const o of cloudObs) {
    const t = ts(o);
    if (!o.clearSky || t - lastClear < 55 * 60 * 1000) continue;
    const code = o.raw?.match(/\b(CAVOK|SKC|CLR)\b/)?.[1] ?? "Klart";
    clear.push({ t, forecast: false, day: isDaylight(lat, lon, t), label: `Klart (${code})` });
    lastClear = t;
  }
  for (const p of fc) {
    const t = ts(p);
    if (p.cloudCoverOktas !== 0 || t - lastClear < 55 * 60 * 1000) continue;
    clear.push({ t, forecast: true, day: isDaylight(lat, lon, t), label: "Klart (prognos)" });
    lastClear = t;
  }
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
  for (const p of fc) {
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

  return {
    temp: { observed: segments(tObs, OBS_GAP), forecast: segments(tFc, FCST_GAP), domain: tDomain, ticks: niceTicks(tDomain) },
    cloudsObserved,
    cloudsForecast,
    precipObserved,
    precipForecast,
    water,
    wind,
    lowVis,
    thunder,
    clear,
    missing,
  };
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
  wind: Reading<{ deg?: number; variable?: boolean; speed?: number }>;
  gust: Reading<number | undefined>;
  visibility: Reading<{ m: number; atLeast?: boolean }>;
  cloud: Reading<{ baseM?: number; layers?: CloudLayer[]; nsc?: boolean; oktas?: number }>;
  precipitation: Reading<{ mm: number; probability?: number }>;
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

/** Rå METAR närmast tidpunkten (senaste vid NU och i prognosläget). */
function metarAt(bundle: WeatherBundle, t: number, mode: Snapshot["mode"]): Snapshot["metar"] {
  const s = bundle.stations.find((x) => x.station.source === "METAR");
  if (!s) return undefined;
  const o =
    mode === "observed"
      ? s.observations
          .filter((x) => Math.abs(ts(x) - t) <= TOL.METAR)
          .sort((a, b) => Math.abs(ts(a) - t) - Math.abs(ts(b) - t))[0]
      : s.observations.at(-1);
  return o?.raw ? { raw: o.raw, stationId: o.stationId, timestamp: ts(o) } : undefined;
}

export function snapshotAt(bundle: WeatherBundle, t: number, now: number): Snapshot {
  const mode: Snapshot["mode"] = Math.abs(t - now) < 10 * 60 * 1000 ? "now" : t < now ? "observed" : "forecast";
  const taf = (bundle.taf?.periods ?? []).filter(
    (p) => p.change !== "BASE" && p.change !== "FM" && Date.parse(p.from) <= t && t < Date.parse(p.to),
  );
  const metar = metarAt(bundle, t, mode);

  if (mode === "forecast") {
    const p = pickForecast(bundle, t);
    const origin: Origin = { kind: "PROGNOS", timestamp: p ? ts(p) : t };
    return {
      mode,
      time: t,
      // Samma justering mot senaste observation som i diagrammet.
      temperature: def(
        p?.temperatureC === undefined ? undefined : Math.round(tempAdjuster(bundle, now).adjust(ts(p), p.temperatureC) * 10) / 10,
        origin,
      ),
      wind: p?.windSpeedMs !== undefined ? { value: { deg: p.windDirectionDeg, speed: p.windSpeedMs }, origin } : null,
      gust: p ? def(p.windGustMs, origin) : null,
      visibility: p?.visibilityM !== undefined ? { value: { m: p.visibilityM, atLeast: p.visibilityM >= 10000 }, origin } : null,
      cloud: p ? { value: { baseM: p.cloudBaseM, oktas: p.cloudCoverOktas }, origin } : null,
      precipitation:
        p?.precipitationMm !== undefined && p.precipitationMm > 0
          ? { value: { mm: p.precipitationMm, probability: p.precipitationProbability }, origin }
          : null,
      phenomena: p?.phenomenon ? { value: [p.phenomenon], origin } : null,
      forecastSummary: symbolLabel(p?.symbolCode),
      metar,
      taf,
    };
  }

  const wind = pickObs(bundle, "wind", t, mode, (o) =>
    o.windSpeedMs === undefined ? undefined : { deg: o.windDirectionDeg, variable: o.windVariable, speed: o.windSpeedMs },
  );
  // Byar: METAR utan G-grupp betyder "inga kraftiga byar rapporterade", inte vindstilla.
  const gust =
    bundle.selections.gust?.station?.source === "METAR"
      ? pickObs<number | undefined>(bundle, "gust", t, mode, (o) => (o.windSpeedMs !== undefined ? (o.windGustMs ?? NaN) : undefined))
      : pickObs(bundle, "gust", t, mode, (o) => o.windGustMs);
  if (gust && Number.isNaN(gust.value)) gust.value = undefined;

  return {
    mode,
    time: t,
    temperature: pickObs(bundle, "temperature", t, mode, (o) => o.temperatureC),
    wind,
    gust,
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
      // Nollvärden behålls – annars skulle NU kunna visa ett äldre regnvärde.
      o.precipitationMm === undefined ? undefined : { mm: o.precipitationMm },
    ),
    phenomena: pickObs(bundle, "phenomena", t, mode, (o) => o.weatherPhenomena),
    metar,
    taf: mode === "now" ? taf : [],
  };
}
