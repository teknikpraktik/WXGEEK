import type {
  CloudLayer,
  ForecastPoint,
  Phenomenon,
  Taf,
  TafElement,
  TafPeriod,
  WeatherBundle,
  WeatherObservation,
} from "../types";
import { fmtTime } from "../format";

// ---------------------------------------------------------------------------
// Prognosens källor: TAF först, SMHI som komplettering och fortsättning.
//
// • TAF (flygplatsens prognos) används för vind, sikt, moln och väder där den
//   anger dem och bara under sin giltighetstid.
// • SMHI (punktprognos för platsens koordinater) används för temperatur och
//   nederbördsmängd, för variabler TAF saknar och efter TAF:s giltighetstid.
// • FM gäller från sin exakta tid. BECMG ändrar bara de element gruppen anger och
//   räknas mitt i sitt intervall – före mitten gäller tidigare läge.
// • PROB30/PROB40 (även PROB TEMPO) tillämpas inte, utom när gruppen börjar inom 3 h från
//   senaste METAR (eller redan pågår) och den METAR:en stöder den – då gäller gruppen hela
//   sin period. Övriga PROB-grupper ändrar inte prognosen (de syns i avläsningens sikt).
// • TEMPO är kompletterande information – aldrig värden för perioden.
// • Källa och giltighet bevaras per variabel och tidpunkt.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const ms = (s: string) => Date.parse(s);

export type TafSource = {
  kind: "TAF";
  stationId: string;
  stationName?: string;
  distanceKm: number;
  /** Den del av TAF som gäller: huvudprognosens period */
  validFrom: number;
  validTo: number;
  /** Värdet kommer från en tillämpad PROB-grupp, t.ex. "PROB40" */
  group?: string;
};
export type SmhiSource = {
  kind: "SMHI-PROGNOS";
  latitude: number;
  longitude: number;
  /** Prognosens tidssteg */
  time: number;
  /** Intervall för nederbörd (föregående timme) */
  intervalFrom?: number;
};
export type FcSource = TafSource | SmhiSource;
export type Sourced<T> = { value: T; source: FcSource };

export type WindValue = { deg?: number; variable?: boolean; speed: number; gust?: number };
export type VisValue = { m: number; atLeast?: boolean };
export type CloudValue = {
  layers?: CloudLayer[];
  /** Lägsta molnbas (SMHI) */
  baseM?: number;
  /** Total molnmängd i oktas, alla höjder (SMHI) */
  oktas?: number;
  /** Mängd låga moln i oktas (SMHI) – hör ihop med en låg molnbas, inte totalen */
  lowOktas?: number;
  /** Mängd medelhöga moln i oktas (SMHI) – för en molnbas över ~2 000 m */
  midOktas?: number;
  /** Inga betydande moln (NSC) */
  nsc?: boolean;
  /** CAVOK: inga moln under 1 500 m – säger inget om högre moln */
  cavok?: boolean;
};
export type PrecipValue = {
  /** Trolig mängd (mm) enligt `precipRange` – 0 = troligen uppehåll */
  mm: number;
  /** Möjlig mängd (mm): övre delen av SMHI:s spridning, minst `mm` */
  possibleMm: number;
  from: number;
  to: number;
  probability?: number;
};

export type TafTransition = { from: number; until: number; to: TafPeriod };

export type MergedForecast = {
  t: number;
  temperature?: Sourced<number>;
  wind?: Sourced<WindValue>;
  visibility?: Sourced<VisValue>;
  clouds?: Sourced<CloudValue>;
  /** Tom lista = inget väder av betydelse enligt källan */
  weather?: Sourced<Phenomenon[]>;
  precipitation?: Sourced<PrecipValue>;
  /** Pågående BECMG-övergång i TAF */
  transition?: TafTransition;
  /** TEMPO och PROB som inte tillämpas, vid t (kompletterande information) */
  supplements: TafPeriod[];
  /** Tillämpad PROB-grupp vid t – dess element ingår i värdena ovan */
  prob?: TafPeriod;
  /** Förklaring när TAF och SMHI säger olika saker om nederbörd */
  note?: string;
};

// ---------------------------------------------------------------------------
// TAF: huvudprognos, BECMG och kompletterande grupper
// ---------------------------------------------------------------------------

const isMain = (p: TafPeriod) => p.change === "BASE" || p.change === "FM" || p.change === "BECMG";

/** Dimma och dis som sikten tillåter: FG under 1 km (MIFG/BCFG/PRFG även över), BR/HZ/FU högst 5 km. */
function obscurationFits(p: Phenomenon, visM: number): boolean {
  if (p.kind === "dimma") return visM < 1000 || /^(MI|BC|PR)FG$/.test(p.code ?? "");
  if (p.kind === "dis") return visM <= 5000;
  return true;
}

/**
 * Läget med en grupps element: föregående läge där de element gruppen anger (BECMG, eller en
 * tillämpad PROB-grupp) ersätts. Övriga element står kvar.
 */
function applyGroup(prev: TafPeriod, g: TafPeriod): TafPeriod {
  const only: TafElement[] | undefined = g.changes;
  if (!only) return g; // råtexten kunde inte kopplas – använd AWC:s värden som de är
  const next: TafPeriod = { ...prev, change: g.change, from: g.from, to: g.to, becomingBy: g.becomingBy, changes: only };
  if (only.includes("wind")) {
    next.windDirectionDeg = g.windDirectionDeg;
    next.windVariable = g.windVariable;
    next.windSpeedMs = g.windSpeedMs;
    next.windGustMs = g.windGustMs;
  }
  if (only.includes("visibility")) {
    next.visibilityM = g.visibilityM;
    next.visibilityAtLeast = g.visibilityAtLeast;
    next.cavok = g.cavok;
    // Utan eget väder står föregående väder kvar – men inte dimma eller dis som den nya sikten
    // utesluter: "0200 FG" följt av "BECMG 9999" betyder att dimman lättar, även utan NSW.
    const vis = g.visibilityM;
    if (!only.includes("weather") && vis !== undefined) next.phenomena = prev.phenomena?.filter((p) => obscurationFits(p, vis));
  }
  if (only.includes("weather")) {
    // CAVOK betyder också inget väder
    next.phenomena = g.cavok ? [] : g.phenomena;
    next.nsw = g.nsw;
    if (g.cavok) next.cavok = true;
  }
  if (only.includes("clouds")) {
    next.cloudLayers = g.cloudLayers;
    next.noSignificantCloud = g.noSignificantCloud;
    next.cavok = g.cavok;
  }
  return next;
}

/** Effektivt huvudläge för varje huvudgrupp (BASE/FM hela läget, BECMG stegvis). */
export function tafMainStates(taf: Taf): TafPeriod[] {
  const mains = taf.periods.filter(isMain).sort((a, b) => ms(a.from) - ms(b.from));
  const out: TafPeriod[] = [];
  mains.forEach((p, i) => {
    out.push(p.change === "BECMG" && i > 0 ? applyGroup(out[i - 1], p) : p);
  });
  return out;
}

/**
 * När en BECMG-grupp räknas som genomförd: mitt i övergångsintervallet ("BECMG 2708/2710" → 09Z).
 * Utan intervallets slut (varken AWC:s timeBec eller råtexten) från intervallets början.
 */
export function becmgAt(p: TafPeriod): number {
  return p.becomingBy ? (ms(p.from) + ms(p.becomingBy)) / 2 : ms(p.from);
}
/** När en huvudgrupp börjar gälla: FM och huvudprognosen från sin tid, BECMG i intervallets mitt. */
const effectiveFrom = (p: TafPeriod) => (p.change === "BECMG" ? becmgAt(p) : ms(p.from));

export type TafMain = {
  state: TafPeriod;
  transition?: TafTransition;
  periodFrom: number;
  periodTo: number;
  /** Tillämpad PROB-grupp vars element ingår i läget */
  prob?: TafPeriod;
};

/** Huvudprognosens läge vid t, eller null utanför TAF:s giltighetstid. */
export function tafMainAt(taf: Taf, t: number): TafMain | null {
  if (t < ms(taf.validFrom) || t >= ms(taf.validTo)) return null;
  const mains = taf.periods.filter(isMain).sort((a, b) => ms(a.from) - ms(b.from));
  const states = tafMainStates(taf);
  let i = -1;
  for (let k = 0; k < mains.length; k++) if (ms(mains[k].from) <= t) i = k;
  if (i < 0) return null;
  const cur = mains[i];
  // Första halvan av ett BECMG-intervall: tidigare läge, med övergången redovisad.
  if (cur.change === "BECMG" && t < becmgAt(cur) && i > 0) {
    return {
      state: states[i - 1],
      transition: { from: ms(cur.from), until: becmgAt(cur), to: states[i] },
      periodFrom: effectiveFrom(mains[i - 1]),
      periodTo: becmgAt(cur),
    };
  }
  const next = mains[i + 1];
  return { state: states[i], periodFrom: effectiveFrom(cur), periodTo: next ? effectiveFrom(next) : ms(taf.validTo) };
}

/**
 * TAF-läget vid t: huvudprognosen med tillämpade PROB-grupper ovanpå – en tillämpad grupp gäller
 * hela sin period och ersätter bara de element den anger.
 */
export function tafStateAt(taf: Taf, t: number, applied: TafPeriod[] = []): TafMain | null {
  const main = tafMainAt(taf, t);
  if (!main) return null;
  const probs = applied.filter((p) => ms(p.from) <= t && t < ms(p.to)).sort((a, b) => ms(a.from) - ms(b.from));
  if (!probs.length) return main;
  const prob = probs[probs.length - 1];
  return {
    ...main,
    state: probs.reduce(applyGroup, main.state),
    prob,
    periodFrom: Math.max(main.periodFrom, ms(prob.from)),
    periodTo: Math.min(main.periodTo, ms(prob.to)),
  };
}

/** TEMPO- och PROB-grupper som gäller vid t – utom de tillämpade, som ingår i läget. */
export function tafSupplementsAt(taf: Taf | null, t: number, applied: TafPeriod[] = []): TafPeriod[] {
  if (!taf || t < ms(taf.validFrom) || t >= ms(taf.validTo)) return [];
  return taf.periods.filter(
    (p) => (p.change === "TEMPO" || p.change === "PROB") && ms(p.from) <= t && t < ms(p.to) && !applied.includes(p),
  );
}

/** "PROB40" eller "TEMPO" */
export const tafGroupName = (g: TafPeriod): string => (g.change === "PROB" ? `PROB${g.probability ?? ""}` : g.change);

// ---------------------------------------------------------------------------
// PROB-grupper: tillämpas bara när senaste METAR stöder dem
// ---------------------------------------------------------------------------

/** En PROB-grupp kan tillämpas om den börjar högst så här långt efter senaste METAR (eller pågår). */
export const PROB_LEAD_MS = 3 * HOUR;
/** Äldre METAR än så här stöder ingen PROB-grupp. */
const PROB_METAR_MAX_AGE = 2 * HOUR;

export type ProbDecision = {
  period: TafPeriod;
  applied: boolean;
  /** Varför, på engelska – för verktygstips */
  reason: string;
};

/** Senaste METAR från TAF:ens flygplats vid now, högst 2 h gammal. */
export function tafMetar(bundle: WeatherBundle, now: number): WeatherObservation | undefined {
  const taf = bundle.taf;
  if (!taf) return undefined;
  const series = bundle.stations.find((s) => s.station.source === "METAR" && s.station.stationId === taf.stationId);
  let last: WeatherObservation | undefined;
  for (const o of [...(series?.observations ?? []), ...(taf.metar ? [taf.metar] : [])]) {
    if (ms(o.timestamp) <= now && (!last || ms(o.timestamp) > ms(last.timestamp))) last = o;
  }
  return last && now - ms(last.timestamp) <= PROB_METAR_MAX_AGE ? last : undefined;
}

const WX_TOKEN = /^(?:[-+]|VC)?(?:MI|BC|PR|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|PL|GR|GS|UP|IC|FG|BR|HZ|FU|SA|DU|SQ|FC|PO|SS|DS|VA)*$/;
/** Väderkoderna i en rå METAR eller TAF-grupp, t.ex. ["-SHRA", "VCTS", "BR"]. Aldrig RE (tidigare väder). */
export const wxCodes = (text: string): string[] => text.split(/\s+/).filter((tok) => WX_TOKEN.test(tok) && /[A-Z]{2}/.test(tok));

/** Väderkoder i en METAR, också i närheten (VC). */
export function metarWeatherCodes(o: WeatherObservation): string[] {
  if (!o.raw) return (o.weatherPhenomena ?? []).flatMap((p) => (p.code ? [p.code] : []));
  return wxCodes(o.raw.split(/\s(?:RMK|TEMPO|BECMG|NOSIG)\b/)[0]);
}
const PRECIP_TYPES = new Set(["DZ", "RA", "SN", "SG", "PL", "GR", "GS", "UP", "IC"]);

/** "-SHRA" → { vc: false, desc: "SH", types: ["RA"] }, "VCTS" → { vc: true, desc: "TS", types: [] } */
function wxParts(code: string): { vc: boolean; desc?: string; types: string[] } {
  let t = code.replace(/^[-+]/, "");
  const vc = t.startsWith("VC");
  if (vc) t = t.slice(2);
  const desc = t.match(/^(MI|BC|PR|DR|BL|SH|TS|FZ)/)?.[1];
  if (desc) t = t.slice(2);
  return { vc, desc, types: t.match(/[A-Z]{2}/g) ?? [] };
}

/**
 * Stöder METAR:en nederbörden eller åskan i gruppen? Samma fenomen (samma nederbördsslag, oavsett
 * intensitet – "-RA" stöder "SHRA"; åska kräver åska) eller dess föregångare: VCSH för skurar,
 * VCTS för åska.
 */
function precipSupported(groupCode: string, metarCodes: string[]): boolean {
  const g = wxParts(groupCode);
  return metarCodes.some((code) => {
    const m = wxParts(code);
    if (m.vc) return (m.desc === "SH" && g.desc === "SH") || (m.desc === "TS" && g.desc === "TS");
    if (g.desc === "TS") return m.desc === "TS";
    return m.types.some((x) => PRECIP_TYPES.has(x) && g.types.includes(x));
  });
}

/** Lägsta BKN/OVC/VV (ceiling) i lagren. */
const ceilingOf = (ls: CloudLayer[] | undefined) =>
  ls?.filter((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV").reduce<number | undefined>(
    (lo, l) => (lo === undefined || l.baseM < lo ? l.baseM : lo),
    undefined,
  );

/**
 * Stöder METAR:en PROB-gruppen? Gruppens väder avgör när den har väder – dimma/dis: METAR med FG
 * eller BR, sikt högst 1 000 m eller VV; nederbörd och åska: samma fenomen eller föregångare.
 * Utan väder avgör sikten (METAR högst 2 × gruppens, när gruppens är under 5 km) eller molnen
 * (METAR med BKN/OVC/VV på högst 2 × gruppens höjd).
 */
export function probSupported(p: TafPeriod, metar: WeatherObservation): boolean {
  const has = (e: TafElement) => !p.changes || p.changes.includes(e);
  const wx = has("weather") ? (p.phenomena ?? []) : [];
  const obscured = wx.filter((x) => x.kind === "dimma" || x.kind === "dis");
  const precip = wx.filter((x) => x.kind !== "dimma" && x.kind !== "dis");
  const codes = metarWeatherCodes(metar);
  if (wx.length) {
    const fog =
      obscured.length > 0 &&
      (codes.some((c) => {
        const m = wxParts(c);
        return !m.vc && (m.types.includes("FG") || m.types.includes("BR"));
      }) ||
        (metar.visibilityM !== undefined && metar.visibilityM <= 1000) ||
        !!metar.cloudLayers?.some((l) => l.cover === "VV"));
    return fog || precip.some((x) => !!x.code && precipSupported(x.code, codes));
  }
  const vis =
    has("visibility") &&
    p.visibilityM !== undefined &&
    !p.visibilityAtLeast &&
    p.visibilityM < 5000 &&
    metar.visibilityM !== undefined &&
    metar.visibilityM <= 2 * p.visibilityM;
  const groupH = has("clouds") ? (ceilingOf(p.cloudLayers) ?? p.cloudLayers?.[0]?.baseM) : undefined;
  const metarCeiling = ceilingOf(metar.cloudLayers);
  const clouds = groupH !== undefined && metarCeiling !== undefined && metarCeiling <= 2 * groupH;
  return vis || clouds;
}

/**
 * Beslut för varje PROB-grupp som inte redan är slut: tillämpas när den börjar inom 3 h från senaste
 * METAR (eller redan pågår) och den METAR:en stöder den. Upphör med perioden, eller när en ny METAR
 * inte längre stöder gruppen – beslutet görs om med senaste METAR varje gång.
 */
export function probDecisions(bundle: WeatherBundle, now: number): ProbDecision[] {
  const taf = bundle.taf;
  if (!taf) return [];
  const metar = tafMetar(bundle, now);
  return taf.periods
    .filter((p) => p.change === "PROB" && ms(p.to) > now)
    .map((period) => {
      if (!metar) return { period, applied: false, reason: `No recent METAR from ${taf.stationId}` };
      const mt = ms(metar.timestamp);
      if (ms(period.from) > Math.max(now, mt + PROB_LEAD_MS))
        return { period, applied: false, reason: `Starts more than 3 h after the latest METAR (${fmtTime(mt)})` };
      return probSupported(period, metar)
        ? { period, applied: true, reason: `Supported by the latest METAR (${fmtTime(mt)})` }
        : { period, applied: false, reason: `Not supported by the latest METAR (${fmtTime(mt)})` };
    });
}

/** De tillämpade PROB-grupperna. */
export const appliedProbs = (decisions: ProbDecision[]) => decisions.filter((d) => d.applied).map((d) => d.period);

// ---------------------------------------------------------------------------
// SMHI
// ---------------------------------------------------------------------------

/**
 * Närmaste prognospunkt inom 40 min. Där prognosen är glesare än timvis (3 h, 6 h) finns alltså
 * bara värden vid dess egna tidssteg – ingen interpolering.
 */
export function smhiPointAt(bundle: WeatherBundle, t: number): ForecastPoint | undefined {
  let best: ForecastPoint | undefined;
  let bestD = Infinity;
  for (const p of bundle.forecast?.points ?? []) {
    const d = Math.abs(ms(p.timestamp) - t);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return bestD <= 40 * 60 * 1000 ? best : undefined;
}

/** Den timvisa prognospunkt vars timme innehåller t (t0 < t ≤ t1) – för nederbörd, som är en
 *  mängd per timme: samma timme som stapeln under markören. */
export function smhiHourAt(bundle: WeatherBundle, t: number): ForecastPoint | undefined {
  return bundle.forecast?.points.find((p) => {
    const t1 = ms(p.timestamp);
    const t0 = p.intervalStart ? ms(p.intervalStart) : t1 - HOUR;
    return t1 - t0 <= HOUR && t0 < t && t <= t1;
  });
}

/**
 * Nederbörd för ett timsteg i SMHI:s prognos (mm), samma regel för timstaplarna och avläsningen:
 * trolig = ensemblens median (annars medel), under 0,1 mm räknas som uppehåll; möjlig = övre
 * delen av spridningen (största av trolig, medel och max). SMHI:s min används inte – den kan
 * vara 0,1 mm även när sannolikheten är några procent.
 */
export function precipRange(p: ForecastPoint): { likely: number; possible: number } | undefined {
  const raw = p.precipitationMedianMm ?? p.precipitationMm;
  if (raw === undefined) return undefined;
  const likely = raw >= 0.1 ? raw : 0;
  const possible = Math.max(likely, p.precipitationMm ?? 0, p.precipitationMaxMm ?? 0);
  return { likely, possible: possible >= 0.1 ? possible : 0 };
}

const smhiSource = (f: NonNullable<WeatherBundle["forecast"]>, p: ForecastPoint): SmhiSource => ({
  kind: "SMHI-PROGNOS",
  latitude: f.latitude,
  longitude: f.longitude,
  time: ms(p.timestamp),
  intervalFrom: p.intervalStart ? ms(p.intervalStart) : undefined,
});

const PRECIP_KINDS = new Set(["regn", "duggregn", "skurar", "underkylt", "snö", "snöblandat", "hagel", "åska"]);
const hasPrecip = (ph: Phenomenon[]) => ph.some((p) => PRECIP_KINDS.has(p.kind));

// ---------------------------------------------------------------------------
// Sammanslagning
// ---------------------------------------------------------------------------

/**
 * Prognos vid tidpunkt t med källa per variabel.
 * `adjustTemp` justerar SMHI:s temperatur mot senaste observation (se timeline.ts).
 * `applied` = de PROB-grupper som tillämpas (`probDecisions`); utan dem visas grundprognosen.
 */
export function mergedForecastAt(
  bundle: WeatherBundle,
  t: number,
  adjustTemp: (t: number, v: number) => number = (_t, v) => v,
  applied: TafPeriod[] = [],
): MergedForecast {
  const p = smhiPointAt(bundle, t);
  const f = bundle.forecast;
  const smhi = p && f ? smhiSource(f, p) : undefined;
  const taf = bundle.taf;
  const main = taf ? tafStateAt(taf, t, applied) : null;
  const tafSrc: TafSource | undefined =
    taf && main
      ? {
          kind: "TAF",
          stationId: taf.stationId,
          stationName: taf.stationName,
          distanceKm: taf.distanceKm,
          validFrom: main.periodFrom,
          validTo: main.periodTo,
        }
      : undefined;
  const s = main?.state;
  // Element som kommer från en tillämpad PROB-grupp får gruppens namn i källan.
  const src = (e: TafElement): TafSource =>
    main?.prob && (!main.prob.changes || main.prob.changes.includes(e)) ? { ...tafSrc!, group: tafGroupName(main.prob) } : tafSrc!;

  const out: MergedForecast = { t, supplements: tafSupplementsAt(taf, t, applied), transition: main?.transition, prob: main?.prob };

  // Temperatur: bara SMHI (TAF:s TX/TN används inte).
  if (p?.temperatureC !== undefined && smhi) {
    out.temperature = { value: Math.round(adjustTemp(ms(p.timestamp), p.temperatureC) * 10) / 10, source: smhi };
  }

  // Vind
  if (s && tafSrc && s.windSpeedMs !== undefined) {
    out.wind = {
      value: { deg: s.windDirectionDeg, variable: s.windVariable, speed: s.windSpeedMs, gust: s.windGustMs },
      source: src("wind"),
    };
  } else if (p?.windSpeedMs !== undefined && smhi) {
    out.wind = { value: { deg: p.windDirectionDeg, speed: p.windSpeedMs, gust: p.windGustMs }, source: smhi };
  }

  // Sikt
  if (s && tafSrc && (s.cavok || s.visibilityM !== undefined)) {
    out.visibility = {
      value: s.cavok ? { m: 10000, atLeast: true } : { m: s.visibilityM!, atLeast: s.visibilityAtLeast },
      source: src("visibility"),
    };
  } else if (p?.visibilityM !== undefined && smhi) {
    out.visibility = { value: { m: p.visibilityM, atLeast: p.visibilityM >= 10000 }, source: smhi };
  }

  // Moln – TAF:s lager där de anges; CAVOK/NSC utan påhittad molnbas.
  if (s && tafSrc && (s.cavok || s.noSignificantCloud || s.cloudLayers?.length)) {
    out.clouds = {
      value: s.cavok
        ? { cavok: true }
        : s.cloudLayers?.length
          ? { layers: s.cloudLayers }
          : { nsc: true },
      source: src("clouds"),
    };
  } else if (p && smhi && (p.cloudBaseM !== undefined || p.cloudCoverOktas !== undefined)) {
    out.clouds = {
      value: { baseM: p.cloudBaseM, oktas: p.cloudCoverOktas, lowOktas: p.lowCloudCoverOktas, midOktas: p.midCloudCoverOktas },
      source: smhi,
    };
  }

  // Väder – TAF:s huvudprognos anger alltid väder (inget angivet = inget av betydelse). CAVOK har
  // inget väder; en senare grupp med väder (t.ex. en tillämpad PROB SHRA) gäller ändå.
  if (s && tafSrc) {
    out.weather = { value: s.nsw ? [] : (s.phenomena ?? []), source: src("weather") };
  } else if (p && smhi) {
    out.weather = { value: p.phenomenon ? [p.phenomenon] : [], source: smhi };
  }

  // Nederbörd: mängd bara från SMHI, för timmen som t ligger i (samma som stapeln under
  // markören), med trolig och möjlig mängd som timstaplarna.
  const ph = smhiHourAt(bundle, t);
  const range = ph && precipRange(ph);
  if (ph && f && range) {
    const to = ms(ph.timestamp);
    out.precipitation = {
      value: {
        mm: range.likely,
        possibleMm: range.possible,
        from: ph.intervalStart ? ms(ph.intervalStart) : to - HOUR,
        to,
        probability: ph.precipitationProbability,
      },
      source: smhiSource(f, ph),
    };
  }

  // Motsägelser mellan källorna förklaras i stället för att döljas.
  if (out.weather?.source.kind === "TAF" && out.precipitation) {
    const tafRain = hasPrecip(out.weather.value);
    const smhiRain = out.precipitation.value.mm >= 0.1;
    if (!tafRain && smhiRain)
      out.note = `TAF gives no precipitation at ${taf!.stationId}; SMHI's model gives precipitation for the location.`;
    else if (tafRain && !smhiRain)
      out.note = `TAF gives precipitation at ${taf!.stationId}; SMHI's model gives no amount for the location.`;
  }
  return out;
}

/** Var i fönstret TAF slutar (om den gör det), för markering i tidslinjen. */
export function tafEndWithin(bundle: WeatherBundle, from: number, to: number): number | undefined {
  const end = bundle.taf ? ms(bundle.taf.validTo) : undefined;
  return end !== undefined && end > from && end < to ? end : undefined;
}
