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
  wind: { maxKm: 40, sources: ["SMHI", "METAR"] },
  gust: {
    maxKm: 40,
    sources: ["SMHI", "METAR"],
    prefer: { SMHI: 30 },
    preferReason: "SMHI measures gusts hourly – METAR only reports strong gusts",
  },
  visibility: {
    maxKm: 50,
    sources: ["METAR", "SMHI"],
    prefer: { METAR: 20 },
    preferReason: "Airport observation (METAR) is the standard source for visibility",
  },
  cloudBase: {
    maxKm: 50,
    sources: ["METAR", "SMHI"],
    prefer: { METAR: 20 },
    preferReason: "METAR reports all cloud layers, not just the lowest",
  },
  precipitation: { maxKm: 30, sources: ["SMHI"] },
  phenomena: {
    maxKm: 40,
    sources: ["METAR", "SMHI"],
    prefer: { METAR: 15 },
    preferReason: "METAR describes weather phenomena in more detail",
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
  if (!winner) return `No station with a current observation within ${rule.maxKm} km`;
  const nearest = [...ranked].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (nearest && nearest.stationId !== winner.stationId && rule.prefer?.[winner.source] && rule.preferReason) {
    return rule.preferReason;
  }
  if (nearest && nearest.stationId !== winner.stationId) return "Closer station had no current observation";
  return "Nearest station with a current observation";
}
