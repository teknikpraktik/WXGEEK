import type { SunEvent } from "../sun";
import { fmtDay, fmtTime, localYmd } from "../format";

/** En soluppgång eller solnedgång vid tidsaxeln. `label`: tiden står bredvid symbolen. */
export type SunMark = { t: number; kind: "sunrise" | "sunset"; x: number; label: boolean; text: string; detail?: string };

/** Symbolens bredd; tiden börjar strax till höger om den (px, "06:52" i 9,5 px siffror). */
export const ICON_W = 14;
const LABEL_X = 9;
const LABEL_W = 29;
/** Dygnsetikettens ungefärliga teckenbredd ("Sat 26 Sep", 10 px). */
const DAY_CHAR_W = 6;

type Box = [number, number];
const hits = (a: Box, b: Box) => a[0] < b[1] + 2 && b[0] < a[1] + 2;

/**
 * Solmarkeringar på tidsaxelns nedre rad, där också dygnsetiketten ("Sat 26 Sep") står vid
 * midnatt. Symbolen står alltid på händelsens exakta tid; tiden bredvid döljs när den skulle
 * krocka – informationen finns kvar i tooltip och skärmläsartext. Står en symbol där
 * dygnsetiketten brukar stå flyttas etiketten till vänster om dygnsstrecket (`dayLeft`).
 */
export function layoutSunMarks(o: {
  /** Alla solhändelser, med marginal utanför fönstret (för gryningens start och skymningens slut) */
  events: SunEvent[];
  start: number;
  end: number;
  now: number;
  x: (t: number) => number;
  midnights: Array<{ t: number; text: string }>;
}): { marks: SunMark[]; dayLeft: Set<number> } {
  const when = (t: number) => (localYmd(t) === localYmd(o.now) ? fmtTime(t) : `${fmtDay(t)} ${fmtTime(t)}`);
  const shown = o.events.filter((e) => (e.kind === "sunrise" || e.kind === "sunset") && e.t >= o.start && e.t <= o.end);
  const icons: Box[] = shown.map((e) => [o.x(e.t) - ICON_W / 2, o.x(e.t) + ICON_W / 2]);

  const dayLeft = new Set<number>();
  const days = o.midnights.map((m): Box => {
    const w = m.text.length * DAY_CHAR_W;
    const right: Box = [o.x(m.t) + 4, o.x(m.t) + 4 + w];
    const left: Box = [o.x(m.t) - 4 - w, o.x(m.t) - 4];
    if (icons.some((b) => hits(b, right)) && !icons.some((b) => hits(b, left))) {
      dayLeft.add(m.t);
      return left;
    }
    return right;
  });

  const taken: Box[] = [...days];
  const marks = shown.map((e, i): SunMark => {
    const ex = o.x(e.t);
    const box: Box = [ex + LABEL_X, ex + LABEL_X + LABEL_W];
    const label = !taken.some((b) => hits(b, box)) && !icons.some((b, j) => j !== i && hits(b, box));
    if (label) taken.push(box);
    // Gryningens start före soluppgången, skymningens slut efter solnedgången. Når solen inte
    // 6° under horisonten emellan är det borgerlig skymning hela natten.
    let detail: string | undefined;
    if (e.kind === "sunrise") {
      const prev = o.events.findLast((d) => d.t < e.t && d.kind !== "sunrise");
      detail = prev?.kind === "dawn" ? `Civil dawn from ${fmtTime(prev.t)}` : prev?.kind === "sunset" ? "Civil twilight all night" : undefined;
    } else {
      const next = o.events.find((d) => d.t > e.t && d.kind !== "sunset");
      detail = next?.kind === "dusk" ? `Civil dusk until ${fmtTime(next.t)}` : next?.kind === "sunrise" ? "Civil twilight all night" : undefined;
    }
    return { t: e.t, kind: e.kind as SunMark["kind"], x: ex, label, text: `${e.kind === "sunrise" ? "Sunrise" : "Sunset"} ${when(e.t)}`, detail };
  });
  return { marks, dayLeft };
}
