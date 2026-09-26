import { fmtDateTime, fmtInterval, fmtTime, localYmd } from "../format";
import type { Origin, Snapshot } from "./timeline";

/** Ett visat värde och dess källa, t.ex. { what: "wind", origin } */
export type SourceItem = { what: string; origin: Origin };

const HOUR = 3_600_000;
/** Värden som följer ett annat i samma ruta och bara nämns när de har en egen källa. */
const FOLLOWS: Record<string, string> = { "dew point": "temperature", gusts: "wind" };
/** Korta namn på värdena i källraden */
const SHORT: Record<string, string> = {
  temperature: "temp",
  "dew point": "dew pt",
  wind: "wind",
  gusts: "gusts",
  visibility: "vis",
  clouds: "clouds",
  precipitation: "precip",
  weather: "weather",
};

/**
 * Källraden under rutorna, kort: platsen, källan och tiden (lokal tid, datum när det inte är
 * samma dag som nu):
 *   "Karlstad flygplats · METAR 10:50 · SMHI obs 11:00 (temp, wind)"
 * Huvudkällan – den flest värden kommer från – står först utan att räkna upp sina värden; övriga
 * källor med vilka värden de gäller, och sin station när den är en annan. Nederbörd anges med
 * timmens intervall ("08–09"). Prognos: "Forecast 14:00 · TAF Karlstad flygplats · SMHI (temp,
 * precip)". Tid och station tas bara ur värdenas egna källor – saknas de hittas inget på.
 */
export function sourceLine(mode: Snapshot["mode"], time: number, now: number, items: SourceItem[]): string {
  const groups = new Map<string, { kind: Origin["kind"]; station: string; t: number; what: string[] }>();
  for (const { what, origin: o } of items) {
    const obs = o.kind === "METAR" || o.kind === "SMHI";
    if (obs === (mode === "forecast")) continue;
    const station = o.kind === "SMHI-PROGNOS" ? "" : (o.stationName ?? o.stationId ?? "");
    // Observationer per station och tid; en prognoskälla gäller hela sin period.
    const key = obs ? `${o.kind}|${station}|${o.timestamp}` : `${o.kind}|${station}`;
    const g = groups.get(key) ?? { kind: o.kind, station, t: o.timestamp, what: [] };
    g.what.push(what);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.what = g.what.filter((w) => !g.what.includes(FOLLOWS[w]));
  if (!groups.size) return "";
  // Huvudkällan är den som flest värden kommer från (vid lika: den första, temperaturens).
  const [main, ...rest] = [...groups.values()].sort((a, b) => b.what.length - a.what.length);

  const sameDay = (t: number) => localYmd(t) === localYmd(now);
  const when = (t: number) => (sameDay(t) ? fmtTime(t) : fmtDateTime(t).replace(", ", " "));
  const what = (g: { what: string[] }) => `(${g.what.map((w) => SHORT[w] ?? w).join(", ")})`;

  if (mode === "forecast") {
    const label = (g: { kind: Origin["kind"]; station: string }) => (g.kind === "TAF" ? `TAF ${g.station}`.trim() : "SMHI");
    return [`Forecast ${when(time)}`, label(main), ...rest.map((g) => `${label(g)} ${what(g)}`)].join(" · ");
  }
  const kind = (g: { kind: Origin["kind"] }) => (g.kind === "METAR" ? "METAR" : "SMHI obs");
  const others = rest.map((g) => {
    // Nederbörd är timmens summa – intervallet säger mer än tidsstämpeln (timmens slut).
    const t = g.what.join() === "precipitation" ? fmtInterval(g.t - HOUR, g.t) : when(g.t);
    const station = g.station && g.station !== main.station ? ` ${g.station}` : "";
    return `${kind(g)}${station} ${t} ${what(g)}`;
  });
  return [main.station, `${kind(main)} ${when(main.t)}`, ...others].filter(Boolean).join(" · ");
}
