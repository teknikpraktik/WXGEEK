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
import { PHENOMENON_GROUP } from "../weather/phenomena";
import { isDaylight, sunEvents, sunPath, type SunEvent } from "../sun";
import { dewPointFromRh, oktasCover } from "../format";
import { fogBands, matchedRuns, type FogPt } from "./fogBand";
import {
  mergedForecastAt,
  precipRange,
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

/** Stationen som ger observerad daggpunkt: temperaturens om den har daggpunkt, annars METAR. */
function dewStation(bundle: WeatherBundle): StationSeries | undefined {
  return [stationFor(bundle, "temperature"), bundle.stations.find((x) => x.station.source === "METAR")].find((x) =>
    x?.observations.some((o) => o.dewPointC !== undefined),
  );
}

/** SMHI:s spridning (temperatur − daggpunkt ur relativ fuktighet) vid tiden t, linjärt mellan timpunkterna. */
function smhiSpreadAt(points: ForecastPoint[], t: number): number | undefined {
  const pts = points.filter((p) => p.temperatureC !== undefined && p.relativeHumidity !== undefined);
  const sp = (p: ForecastPoint) => p.temperatureC! - dewPointFromRh(p.temperatureC!, p.relativeHumidity!);
  if (!pts.length || t < ts(pts[0]) - HOUR) return undefined;
  if (t <= ts(pts[0])) return sp(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    if (t <= ts(pts[i])) {
      const f = (t - ts(pts[i - 1])) / (ts(pts[i]) - ts(pts[i - 1]));
      return sp(pts[i - 1]) + (sp(pts[i]) - sp(pts[i - 1])) * f;
    }
  }
  return undefined;
}

/**
 * Prognosens daggpunkt = visad (justerad) temperatur − spridning. Spridningen börjar i senaste
 * observerade (temperatur − daggpunkt i samma rapport) och klingar av mot SMHI:s under BLEND_MS,
 * som temperaturen – kurvorna sitter ihop vid NU, och avläsningen visar samma värde som kurvan.
 */
function dewAdjuster(bundle: WeatherBundle, now: number): { anchor?: Pt; spread: (t: number, smhiSpread: number) => number } {
  const last = dewStation(bundle)
    ?.observations.filter((o) => o.dewPointC !== undefined && o.temperatureC !== undefined && ts(o) <= now)
    .at(-1);
  if (!last) return { spread: (_t, v) => Math.max(0, v) };
  const t0 = ts(last);
  const fcSpread = smhiSpreadAt(bundle.forecast?.points ?? [], t0);
  const offset = fcSpread === undefined ? 0 : last.temperatureC! - last.dewPointC! - fcSpread;
  return {
    anchor: { t: t0, v: last.dewPointC! },
    spread: (t, v) => Math.max(0, v + offset * Math.max(0, 1 - (t - t0) / BLEND_MS)),
  };
}

// --- Molntäcke per skikt --------------------------------------------------------
/** Åttondelar för METAR-kategorierna: kategorins mitt (FEW 1–2, SCT 3–4, BKN 5–7, OVC 8). */
const CATEGORY_OKTAS: Record<string, number> = { FEW: 1.5, SCT: 3.5, BKN: 6, OVC: 8, VV: 8 };
const LAYERS = ["low", "mid", "high"] as const;
/** Skikt efter molnbasen: låga under 2 000 m, medelhöga 2 000–6 000 m, höga därovan. */
const layerIndex = (baseM: number) => (baseM < 2000 ? 0 : baseM < 6000 ? 1 : 2);

/** Molntäcket ur en METAR: skikt med rapporterat lager, lägre skikt klara, högre okända. */
function metarCover(o: WeatherObservation): Pick<CloudCoverHour, "low" | "mid" | "high"> | undefined {
  const cavok = !!o.raw && /\bCAVOK\b/.test(o.raw);
  if (o.clearSky && !cavok) return { low: 0, mid: 0, high: 0 };
  const out: Pick<CloudCoverHour, "low" | "mid" | "high"> = {};
  let top = -1;
  for (const l of o.cloudLayers ?? []) {
    const i = layerIndex(l.baseM);
    out[LAYERS[i]] = Math.max(out[LAYERS[i]] ?? 0, CATEGORY_OKTAS[l.cover] ?? 0);
    top = Math.max(top, i);
  }
  for (let i = 0; i < top; i++) out[LAYERS[i]] ??= 0;
  // CAVOK/NSC: inga moln under 1 500 m – de lågas skikt räknas som klart, högre okända.
  if (top < 0) return cavok || o.noSignificantCloud ? { low: 0 } : undefined;
  return out;
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
 * Prognos (SMHI:s ensemble, `precipRange`): likely = median (minst hälften av medlemmarna ger
 * så mycket), possible = övre delen av spridningen (max av medel och max) – samma regel som
 * avläsningen.
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
  /**
   * Dimma, dis eller sikt under 5 km. `severe`: dimma (sikt under 1 km).
   * `phenomenon`: dimma/dis rapporterad som väder – annars bara härledd ur sikten.
   */
  lowVis: Array<Mark & { severe: boolean; phenomenon: boolean }>;
  thunder: Mark[];
  missing: { temp?: string; wind?: string; clouds?: string; forecast?: string };
  /** Tidpunkt då TAF slutar inom fönstret – därefter fortsätter SMHI */
  tafEnd?: { t: number; stationId: string };
  /** Solbanan för platsen över fönstret: solhöjden var 10:e minut, gryning, soluppgång, solnedgång och skymning */
  sun: { path: Array<{ t: number; alt: number }>; events: SunEvent[] };
  /** Daggpunkt: observerat (temperaturens station om den har daggpunkt, annars METAR) och prognos
   *  (ur SMHI:s relativa fuktighet), sammanfogade vid senaste observationen som temperaturen */
  dew: { observed: Pt[][]; forecast: Pt[][] };
  /** Molntäcke per timme i tre skikt, åttondelar 0–8 (undefined = okänt) */
  cloudCover: CloudCoverHour[];
  /**
   * Dimrisk: ytan mellan temperatur och daggpunkt där spridningen är under 1 °C (`FOG_SPREAD`),
   * bara mellan tidsmatchade par i samma följd – observerat och prognos var för sig.
   */
  fogRisk: FogPt[][];
};

/**
 * Molntäcke en hel timme: prognos ur SMHI:s låga, medelhöga och höga moln (åttondelar); observerat
 * ur METAR-lagrens kategorier efter höjd (kategorins mitt – METAR anger inga procent). Skikt
 * ovanför det högsta rapporterade lagret är okända (undefined), aldrig påhittat klara.
 */
export type CloudCoverHour = { t: number; forecast: boolean; low?: number; mid?: number; high?: number; label: string };

/** Molnbasaxeln (höger): linjär 0–3 000 m. */
export const CLOUD_TOP_M = 3000;
export const CLOUD_TICKS = [0, 500, 1000, 1500, 2000, 2500, 3000];
/**
 * Temperaturaxelns inställningar – justeras visuellt här.
 * - minSpan: minsta spann (°C)
 * - margin: luft över och under kurvorna (°C)
 * - keep: vid uppdatering behålls skalan så länge alla värden ligger minst så här långt innanför
 * - zeroNear: 0° tas med när lägsta värdet ligger högst så här långt från 0
 * - fallback: skala när temperaturdata saknas helt
 */
export const TEMP_AXIS = {
  minSpan: 10,
  margin: 1,
  keep: 0.5,
  zeroNear: 5,
  fallback: [0, 10] as [number, number],
};

/** Stegen mellan skalmarkeringarna: 2° för små spann, 5° eller 10° för större. */
const tickStep = (span: number) => (span <= 14 ? 2 : span <= 35 ? 5 : 10);
const snapOut = (a: number, b: number, step: number): [number, number] => [Math.floor(a / step) * step, Math.ceil(b / step) * step];

/**
 * Väljer skalans intervall för temperaturerna (och daggpunkterna) lo…hi: värdena med marginal,
 * minst `minSpan` brett, 0° med när lägsta värdet ligger inom `zeroNear` från 0 (eller kurvorna
 * korsar 0), och gränserna på jämna skalsteg.
 */
function pickTempRange(lo: number, hi: number, minSpan: number): [number, number] {
  const c = TEMP_AXIS;
  const zero = Math.abs(lo) <= c.zeroNear || (lo < 0 && hi > 0);
  let a = lo - c.margin;
  let b = hi + c.margin;
  if (zero) {
    a = Math.min(a, 0);
    b = Math.max(b, 0);
  }
  if (b - a < minSpan) {
    // Minsta spannet: bort från 0 när 0 är kanten, annars jämnt runt värdena.
    const extra = minSpan - (b - a);
    if (zero && a === 0) b += extra;
    else if (zero && b === 0) a -= extra;
    else {
      a -= extra / 2;
      b += extra / 2;
    }
  }
  let r = snapOut(a, b, 2);
  for (const step of [5, 10]) if (tickStep(r[1] - r[0]) >= step) r = snapOut(a, b, step);
  return r;
}

/**
 * Temperaturskalans intervall för alla giltiga värden i fönstret (observationer + prognos, både
 * temperatur och daggpunkt). Med tidigare skala (samma plats): behålls så länge alla värden
 * ligger minst `keep` innanför gränserna; annars väljs en ny utan att spannet krymper.
 */
export function tempScale(values: number[], prev?: [number, number]): [number, number] {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return prev ?? TEMP_AXIS.fallback;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  if (!prev) return pickTempRange(lo, hi, TEMP_AXIS.minSpan);
  if (lo >= prev[0] + TEMP_AXIS.keep && hi <= prev[1] - TEMP_AXIS.keep) return prev;
  return pickTempRange(lo, hi, Math.max(TEMP_AXIS.minSpan, prev[1] - prev[0]));
}

/** Skalmarkeringar på jämna steg (2°, 5° eller 10° efter spannet); 0° med när den ryms. */
export function tempTicks([lo, hi]: [number, number]): number[] {
  const step = tickStep(hi - lo);
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
  return out;
}

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

  // Daggpunkt: observerat och prognos, sammanfogade vid senaste observationen (som temperaturen).
  const dObs = (dewStation(bundle)?.observations ?? []).flatMap((o) => (o.dewPointC === undefined ? [] : [{ t: ts(o), v: o.dewPointC }]));
  const dewAdj = dewAdjuster(bundle, now);
  const dFc = [
    ...(dewAdj.anchor && bundle.forecast ? [dewAdj.anchor] : []),
    ...fc.flatMap((p) => {
      if (p.temperatureC === undefined || p.relativeHumidity === undefined || (dewAdj.anchor && ts(p) <= dewAdj.anchor.t)) return [];
      const spread = dewAdj.spread(ts(p), p.temperatureC - dewPointFromRh(p.temperatureC, p.relativeHumidity));
      return [{ t: ts(p), v: Math.round((adjust(ts(p), p.temperatureC) - spread) * 10) / 10 }];
    }),
  ];

  const inWindow = (p: Pt) => p.t >= now - PAST_HOURS * HOUR;
  const tDomain = tempScale(
    [...tObs.filter(inWindow), ...tFc, ...dObs.filter(inWindow), ...dFc].map((p) => p.v),
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
    const range = precipRange(p);
    if (!range) continue;
    const span = { t0, t1: t };
    precipHours.push({ ...span, ...range, kind: kindOver(span, precipForecast), forecast: true });
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
      lowVis.push({ t0: t - visStep / 2, t1: t + visStep / 2, forecast: false, severe: o.visibilityM < 1000, phenomenon: false, label: `Visibility ${o.visibilityM} m` });
    }
  }
  for (const o of phenObs) {
    const p = o.weatherPhenomena?.[0];
    const t = ts(o);
    const span = { t0: t - phenStep / 2, t1: t + phenStep / 2 };
    if (p && PHENOMENON_GROUP[p.kind] === "dimma" && !lowVis.some((v) => v.t0 < span.t1 && v.t1 > span.t0)) {
      lowVis.push({ ...span, forecast: false, severe: p.kind === "dimma", phenomenon: true, label: p.label });
    }
    if (p?.kind === "åska") thunder.push({ ...span, forecast: false, label: p.label });
  }
  for (const m of merged) {
    const span = { t0: m.t - HOUR / 2, t1: m.t + HOUR / 2 };
    const vis = m.visibility?.value.m;
    const wx = m.weather?.value ?? [];
    const fog = wx.find((x) => x.kind === "dimma" || x.kind === "dis");
    // Dimma i TAF:ens TEMPO/PROB (t.ex. TEMPO BCFG) ger också dimsymbol under gruppens tid.
    const alt = fog?.kind === "dimma" ? undefined : m.supplements.find((p) => p.phenomena?.some((x) => x.kind === "dimma"));
    const altFog = alt?.phenomena?.find((x) => x.kind === "dimma");
    if ((vis !== undefined && vis < 5000) || fog || altFog) {
      lowVis.push({
        ...span,
        forecast: true,
        severe: (vis ?? 5000) < 1000 || fog?.kind === "dimma" || !!altFog,
        phenomenon: !!(fog || altFog),
        label: alt && altFog ? `${altFog.label} (${tafGroupName(alt)})` : (fog?.label ?? `Visibility ${vis} m`),
      });
    }
    const ts_ = wx.find((x) => x.kind === "åska");
    if (ts_) thunder.push({ ...span, forecast: true, label: ts_.label });
  }

  const temp = { observed: segments(tObs, OBS_GAP), forecast: segments(tFc, FCST_GAP) };
  const dew = { observed: segments(dObs, OBS_GAP), forecast: segments(dFc, FCST_GAP) };
  return {
    temp: { ...temp, domain: tDomain, ticks: tempTicks(tDomain) },
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
    sun: sunOver(bundle, now),
    dew,
    cloudCover: cloudCoverHours(bundle, fc, now),
    fogRisk: [...fogBands(matchedRuns(temp.observed, dew.observed)), ...fogBands(matchedRuns(temp.forecast, dew.forecast))],
  };
}

/**
 * Molntäcke per hel timme i fönstret: observerat ur närmaste METAR inom 35 min fram till NU,
 * därefter SMHI:s skikt (snow1g) vid samma timme.
 */
function cloudCoverHours(bundle: WeatherBundle, fc: ForecastPoint[], now: number): CloudCoverHour[] {
  const metar = bundle.stations.find((x) => x.station.source === "METAR")?.observations ?? [];
  const out: CloudCoverHour[] = [];
  const end = Date.parse(bundle.forecastUntil);
  const o8 = (v: number | undefined) => (v === undefined ? "?" : `${Math.round(v)}/8`);
  for (let t = Math.ceil((now - PAST_HOURS * HOUR) / HOUR) * HOUR; t <= end; t += HOUR) {
    if (t <= now) {
      let best: WeatherObservation | undefined;
      for (const o of metar) {
        const d = Math.abs(ts(o) - t);
        if (d <= 35 * 60 * 1000 && ts(o) <= now && (!best || d < Math.abs(ts(best) - t))) best = o;
      }
      const c = best && metarCover(best);
      if (!best || !c) continue;
      const layers = best.cloudLayers?.map((l) => `${l.cover} ${Math.round(l.baseM / 10) * 10} m`).join(", ");
      out.push({ t, forecast: false, ...c, label: `METAR ${best.stationId}: ${layers || (c.high === 0 ? "clear sky" : "no cloud below 1500 m")}` });
    } else {
      const p = fc.find((x) => ts(x) === t);
      if (!p || (p.lowCloudCoverOktas === undefined && p.midCloudCoverOktas === undefined && p.highCloudCoverOktas === undefined)) continue;
      out.push({
        t,
        forecast: true,
        low: p.lowCloudCoverOktas,
        mid: p.midCloudCoverOktas,
        high: p.highCloudCoverOktas,
        label: `SMHI: low ${o8(p.lowCloudCoverOktas)} · mid ${o8(p.midCloudCoverOktas)} · high ${o8(p.highCloudCoverOktas)}`,
      });
    }
  }
  return out;
}

/** Solbanan över diagrammets fönster (som tidslinjens: hela timmar, 12 h bakåt), med marginal. */
function sunOver(bundle: WeatherBundle, now: number): ChartData["sun"] {
  const { latitude: lat, longitude: lon } = bundle.location;
  const from = Math.floor(now / HOUR) * HOUR - (PAST_HOURS + 1) * HOUR;
  const to = Math.ceil(Math.max(Date.parse(bundle.forecastUntil), now) / HOUR) * HOUR + 2 * HOUR;
  return { path: sunPath(lat, lon, from, to), events: sunEvents(lat, lon, from, to) };
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
  /** Daggpunkt: METAR vid observationer, ur SMHI:s relativa fuktighet i prognosen */
  dewPoint: Reading<number>;
  wind: Reading<{ deg?: number; variable?: boolean; speed?: number }>;
  /** Byvind. value undefined = METAR utan G-grupp (inga kraftiga byar rapporterade). */
  gust: Reading<number | undefined>;
  visibility: Reading<{ m: number; atLeast?: boolean }>;
  cloud: Reading<{ baseM?: number; layers?: CloudLayer[]; nsc?: boolean; oktas?: number; lowOktas?: number; cavok?: boolean; clear?: boolean }>;
  /** Förenklad molnighet (största kategorin) för vald tid */
  sky: Sky;
  /** Dag (solen över horisonten) vid vald tid och plats */
  day: boolean;
  /** Nederbördsmängd under intervallet from–to. Prognos: trolig mängd (0 = troligen uppehåll)
   *  och möjlig (`possibleMm`, övre delen av SMHI:s spridning). Sannolikhet hålls separat. */
  precipitation: Reading<{ mm: number; from: number; to: number; possibleMm?: number }>;
  precipProbability?: { value: number; origin: Origin };
  phenomena: Reading<Phenomenon[]>;
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
  /** Timsumma för timmen före tidsstämpeln (SMHI:s nederbörd): bakåt i tiden den timme som t
   *  ligger i – samma som stapeln under markören – i stället för närmaste tidsstämpel. */
  hourSum = false,
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
  } else if (hourSum) {
    best = s.observations.find((o) => ts(o) - HOUR < t && t <= ts(o) && get(o) !== undefined);
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
      dewPoint: forecastDewPoint(m.temperature?.value, p, (sp) => dewAdjuster(bundle, now).spread(t, sp)),
      wind: read(m.wind, (v) => ({ deg: v.deg, variable: v.variable, speed: v.speed })),
      gust: read(m.wind, (v) => v.gust),
      visibility: read(m.visibility, (v) => v),
      cloud: read(m.clouds, (v) => v),
      sky: skyOf(m.clouds?.value, m.clouds?.value.cavok ? p?.cloudCoverOktas : undefined),
      day: isDaylight(bundle.location.latitude, bundle.location.longitude, t),
      precipitation: read(pr, (v) => ({ mm: v.mm, possibleMm: v.possibleMm, from: v.from, to: v.to })),
      precipProbability:
        pr?.value.probability !== undefined ? { value: pr.value.probability, origin: originOf(pr.source) } : undefined,
      phenomena: read(m.weather, (v) => v),
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
  const temperature = pickObs(bundle, "temperature", t, mode, (o) => o.temperatureC);

  // Nederbörd: SMHI:s timsumma avser timmen före tidsstämpeln. Vid NU senaste mätningen,
  // bakåt timmen som vald tid ligger i.
  const precip = pickObs(
    bundle,
    "precipitation",
    t,
    mode,
    (o) => (o.precipitationMm === undefined ? undefined : { mm: o.precipitationMm, from: ts(o) - HOUR, to: ts(o) }),
    true,
  );

  return {
    mode,
    time: t,
    temperature,
    dewPoint: obsDewPoint(bundle, t, mode, temperature),
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

// ---------------------------------------------------------------------------
// Daggpunkt
// ---------------------------------------------------------------------------

/**
 * Spridningen temperatur − daggpunkt vid vald tid, bara när båda värdena är tidsmatchade: samma
 * mätning (station och tid) eller samma prognossteg. Daggpunkt från en annan station eller tid ger
 * ingen spridning – då kan ingen dimrisk visas.
 */
export function matchedSpread(snap: Pick<Snapshot, "temperature" | "dewPoint">): number | undefined {
  const t = snap.temperature;
  const d = snap.dewPoint;
  if (!t || !d) return undefined;
  const a = t.origin;
  const b = d.origin;
  if (a.kind !== b.kind || a.timestamp !== b.timestamp || (a.stationId ?? "") !== (b.stationId ?? "")) return undefined;
  return t.value - d.value;
}

/**
 * Observerad daggpunkt. Helst från samma station och tid som temperaturen; annars närmaste
 * METAR. Aldrig över visad temperatur (olika stationer kan annars ge negativ spread).
 */
function obsDewPoint(bundle: WeatherBundle, t: number, mode: Snapshot["mode"], temp: Reading<number>): Reading<number> {
  if (temp) {
    const s = bundle.stations.find((x) => x.station.stationId === temp.origin.stationId);
    const o = s?.observations.find((x) => ts(x) === temp.origin.timestamp && x.dewPointC !== undefined);
    if (o) return { value: Math.min(o.dewPointC!, temp.value), origin: temp.origin };
  }
  const s = bundle.stations.find((x) => x.station.source === "METAR");
  if (!s) return null;
  let best: WeatherObservation | undefined;
  let bestD = Infinity;
  for (const o of s.observations) {
    if (o.dewPointC === undefined) continue;
    if (mode === "now" && ts(o) > t) continue;
    const d = Math.abs(ts(o) - t);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  const maxAge = mode === "now" ? NOW_MAX_AGE.METAR : TOL.METAR;
  if (!best || bestD > maxAge) return null;
  return {
    value: temp ? Math.min(best.dewPointC!, temp.value) : best.dewPointC!,
    origin: {
      kind: "METAR",
      stationId: s.station.stationId,
      stationName: s.station.stationName,
      distanceKm: s.station.distanceKm,
      timestamp: ts(best),
    },
  };
}

/**
 * Prognosens daggpunkt ur SMHI:s fuktighet. Spreaden räknas på SMHI:s egen temperatur och
 * läggs på den visade (observationsjusterade) temperaturen, så att spreaden blir modellens.
 */
function forecastDewPoint(
  shownT: number | undefined,
  p: ForecastPoint | undefined,
  spreadOf: (smhiSpread: number) => number = (v) => Math.max(0, v),
): Reading<number> {
  if (!p || p.temperatureC === undefined || p.relativeHumidity === undefined) return null;
  const spread = spreadOf(p.temperatureC - dewPointFromRh(p.temperatureC, p.relativeHumidity));
  const base = shownT ?? p.temperatureC;
  return {
    value: Math.round((base - spread) * 10) / 10,
    origin: { kind: "SMHI-PROGNOS", timestamp: ts(p), validFrom: p.intervalStart ? Date.parse(p.intervalStart) : undefined },
  };
}

// ---------------------------------------------------------------------------
// Dimma och dis i avläsningen
// ---------------------------------------------------------------------------

/** TAF-gruppen som bara ger något som möjligt: "PROB40" eller "TEMPO". */
export function tafGroupName(g: TafPeriod): string {
  return g.change === "PROB" ? `PROB${g.probability ?? ""}` : "TEMPO";
}

export type Fog = {
  /** METAR-kod, t.ex. FG, FZFG, BCFG eller BR */
  code: string;
  /** I ord, t.ex. "Freezing fog" */
  label: string;
  /** Dimma (tre streck) eller dis (två streck), som i diagrammet */
  severe: boolean;
  /** TAF-gruppen när dimman bara är möjlig, t.ex. "PROB40" */
  group?: string;
};

/** Koder för SMHI:s dimma/dis, som bara har sifferkoder. */
const FOG_CODE: Record<string, string> = {
  Fog: "FG",
  "Freezing fog": "FZFG",
  "Shallow fog": "MIFG",
  "Fog patches": "BCFG",
  Mist: "BR",
  Haze: "HZ",
  Smoke: "FU",
};

/**
 * Dimma/dis vid vald tid, med samma regel som diagrammets dimsymbol: rapporterad eller
 * prognostiserad dimma/dis, dimma i TAF:ens TEMPO/PROB (bara i prognosläget), annars sikt under
 * 1 km, eller under 5 km – men aldrig när det är nederbörden som skymmer sikten. Dimma vid
 * minusgrader är underkyld (FZFG).
 */
export function fogOf(
  s: Pick<Snapshot, "mode" | "phenomena" | "supplements" | "visibility" | "precipitation" | "temperature">,
): Fog | undefined {
  const freezing = (f: Fog): Fog =>
    f.code === "FG" && s.temperature && s.temperature.value < 0 ? { ...f, code: "FZFG", label: "Freezing fog" } : f;
  const of = (p: Phenomenon, group?: string): Fog =>
    freezing({
      code: /^[A-Z]{2,4}$/.test(p.code ?? "") ? p.code! : (FOG_CODE[p.label] ?? (p.kind === "dimma" ? "FG" : "BR")),
      label: p.label,
      severe: p.kind === "dimma",
      group,
    });

  const wx = s.phenomena?.value ?? [];
  const reported = wx.find((p) => p.kind === "dimma") ?? wx.find((p) => p.kind === "dis");
  if (reported) return of(reported);
  if (s.mode === "forecast") {
    for (const g of s.supplements) {
      const f = g.phenomena?.find((p) => p.kind === "dimma");
      if (f) return of(f, tafGroupName(g));
    }
  }
  const vis = s.visibility?.value.m;
  const wet =
    (s.precipitation?.value.mm ?? 0) > 0 || wx.some((p) => PHENOMENON_GROUP[p.kind] === "regn" || PHENOMENON_GROUP[p.kind] === "snö");
  if (vis === undefined || vis >= 5000 || wet) return undefined;
  return vis < 1000 ? freezing({ code: "FG", label: "Fog", severe: true }) : { code: "BR", label: "Mist", severe: false };
}

/** Lägsta sikten i TAF:ens TEMPO/PROB vid vald tid, när den är under huvudvärdet och under 5 km (bara i prognosläget). */
export function tafLowVisibility(
  s: Pick<Snapshot, "mode" | "supplements" | "visibility">,
): { group: string; m: number; atLeast?: boolean } | undefined {
  if (s.mode !== "forecast") return undefined;
  const main = s.visibility?.value.m ?? Infinity;
  const low = s.supplements
    .filter((g) => g.visibilityM !== undefined && g.visibilityM < Math.min(main, 5000))
    .sort((a, b) => a.visibilityM! - b.visibilityM!)[0];
  return low ? { group: tafGroupName(low), m: low.visibilityM!, atLeast: low.visibilityAtLeast } : undefined;
}
