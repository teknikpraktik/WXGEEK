import { fmtTime } from "../format";
import { SUNRISE_ALT, type SunEvent } from "../sun";

/**
 * Ljuspanelens fasta skala året runt (grader) – ingen autoskalning, säsongsskillnaden är poängen.
 * Tvådelad: horisonten…60° tar 65 % av höjden, −18°…horisonten (skymningen) 35 %, så att de tre
 * skymningszonerna blir tydliga. Värden utanför klipps mot kanterna.
 */
export const SUN_MIN = -18;
export const SUN_MAX = 60;
export const SUN_SPLIT = 0.65;
/**
 * Horisontlinjen: −0,833°, standarddefinitionen av soluppgång och solnedgång (ljusbrytningen och
 * solens radie). Kurvan korsar den alltså just vid ↑- och ↓-tiderna och den gula ytan betyder att
 * solen är uppe. Mot geometriska 0° skiljer det ~1 px i höjd men 5–10 minuter i tid.
 */
export const HORIZON = SUNRISE_ALT;

/** y (px) för solhöjden i ett band med överkant `top` och höjd `h`. */
export function sunY(alt: number, top: number, h: number): number {
  const a = Math.min(SUN_MAX, Math.max(SUN_MIN, alt));
  const horizon = top + h * SUN_SPLIT;
  return a >= HORIZON
    ? horizon - ((a - HORIZON) / (SUN_MAX - HORIZON)) * h * SUN_SPLIT
    : horizon + ((HORIZON - a) / (HORIZON - SUN_MIN)) * h * (1 - SUN_SPLIT);
}

/**
 * Skymningszonerna under horisonten som horisontella band – ovanför horisonten är bakgrunden
 * neutral. Den borgerliga skymningen räknas från solnedgången, som i almanackan.
 */
export const SUN_ZONES = [
  { top: HORIZON, bottom: -6, zone: "civil" },
  { top: -6, bottom: -12, zone: "nautical" },
  { top: -12, bottom: -18, zone: "astro" },
] as const;

type SunPt = { t: number; alt: number };

/** Punkter med exakta passager av `level` inlagda (linjärt mellan punkterna). */
function withCrossings(path: SunPt[], level: number): SunPt[] {
  const out: SunPt[] = [];
  path.forEach((p, i) => {
    const q = path[i - 1];
    if (q && q.alt < level !== p.alt < level && q.alt !== level && p.alt !== level) {
      out.push({ t: q.t + ((p.t - q.t) * (level - q.alt)) / (p.alt - q.alt), alt: level });
    }
    out.push(p);
  });
  return out;
}

/**
 * Solbanan med exakta horisontpassager inlagda – så att den gula ytan över horisonten börjar och
 * slutar precis vid korsningen, dvs. vid soluppgången och solnedgången.
 */
export const withHorizonCrossings = (path: SunPt[]) => withCrossings(path, HORIZON);

/**
 * Kurvans delar där solen står på −18° eller högre: under astronomisk skymning döljs kurvan i
 * stället för att ritas platt mot bandets nederkant. Horisontpassagerna ligger med som punkter –
 * skalan knäcker vid horisonten, så en rak linje mellan tiominuterspunkterna skulle annars korsa
 * horisontlinjen upp till ett par minuter fel.
 */
export function sunCurveSegments(path: SunPt[]): SunPt[][] {
  const out: SunPt[][] = [];
  let cur: SunPt[] = [];
  for (const p of withCrossings(withHorizonCrossings(path), SUN_MIN)) {
    if (p.alt >= SUN_MIN) cur.push(p);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((seg) => seg.length > 1);
}

export type SunLabel = {
  kind: "max" | "sunrise" | "sunset" | "dawn" | "dusk";
  t: number;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** Etikettens vänster- och högerkant (px) – den döljs när vyns kanter skulle klippa den. */
  x0: number;
  x1: number;
};

/** Etiketternas storlek (9,5 px siffror) och luft (px). */
const CHAR_W = 5.8;
const TEXT_H = 8;
const GAP = 3;

type Box = [number, number, number, number]; // x0, x1, y0, y1
const hits = (a: Box, b: Box) => a[0] < b[1] + GAP && b[0] < a[1] + GAP && a[2] < b[3] + 1 && b[2] < a[3] + 1;

/**
 * Etiketterna i ljuspanelen, alla ovanför horisonten – på neutral bakgrund eller den ljusa gula
 * ytan, aldrig på de mörka skymningszonerna:
 * - soluppgång och solnedgång (−0,833°) som "↑ 06:59" och "↓ 18:54" på dagsidan av passagen
 *   (till höger om uppgången, till vänster om nedgången), ovanför kurvan;
 * - maxhöjden vid varje middag i fönstret, "Max 29°", ovanför toppen – under den när toppen når
 *   bandets överkant;
 * - borgerlig gryning och skymning (−6°) som diskreta tider vid passagen, strax ovanför horisonten.
 * Uppgång och nedgång går först, sedan maxhöjden, sist gryning och skymning; en etikett som skulle
 * krocka med en annan eller inte ryms helt inom bandet visas inte. Polarfall ger bara det som finns.
 */
export function sunBandLabels(o: {
  path: SunPt[];
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
  const horizon = o.y(HORIZON);
  const place = (l: Omit<SunLabel, "x0" | "x1">) => {
    const w = l.text.length * CHAR_W;
    const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    const box: Box = [x0, x0 + w, l.y - TEXT_H, l.y];
    const inside = box[0] >= 1 && box[1] <= o.width - 1 && box[2] >= o.top + 1 && box[3] <= horizon - 1;
    if (!inside || placed.some((b) => hits(b, box))) return false;
    placed.push(box);
    out.push({ ...l, x0: box[0], x1: box[1] });
    return true;
  };
  const inWindow = (t: number) => t >= o.start && t <= o.end;

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
    if (!inWindow(e.t) || (e.kind !== "sunrise" && e.kind !== "sunset")) continue;
    const rise = e.kind === "sunrise";
    const text = `${rise ? "↑" : "↓"} ${fmtTime(e.t)}`;
    const w = text.length * CHAR_W;
    // Dagsidan av passagen, ovanför kurvan – tiden hamnar inte under vänsteraxeln i standardvyn.
    const x0 = rise ? o.x(e.t) + GAP : o.x(e.t) - GAP - w;
    const baseline = Math.min(horizon - GAP - 1, curveTop(x0, x0 + w) - GAP);
    place({ kind: e.kind, t: e.t, text, x: rise ? x0 : x0 + w, y: baseline, anchor: rise ? "start" : "end" });
  }

  // Middagstoppar: lokala maxima i banan, inte i fönstrets kanter.
  for (let i = 1; i < o.path.length - 1; i++) {
    const p = o.path[i];
    if (!inWindow(p.t) || !(p.alt >= o.path[i - 1].alt && p.alt > o.path[i + 1].alt)) continue;
    const text = `Max ${Math.round(p.alt)}°`.replace("-", "−");
    // Topp under horisonten (polarnatt): etiketten strax ovanför horisontlinjen.
    const py = Math.min(o.y(p.alt), horizon);
    const label = (y: number): Omit<SunLabel, "x0" | "x1"> => ({ kind: "max", t: p.t, text, x: o.x(p.t), y, anchor: "middle" });
    if (!place(label(py - GAP - 1))) place(label(py + GAP + TEXT_H + 1));
  }

  // Borgerlig gryning och skymning: diskreta tider ovanför horisonten vid passagen av −6°, där
  // kurvan ligger under horisonten.
  for (const e of o.events) {
    if (!inWindow(e.t) || (e.kind !== "dawn" && e.kind !== "dusk")) continue;
    place({ kind: e.kind, t: e.t, text: fmtTime(e.t), x: o.x(e.t), y: horizon - GAP, anchor: "middle" });
  }
  return out.sort((a, b) => a.t - b.t);
}
