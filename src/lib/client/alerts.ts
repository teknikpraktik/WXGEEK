import type { CloudLayer, Phenomenon, TafPeriod, WeatherBundle } from "../types";
import { tafMainStates } from "./forecast";
import { fmtCloudBase, fmtDateTime, fmtInterval, fmtTime, fmtWindSpeed } from "../format";

// ---------------------------------------------------------------------------
// Warnings from METAR and TAF, shown at the bottom of the page. Only weather that can
// affect society: thunderstorm, CB, strong wind (mean ≥ 14 m/s or gusts ≥ 20 m/s),
// heavy or freezing precipitation, hail, ice pellets and blowing snow.
// Not warnings: fog, low visibility, low cloud / vertical visibility, TCU, small hail
// and light or moderate precipitation.
// ---------------------------------------------------------------------------

export type AviationAlert = {
  id: string;
  source: "METAR" | "TAF";
  stationId: string;
  /** e.g. "METAR 16:50" or "TAF TEMPO 17–23" */
  when: string;
  /** Significant items, e.g. ["Thunderstorm with rain", "CB at 900 m"] */
  items: string[];
  from: number;
  to?: number;
};

/** Hård vind (medelvind) respektive kraftiga byar, m/s. */
const WIND_MEAN_LIMIT_MS = 14;
const GUST_LIMIT_MS = 20;

type Elements = {
  phenomena?: Phenomenon[];
  visibilityM?: number;
  windSpeedMs?: number;
  windGustMs?: number;
  cloudLayers?: CloudLayer[];
};

/** Significant items in a set of weather elements (empty = nothing significant). */
export function significantItems(e: Elements): string[] {
  const out: string[] = [];
  for (const p of e.phenomena ?? []) {
    const code = p.code ?? "";
    // Småhagel (GS) utan hagel är vanligt i skurar och räknas inte.
    const smallHailOnly = code.includes("GS") && !code.includes("GR") && p.intensity !== "kraftig";
    if (
      p.kind === "åska" ||
      p.kind === "underkylt" ||
      (p.kind === "hagel" && !smallHailOnly) ||
      code.includes("BLSN") ||
      (p.intensity === "kraftig" && p.kind !== "dimma" && p.kind !== "dis")
    )
      out.push(p.label);
  }
  if (e.windGustMs !== undefined && e.windGustMs >= GUST_LIMIT_MS) out.push(`Gusts ${fmtWindSpeed(e.windGustMs)} m/s`);
  else if (e.windSpeedMs !== undefined && e.windSpeedMs >= WIND_MEAN_LIMIT_MS) out.push(`Wind ${fmtWindSpeed(e.windSpeedMs)} m/s`);
  for (const l of e.cloudLayers ?? []) {
    if (l.type === "CB") out.push(`CB at ${fmtCloudBase(l.baseM)}`);
  }
  return [...new Set(out)];
}

const periodLabel = (p: TafPeriod) =>
  p.change === "TEMPO" ? "TEMPO" : p.change === "PROB" ? `PROB${p.probability ?? ""}` : p.change === "BECMG" ? "BECMG" : p.change === "FM" ? "FM" : "";

export function aviationAlerts(bundle: WeatherBundle, now: number, windowEnd: number): AviationAlert[] {
  const out: AviationAlert[] = [];

  // Latest METAR (≤ 2 h old)
  const metar = bundle.stations.find((s) => s.station.source === "METAR");
  const last = metar?.observations.at(-1);
  if (last && now - Date.parse(last.timestamp) <= 2 * 3_600_000) {
    const items = significantItems(last);
    if (items.length)
      out.push({
        id: `metar-${last.timestamp}`,
        source: "METAR",
        stationId: last.stationId,
        when: `METAR ${fmtTime(last.timestamp)}`,
        items,
        from: Date.parse(last.timestamp),
      });
  }

  // TAF: main forecast states (incl. BECMG effect) and TEMPO/PROB within the window
  const taf = bundle.taf;
  if (taf) {
    const validTo = Date.parse(taf.validTo);
    const mains = tafMainStates(taf);
    const extras = taf.periods.filter((p) => p.change === "TEMPO" || p.change === "PROB");
    for (const p of [...mains, ...extras]) {
      const from = Math.max(Date.parse(p.from), now);
      const to = Math.min(Date.parse(p.to), validTo, windowEnd);
      if (to <= from) continue;
      const items = significantItems(p);
      if (!items.length) continue;
      const label = periodLabel(p);
      out.push({
        id: `taf-${p.change}-${p.from}`,
        source: "TAF",
        stationId: taf.stationId,
        // Long periods (e.g. the 24 h main forecast) as "until …" instead of an ambiguous "17–17".
        when:
          Date.parse(p.to) - Date.parse(p.from) >= 12 * 3_600_000
            ? `TAF${label ? ` ${label}` : ""} until ${fmtDateTime(Date.parse(p.to))}`
            : `TAF${label ? ` ${label}` : ""} ${fmtInterval(Date.parse(p.from), Date.parse(p.to))}`,
        items,
        from,
        to,
      });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
