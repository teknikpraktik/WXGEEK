import type { ObservationSource, ParamKey, StationRef } from "../types";

/**
 * Stationsval – medvetet enkel och transparent logik.
 *
 * För varje parameter:
 *   1. Kandidater = stationer (METAR och SMHI) som mäter parametern, ligger inom
 *      parameterns maxavstånd och har rapporterat nyligen.
 *   2. Poäng = avstånd (km) + åldersstraff − källpreferens (km).
 *   3. Lägst poäng vinner. Ingen interpolation mellan stationer.
 */
export type ParamRule = {
  maxKm: number;
  /** Bonus i "km" för en viss källa, t.ex. METAR för sikt och molnbas. */
  prefer?: Partial<Record<ObservationSource, number>>;
  preferReason?: string;
  /** Källor som alls kan leverera parametern */
  sources: ObservationSource[];
};

export const PARAM_RULES: Record<ParamKey, ParamRule> = {
  temperature: { maxKm: 40, sources: ["SMHI", "METAR"] },
  humidity: {
    maxKm: 40,
    sources: ["SMHI", "METAR"],
    prefer: { SMHI: 10 },
    preferReason: "SMHI mäter luftfuktighet direkt (METAR ger bara heltalsgrader)",
  },
  wind: { maxKm: 40, sources: ["SMHI", "METAR"] },
  gust: {
    maxKm: 40,
    sources: ["SMHI", "METAR"],
    prefer: { SMHI: 30 },
    preferReason: "SMHI mäter byvind varje timme – METAR rapporterar bara kraftiga byar",
  },
  // Lufttryck varierar långsamt i rummet – längre avstånd är acceptabelt.
  pressure: { maxKm: 100, sources: ["SMHI", "METAR"] },
  visibility: {
    maxKm: 50,
    sources: ["METAR", "SMHI"],
    prefer: { METAR: 20 },
    preferReason: "Flygplatsobservation (METAR) är standardkälla för sikt",
  },
  cloudBase: {
    maxKm: 50,
    sources: ["METAR", "SMHI"],
    prefer: { METAR: 20 },
    preferReason: "METAR anger alla molnlager, inte bara det lägsta",
  },
  precipitation: { maxKm: 30, sources: ["SMHI"] },
  phenomena: {
    maxKm: 40,
    sources: ["METAR", "SMHI"],
    prefer: { METAR: 15 },
    preferReason: "METAR beskriver väderfenomen mer detaljerat",
  },
};

/** Maximal ålder på senaste observation för att räknas som "aktuell". */
export const MAX_AGE_MS: Record<ObservationSource, number> = {
  METAR: 2 * 60 * 60 * 1000,
  // SMHI publicerar med ~1 h fördröjning
  SMHI: 3 * 60 * 60 * 1000,
};

export type Candidate = StationRef & { latestMs: number };

export function score(c: Candidate, rule: ParamRule, now: number): number {
  const ageH = Math.max(0, (now - c.latestMs) / 3_600_000);
  // Åldersstraff: 10 km per timme utöver den första.
  const agePenalty = Math.max(0, ageH - 1) * 10;
  return c.distanceKm + agePenalty - (rule.prefer?.[c.source] ?? 0);
}

export function rankCandidates(candidates: Candidate[], param: ParamKey, now: number): Candidate[] {
  const rule = PARAM_RULES[param];
  return candidates
    .filter(
      (c) =>
        rule.sources.includes(c.source) &&
        c.distanceKm <= rule.maxKm &&
        now - c.latestMs <= MAX_AGE_MS[c.source],
    )
    .sort((a, b) => score(a, rule, now) - score(b, rule, now));
}

export function selectionReason(param: ParamKey, winner: Candidate | undefined, ranked: Candidate[]): string {
  const rule = PARAM_RULES[param];
  if (!winner) return `Ingen station med aktuell mätning inom ${rule.maxKm} km`;
  const nearest = [...ranked].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (nearest && nearest.stationId !== winner.stationId && rule.prefer?.[winner.source] && rule.preferReason) {
    return rule.preferReason;
  }
  if (nearest && nearest.stationId !== winner.stationId) return "Närmare station saknade aktuell mätning";
  return "Närmaste station med aktuell mätning";
}
