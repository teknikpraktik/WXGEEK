import { fmtDateTime, fmtInterval, fmtTime, localYmd } from "../format";
import type { Origin, Snapshot } from "./timeline";

/** Ett visat värde och dess källa, t.ex. { what: "wind", origin } */
export type SourceItem = { what: string; origin: Origin };

const HOUR = 3_600_000;
/** Värden som följer ett annat i samma ruta och bara nämns när de har en egen källa. */
const FOLLOWS: Record<string, string> = { "dew point": "temperature", gusts: "wind" };

/**
 * Källraden under rutorna: var och när värdena kommer ifrån, i lokal tid (Europe/Stockholm,
 * sommartid hanteras), med datum när det inte är samma dag som nu:
 *   "Observed at 09:20 local time · Karlstad flygplats"
 * Värden från en annan station eller tid läggs till med vad de gäller, så att inget tillskrivs
 * fel källa: "…; precipitation 08–09 · Kilsbergen-Suttarboda A". Prognos:
 *   "Forecast for 14:00 · TAF Karlstad flygplats; temperature, precipitation · SMHI".
 * Tid och station tas bara ur värdenas egna källor – saknas de hittas inget på.
 */
export function sourceLine(mode: Snapshot["mode"], time: number, now: number, items: SourceItem[]): string {
  const groups = new Map<string, { label: string; t: number; what: string[] }>();
  for (const { what, origin: o } of items) {
    const obs = o.kind === "METAR" || o.kind === "SMHI";
    if (obs === (mode === "forecast")) continue;
    const station = o.stationName ?? o.stationId ?? "";
    const label = o.kind === "TAF" ? `TAF ${station}`.trim() : o.kind === "SMHI-PROGNOS" ? "SMHI" : station;
    // Observationer per station och tid; en prognoskälla gäller hela sin period.
    const key = obs ? `${o.kind}|${station}|${o.timestamp}` : `${o.kind}|${station}`;
    const g = groups.get(key) ?? { label, t: o.timestamp, what: [] };
    g.what.push(what);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.what = g.what.filter((w) => !g.what.includes(FOLLOWS[w]));
  if (!groups.size) return "";
  // Huvudkällan är den som flest värden kommer från (vid lika: den första, temperaturens).
  const [main, ...rest] = [...groups.values()].sort((a, b) => b.what.length - a.what.length);

  const sameDay = (t: number) => localYmd(t) === localYmd(now);
  const at = (t: number) => (sameDay(t) ? `at ${fmtTime(t)}` : `on ${fmtDateTime(t).replace(", ", " at ")}`);
  const lead =
    mode === "forecast"
      ? `Forecast for ${sameDay(time) ? fmtTime(time) : fmtDateTime(time).replace(", ", " at ")}`
      : `Observed ${at(main.t)} local time`;
  const part = (text: string, label: string) => (label ? `${text} · ${label}` : text);
  const others = rest.map((g) => {
    // Nederbörd är timmens summa – intervallet säger mer än tidsstämpeln (timmens slut).
    const when =
      mode === "forecast" || g.t === main.t ? "" : g.what.join() === "precipitation" ? fmtInterval(g.t - HOUR, g.t) : at(g.t);
    return part([g.what.join(", "), when].filter(Boolean).join(" "), g.label);
  });
  return [part(lead, main.label), ...others].join("; ");
}
