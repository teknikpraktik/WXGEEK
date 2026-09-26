import { fmtTime } from "../format";
import type { SunEvent } from "../sun";

/**
 * Solbandets fasta skala året runt (grader) – ingen autoskalning, säsongsskillnaden är poängen.
 * Tvådelad: 0°…60° tar 65 % av höjden, −18°…0° (skymningen) 35 %, så att de tre
 * skymningszonerna blir tydliga. Värden utanför klipps mot bandets kanter.
 */
export const SUN_MIN = -18;
export const SUN_MAX = 60;
export const SUN_SPLIT = 0.65;

/** y (px) för solhöjden i ett band med överkant `top` och höjd `h`. */
export function sunY(alt: number, top: number, h: number): number {
  const a = Math.min(SUN_MAX, Math.max(SUN_MIN, alt));
  const horizon = top + h * SUN_SPLIT;
  return a >= 0 ? horizon - (a / SUN_MAX) * h * SUN_SPLIT : horizon + (a / SUN_MIN) * h * (1 - SUN_SPLIT);
}

/** Skymningszonerna under horisonten som horisontella band – ovanför horisonten är bakgrunden neutral. */
export const SUN_ZONES = [
  { top: 0, bottom: -6, zone: "civil" },
  { top: -6, bottom: -12, zone: "nautical" },
  { top: -12, bottom: -18, zone: "astro" },
] as const;

/**
 * Solbanan med exakta horisontpassager (0°) inlagda, linjärt mellan punkterna – så att kurvan
 * och den gula ytan över horisonten börjar och slutar precis vid korsningen.
 */
export function withHorizonCrossings(path: Array<{ t: number; alt: number }>): Array<{ t: number; alt: number }> {
  const out: Array<{ t: number; alt: number }> = [];
  path.forEach((p, i) => {
    const q = path[i - 1];
    if (q && q.alt < 0 !== p.alt < 0 && q.alt !== 0 && p.alt !== 0) {
      out.push({ t: q.t + ((p.t - q.t) * (0 - q.alt)) / (p.alt - q.alt), alt: 0 });
    }
    out.push(p);
  });
  return out;
}

export type SunLabel = { kind: "max" | "sunrise" | "sunset"; t: number; text: string; x: number; y: number; anchor: "start" | "middle" | "end" };

/** Etiketternas storlek (9,5 px siffror) och luft (px). */
const CHAR_W = 5.8;
const TEXT_H = 8;
const GAP = 3;

type Box = [number, number, number, number]; // x0, x1, y0, y1
const hits = (a: Box, b: Box) => a[0] < b[1] + GAP && b[0] < a[1] + GAP && a[2] < b[3] + 1 && b[2] < a[3] + 1;

/**
 * Etiketterna i solbandet, alla ovanför horisonten – på neutral bakgrund eller den ljusa gula
 * ytan, aldrig på de mörka skymningszonerna:
 * - soluppgång och solnedgång (−0,833°) som tid vid passagen, på dagsidan: "06:59" till höger
 *   om uppgången och "18:54" till vänster om nedgången, ovanför kurvan;
 * - maxhöjden vid varje middag i fönstret, "29°", ovanför toppen – under den när toppen når
 *   bandets överkant.
 * Tiderna går först; en etikett som skulle krocka med en annan eller inte ryms helt inom bandet
 * visas inte. Polarfall (ingen passage) ger bara maxhöjden.
 */
export function sunBandLabels(o: {
  path: Array<{ t: number; alt: number }>;
  events: SunEvent[];
  start: number;
  end: number;
  x: (t: number) => number;
  y: (alt: number) => number;
  /** Bandets över- och underkant och diagrammets bredd (px) */
  top: number;
  bottom: number;
  width: number;
}): SunLabel[] {
  const out: SunLabel[] = [];
  const placed: Box[] = [];
  const horizon = o.y(0);
  const place = (l: SunLabel) => {
    const w = l.text.length * CHAR_W;
    const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    const box: Box = [x0, x0 + w, l.y - TEXT_H, l.y];
    const inside = box[0] >= 1 && box[1] <= o.width - 1 && box[2] >= o.top + 1 && box[3] <= horizon - 1;
    if (!inside || placed.some((b) => hits(b, box))) return false;
    placed.push(box);
    out.push(l);
    return true;
  };

  // Kurvans högsta punkt (minsta y) mellan x0 och x1, med en punkt marginal åt vardera håll.
  const curveTop = (x0: number, x1: number) => {
    let top = horizon;
    o.path.forEach((p, i) => {
      const near = [o.path[i - 1], p, o.path[i + 1]].some((q) => q && o.x(q.t) >= x0 && o.x(q.t) <= x1);
      if (near) top = Math.min(top, o.y(p.alt));
    });
    return top;
  };
  for (const e of o.events) {
    if (e.t < o.start || e.t > o.end) continue;
    const rise = e.kind === "sunrise";
    const text = fmtTime(e.t);
    const w = text.length * CHAR_W;
    // Dagsidan av passagen – till höger om uppgången, till vänster om nedgången – ovanför kurvan,
    // så att tiden inte hamnar under vänsteraxeln i standardvyn och aldrig korsar kurvan.
    const x0 = rise ? o.x(e.t) + GAP : o.x(e.t) - GAP - w;
    const baseline = Math.min(horizon - GAP - 1, curveTop(x0, x0 + w) - GAP);
    place({ kind: e.kind, t: e.t, text, x: rise ? x0 : x0 + w, y: baseline, anchor: rise ? "start" : "end" });
  }

  // Middagstoppar: lokala maxima i banan, inte i fönstrets kanter.
  for (let i = 1; i < o.path.length - 1; i++) {
    const p = o.path[i];
    if (p.t < o.start || p.t > o.end || !(p.alt >= o.path[i - 1].alt && p.alt > o.path[i + 1].alt)) continue;
    const text = `${Math.round(p.alt)}°`.replace("-", "−");
    // Topp under horisonten (polarnatt): etiketten strax ovanför horisontlinjen.
    const py = Math.min(o.y(p.alt), horizon);
    const label = (y: number): SunLabel => ({ kind: "max", t: p.t, text, x: o.x(p.t), y, anchor: "middle" });
    if (!place(label(py - GAP - 1))) place(label(py + GAP + TEXT_H + 1));
  }
  return out.sort((a, b) => a.t - b.t);
}
