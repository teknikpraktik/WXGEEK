import { fmtTime } from "../format";
import { CIVIL_ALT, SUNRISE_ALT, type SunEvent } from "../sun";

/**
 * Ljuspanelens fasta skala året runt, i geometrisk solhöjd (grader) – ingen autoskalning,
 * säsongsskillnaden är poängen. Tvådelad: 0°…60° tar 65 % av höjden och −18°…0° (skymningen)
 * 35 %, så att de tre skymningszonerna (0/−6, −6/−12, −12/−18) blir lika höga och tydliga.
 * Horisontlinjen ligger vid 0°. Värden utanför klipps mot kanterna.
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
 * Solhöjden där varje händelse inträffar: upp- och nedgång vid −0,833° (ljusbrytningen och solens
 * radie – strax under horisontlinjen), borgerlig gryning och skymning vid −6°.
 */
export const EVENT_ALT: Record<SunEvent["kind"], number> = {
  sunrise: SUNRISE_ALT,
  sunset: SUNRISE_ALT,
  dawn: CIVIL_ALT,
  dusk: CIVIL_ALT,
};

/** Händelsernas namn i etiketterna */
export const EVENT_NAME: Record<SunEvent["kind"], string> = {
  sunrise: "Sunrise",
  sunset: "Sunset",
  dawn: "Civil dawn",
  dusk: "Civil dusk",
};

/** "Sunrise 06:59" */
export const sunEventText = (e: SunEvent) => `${EVENT_NAME[e.kind]} ${fmtTime(e.t)}`;

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
 * Solbanan med exakta passager av horisonten (0°) inlagda – där knäcker skalan, och den gula ytan
 * börjar och slutar precis vid korsningen.
 */
export const withHorizonCrossings = (path: SunPt[]) => withCrossings(path, 0);

/**
 * Kurvans delar där solen står på −18° eller högre: under astronomisk skymning döljs kurvan i
 * stället för att ritas platt mot bandets nederkant. Horisontpassagerna och händelsernas exakta
 * punkter (−0,833° och −6°) ligger med som punkter – markörerna hamnar då exakt på den ritade
 * kurvan, och en rak linje mellan tiominuterspunkterna korsar aldrig horisonten fel där skalan
 * knäcker.
 */
export function sunCurveSegments(path: SunPt[], events: SunEvent[] = []): SunPt[][] {
  const base = withCrossings(withHorizonCrossings(path), SUN_MIN);
  const first = base[0]?.t ?? Infinity;
  const last = base.at(-1)?.t ?? -Infinity;
  const extra = events.filter((e) => e.t > first && e.t < last).map((e) => ({ t: e.t, alt: EVENT_ALT[e.kind] }));
  const pts = [...base, ...extra].sort((a, b) => a.t - b.t);
  const out: SunPt[][] = [];
  let cur: SunPt[] = [];
  for (const p of pts) {
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
  kind: "max" | SunEvent["kind"];
  t: number;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** Etikettens vänster- och högerkant (px) – den döljs när vyns kanter skulle klippa den. */
  x0: number;
  x1: number;
};

/** Etiketternas storlek (12 px text, uppskattad bredd per tecken med marginal) och luft (px). */
export const SUN_CHAR_W = 6.6;
export const SUN_TEXT_H = 9;
const GAP = 4;
/** Radavstånd när en etikett flyttas upp en rad för att gå fri från en annan (px). */
const ROW = 14;

type Box = [number, number, number, number]; // x0, x1, y0, y1
/** Krockar två etiketter? Minst GAP px luft i sidled och 4 px i höjdled (textens över- och underhäng). */
const hits = (a: Box, b: Box) => a[0] < b[1] + GAP && b[0] < a[1] + GAP && a[2] < b[3] + 4 && b[2] < a[3] + 4;

/**
 * Etiketterna i ljuspanelen, alla ovanför horisontlinjen och helt inom bandet:
 * - soluppgång och solnedgång ("Sunrise 06:59", "Sunset 18:54") intill sina markörer på kurvan
 *   (−0,833°), på dagsidan – till höger om uppgången, till vänster om nedgången – ovanför kurvan;
 * - maxhöjden vid varje middag i fönstret, "Sun alt. max 29°", ovanför toppen – en rad högre när
 *   en kort dags upp- och nedgång står i vägen, under toppen när den når bandets överkant;
 * - borgerlig gryning och skymning ("Civil dawn 06:18", "Civil dusk 19:34") ovanför sina markörer
 *   på −6°-linjen, på nattsidan – slutar vid gryningen, börjar vid skymningen.
 * Uppgång och nedgång går först, sedan maxhöjden, sist gryning och skymning. Ingen etikett korsar
 * en lodrät linje i `avoid` (NU-linjen): den flyttas då till markörens andra sida eller, för
 * maxhöjden, åt sidan av linjen. En etikett som ändå skulle krocka med en annan eller inte ryms helt
 * inom bandet visas inte. Polarfall ger bara det som finns.
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
  /** Lodräta linjer (x, px) som ingen etikett får korsa, t.ex. NU-linjen */
  avoid?: number[];
  /** Den synliga delen i standardvyn (x, px): av två lägen för maxhöjden väljs det som syns där */
  view?: [number, number];
}): SunLabel[] {
  const out: SunLabel[] = [];
  const placed: Box[] = [];
  const horizon = o.y(0);
  /** Första läget (baslinjen i tur och ordning) där etiketten ryms utan att krocka. */
  const placeAt = (l: Omit<SunLabel, "x0" | "x1" | "y">, ys: number[]) => ys.some((y) => place({ ...l, y }));
  const place = (l: Omit<SunLabel, "x0" | "x1">) => {
    const w = l.text.length * SUN_CHAR_W;
    const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    const box: Box = [x0, x0 + w, l.y - SUN_TEXT_H, l.y];
    const inside = box[0] >= 1 && box[1] <= o.width - 1 && box[2] >= o.top + 1 && box[3] <= horizon - 1;
    const crossesLine = (o.avoid ?? []).some((ax) => ax > box[0] - 3 && ax < box[1] + 3);
    if (!inside || crossesLine || placed.some((b) => hits(b, box))) return false;
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
    const text = sunEventText(e);
    const w = text.length * SUN_CHAR_W;
    const mx = o.x(e.t);
    // Dagsidan av markören, ovanför kurvan – annars nattsidan, strax ovanför horisonten
    const x0 = rise ? mx + GAP : mx - GAP - w;
    const baseline = Math.min(horizon - GAP, curveTop(x0, x0 + w) - 3);
    const day = { kind: e.kind, t: e.t, text, x: rise ? x0 : x0 + w, anchor: rise ? "start" : "end" } as const;
    const night = { kind: e.kind, t: e.t, text, x: rise ? mx - GAP : mx + GAP, anchor: rise ? "end" : "start" } as const;
    if (!placeAt(day, [baseline, baseline - ROW])) placeAt(night, [horizon - GAP, horizon - GAP - ROW]);
  }

  // Middagstoppar: lokala maxima i banan, inte i fönstrets kanter.
  for (let i = 1; i < o.path.length - 1; i++) {
    const p = o.path[i];
    if (!inWindow(p.t) || !(p.alt >= o.path[i - 1].alt && p.alt > o.path[i + 1].alt)) continue;
    const text = `Sun alt. max ${Math.round(p.alt)}°`.replace("-", "−");
    // Topp under horisonten (polarnatt): etiketten strax ovanför horisontlinjen.
    const py = Math.min(o.y(p.alt), horizon);
    // Ovanför toppen – en eller två rader högre när en kort dags upp- och nedgång står i vägen –
    // annars under toppen, på den gula ytan.
    // Mitt över toppen, eller åt sidan av en linje som annars skulle korsa etiketten.
    const w = text.length * SUN_CHAR_W;
    const px = o.x(p.t);
    const xs = [px, ...(o.avoid ?? []).filter((ax) => Math.abs(ax - px) < w / 2 + 3).flatMap((ax) => [ax - 5 - w / 2, ax + 5 + w / 2])];
    const seen = (cx: number) => !o.view || (cx - w / 2 >= o.view[0] && cx + w / 2 <= o.view[1]);
    xs.sort((a, b) => Number(seen(b)) - Number(seen(a)) || Math.abs(a - px) - Math.abs(b - px));
    const ys = [py - GAP, py - GAP - ROW, py - GAP - 2 * ROW, py + GAP + SUN_TEXT_H];
    xs.some((cx) => placeAt({ kind: "max", t: p.t, text, x: cx, anchor: "middle" }, ys));
  }

  // Borgerlig gryning och skymning ovanför horisonten, på nattsidan av markören vid −6°.
  for (const e of o.events) {
    if (!inWindow(e.t) || (e.kind !== "dawn" && e.kind !== "dusk")) continue;
    const dawn = e.kind === "dawn";
    const mx = o.x(e.t);
    const rows = [horizon - GAP, horizon - GAP - ROW];
    const text = sunEventText(e);
    // Nattsidan först, annars markörens andra sida
    if (!placeAt({ kind: e.kind, t: e.t, text, x: mx + (dawn ? 2 : -2), anchor: dawn ? "end" : "start" }, rows)) {
      placeAt({ kind: e.kind, t: e.t, text, x: mx + (dawn ? -2 : 2), anchor: dawn ? "start" : "end" }, rows);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
