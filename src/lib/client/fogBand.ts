import type { Pt } from "./timeline";

/** Punkt i ett dimriskband: temperatur (övre kant) och daggpunkt (undre kant) vid tiden t. */
export type FogPt = { t: number; hi: number; lo: number };

/** Linjärt mellan punkterna i den del som täcker t – utanför alla delar (luckor) finns inget värde. */
function valueAt(segs: Pt[][], t: number): number | undefined {
  for (const s of segs) {
    if (!s.length || t < s[0].t || t > s[s.length - 1].t) continue;
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i].t) {
        const a = s[i - 1];
        const b = s[i];
        return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
      }
    }
    return s[0].v;
  }
  return undefined;
}

/**
 * Ytorna mellan temperatur och daggpunkt där spridningen är högst `limit` °C (dimrisk): ett rutnät
 * var 10:e minut, med exakta gränser där spridningen passerar gränsen. Bara där båda kurvorna har
 * värden – aldrig över luckor i data.
 */
export function fogBands(temp: Pt[][], dew: Pt[][], limit = 2, step = 10 * 60_000): FogPt[][] {
  const all = [...temp, ...dew].flat();
  if (!all.length) return [];
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const at = (t: number): FogPt | undefined => {
    const hi = valueAt(temp, t);
    const lo = valueAt(dew, t);
    return hi === undefined || lo === undefined ? undefined : { t, hi, lo };
  };
  const out: FogPt[][] = [];
  let cur: FogPt[] = [];
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  let prev: FogPt | undefined;
  for (let t = t0; t <= t1; t += step) {
    const p = at(t);
    if (!p) {
      flush();
      prev = undefined;
      continue;
    }
    const inside = p.hi - p.lo <= limit;
    if (prev && inside !== prev.hi - prev.lo <= limit) {
      // Gränsen passeras mellan rutorna: lägg in den exakta punkten.
      const sa = prev.hi - prev.lo;
      const sb = p.hi - p.lo;
      const edge = at(prev.t + ((limit - sa) / (sb - sa)) * (t - prev.t));
      if (edge) {
        if (inside) cur = [edge];
        else {
          cur.push(edge);
          flush();
        }
      }
    }
    if (inside) cur.push(p);
    prev = p;
  }
  flush();
  return out;
}
