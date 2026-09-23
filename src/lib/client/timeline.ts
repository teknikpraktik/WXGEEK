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
import { oktasCover } from "../format";
import {
  mergedForecastAt,
  smhiPointAt,
  tafEndWithin,
  tafMainAt,
  tafSupplementsAt,
  type FcSource,
  type MergedForecast,
  type TafTransition,
} from "./forecast";

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
/**
 * Ett molnlager under ett tidsintervall: höjd och mängd kommer alltid från samma lager.
 * cover "UNKNOWN" = molnbas känd men mängden okänd (SMHI-station, eller SMHI-prognos där
 * mängden låga moln inte hör ihop med basen).
 */
export type CloudBlock = Span & { baseM: number; cover: CloudLayer["cover"] | "UNKNOWN"; type?: CloudLayer["type"]; forecast: boolean };

/** Högsta basen där SMHI:s mängd låga moln (low_type_cloud_area_fraction) anses höra till lagret. */
const LOW_CLOUD_MAX_M = 2500;
/**
 * SMHI-prognosens lager: lägsta molnbas + mängd *låga* moln. Den totala molnmängden
 * (cloud_area_fraction) gäller alla höjder och kombineras aldrig med basen.
 */
export function modelLayer(c: { baseM?: number; lowOktas?: number }): { baseM: number; cover: CloudBlock["cover"] } | null {
  if (c.baseM === undefined) return null;
  const cover = c.baseM <= LOW_CLOUD_MAX_M ? oktasCover(c.lowOktas) : undefined;
  return { baseM: c.baseM, cover: cover ?? "UNKNOWN" };
}
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
  /** SMHI probability of precipitation (%), forecast only */
  probability?: number;
};

/**
 * Ackumulerad nederbörd vid marken. Regn som vatten (mm); snö som uppskattat nysnödjup (cm)
 * med tumregeln 1 mm vatten ≈ 1 cm nysnö. Smältning och sättning räknas inte.
 */
/**
 * Nederbörd per timme (mängd under timmen t0–t1, mm), i ett eget fält under diagrammet.
 * Både SMHI:s mätning (parameter 7, summa 1 h) och prognosens timsteg är mängder per
 * intervall – ingen omräkning från intensitet behövs. Timmar utan uppgift saknas i listan
 * (visas inte som 0 mm); 0 mm är en giltig uppgift.
 * Uppmätt: likely = possible = mätt mängd.
 * Prognos (SMHI:s ensemble): likely = median (minst hälften av medlemmarna ger så mycket),
 * possible = övre delen av spridningen (max av medel och max). SMHI:s min används inte –
 * den kan vara 0,1 mm även när sannolikheten är några procent.
 */
export type PrecipHour = Span & { likely: number; possible: number; kind: PrecipKind; forecast: boolean };

export type Arrow = { t: number; deg?: number; variable?: boolean; speed: number; gust?: number; forecast: boolean };
export type Mark = Span & { forecast: boolean; label: string };

export type ChartData = {
  temp: { observed: Pt[][]; forecast: Pt[][]; domain: [number, number]; ticks: number[] };
  cloudsObserved: CloudBlock[];
  cloudsForecast: CloudBlock[];
  /** Molnighet per hel timme i fönstret (observerat fram till NU, därefter prognos) */
  sky: Array<Sky & { t: number; forecast: boolean; day: boolean }>;
  precipObserved: Precip[];
  precipForecast: Precip[];
  precipHours: PrecipHour[];
  wind: Arrow[];
  /** Dimma / sikt under 5 km */
  lowVis: Array<Mark & { severe: boolean }>;
  thunder: Mark[];
  missing: { temp?: string; wind?: string; clouds?: string; forecast?: string };
  /** Tidpunkt då TAF slutar inom fönstret – därefter fortsätter SMHI */
  tafEnd?: { t: number; stationId: string };
};

/** Molnbasaxeln (höger): linjär 0–3 000 m. */
export const CLOUD_TOP_M = 3000;
export const CLOUD_TICKS = [0, 500, 1000, 1500, 2000, 2500, 3000];
// Temperaturaxeln: fast skala per årstid, gränser på multiplar av 5 °C.
const TEMP_MARGIN = 2;
const floor5 = (v: number) => Math.floor(v / 5) * 5;
const ceil5 = (v: number) => Math.ceil(v / 5) * 5;

/** Årstidens grundskala: vinter (dec–feb) −20…+10, sommar (jun–aug) 0…30, vår/höst −5…+20. */
export function seasonTempScale(month: number): [number, number] {
  if (month === 11 || month <= 1) return [-20, 10];
  if (month >= 5 && month <= 7) return [0, 30];
  return [-5, 20];
}

/**
 * Temperaturskalans intervall för värdena i fönstret (observationer + prognos).
 * Utgår från årstidens fasta skala (`month` 0–11) och utökas i steg om 5 °C så att alla värden
 * får minst 2 °C marginal. En tidigare skala krymps aldrig. Värden klipps aldrig.
 */
export function tempScale(values: number[], month: number, prev?: [number, number]): [number, number] {
  let [l, u] = seasonTempScale(month);
  if (values.length) {
    l = Math.min(l, floor5(Math.min(...values) - TEMP_MARGIN));
    u = Math.max(u, ceil5(Math.max(...values) + TEMP_MARGIN));
  }
  if (prev) {
    l = Math.min(l, prev[0]);
    u = Math.max(u, prev[1]);
  }
  return [l, u];
}
export const tempTicks = ([lo, hi]: [number, number]) => Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5);

// --- Molnighet som symbol ---------------------------------------------------
/**
 * Förenklad molnighet för en tidpunkt. Regel: den största täckningskategorin bland samtidiga
 * lager (åttondelar summeras inte). CAVOK, NSC och saknade uppgifter blir aldrig SKC.
 */
export type SkyKind = "SKC" | "FEW" | "SCT" | "BKN" | "OVC" | "VV" | "CAVOK" | "NSC" | "UNKNOWN" | "MISSING";
export type Sky = {
  kind: SkyKind;
  /** Kategorin kommer från SMHI:s modell som komplement till CAVOK */
  fromSmhi?: boolean;
  /** Ursprunglig uppgift var CAVOK */
  cavok?: boolean;
};
const COVER_RANK: Record<string, number> = { FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 5 };
type SkyInput = { layers?: CloudLayer[]; cavok?: boolean; clear?: boolean; nsc?: boolean; oktas?: number; baseM?: number };
export function skyOf(c: SkyInput | undefined | null, smhiOktas?: number): Sky {
  if (!c) return { kind: "MISSING" };
  if (c.cavok) {
    if (smhiOktas === undefined) return { kind: "CAVOK", cavok: true };
    return { kind: smhiOktas === 0 ? "SKC" : oktasCover(smhiOktas)!, fromSmhi: true, cavok: true };
  }
  if (c.layers?.length) {
    const top = c.layers.reduce((a, b) => (COVER_RANK[b.cover] > COVER_RANK[a.cover] ? b : a));
    return { kind: top.cover };
  }
  if (c.clear) return { kind: "SKC" };
  if (c.nsc) return { kind: "NSC" };
  if (c.oktas !== undefined) return { kind: c.oktas === 0 ? "SKC" : oktasCover(c.oktas)! };
  if (c.baseM !== undefined) return { kind: "UNKNOWN" };
  return { kind: "MISSING" };
}
/** Molnighet ur en observation (CAVOK läses ur rå-METAR; clearSky i adaptern omfattar även CAVOK). */
const obsCloud = (o: WeatherObservation): SkyInput | undefined => {
  const cavok = !!o.raw && /\bCAVOK\b/.test(o.raw);
  if (!(o.cloudLayers?.length || o.noSignificantCloud || o.clearSky || o.cloudBaseM !== undefined || cavok)) return undefined;
  return { layers: o.cloudLayers, nsc: o.noSignificantCloud, clear: o.clearSky && !cavok, cavok, baseM: o.cloudBaseM };
};

const OBS_GAP = 100 * 60 * 1000;
const FCST_GAP = 3 * HOUR + 1;

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

export function buildChart(bundle: WeatherBundle, now: number, prevTempDomain?: [number, number]): ChartData {
  const fc = forecastWindow(bundle, now);
  const missing: ChartData["missing"] = {};
  if (!bundle.forecast) missing.forecast = "No forecast";

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

  const tDomain = tempScale(
    [...tObs.filter((p) => p.t >= now - PAST_HOURS * HOUR), ...tFc].map((p) => p.v),
    new Date(now).getMonth(),
    prevTempDomain,
  );

  // Prognos per timme med källa per variabel: TAF där den gäller, annars SMHI.
  const merged: MergedForecast[] = fc.filter((p) => ts(p) >= now - 30 * 60 * 1000).map((p) => mergedForecastAt(bundle, ts(p), adjust));
  /** Lägsta molnbas (ej FEW) i en sammanslagen prognospunkt. */
  const fcBase = (m: MergedForecast): number | undefined => {
    const c = m.clouds?.value;
    if (!c) return undefined;
    if (c.layers?.length) return c.layers.find((l) => l.cover !== "FEW")?.baseM;
    return c.baseM;
  };
  if (!stationFor(bundle, "temperature")) missing.temp = "No temperature observation nearby";

  // Moln
  const cloudObs = stationFor(bundle, "cloudBase")?.observations ?? [];
  const cloudStep = stepOf(cloudObs);
  // Varje observation gäller ± halva rapportintervallet, men aldrig efter NU; prognosen
  // gäller från NU.
  const cloudsObserved: CloudBlock[] = [];
  for (const x of cloudObs) {
    const t = ts(x);
    const span = { t0: t - cloudStep / 2, t1: Math.min(now, t + cloudStep / 2) };
    if (span.t1 <= span.t0) continue;
    if (x.cloudLayers?.length) {
      for (const l of x.cloudLayers) cloudsObserved.push({ ...span, baseM: l.baseM, cover: l.cover, type: l.type, forecast: false });
    } else if (x.cloudBaseM !== undefined) {
      cloudsObserved.push({ ...span, baseM: x.cloudBaseM, cover: "UNKNOWN", forecast: false });
    }
  }
  if (!cloudObs.length) missing.clouds = "No cloud observation nearby";
  const cloudsForecast: CloudBlock[] = merged.flatMap((m): CloudBlock[] => {
    const c = m.clouds?.value;
    if (!c) return [];
    const span = { t0: Math.max(now, m.t - HOUR / 2), t1: m.t + HOUR / 2 };
    if (span.t1 <= span.t0) return [];
    // TAF: angivna lager med täckningsgrad. CAVOK/NSC ritar inga moln (ingen påhittad molnbas).
    if (c.layers?.length) return c.layers.map((l) => ({ ...span, baseM: l.baseM, cover: l.cover, type: l.type, forecast: true }));
    const ml = modelLayer(c);
    return ml ? [{ ...span, ...ml, forecast: true }] : [];
  });
  // Molnighet per hel timme: närmaste observation (inom rapporttoleransen) fram till NU,
  // därefter prognosens huvudläge (TAF BASE/FM/BECMG eller SMHI – aldrig TEMPO/PROB).
  const { latitude: lat, longitude: lon } = bundle.location;
  const skySrc = stationFor(bundle, "cloudBase");
  const skyTol = skySrc?.station.source === "SMHI" ? 40 * 60 * 1000 : 35 * 60 * 1000;
  const sky: ChartData["sky"] = [];
  const fcEnd = Date.parse(bundle.forecastUntil);
  for (let t = Math.ceil((now - PAST_HOURS * HOUR) / HOUR) * HOUR; t <= fcEnd; t += HOUR) {
    const day = isDaylight(lat, lon, t);
    if (t <= now) {
      let best: WeatherObservation | undefined;
      for (const o of cloudObs) {
        const d = Math.abs(ts(o) - t);
        if (d <= skyTol && ts(o) <= now && obsCloud(o) && (!best || d < Math.abs(ts(best) - t))) best = o;
      }
      sky.push({ t, forecast: false, day, ...skyOf(best && obsCloud(best)) });
    } else {
      const m = merged.find((x) => x.t === t);
      const pt = fc.find((x) => ts(x) === t);
      sky.push({ t, forecast: true, day, ...skyOf(m?.clouds?.value, m?.clouds?.value.cavok ? pt?.cloudCoverOktas : undefined) });
    }
  }

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
    precipObserved.push({ ...span, kind, mm: x.precipitationMm, ...source(cloudsObserved, span), label: kind === "snö" ? "Snow" : "Rain" });
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
  const precipForecast: Precip[] = merged.flatMap((m) => {
    if (m.t < now) return [];
    const pr = m.precipitation?.value;
    const wx = m.weather?.value ?? [];
    const wxPrecip = wx.find((x) => precipKindOf(x));
    const amount = pr && pr.mm >= 0.1 ? pr.mm : undefined;
    // TAF anger nederbörd men SMHI ingen mängd: glesa droppar utan mängd.
    if (amount === undefined && !(wxPrecip && m.weather?.source.kind === "TAF")) return [];
    const kind = precipKindOf(wxPrecip) ?? "regn";
    const base = fcBase(m);
    const t0 = pr?.from ?? m.t - HOUR;
    const t1 = pr?.to ?? m.t;
    // Prognosens moln för timmen ritas centrerat på tidssteget – dropparna täcker samma bredd.
    const from =
      base !== undefined
        ? { fromM: base, atT: m.t, drawT0: m.t - HOUR / 2, drawT1: m.t + HOUR / 2 }
        : { atT: (t0 + t1) / 2, drawT0: t0, drawT1: t1 };
    return [{ t0, t1, kind, mm: amount, ...from, label: wxPrecip?.label ?? (kind === "snö" ? "Snow" : "Rain"), probability: pr?.probability }];
  });

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
      p.label = p.label.replace(/rain showers/i, "Snow showers").replace(/rain/i, "snow");
      if (!/snow/i.test(p.label)) p.label = "Snow";
    }
  }

  // Nederbördstyp per intervall hämtas från nederbördsobjekten ovan (efter snö-omklassningen).
  const kindOver = (span: Span, list: Precip[]): PrecipKind => {
    const hit = list.find((p) => p.t0 < span.t1 && p.t1 > span.t0);
    if (hit) return hit.kind;
    const temp = tempNear((span.t0 + span.t1) / 2);
    return temp !== undefined && temp < 0 ? "snö" : "regn";
  };
  const measured = (stationFor(bundle, "precipitation")?.observations ?? []).filter(
    (o) => o.precipitationMm !== undefined && ts(o) <= now,
  );
  // Nederbörd per timme: uppmätt fram till senaste mätningen, därefter prognosen
  const precipHours: PrecipHour[] = [];
  for (const o of measured) {
    const span = { t0: ts(o) - HOUR, t1: ts(o) };
    if (span.t1 < now - PAST_HOURS * HOUR) continue;
    precipHours.push({ ...span, likely: o.precipitationMm!, possible: o.precipitationMm!, kind: kindOver(span, precipObserved), forecast: false });
  }
  const measuredUntil = measured.length ? ts(measured.at(-1)!) : -Infinity;
  for (const p of fc) {
    const t = ts(p);
    const t0 = p.intervalStart ? Date.parse(p.intervalStart) : t - HOUR;
    if (t <= now || t0 < measuredUntil || t - t0 > HOUR) continue;
    const likelyRaw = p.precipitationMedianMm ?? p.precipitationMm;
    if (likelyRaw === undefined) continue;
    const likely = likelyRaw >= 0.1 ? likelyRaw : 0;
    const possible = Math.max(likely, p.precipitationMm ?? 0, p.precipitationMaxMm ?? 0);
    const span = { t0, t1: t };
    precipHours.push({ ...span, likely, possible: possible >= 0.1 ? possible : 0, kind: kindOver(span, precipForecast), forecast: true });
  }

  // Vind: en pil per timme
  const wind: Arrow[] = [];
  const windObs = stationFor(bundle, "wind")?.observations ?? [];
  const gustObs = stationFor(bundle, "gust")?.observations ?? [];
  if (!windObs.length) missing.wind = "No wind observation nearby";
  let lastT = -Infinity;
  for (const x of windObs) {
    const t = ts(x);
    if (x.windSpeedMs === undefined || t - lastT < 55 * 60 * 1000) continue;
    const g = gustObs.find((o) => Math.abs(ts(o) - t) <= 35 * 60 * 1000 && o.windGustMs !== undefined);
    wind.push({ t, deg: x.windDirectionDeg, variable: x.windVariable, speed: x.windSpeedMs, gust: g?.windGustMs, forecast: false });
    lastT = t;
  }
  for (const m of merged) {
    const w = m.wind?.value;
    if (m.t < now || !w || m.t - lastT < 55 * 60 * 1000) continue;
    wind.push({ t: m.t, deg: w.deg, variable: w.variable, speed: w.speed, gust: w.gust, forecast: true });
    lastT = m.t;
  }

  // Låg sikt / dimma och åska
  const lowVis: ChartData["lowVis"] = [];
  const thunder: Mark[] = [];

  const visObs = stationFor(bundle, "visibility")?.observations ?? [];
  const visStep = stepOf(visObs);
  for (const o of visObs) {
    if (o.visibilityM !== undefined && o.visibilityM < 5000) {
      const t = ts(o);
      lowVis.push({ t0: t - visStep / 2, t1: t + visStep / 2, forecast: false, severe: o.visibilityM < 1000, label: `Visibility ${o.visibilityM} m` });
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
  for (const m of merged) {
    const span = { t0: m.t - HOUR / 2, t1: m.t + HOUR / 2 };
    const vis = m.visibility?.value.m;
    const wx = m.weather?.value ?? [];
    const fog = wx.find((x) => x.kind === "dimma" || x.kind === "dis");
    if ((vis !== undefined && vis < 5000) || fog) {
      lowVis.push({
        ...span,
        forecast: true,
        severe: (vis ?? 5000) < 1000 || fog?.kind === "dimma",
        label: fog?.label ?? `Visibility ${vis} m`,
      });
    }
    const ts_ = wx.find((x) => x.kind === "åska");
    if (ts_) thunder.push({ ...span, forecast: true, label: ts_.label });
  }

  return {
    temp: { observed: segments(tObs, OBS_GAP), forecast: segments(tFc, FCST_GAP), domain: tDomain, ticks: tempTicks(tDomain) },
    cloudsObserved,
    cloudsForecast,
    sky,
    precipObserved,
    precipForecast,
    precipHours,
    wind,
    lowVis,
    thunder,
    missing,
    tafEnd: (() => {
      const t = tafEndWithin(bundle, now, Date.parse(bundle.forecastUntil));
      return t && bundle.taf ? { t, stationId: bundle.taf.stationId } : undefined;
    })(),
  };
}

// ---------------------------------------------------------------------------
// Avläsning vid en tidpunkt
// ---------------------------------------------------------------------------

/**
 * Varifrån ett värde kommer. Observationer har station och tid; TAF har flygplats och
 * giltighetsperiod; SMHI-prognos har platsens koordinater, tidssteg och ev. intervall.
 */
export type Origin = {
  kind: "METAR" | "SMHI" | "TAF" | "SMHI-PROGNOS";
  stationId?: string;
  stationName?: string;
  distanceKm?: number;
  /** Observationstid eller prognosens tidssteg */
  timestamp: number;
  /** TAF: period som värdet gäller */
  validFrom?: number;
  validTo?: number;
  /** SMHI-prognos: koordinater */
  latitude?: number;
  longitude?: number;
};

export type Reading<T> = { value: T; origin: Origin } | null;

export type Snapshot = {
  mode: "now" | "observed" | "forecast";
  time: number;
  temperature: Reading<number>;
  wind: Reading<{ deg?: number; variable?: boolean; speed?: number }>;
  /** Byvind. value undefined = METAR utan G-grupp (inga kraftiga byar rapporterade). */
  gust: Reading<number | undefined>;
  visibility: Reading<{ m: number; atLeast?: boolean }>;
  cloud: Reading<{ baseM?: number; layers?: CloudLayer[]; nsc?: boolean; oktas?: number; lowOktas?: number; cavok?: boolean; clear?: boolean }>;
  /** Förenklad molnighet (största kategorin) för vald tid */
  sky: Sky;
  /** Dag (solen över horisonten) vid vald tid och plats */
  day: boolean;
  /** Nederbördsmängd under intervallet from–to. Sannolikhet hålls separat. */
  precipitation: Reading<{ mm: number; from: number; to: number }>;
  precipProbability?: { value: number; origin: Origin };
  phenomena: Reading<Phenomenon[]>;
  /** Symboltext från SMHI-prognosen, t.ex. "Halvklart" */
  forecastSummary?: string;
  metar?: { raw: string; stationId: string; timestamp: number };
  /** TAF: TEMPO/PROB som gäller vid vald tid (kompletterande information) */
  supplements: TafPeriod[];
  /** TAF: pågående BECMG-övergång */
  transition?: TafTransition;
  /** Förklaring när källorna säger olika saker */
  note?: string;
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
      if (ts(o) <= t && get(o) !== undefined) {
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

function originOf(src: FcSource): Origin {
  return src.kind === "TAF"
    ? {
        kind: "TAF",
        stationId: src.stationId,
        stationName: src.stationName,
        distanceKm: src.distanceKm,
        timestamp: src.validFrom,
        validFrom: src.validFrom,
        validTo: src.validTo,
      }
    : { kind: "SMHI-PROGNOS", latitude: src.latitude, longitude: src.longitude, timestamp: src.time, validFrom: src.intervalFrom };
}

function read<T, U>(s: { value: T; source: FcSource } | undefined, map: (v: T) => U): Reading<U> {
  return s ? { value: map(s.value), origin: originOf(s.source) } : null;
}

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

/** Läge för en tidpunkt: nära NU = senaste observation, före = observerat, efter = prognos. */
export function modeAt(t: number, now: number): Snapshot["mode"] {
  return Math.abs(t - now) < 10 * 60 * 1000 ? "now" : t < now ? "observed" : "forecast";
}

export function snapshotAt(bundle: WeatherBundle, t: number, now: number): Snapshot {
  const mode = modeAt(t, now);
  const metar = metarAt(bundle, t, mode);

  if (mode === "forecast") {
    const { adjust } = tempAdjuster(bundle, now);
    const m = mergedForecastAt(bundle, t, adjust);
    const p = smhiPointAt(bundle, t);
    const pr = m.precipitation;
    return {
      mode,
      time: t,
      temperature: read(m.temperature, (v) => v),
      wind: read(m.wind, (v) => ({ deg: v.deg, variable: v.variable, speed: v.speed })),
      gust: read(m.wind, (v) => v.gust),
      visibility: read(m.visibility, (v) => v),
      cloud: read(m.clouds, (v) => v),
      sky: skyOf(m.clouds?.value, m.clouds?.value.cavok ? p?.cloudCoverOktas : undefined),
      day: isDaylight(bundle.location.latitude, bundle.location.longitude, t),
      precipitation: read(pr, (v) => ({ mm: v.mm, from: v.from, to: v.to })),
      precipProbability:
        pr?.value.probability !== undefined ? { value: pr.value.probability, origin: originOf(pr.source) } : undefined,
      phenomena: read(m.weather, (v) => v),
      forecastSummary: m.clouds?.source.kind === "SMHI-PROGNOS" ? symbolLabel(p?.symbolCode) : undefined,
      metar,
      supplements: m.supplements,
      transition: m.transition,
      note: m.note,
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

  const cloud = pickObs(bundle, "cloudBase", t, mode, obsCloud);

  // Nederbörd: SMHI:s timsumma avser timmen före tidsstämpeln.
  const precip = pickObs(bundle, "precipitation", t, mode, (o) =>
    o.precipitationMm === undefined ? undefined : { mm: o.precipitationMm, from: ts(o) - HOUR, to: ts(o) },
  );

  return {
    mode,
    time: t,
    temperature: pickObs(bundle, "temperature", t, mode, (o) => o.temperatureC),
    wind,
    gust,
    visibility: pickObs(bundle, "visibility", t, mode, (o) =>
      o.visibilityM === undefined ? undefined : { m: o.visibilityM, atLeast: o.visibilityAtLeast },
    ),
    cloud,
    sky: skyOf(cloud?.value),
    day: isDaylight(bundle.location.latitude, bundle.location.longitude, t),
    precipitation: precip,
    phenomena: pickObs(bundle, "phenomena", t, mode, (o) => o.weatherPhenomena),
    metar,
    supplements: mode === "now" ? tafSupplementsAt(bundle.taf, t) : [],
    transition: mode === "now" && bundle.taf ? (tafMainAt(bundle.taf, t)?.transition ?? undefined) : undefined,
  };
}
