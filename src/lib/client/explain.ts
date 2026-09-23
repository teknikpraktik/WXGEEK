import type { ChartData, Snapshot } from "./timeline";
import { fmtTime } from "../format";

// ---------------------------------------------------------------------------
// Populärvetenskaplig beskrivning av vädret just nu (engelska), byggd regelbaserat
// ur samma data som diagrammet. Inga påhittade värden: saknas en uppgift hoppas
// stycket över.
// ---------------------------------------------------------------------------

const DIR = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const dirWord = (deg: number) => DIR[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Beaufort-skalan (m/s, övre gräns) med engelska namn. */
const BEAUFORT: Array<[number, string]> = [
  [0.3, "calm"],
  [1.6, "light air"],
  [3.4, "light breeze"],
  [5.5, "gentle breeze"],
  [8, "moderate breeze"],
  [10.8, "fresh breeze"],
  [13.9, "strong breeze"],
  [17.2, "near gale"],
  [20.8, "gale"],
  [24.5, "strong gale"],
  [28.5, "storm"],
  [32.7, "violent storm"],
];
function beaufort(ms: number): { force: number; name: string } {
  const i = BEAUFORT.findIndex(([max]) => ms < max);
  return i === -1 ? { force: 12, name: "hurricane-force wind" } : { force: i, name: BEAUFORT[i][1] };
}

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
/** Höjder avrundas till 10 m – METAR anger molnbas i hundratal fot. */
const r10 = (m: number) => Math.round(m / 10) * 10;
const mm = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

/**
 * En enda populärvetenskaplig mening om vädret vid NU: molnen (typ och höjd), luften
 * (fuktighet), vinden (Beaufort) och vad som väntar (nederbörd eller temperatur).
 */
export function explainWeather(snap: Snapshot, chart: ChartData, now: number): string {
  const parts: string[] = [];

  // Moln
  const c = snap.cloud?.value;
  const low = c?.layers?.find((l) => l.cover !== "VV");
  const cb = c?.layers?.some((l) => l.type === "CB");
  if (c?.cavok) parts.push("no cloud below 1,500 m (CAVOK)");
  else if (c?.clear || (c && !c.layers?.length && c.oktas === 0)) parts.push("a clear sky");
  else if (c?.layers?.some((l) => l.cover === "VV")) parts.push("fog so thick the sky is hidden");
  else if (low) {
    const kind = low.baseM < 300 ? "stratus" : low.baseM < 2000 ? "low cloud" : "mid-level cloud";
    const amount = { FEW: "a few wisps of", SCT: "scattered", BKN: "broken", OVC: "a lid of" }[low.cover as "FEW"] ?? "";
    parts.push(`${amount} ${kind} at about ${r10(low.baseM)} m${cb ? " with towering thunderclouds" : ""}`);
  }

  // Luft
  const t = snap.temperature?.value;
  const td = dewPointFromMetar(snap.metar?.raw);
  if (t !== undefined) {
    const humid = td !== undefined && t - td <= 2 ? "almost saturated" : td !== undefined && t - td >= 10 ? "dry" : undefined;
    const rh = td !== undefined ? ` (${Math.min(100, relativeHumidity(t, td))} % humidity)` : "";
    parts.push(`${humid ? `${humid} ` : ""}air at ${round(t)} °C${rh}`);
  }

  // Vind
  const w = snap.wind?.value;
  if (w?.speed !== undefined) {
    const b = beaufort(w.speed);
    parts.push(b.force === 0 ? "no wind" : `a ${b.name}${w.deg !== undefined && !w.variable ? ` from the ${dirWord(w.deg)}` : ""}`);
  }

  // Framåt: nederbörd om den väntas, annars temperaturtrend
  const next = chart.precipHours.filter((p) => p.forecast && p.t1 > now);
  const likely = next.reduce((s, p) => s + p.likely, 0);
  const possible = next.reduce((s, p) => s + p.possible, 0);
  let outlook = "";
  if (likely >= 0.1) outlook = ` – SMHI's ensemble expects about ${mm(likely)} mm of ${next.some((p) => p.kind === "snö") ? "snow" : "rain"} in the next 12 hours`;
  else if (possible >= 0.5) outlook = " – probably dry, though a few model runs give some rain";
  else {
    const pts = chart.temp.forecast.flat().filter((p) => p.t > now);
    const min = pts.length ? pts.reduce((a, b) => (b.v < a.v ? b : a)) : undefined;
    if (min && t !== undefined && t - min.v >= 2) outlook = ` – cooling to about ${round(min.v)} °C by ${fmtTime(min.t)}`;
  }

  if (!parts.length) return "";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const s = `Right now: ${list}${outlook}.`;
  return s.replace(/\s+/g, " ");
}
