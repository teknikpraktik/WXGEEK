/**
 * Etiketten vid senaste temperaturobservationen ("11 °C"): högerjusterad mot punkten, vänster om
 * NU-linjen (punkten ligger vid mätningens tid, som är NU eller tidigare), ovanför kurvan – eller
 * under när kurvan eller ritytans kant är i vägen. Texten hamnar aldrig på temperaturkurvan och
 * inte heller på andra kurvor (`otherCurves`, daggpunkten). Punkten flyttas aldrig; bara
 * etiketten väljer läge.
 *
 * Skalan ligger kvar så länge värdena är minst 1 °C innanför kanten, så en mätning som är
 * fönstrets högsta (eller lägsta) kan ligga bara ~9 px från ritytans kant. Då hålls texten vid
 * kanten och flyttas åt vänster tills kurvorna går fri; är vänster sida full (brant kurva
 * ovanför, daggpunkten under) står den till höger om NU-linjen.
 */
export type TempLabel = { x: number; baseline: number; above: boolean; hideObserved: boolean };

/** Avstånd från punktens mitt till texten och textens höjd (px, 11 px siffror). */
const GAP = 8;
const TEXT_H = 8;
/** Minsta luft mellan kurvan och texten, och mellan texten och punkten (px). */
const CLEAR = 2;
const DOT_CLEAR = 6;
/** Hur långt åt vänster etiketten får flyttas för att gå fri från kurvan (px). */
const MAX_SHIFT = 40;

export function placeTempLabel(o: {
  /** Punkten på kurvan */
  cx: number;
  cy: number;
  /** NU-linjens x */
  nowX: number;
  /** Etikettens ungefärliga bredd */
  width: number;
  /** Ritytans överkant (under symbolraden) och underkant */
  plotTop: number;
  plotBottom: number;
  /** Underkant för raden med OBSERVED/FORECAST överst i ritytan */
  labelsBottom: number;
  /** Vänstergräns: synliga ritytans vänsterkant vid NU. Är historiken smal (mobil) flyttas
   *  etiketten hellre mot NU-linjen – ovanför eller under punkten – än in under axeln. */
  minX?: number;
  /** Kurvans y vid ett x */
  curveY: (x: number) => number;
  /** Andra kurvor som texten inte heller får ligga på, t.ex. daggpunkten (y eller undefined där
   *  kurvan saknas) */
  otherCurves?: Array<(x: number) => number | undefined>;
}): TempLabel {
  // Gränsen gäller bara när punkten själv syns – annars följer etiketten punkten ut ur vyn.
  const lo = o.minX !== undefined && o.cx >= o.minX ? o.minX : -Infinity;
  const end0 = Math.min(Math.max(o.cx + 4, lo + o.width), o.nowX - 4);
  /** Går kurvan helt under eller helt över texten (y top–bottom) när den slutar vid `end`? */
  const clearOf = (curve: (x: number) => number | undefined, end: number, top: number, bottom: number) => {
    const ys = Array.from({ length: 9 }, (_, i) => curve(end - (o.width * i) / 8)).filter((y): y is number => y !== undefined);
    return ys.every((y) => y >= bottom + CLEAR) || ys.every((y) => y <= top - CLEAR);
  };
  /** Både temperaturkurvan och de andra kurvorna går fria från texten */
  const clear = (end: number, top: number, bottom: number) =>
    clearOf(o.curveY, end, top, bottom) && (o.otherCurves ?? []).every((c) => clearOf(c, end, top, bottom));
  const label = (end: number, bottom: number, above: boolean): TempLabel => ({
    x: end,
    baseline: bottom,
    above,
    hideObserved: above && bottom - TEXT_H < o.labelsBottom,
  });

  // 1–2: rakt ovanför eller under punkten.
  const aTop = o.cy - GAP - TEXT_H;
  const bBottom = o.cy + GAP + TEXT_H;
  if (aTop >= o.labelsBottom && clear(end0, aTop, o.cy - GAP)) return label(end0, o.cy - GAP, true);
  if (bBottom <= o.plotBottom && clear(end0, o.cy + GAP, bBottom)) return label(end0, bBottom, false);

  // 3–4: vid ritytans kant (ovanför lånas OBSERVED-raden). Ligger texten då i höjd med
  // punkten flyttas den förbi den; sedan åt vänster tills kurvan går fri.
  const edges = [
    { top: Math.max(aTop, o.plotTop + 1), above: true },
    { top: Math.min(o.cy + GAP, o.plotBottom - TEXT_H), above: false },
  ];
  for (const e of edges) {
    const bottom = e.top + TEXT_H;
    const besideDot = bottom > o.cy - GAP && e.top < o.cy + GAP;
    const start = besideDot ? Math.min(end0, o.cx - DOT_CLEAR) : end0;
    for (let end = start; end >= start - MAX_SHIFT && end - o.width >= lo; end -= 2) {
      if (clear(end, e.top, bottom)) return label(end, bottom, e.above);
    }
  }

  // 5–6: till höger om NU-linjen, ovanför eller under punktens höjd, när vänster sida är full
  // (brant kurva ovanför och daggpunkten under).
  const right = o.nowX + 4 + o.width;
  if (aTop >= o.labelsBottom && clear(right, aTop, o.cy - GAP)) return label(right, o.cy - GAP, true);
  if (bBottom <= o.plotBottom && clear(right, o.cy + GAP, bBottom)) return label(right, bBottom, false);

  // Kurvan går inte att undvika helt (mycket brant): rakt ovanför eller under, inom ritytan.
  return aTop >= o.plotTop ? label(end0, o.cy - GAP, true) : label(end0, Math.min(bBottom, o.plotBottom), false);
}
