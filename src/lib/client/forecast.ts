import type { CloudLayer, ForecastPoint, Phenomenon, Taf, TafElement, TafPeriod, WeatherBundle } from "../types";

// ---------------------------------------------------------------------------
// Prognosens källor: TAF först, SMHI som komplettering och fortsättning.
//
// • TAF (flygplatsens prognos) används för vind, sikt, moln och väder där den
//   anger dem och bara under sin giltighetstid.
// • SMHI (punktprognos för platsens koordinater) används för temperatur och
//   nederbördsmängd, för variabler TAF saknar och efter TAF:s giltighetstid.
// • TEMPO och PROB är kompletterande information – aldrig värden för hela perioden.
// • BECMG ändrar bara de element gruppen anger. Under övergångsintervallet visas
//   tidigare läge med en notering; övergången är inget exakt känt ögonblick.
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
  /** Molnmängd i oktas (SMHI) */
  oktas?: number;
  /** Inga betydande moln (NSC) */
  nsc?: boolean;
  /** CAVOK: inga moln under 1 500 m – säger inget om högre moln */
  cavok?: boolean;
};
export type PrecipValue = { mm: number; from: number; to: number; probability?: number };

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
  /** TEMPO/PROB som gäller vid t (kompletterande information) */
  supplements: TafPeriod[];
  /** Förklaring när TAF och SMHI säger olika saker om nederbörd */
  note?: string;
};

// ---------------------------------------------------------------------------
// TAF: huvudprognos, BECMG och kompletterande grupper
// ---------------------------------------------------------------------------

const isMain = (p: TafPeriod) => p.change === "BASE" || p.change === "FM" || p.change === "BECMG";

/** Läget efter en BECMG: föregående läge med de element gruppen anger ersatta. */
function applyBecmg(prev: TafPeriod, becmg: TafPeriod): TafPeriod {
  const only: TafElement[] | undefined = becmg.changes;
  if (!only) return becmg; // råtexten kunde inte kopplas – använd AWC:s värden som de är
  const next: TafPeriod = { ...prev, change: "BECMG", from: becmg.from, to: becmg.to, becomingBy: becmg.becomingBy, changes: only };
  if (only.includes("wind")) {
    next.windDirectionDeg = becmg.windDirectionDeg;
    next.windVariable = becmg.windVariable;
    next.windSpeedMs = becmg.windSpeedMs;
    next.windGustMs = becmg.windGustMs;
  }
  if (only.includes("visibility")) {
    next.visibilityM = becmg.visibilityM;
    next.visibilityAtLeast = becmg.visibilityAtLeast;
    next.cavok = becmg.cavok;
  }
  if (only.includes("weather")) {
    next.phenomena = becmg.phenomena;
    next.nsw = becmg.nsw;
    if (becmg.cavok) next.cavok = true;
  }
  if (only.includes("clouds")) {
    next.cloudLayers = becmg.cloudLayers;
    next.noSignificantCloud = becmg.noSignificantCloud;
    next.cavok = becmg.cavok;
  }
  return next;
}

/** Effektivt huvudläge för varje huvudgrupp (BASE/FM hela läget, BECMG stegvis). */
export function tafMainStates(taf: Taf): TafPeriod[] {
  const mains = taf.periods.filter(isMain).sort((a, b) => ms(a.from) - ms(b.from));
  const out: TafPeriod[] = [];
  mains.forEach((p, i) => {
    out.push(p.change === "BECMG" && i > 0 ? applyBecmg(out[i - 1], p) : p);
  });
  return out;
}

export type TafMain = { state: TafPeriod; transition?: TafTransition; periodFrom: number; periodTo: number };

/** Huvudprognosens läge vid t, eller null utanför TAF:s giltighetstid. */
export function tafMainAt(taf: Taf, t: number): TafMain | null {
  if (t < ms(taf.validFrom) || t >= ms(taf.validTo)) return null;
  const mains = taf.periods.filter(isMain).sort((a, b) => ms(a.from) - ms(b.from));
  const states = tafMainStates(taf);
  let i = -1;
  for (let k = 0; k < mains.length; k++) if (ms(mains[k].from) <= t) i = k;
  if (i < 0) return null;
  const cur = mains[i];
  // Under BECMG-övergången gäller tidigare läge – övergången kan ske när som helst i intervallet.
  if (cur.change === "BECMG" && cur.becomingBy && t < ms(cur.becomingBy) && i > 0) {
    return {
      state: states[i - 1],
      transition: { from: ms(cur.from), until: ms(cur.becomingBy), to: states[i] },
      periodFrom: ms(mains[i - 1].from),
      periodTo: ms(cur.becomingBy),
    };
  }
  const start = cur.change === "BECMG" && cur.becomingBy ? ms(cur.becomingBy) : ms(cur.from);
  const next = mains[i + 1];
  return { state: states[i], periodFrom: start, periodTo: next ? ms(next.from) : ms(taf.validTo) };
}

/** TEMPO- och PROB-grupper som gäller vid t. */
export function tafSupplementsAt(taf: Taf | null, t: number): TafPeriod[] {
  if (!taf || t < ms(taf.validFrom) || t >= ms(taf.validTo)) return [];
  return taf.periods.filter((p) => (p.change === "TEMPO" || p.change === "PROB") && ms(p.from) <= t && t < ms(p.to));
}

// ---------------------------------------------------------------------------
// SMHI
// ---------------------------------------------------------------------------

/** Närmaste timvisa prognospunkt inom 40 min. */
export function smhiPointAt(bundle: WeatherBundle, t: number): ForecastPoint | undefined {
  let best: ForecastPoint | undefined;
  let bestD = Infinity;
  for (const p of bundle.forecast?.points ?? []) {
    const pt = ms(p.timestamp);
    const hourly = !p.intervalStart || pt - ms(p.intervalStart) <= HOUR;
    const d = Math.abs(pt - t);
    if (hourly && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return bestD <= 40 * 60 * 1000 ? best : undefined;
}

const PRECIP_KINDS = new Set(["regn", "duggregn", "skurar", "underkylt", "snö", "snöblandat", "hagel", "åska"]);
const hasPrecip = (ph: Phenomenon[]) => ph.some((p) => PRECIP_KINDS.has(p.kind));

// ---------------------------------------------------------------------------
// Sammanslagning
// ---------------------------------------------------------------------------

/**
 * Prognos vid tidpunkt t med källa per variabel.
 * `adjustTemp` justerar SMHI:s temperatur mot senaste observation (se timeline.ts).
 */
export function mergedForecastAt(
  bundle: WeatherBundle,
  t: number,
  adjustTemp: (t: number, v: number) => number = (_t, v) => v,
): MergedForecast {
  const p = smhiPointAt(bundle, t);
  const f = bundle.forecast;
  const smhi: SmhiSource | undefined =
    p && f
      ? {
          kind: "SMHI-PROGNOS",
          latitude: f.latitude,
          longitude: f.longitude,
          time: ms(p.timestamp),
          intervalFrom: p.intervalStart ? ms(p.intervalStart) : undefined,
        }
      : undefined;
  const taf = bundle.taf;
  const main = taf ? tafMainAt(taf, t) : null;
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

  const out: MergedForecast = { t, supplements: tafSupplementsAt(taf, t), transition: main?.transition };

  // Temperatur: bara SMHI (TAF:s TX/TN används inte).
  if (p?.temperatureC !== undefined && smhi) {
    out.temperature = { value: Math.round(adjustTemp(ms(p.timestamp), p.temperatureC) * 10) / 10, source: smhi };
  }

  // Vind
  if (s && tafSrc && s.windSpeedMs !== undefined) {
    out.wind = {
      value: { deg: s.windDirectionDeg, variable: s.windVariable, speed: s.windSpeedMs, gust: s.windGustMs },
      source: tafSrc,
    };
  } else if (p?.windSpeedMs !== undefined && smhi) {
    out.wind = { value: { deg: p.windDirectionDeg, speed: p.windSpeedMs, gust: p.windGustMs }, source: smhi };
  }

  // Sikt
  if (s && tafSrc && (s.cavok || s.visibilityM !== undefined)) {
    out.visibility = {
      value: s.cavok ? { m: 10000, atLeast: true } : { m: s.visibilityM!, atLeast: s.visibilityAtLeast },
      source: tafSrc,
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
      source: tafSrc,
    };
  } else if (p && smhi && (p.cloudBaseM !== undefined || p.cloudCoverOktas !== undefined)) {
    out.clouds = { value: { baseM: p.cloudBaseM, oktas: p.cloudCoverOktas }, source: smhi };
  }

  // Väder – TAF:s huvudprognos anger alltid väder (inget angivet = inget av betydelse).
  if (s && tafSrc) {
    out.weather = { value: s.nsw || s.cavok ? [] : (s.phenomena ?? []), source: tafSrc };
  } else if (p && smhi) {
    out.weather = { value: p.phenomenon ? [p.phenomenon] : [], source: smhi };
  }

  // Nederbörd: mängd bara från SMHI, med prognosens faktiska intervall.
  if (p && smhi && p.precipitationMm !== undefined) {
    const to = ms(p.timestamp);
    out.precipitation = {
      value: {
        mm: p.precipitationMm,
        from: p.intervalStart ? ms(p.intervalStart) : to - HOUR,
        to,
        probability: p.precipitationProbability,
      },
      source: smhi,
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
