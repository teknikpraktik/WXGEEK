import type { ChartData, Snapshot } from "./timeline";
import { fmtTime } from "../format";

// ---------------------------------------------------------------------------
// Populärvetenskaplig beskrivning av vädret just nu (engelska), byggd regelbaserat
// ur samma data som diagrammet. Inga påhittade värden: saknas en uppgift hoppas
// stycket över.
// ---------------------------------------------------------------------------

const DIR = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const dirWord = (deg: number) => DIR[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Vind i vardagliga ord (m/s, övre gräns). */
const WIND_WORDS: Array<[number, string]> = [
  [0.3, "no wind"],
  [3.4, "a light breeze"],
  [8, "a breeze"],
  [13.9, "a strong wind"],
  [20.8, "a gale"],
];
const windWord = (ms: number) => WIND_WORDS.find(([max]) => ms < max)?.[1] ?? "a storm";

/** Daggpunkt ur rå-METAR: "15/14", "M02/M05". */
export function dewPointFromMetar(raw: string | undefined): number | undefined {
  const m = raw?.match(/\s(M?\d{2})\/(M?\d{2})\s/);
  if (!m) return undefined;
  return Number(m[2].replace("M", "-"));
}

/** Relativ fuktighet (%) med Magnus formel. */
export function relativeHumidity(t: number, td: number): number {
  const g = (x: number) => (17.62 * x) / (243.12 + x);
  return Math.round(100 * Math.exp(g(td) - g(t)));
}

const round = (v: number) => Math.round(v);

/**
 * En kort, vardaglig beskrivning av vädret vid NU: temperatur och hur luften känns, himlen,
 * vinden och vad som väntar (nederbörd eller temperatur).
 */
export function explainWeather(snap: Snapshot, chart: ChartData, now: number): string {
  // Himlen
  const c = snap.cloud?.value;
  const low = c?.layers?.find((l) => l.cover !== "VV");
  const cb = c?.layers?.some((l) => l.type === "CB");
  let sky = "";
  if (c?.cavok || c?.clear || (c && !c.layers?.length && c.oktas === 0)) sky = "clear skies";
  else if (c?.layers?.some((l) => l.cover === "VV")) sky = "thick fog";
  else if (low) {
    const nearGround = low.baseM < 150;
    if (nearGround) sky = low.cover === "FEW" || low.cover === "SCT" ? "patches of low cloud near the ground" : "grey cloud almost down to the ground";
    else sky = { FEW: "a few clouds", SCT: "a mix of sun and cloud", BKN: "mostly cloudy skies", OVC: "grey, overcast skies" }[low.cover as "FEW"] ?? "some cloud";
    if (cb) sky += " and thunderclouds around";
  }

  // Luften
  const t = snap.temperature?.value;
  const td = dewPointFromMetar(snap.metar?.raw);
  const feel = t !== undefined && td !== undefined ? (t - td <= 2 ? " and damp" : t - td >= 10 ? " and dry" : "") : "";

  // Vinden
  const w = snap.wind?.value;
  const wind =
    w?.speed === undefined
      ? ""
      : `${windWord(w.speed)}${w.speed >= 0.3 && w.deg !== undefined && !w.variable ? ` from the ${dirWord(w.deg)}` : ""}`;

  // Framåt: nederbörd om den väntas, annars temperaturtrend
  const next = chart.precipHours.filter((p) => p.forecast && p.t1 > now);
  const likely = next.reduce((s, p) => s + p.likely, 0);
  const possible = next.reduce((s, p) => s + p.possible, 0);
  const what = next.some((p) => p.kind === "snö") ? "snow" : "rain";
  let outlook = "";
  if (likely >= 1) outlook = `Expect about ${round(likely)} mm of ${what} over the next 12 hours.`;
  else if (likely >= 0.1) outlook = `A little ${what} is likely over the next 12 hours.`;
  else if (possible >= 0.5) outlook = `It should stay mostly dry, but a shower can't be ruled out.`;
  else {
    const pts = chart.temp.forecast.flat().filter((p) => p.t > now);
    const min = pts.length ? pts.reduce((a, b) => (b.v < a.v ? b : a)) : undefined;
    if (min && t !== undefined && t - min.v >= 2) outlook = `It will cool to about ${round(min.v)} °C by ${fmtTime(min.t)}.`;
  }

  const rest = [sky, wind].filter(Boolean).join(" and ");
  let first = "";
  if (t !== undefined) first = `It's ${round(t)} °C${feel}${rest ? `, with ${rest}` : ""}.`;
  else if (rest) first = `Right now: ${rest}.`;
  return [first, outlook].filter(Boolean).join(" ");
}
