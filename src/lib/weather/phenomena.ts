import type { Phenomenon, PhenomenonKind } from "../types";

// ---------------------------------------------------------------------------
// METAR / TAF (e.g. "-RA", "+SHSN", "TSRA", "BR", "VCSH")
// Internal kinds (regn, snö, …) are identifiers only; labels are English.
// ---------------------------------------------------------------------------

const PRECIP: Record<string, { kind: PhenomenonKind; label: string }> = {
  DZ: { kind: "duggregn", label: "drizzle" },
  RA: { kind: "regn", label: "rain" },
  SN: { kind: "snö", label: "snow" },
  SG: { kind: "snö", label: "snow grains" },
  PL: { kind: "hagel", label: "ice pellets" },
  GR: { kind: "hagel", label: "hail" },
  GS: { kind: "hagel", label: "small hail" },
  UP: { kind: "regn", label: "unknown precipitation" },
};

const OBSCURATION: Record<string, { kind: PhenomenonKind; label: string }> = {
  FG: { kind: "dimma", label: "Fog" },
  BR: { kind: "dis", label: "Mist" },
  HZ: { kind: "dis", label: "Haze" },
  FU: { kind: "dis", label: "Smoke" },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function parseMetarToken(token: string): Phenomenon | null {
  const code = token;
  let t = token;
  let intensity: Phenomenon["intensity"];
  if (t.startsWith("+")) {
    intensity = "kraftig";
    t = t.slice(1);
  } else if (t.startsWith("-")) {
    intensity = "lätt";
    t = t.slice(1);
  }
  // "In the vicinity" (VC) and recent (RE) weather is not at the station – skipped.
  if (t.startsWith("VC") || t.startsWith("RE")) return null;
  if (t === "NSW") return null;

  let descriptor = "";
  for (const d of ["MI", "BC", "PR", "DR", "BL", "SH", "TS", "FZ"]) {
    if (t.startsWith(d)) {
      descriptor = d;
      t = t.slice(2);
      break;
    }
  }

  if (descriptor === "TS") {
    const withPrecip = t ? PRECIP[t.slice(0, 2)] : undefined;
    return { kind: "åska", label: withPrecip ? `Thunderstorm with ${withPrecip.label}` : "Thunderstorm", intensity, code };
  }

  if (OBSCURATION[t]) {
    const o = OBSCURATION[t];
    if (t === "FG" && (descriptor === "MI" || descriptor === "BC" || descriptor === "PR")) {
      return { kind: "dimma", label: descriptor === "MI" ? "Shallow fog" : "Fog patches", code };
    }
    if (t === "FG" && descriptor === "FZ") return { kind: "dimma", label: "Freezing fog", code };
    return { ...o, code };
  }

  // Precipitation may be combined, e.g. RASN.
  const parts: string[] = [];
  for (let i = 0; i + 1 < t.length; i += 2) parts.push(t.slice(i, i + 2));
  const precip = parts.map((p) => PRECIP[p]).filter(Boolean);
  if (precip.length === 0) return null;

  const hasRain = parts.includes("RA") || parts.includes("DZ");
  const hasSnow = parts.includes("SN");
  let kind: PhenomenonKind = precip[0].kind;
  let base = precip[0].label;
  if (hasRain && hasSnow) {
    kind = "snöblandat";
    base = "rain and snow";
  }
  if (descriptor === "FZ") {
    kind = "underkylt";
    base = `freezing ${base}`;
  }
  if (descriptor === "SH") {
    if (kind === "snö") base = "snow showers";
    else if (kind === "hagel") base = "hail showers";
    else if (kind === "snöblandat") base = "rain and snow showers";
    else {
      kind = "skurar";
      base = "rain showers";
    }
  }
  if (descriptor === "BL") base = "blowing snow";
  if (descriptor === "DR") base = "drifting snow";

  const prefix = intensity === "lätt" ? "light " : intensity === "kraftig" ? "heavy " : "";
  return { kind, label: cap(prefix + base), intensity: intensity ?? "måttlig", code };
}

export function parseMetarWeather(wx: string | null | undefined): Phenomenon[] {
  if (!wx) return [];
  return wx
    .split(/\s+/)
    .map((tok) => parseMetarToken(tok.trim()))
    .filter((p): p is Phenomenon => p !== null);
}

// ---------------------------------------------------------------------------
// SMHI parameter 13 "present weather"
// 0–99: manual observation (WMO 4677, ww). 100–199: automatic station (WMO 4680 + 100).
// Coarse categories – exact wording is in the WMO code tables.
// ---------------------------------------------------------------------------

function fromWmo4680(c: number): Phenomenon | null {
  const code = String(c + 100);
  if (c === 4 || c === 5) return { kind: "dis", label: "Haze", code };
  if (c === 10) return { kind: "dis", label: "Mist", code };
  if (c >= 30 && c <= 35) return { kind: "dimma", label: "Fog", code };
  if (c >= 40 && c <= 42) return { kind: "regn", label: "Precipitation", code };
  if (c >= 50 && c <= 53)
    return { kind: "duggregn", label: c === 51 ? "Light drizzle" : "Drizzle", code, intensity: c === 51 ? "lätt" : undefined };
  if (c >= 54 && c <= 56) return { kind: "underkylt", label: "Freezing drizzle", code };
  if (c >= 57 && c <= 58) return { kind: "snöblandat", label: "Drizzle and rain", code };
  if (c >= 60 && c <= 63)
    return {
      kind: "regn",
      label: c === 61 ? "Light rain" : c === 63 ? "Heavy rain" : "Rain",
      code,
      intensity: c === 61 ? "lätt" : c === 63 ? "kraftig" : "måttlig",
    };
  if (c >= 64 && c <= 66) return { kind: "underkylt", label: "Freezing rain", code };
  if (c >= 67 && c <= 68) return { kind: "snöblandat", label: "Rain and snow", code };
  if (c >= 70 && c <= 73) return { kind: "snö", label: c === 71 ? "Light snow" : c === 73 ? "Heavy snow" : "Snow", code };
  if (c >= 74 && c <= 78) return { kind: "hagel", label: "Ice pellets", code };
  if (c >= 80 && c <= 84) return { kind: "skurar", label: "Rain showers", code };
  if (c >= 85 && c <= 87) return { kind: "snö", label: "Snow showers", code };
  if (c === 89) return { kind: "hagel", label: "Hail", code };
  if (c >= 90 && c <= 96) return { kind: "åska", label: "Thunderstorm", code };
  return null;
}

function fromWmo4677(c: number): Phenomenon | null {
  const code = String(c);
  if (c === 4 || c === 5) return { kind: "dis", label: "Haze", code };
  if (c === 10) return { kind: "dis", label: "Mist", code };
  if (c === 11 || c === 12) return { kind: "dimma", label: "Shallow fog", code };
  if (c === 17) return { kind: "åska", label: "Thunderstorm", code };
  if (c >= 40 && c <= 49) return { kind: "dimma", label: "Fog", code };
  if (c >= 50 && c <= 55) return { kind: "duggregn", label: "Drizzle", code };
  if (c >= 56 && c <= 57) return { kind: "underkylt", label: "Freezing drizzle", code };
  if (c >= 58 && c <= 59) return { kind: "regn", label: "Drizzle and rain", code };
  if (c >= 60 && c <= 65) return { kind: "regn", label: c <= 61 ? "Light rain" : c >= 64 ? "Heavy rain" : "Rain", code };
  if (c >= 66 && c <= 67) return { kind: "underkylt", label: "Freezing rain", code };
  if (c >= 68 && c <= 69) return { kind: "snöblandat", label: "Rain and snow", code };
  if (c >= 70 && c <= 79) return { kind: "snö", label: "Snow", code };
  if (c >= 80 && c <= 82) return { kind: "skurar", label: "Rain showers", code };
  if (c >= 83 && c <= 84) return { kind: "snöblandat", label: "Rain and snow showers", code };
  if (c >= 85 && c <= 86) return { kind: "snö", label: "Snow showers", code };
  if (c >= 87 && c <= 90) return { kind: "hagel", label: "Hail showers", code };
  if (c >= 91 && c <= 99) return { kind: "åska", label: "Thunderstorm", code };
  return null;
}

export function parseSmhiPresentWeather(code: number): Phenomenon[] {
  if (!Number.isFinite(code)) return [];
  const p = code >= 100 ? fromWmo4680(code - 100) : fromWmo4677(code);
  return p ? [p] : [];
}

// ---------------------------------------------------------------------------
// SMHI forecast: symbol_code 1–27 (Wsymb2)
// ---------------------------------------------------------------------------

const SYMBOLS: Record<number, { label: string; kind?: PhenomenonKind; intensity?: Phenomenon["intensity"] }> = {
  1: { label: "Clear sky" },
  2: { label: "Nearly clear sky" },
  3: { label: "Variable cloudiness" },
  4: { label: "Halfclear sky" },
  5: { label: "Cloudy sky" },
  6: { label: "Overcast" },
  7: { label: "Fog", kind: "dimma" },
  8: { label: "Light rain showers", kind: "skurar", intensity: "lätt" },
  9: { label: "Rain showers", kind: "skurar", intensity: "måttlig" },
  10: { label: "Heavy rain showers", kind: "skurar", intensity: "kraftig" },
  11: { label: "Thunderstorm", kind: "åska" },
  12: { label: "Light sleet showers", kind: "snöblandat", intensity: "lätt" },
  13: { label: "Sleet showers", kind: "snöblandat" },
  14: { label: "Heavy sleet showers", kind: "snöblandat", intensity: "kraftig" },
  15: { label: "Light snow showers", kind: "snö", intensity: "lätt" },
  16: { label: "Snow showers", kind: "snö" },
  17: { label: "Heavy snow showers", kind: "snö", intensity: "kraftig" },
  18: { label: "Light rain", kind: "regn", intensity: "lätt" },
  19: { label: "Rain", kind: "regn" },
  20: { label: "Heavy rain", kind: "regn", intensity: "kraftig" },
  21: { label: "Thunder", kind: "åska" },
  22: { label: "Light sleet", kind: "snöblandat", intensity: "lätt" },
  23: { label: "Sleet", kind: "snöblandat" },
  24: { label: "Heavy sleet", kind: "snöblandat", intensity: "kraftig" },
  25: { label: "Light snowfall", kind: "snö", intensity: "lätt" },
  26: { label: "Snowfall", kind: "snö" },
  27: { label: "Heavy snowfall", kind: "snö", intensity: "kraftig" },
};

export function phenomenonFromSymbol(code: number | undefined): Phenomenon | undefined {
  if (!code) return undefined;
  const s = SYMBOLS[code];
  if (!s?.kind) return undefined;
  return { kind: s.kind, label: s.label, intensity: s.intensity, code: String(code) };
}

/** Grouped categories used in the timeline. */
export const PHENOMENON_GROUP: Record<PhenomenonKind, "regn" | "snö" | "dimma" | "åska"> = {
  regn: "regn",
  duggregn: "regn",
  skurar: "regn",
  underkylt: "regn",
  snöblandat: "snö",
  snö: "snö",
  hagel: "snö",
  dimma: "dimma",
  dis: "dimma",
  åska: "åska",
};
