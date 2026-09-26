import type { Pt } from "./timeline";

/** Dimrisk: spridningen temperatur − daggpunkt under så här många grader (°C), i header och diagram. */
export const FOG_SPREAD = 1;
/** Förklaringen som följer dimrisken i header och diagram */
export const FOG_NOTE = "Small temperature–dew point spread indicates possible fog; it is not a fog forecast.";

/** Ett tidsmatchat par: temperatur och daggpunkt vid samma tid (samma mätning eller prognossteg). */
export type MatchedPt = { t: number; temp: number; dew: number };
export type FogPt = { t: number; hi: number; lo: number };

/**
 * Följder av tidsmatchade par ur temperatur- och daggpunktskurvorna (segment som ritas). Ett par
 * kräver en punkt i båda kurvorna vid exakt samma tid. En följd bryts så fort någon av kurvorna har
 * en punkt emellan som den andra saknar, eller ett segment tar slut – luckor överbryggas aldrig.
 */
export function matchedRuns(temp: Pt[][], dew: Pt[][]): MatchedPt[][] {
  const at = new Map<number, { seg: number; i: number; v: number }>();
  temp.forEach((s, seg) => s.forEach((p, i) => at.set(p.t, { seg, i, v: p.v })));
  const runs: MatchedPt[][] = [];
  for (const s of dew) {
    let run: MatchedPt[] = [];
    let prev: { seg: number; i: number; di: number } | undefined;
    s.forEach((p, di) => {
      const m = at.get(p.t);
      const next = m && prev && prev.seg === m.seg && m.i === prev.i + 1 && di === prev.di + 1;
      if (!next && run.length) {
        runs.push(run);
        run = [];
      }
      if (!m) {
        prev = undefined;
        return;
      }
      run.push({ t: p.t, temp: m.v, dew: p.v });
      prev = { seg: m.seg, i: m.i, di };
    });
    if (run.length) runs.push(run);
  }
  return runs;
}

/**
 * Dimrisk: ytan mellan temperatur och daggpunkt där spridningen är under `limit` °C, med exakta
 * gränspunkter där spridningen passerar gränsen. Mellan två par i samma följd är båda kurvorna
 * raka linjer, så spridningen ändras linjärt – inga värden utanför paren hittas på.
 */
export function fogBands(runs: MatchedPt[][], limit = FOG_SPREAD): FogPt[][] {
  const out: FogPt[][] = [];
  const sp = (p: MatchedPt) => p.temp - p.dew;
  const pt = (p: MatchedPt): FogPt => ({ t: p.t, hi: Math.max(p.temp, p.dew), lo: Math.min(p.temp, p.dew) });
  for (const run of runs) {
    let cur: FogPt[] = [];
    const flush = () => {
      if (cur.length > 1) out.push(cur);
      cur = [];
    };
    run.forEach((p, i) => {
      const q = run[i - 1];
      if (q && sp(q) < limit !== sp(p) < limit) {
        // Gränsen passeras mellan q och p: lägg in punkten där spridningen är exakt `limit`.
        const f = (limit - sp(q)) / (sp(p) - sp(q));
        const mid = { t: q.t + (p.t - q.t) * f, temp: q.temp + (p.temp - q.temp) * f, dew: q.dew + (p.dew - q.dew) * f };
        cur.push(pt(mid));
        if (sp(p) >= limit) flush();
      }
      if (sp(p) < limit) cur.push(pt(p));
    });
    flush();
  }
  return out;
}
