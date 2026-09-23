import type { CloudLayer, Phenomenon, TafPeriod, WeatherBundle } from "../types";
import { tafMainStates } from "./forecast";
import { fmtCloudBase, fmtDateTime, fmtInterval, fmtTime, fmtVisibility, fmtWindSpeed } from "../format";

// ---------------------------------------------------------------------------
// Significant weather from METAR and TAF, shown as text under the chart.
// Criteria (aviation-style, conservative):
//   thunderstorm, CB/TCU, freezing precipitation, hail, heavy precipitation, fog,
//   visibility < 1,500 m, gusts or mean wind ≥ 13 m/s (~25 kt),
//   sky obscured (VV) or broken/overcast cloud below 150 m (~500 ft).
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

const WIND_LIMIT_MS = 13;
const VIS_LIMIT_M = 1500;
const LOW_CLOUD_M = 150;

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
    if (p.kind === "åska" || p.kind === "underkylt" || p.kind === "hagel" || p.kind === "dimma" || p.intensity === "kraftig")
      out.push(p.label);
  }
  if (e.visibilityM !== undefined && e.visibilityM < VIS_LIMIT_M) out.push(`Visibility ${fmtVisibility(e.visibilityM)}`);
  if (e.windGustMs !== undefined && e.windGustMs >= WIND_LIMIT_MS) out.push(`Gusts ${fmtWindSpeed(e.windGustMs)} m/s`);
  else if (e.windSpeedMs !== undefined && e.windSpeedMs >= WIND_LIMIT_MS) out.push(`Wind ${fmtWindSpeed(e.windSpeedMs)} m/s`);
  for (const l of e.cloudLayers ?? []) {
    if (l.type) out.push(`${l.type} at ${fmtCloudBase(l.baseM)}`);
    else if (l.cover === "VV") out.push(`Sky obscured, vertical visibility ${fmtCloudBase(l.baseM)}`);
    else if ((l.cover === "BKN" || l.cover === "OVC") && l.baseM < LOW_CLOUD_M) out.push(`${l.cover} at ${fmtCloudBase(l.baseM)}`);
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
