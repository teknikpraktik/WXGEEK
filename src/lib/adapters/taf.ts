import type { CloudLayer, Taf, TafChange, TafPeriod } from "../types";
import { compass } from "../geo";
import { cleanAwcName, FT_TO_M, ktToMs, visibFromAwc } from "./metar";
import { parseMetarWeather } from "../weather/phenomena";

export type AwcTaf = {
  icaoId: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  rawTAF: string;
  lat: number;
  lon: number;
  name?: string;
  fcsts: Array<{
    timeFrom: number;
    timeTo: number;
    timeBec: number | null;
    fcstChange: string | null;
    probability: number | null;
    wdir: number | "VRB" | null;
    wspd: number | null;
    wgst: number | null;
    visib: number | string | null;
    vertVis?: number | null;
    wxString: string | null;
    clouds: Array<{ cover: string; base: number | null; type: string | null }>;
  }>;
};

const iso = (s: number) => new Date(s * 1000).toISOString();

/**
 * Sikt i TAF: AWC ger statute miles. Europeiska TAF anger meter, så vi försöker
 * läsa ursprungsvärdet ur rå-TAF-segmentet för bättre noggrannhet.
 */
function visibilityForPeriod(v: AwcTaf["fcsts"][number]["visib"]) {
  const r = visibFromAwc(v);
  if (!r) return null;
  // Avrunda till "TAF-steg" för att inte visa falsk precision efter omräkning.
  if (r.atLeast) return r;
  const m = r.m < 800 ? Math.round(r.m / 50) * 50 : r.m < 5000 ? Math.round(r.m / 100) * 100 : Math.round(r.m / 1000) * 1000;
  return { m, atLeast: false };
}

function fmtVis(m: number, atLeast?: boolean) {
  if (atLeast && m >= 10000) return "sikt 10 km eller mer";
  return m < 1000 ? `sikt ${m} m` : `sikt ${(m / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km`;
}

function summarize(p: Omit<TafPeriod, "summary">): string {
  const parts: string[] = [];
  if (p.windSpeedMs !== undefined) {
    const dir = p.windVariable ? "Varierande" : p.windDirectionDeg !== undefined ? compass(p.windDirectionDeg) : "";
    let w = `${dir} ${Math.round(p.windSpeedMs)} m/s`.trim();
    if (p.windGustMs) w += `, byar ${Math.round(p.windGustMs)} m/s`;
    parts.push(w);
  }
  if (p.visibilityM !== undefined) parts.push(fmtVis(p.visibilityM, p.visibilityAtLeast));
  if (p.phenomena?.length) parts.push(p.phenomena.map((x) => x.label.toLowerCase()).join(", "));
  const low = p.cloudLayers?.find((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV");
  if (low) parts.push(`${low.cover === "VV" ? "vertikal sikt" : "molnbas"} ${roundBase(low.baseM)} m`);
  else if (p.noSignificantCloud) parts.push("inga betydande moln");
  const s = parts.join(" · ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Ingen ändring angiven";
}

const roundBase = (m: number) => (m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100);

export function normalizeTaf(t: AwcTaf, distanceKm: number): Taf {
  const periods: TafPeriod[] = t.fcsts.map((f) => {
    let change: TafChange = "BASE";
    if (f.fcstChange === "FM") change = "FM";
    else if (f.fcstChange === "BECMG") change = "BECMG";
    else if (f.fcstChange === "TEMPO") change = "TEMPO";
    else if (f.fcstChange === "PROB" || (f.probability && !f.fcstChange)) change = "PROB";
    // "PROB30 TEMPO" kodas som TEMPO med probability.
    if (change === "TEMPO" && f.probability) change = "PROB";

    const vis = visibilityForPeriod(f.visib);
    const layers: CloudLayer[] = [];
    let nsc = false;
    for (const c of f.clouds ?? []) {
      if (["FEW", "SCT", "BKN", "OVC"].includes(c.cover) && c.base != null) {
        layers.push({
          cover: c.cover as CloudLayer["cover"],
          baseM: Math.round(c.base * FT_TO_M),
          type: c.type === "CB" || c.type === "TCU" ? c.type : undefined,
        });
      } else if (["NSC", "SKC", "CAVOK", "CLR"].includes(c.cover)) nsc = true;
    }
    if (f.vertVis != null) layers.push({ cover: "VV", baseM: Math.round(f.vertVis * FT_TO_M) });

    const base: Omit<TafPeriod, "summary"> = {
      change,
      probability: f.probability ?? undefined,
      from: iso(f.timeFrom),
      to: iso(f.timeTo),
      becomingBy: f.timeBec ? iso(f.timeBec) : undefined,
      windDirectionDeg: typeof f.wdir === "number" ? f.wdir : undefined,
      windVariable: f.wdir === "VRB" || undefined,
      windSpeedMs: typeof f.wspd === "number" ? ktToMs(f.wspd) : undefined,
      windGustMs: typeof f.wgst === "number" ? ktToMs(f.wgst) : undefined,
      visibilityM: vis?.m,
      visibilityAtLeast: vis?.atLeast || undefined,
      cloudLayers: layers.sort((a, b) => a.baseM - b.baseM),
      noSignificantCloud: nsc || undefined,
      phenomena: parseMetarWeather(f.wxString),
    };
    return { ...base, summary: summarize(base) };
  });

  return {
    stationId: t.icaoId,
    stationName: t.name ? cleanAwcName(t.name) : undefined,
    distanceKm,
    issueTime: t.issueTime,
    validFrom: iso(t.validTimeFrom),
    validTo: iso(t.validTimeTo),
    raw: t.rawTAF,
    periods,
  };
}
