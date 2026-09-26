import { fmtTime } from "../format";
import type { SunEvent } from "../sun";

/** Solbandets fasta skala året runt (grader) – ingen autoskalning, säsongsskillnaden är poängen. */
export const SUN_MIN = -20;
export const SUN_MAX = 60;

/** Zonerna som horisontella band: dag, borgerlig, nautisk och astronomisk skymning, natt. */
export const SUN_ZONES = [
  { top: SUN_MAX, bottom: 0, zone: "day" },
  { top: 0, bottom: -6, zone: "civil" },
  { top: -6, bottom: -12, zone: "nautical" },
  { top: -12, bottom: -18, zone: "astro" },
  { top: -18, bottom: SUN_MIN, zone: "night" },
] as const;

export type SunLabel = { kind: "max" | "sunrise" | "sunset"; t: number; text: string; x: number; y: number; anchor: "start" | "middle" | "end" };

/** Etiketternas storlek (9,5 px siffror) och luft (px). */
const CHAR_W = 5.8;
const TEXT_H = 8;
const GAP = 3;

type Box = [number, number, number, number]; // x0, x1, y0, y1
const hits = (a: Box, b: Box) => a[0] < b[1] + GAP && b[0] < a[1] + GAP && a[2] < b[3] + 1 && b[2] < a[3] + 1;

/**
 * Etiketterna i solbandet:
 * - soluppgång och solnedgång (−0,833°) som tid vid passagen: "06:59" till vänster om
 *   uppgången och "18:54" till höger om nedgången, strax ovanför horisonten – där kurvan inte går;
 * - maxhöjden vid varje middag i fönstret, "29°", ovanför toppen – under den när toppen når
 *   bandets överkant.
 * Tiderna går först; en etikett som skulle krocka med en annan eller gå utanför diagrammet
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
  const place = (l: SunLabel) => {
    const w = l.text.length * CHAR_W;
    const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    const box: Box = [x0, x0 + w, l.y - TEXT_H, l.y];
    const inside = box[0] >= 1 && box[1] <= o.width - 1 && box[2] >= o.top && box[3] <= o.bottom;
    if (!inside || placed.some((b) => hits(b, box))) return false;
    placed.push(box);
    out.push(l);
    return true;
  };

  const horizon = o.y(0) - GAP;
  for (const e of o.events) {
    if (e.t < o.start || e.t > o.end) continue;
    const rise = e.kind === "sunrise";
    place({ kind: e.kind, t: e.t, text: fmtTime(e.t), x: o.x(e.t) + (rise ? -GAP : GAP), y: horizon, anchor: rise ? "end" : "start" });
  }

  // Middagstoppar: lokala maxima i banan, inte i fönstrets kanter.
  for (let i = 1; i < o.path.length - 1; i++) {
    const p = o.path[i];
    if (p.t < o.start || p.t > o.end || !(p.alt >= o.path[i - 1].alt && p.alt > o.path[i + 1].alt)) continue;
    const text = `${Math.round(p.alt)}°`.replace("-", "−");
    const py = o.y(Math.min(p.alt, SUN_MAX));
    const label = (y: number): SunLabel => ({ kind: "max", t: p.t, text, x: o.x(p.t), y, anchor: "middle" });
    if (!place(label(py - GAP - 1))) place(label(py + GAP + TEXT_H + 1));
  }
  return out.sort((a, b) => a.t - b.t);
}
