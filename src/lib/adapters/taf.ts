import type { CloudLayer, Taf, TafChange, TafElement, TafPeriod } from "../types";
import { fmtWindDeg } from "../format";
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
 * Delar rå-TAF i grupper i samma ordning som AWC:s `fcsts`: huvudprognos, därefter
 * en grupp per FM / BECMG / TEMPO / PROBnn (PROBnn TEMPO räknas som en grupp).
 * Används för det AWC:s avkodning tappar: CAVOK, VV, sikt i meter och vilka element
 * en BECMG-grupp faktiskt ändrar.
 */
export function splitTafGroups(raw: string): string[] {
  const body = raw
    .replace(/^TAF\s+(AMD\s+|COR\s+)?/, "")
    .replace(/\s+RMK\b.*$/, "")
    .trim();
  const parts = body.split(/\s+(?=FM\d{6}\b|BECMG\b|TEMPO\b|PROB\d{2}\b)/);
  const out: string[] = [];
  for (const p of parts) {
    // "PROB40 TEMPO ..." är en grupp; "TEMPO" direkt efter en ensam "PROB40" slås ihop.
    if (/^TEMPO\b/.test(p) && out.length && /^PROB\d{2}$/.test(out[out.length - 1].trim())) {
      out[out.length - 1] = `${out[out.length - 1]} ${p}`;
    } else out.push(p);
  }
  return out;
}

/** Sikt i meter ur en TAF-grupp: fyra siffror (9999 = minst 10 km) eller CAVOK. */
function visibilityFromGroup(g: string): { m: number; atLeast: boolean } | null {
  if (/\bCAVOK\b/.test(g)) return { m: 10000, atLeast: true };
  const m = g.split(/\s+/).find((tok) => /^\d{4}$/.test(tok));
  if (!m) return null;
  const v = parseInt(m, 10);
  return v >= 9999 ? { m: 10000, atLeast: true } : { m: v, atLeast: false };
}

/** Vilka element en grupp anger (övriga lämnas oförändrade av BECMG). */
function elementsInGroup(g: string): TafElement[] {
  const toks = g.split(/\s+/);
  const out: TafElement[] = [];
  if (toks.some((t) => /^(\d{3}|VRB)\d{2,3}(G\d{2,3})?(KT|MPS)$/.test(t))) out.push("wind");
  if (/\bCAVOK\b/.test(g) || toks.some((t) => /^\d{4}$/.test(t))) out.push("visibility");
  if (/\bCAVOK\b|\bNSW\b/.test(g) || toks.some((t) => /^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP|FG|BR|HZ|FU)+$/.test(t)))
    out.push("weather");
  if (/\bCAVOK\b|\bNSC\b|\bSKC\b|\bVV\d{3}\b/.test(g) || toks.some((t) => /^(FEW|SCT|BKN|OVC)\d{3}/.test(t))) out.push("clouds");
  return out;
}

function fmtVis(m: number, atLeast?: boolean) {
  if (atLeast && m >= 10000) return "visibility 10 km or more";
  return m < 1000 ? `visibility ${m} m` : `visibility ${(m / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} km`;
}

const roundBase = (m: number) => (m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100);
const COVER_WORD: Record<string, string> = {
  FEW: "few",
  SCT: "scattered",
  BKN: "broken",
  OVC: "overcast",
};
const COVER_OKTAS: Record<string, string> = { FEW: "1–2/8", SCT: "3–4/8", BKN: "5–7/8", OVC: "8/8" };

/**
 * Svensk sammanfattning av de element gruppen faktiskt anger. För BECMG/TEMPO/PROB
 * tas bara de element med som står i gruppen – inte de som AWC fört vidare.
 */
function summarize(p: Omit<TafPeriod, "summary">, only?: TafElement[]): string {
  const has = (e: TafElement) => !only || only.includes(e);
  const parts: string[] = [];
  if (p.cavok && has("visibility")) parts.push("CAVOK: visibility 10 km or more, no cloud below 1,500 m, no significant weather");
  else {
    if (has("wind") && p.windSpeedMs !== undefined) {
      if (p.windSpeedMs < 0.5) parts.push("calm");
      else {
        const dir = p.windVariable ? "variable wind" : p.windDirectionDeg !== undefined ? `wind from ${fmtWindDeg(p.windDirectionDeg)}` : "wind";
        let w = `${dir} ${Math.round(p.windSpeedMs)} m/s`;
        if (p.windGustMs) w += `, gusts ${Math.round(p.windGustMs)} m/s`;
        parts.push(w);
      }
    }
    if (has("visibility") && p.visibilityM !== undefined) parts.push(fmtVis(p.visibilityM, p.visibilityAtLeast));
    if (has("weather")) {
      if (p.nsw) parts.push("no significant weather");
      else if (p.phenomena?.length) parts.push(p.phenomena.map((x) => x.label.toLowerCase()).join(", "));
    }
    if (has("clouds")) {
      const vv = p.cloudLayers?.find((l) => l.cover === "VV");
      const lowest = p.cloudLayers?.find((l) => l.cover !== "VV");
      if (vv) parts.push(`sky obscured, vertical visibility ${roundBase(vv.baseM)} m`);
      else if (lowest) {
        parts.push(
          `${COVER_WORD[lowest.cover] ?? "cloud"} ${COVER_OKTAS[lowest.cover] ?? ""} at ${roundBase(lowest.baseM)} m${lowest.type ? ` (${lowest.type})` : ""}`,
        );
      } else if (p.noSignificantCloud) parts.push("no significant cloud");
    }
  }
  const s = parts.join(" · ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "No details in group";
}

export function normalizeTaf(t: AwcTaf, distanceKm: number): Taf {
  const groups = splitTafGroups(t.rawTAF);
  const groupsMatch = groups.length === t.fcsts.length;

  const periods: TafPeriod[] = t.fcsts.map((f, i) => {
    let change: TafChange = "BASE";
    if (f.fcstChange === "FM") change = "FM";
    else if (f.fcstChange === "BECMG") change = "BECMG";
    else if (f.fcstChange === "TEMPO") change = "TEMPO";
    else if (f.fcstChange === "PROB" || (f.probability && !f.fcstChange)) change = "PROB";
    // "PROB30 TEMPO" kodas som TEMPO med sannolikhet.
    if (change === "TEMPO" && f.probability) change = "PROB";

    const g = groupsMatch ? groups[i] : "";
    const cavok = /\bCAVOK\b/.test(g);
    const nsw = /\bNSW\b/.test(g) || (f.wxString ?? "").includes("NSW") ? true : undefined;

    // Sikt: meter ur råtexten om möjligt, annars AWC:s statute miles avrundat.
    let vis = g ? visibilityFromGroup(g) : null;
    if (!vis) {
      const r = visibFromAwc(f.visib);
      if (r)
        vis = r.atLeast
          ? r
          : { m: r.m < 800 ? Math.round(r.m / 50) * 50 : r.m < 5000 ? Math.round(r.m / 100) * 100 : Math.round(r.m / 1000) * 1000, atLeast: false };
    }

    const layers: CloudLayer[] = [];
    let nsc = cavok;
    for (const c of f.clouds ?? []) {
      if (["FEW", "SCT", "BKN", "OVC"].includes(c.cover) && c.base != null) {
        layers.push({
          cover: c.cover as CloudLayer["cover"],
          baseM: Math.round(c.base * FT_TO_M),
          type: c.type === "CB" || c.type === "TCU" ? c.type : undefined,
        });
      } else if (["NSC", "SKC", "CAVOK", "CLR"].includes(c.cover)) nsc = true;
    }
    // Vertikal sikt: AWC anger ibland bara "OVX" utan höjd – läs VV ur råtexten.
    // AWC för dessutom vidare VV från tidigare grupp in i BECMG ("BECMG 9999 SCT020" efter
    // "VV002" fick VV kvar) – finns gruppens råtext gäller bara den.
    const vvRaw = g.match(/\bVV(\d{3})\b/);
    const vvFt = g ? (vvRaw ? parseInt(vvRaw[1], 10) * 100 : null) : (f.vertVis ?? null);
    if (vvFt != null) layers.push({ cover: "VV", baseM: Math.round(vvFt * FT_TO_M) });

    const changes = g ? elementsInGroup(g) : undefined;
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
      noSignificantCloud: (nsc && layers.length === 0) || undefined,
      cavok: cavok || undefined,
      nsw,
      phenomena: parseMetarWeather(f.wxString),
      changes,
      group: g || undefined,
    };
    // Huvudprognos/FM: hela tillståndet. BECMG/TEMPO/PROB: bara det gruppen anger.
    const only = change === "BASE" || change === "FM" ? undefined : changes;
    return { ...base, summary: summarize(base, only) };
  });

  return {
    stationId: t.icaoId,
    stationName: t.name ? cleanAwcName(t.name) : undefined,
    distanceKm,
    latitude: t.lat,
    longitude: t.lon,
    issueTime: t.issueTime,
    validFrom: iso(t.validTimeFrom),
    validTo: iso(t.validTimeTo),
    raw: t.rawTAF,
    periods,
  };
}
