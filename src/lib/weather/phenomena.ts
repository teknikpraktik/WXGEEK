import type { Phenomenon, PhenomenonKind } from "../types";

// ---------------------------------------------------------------------------
// METAR / TAF (t.ex. "-RA", "+SHSN", "TSRA", "BR", "VCSH")
// ---------------------------------------------------------------------------

const PRECIP: Record<string, { kind: PhenomenonKind; label: string }> = {
  DZ: { kind: "duggregn", label: "duggregn" },
  RA: { kind: "regn", label: "regn" },
  SN: { kind: "snö", label: "snöfall" },
  SG: { kind: "snö", label: "kornsnö" },
  PL: { kind: "hagel", label: "iskorn" },
  GR: { kind: "hagel", label: "hagel" },
  GS: { kind: "hagel", label: "småhagel" },
  UP: { kind: "regn", label: "okänd nederbörd" },
};

const OBSCURATION: Record<string, { kind: PhenomenonKind; label: string }> = {
  FG: { kind: "dimma", label: "Dimma" },
  BR: { kind: "dis", label: "Dis" },
  HZ: { kind: "dis", label: "Torrdis" },
  FU: { kind: "dis", label: "Rök" },
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
  // Fenomen "i närheten" (VC) är inte vid stationen – vi hoppar över dem.
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
    return {
      kind: "åska",
      label: withPrecip ? `Åska med ${withPrecip.label}` : "Åska",
      intensity,
      code,
    };
  }

  if (OBSCURATION[t]) {
    const o = OBSCURATION[t];
    if (t === "FG" && (descriptor === "MI" || descriptor === "BC" || descriptor === "PR")) {
      return { kind: "dimma", label: "Dimbankar", code };
    }
    if (t === "FG" && descriptor === "FZ") return { kind: "dimma", label: "Underkyld dimma", code };
    return { ...o, code };
  }

  // Nederbörd kan vara kombinerad, t.ex. RASN.
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
    base = "snöblandat regn";
  }
  if (descriptor === "FZ") {
    kind = "underkylt";
    base = `underkylt ${base}`;
  }
  let plural = false;
  if (descriptor === "SH") {
    plural = true;
    if (kind === "snö") base = "snöbyar";
    else if (kind === "hagel") base = "hagelskurar";
    else if (kind === "snöblandat") base = "byar av snöblandat regn";
    else {
      kind = "skurar";
      base = "regnskurar";
    }
  }
  if (descriptor === "BL" || descriptor === "DR") base = descriptor === "BL" ? "yrsnö" : "lågt drivande snö";

  const prefix =
    intensity === "lätt"
      ? plural
        ? "lätta "
        : "lätt "
      : intensity === "kraftig"
        ? plural
          ? "kraftiga "
          : "kraftigt "
        : "";
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
// SMHI parameter 13 "Rådande väder"
// 0–99: manuell observation (WMO 4677, ww). 100–199: automatstation (WMO 4680 + 100).
// Grov kategorisering – exakta beskrivningar finns i WMO:s kodtabeller.
// ---------------------------------------------------------------------------

function fromWmo4680(c: number): Phenomenon | null {
  const code = String(c + 100);
  if (c === 4 || c === 5) return { kind: "dis", label: "Dis", code };
  if (c === 10) return { kind: "dis", label: "Dis", code };
  if (c >= 30 && c <= 35) return { kind: "dimma", label: "Dimma", code };
  if (c >= 40 && c <= 42) return { kind: "regn", label: "Nederbörd", code };
  if (c >= 50 && c <= 53)
    return { kind: "duggregn", label: c === 51 ? "Lätt duggregn" : "Duggregn", code, intensity: c === 51 ? "lätt" : undefined };
  if (c >= 54 && c <= 56) return { kind: "underkylt", label: "Underkylt duggregn", code };
  if (c >= 57 && c <= 58) return { kind: "snöblandat", label: "Duggregn och regn", code };
  if (c >= 60 && c <= 63)
    return {
      kind: "regn",
      label: c === 61 ? "Lätt regn" : c === 63 ? "Kraftigt regn" : "Regn",
      code,
      intensity: c === 61 ? "lätt" : c === 63 ? "kraftig" : "måttlig",
    };
  if (c >= 64 && c <= 66) return { kind: "underkylt", label: "Underkylt regn", code };
  if (c >= 67 && c <= 68) return { kind: "snöblandat", label: "Snöblandat regn", code };
  if (c >= 70 && c <= 73)
    return { kind: "snö", label: c === 71 ? "Lätt snöfall" : c === 73 ? "Kraftigt snöfall" : "Snöfall", code };
  if (c >= 74 && c <= 78) return { kind: "hagel", label: "Iskorn", code };
  if (c >= 80 && c <= 84) return { kind: "skurar", label: "Regnskurar", code };
  if (c >= 85 && c <= 87) return { kind: "snö", label: "Snöbyar", code };
  if (c === 89) return { kind: "hagel", label: "Hagel", code };
  if (c >= 90 && c <= 96) return { kind: "åska", label: "Åska", code };
  return null;
}

function fromWmo4677(c: number): Phenomenon | null {
  const code = String(c);
  if (c === 4 || c === 5 || c === 10) return { kind: "dis", label: "Dis", code };
  if (c === 11 || c === 12) return { kind: "dimma", label: "Dimbankar", code };
  if (c === 17) return { kind: "åska", label: "Åska", code };
  if (c >= 40 && c <= 49) return { kind: "dimma", label: "Dimma", code };
  if (c >= 50 && c <= 55) return { kind: "duggregn", label: "Duggregn", code };
  if (c >= 56 && c <= 57) return { kind: "underkylt", label: "Underkylt duggregn", code };
  if (c >= 58 && c <= 59) return { kind: "regn", label: "Duggregn och regn", code };
  if (c >= 60 && c <= 65)
    return { kind: "regn", label: c <= 61 ? "Lätt regn" : c >= 64 ? "Kraftigt regn" : "Regn", code };
  if (c >= 66 && c <= 67) return { kind: "underkylt", label: "Underkylt regn", code };
  if (c >= 68 && c <= 69) return { kind: "snöblandat", label: "Snöblandat regn", code };
  if (c >= 70 && c <= 79) return { kind: "snö", label: "Snöfall", code };
  if (c >= 80 && c <= 82) return { kind: "skurar", label: "Regnskurar", code };
  if (c >= 83 && c <= 84) return { kind: "snöblandat", label: "Byar av snöblandat regn", code };
  if (c >= 85 && c <= 86) return { kind: "snö", label: "Snöbyar", code };
  if (c >= 87 && c <= 90) return { kind: "hagel", label: "Hagelskurar", code };
  if (c >= 91 && c <= 99) return { kind: "åska", label: "Åska", code };
  return null;
}

export function parseSmhiPresentWeather(code: number): Phenomenon[] {
  if (!Number.isFinite(code)) return [];
  const p = code >= 100 ? fromWmo4680(code - 100) : fromWmo4677(code);
  return p ? [p] : [];
}

// ---------------------------------------------------------------------------
// SMHI prognos: symbol_code 1–27 (Wsymb2)
// ---------------------------------------------------------------------------

const SYMBOLS: Record<number, { label: string; kind?: PhenomenonKind; intensity?: Phenomenon["intensity"] }> = {
  1: { label: "Klart" },
  2: { label: "Nästan klart" },
  3: { label: "Växlande molnighet" },
  4: { label: "Halvklart" },
  5: { label: "Molnigt" },
  6: { label: "Mulet" },
  7: { label: "Dimma", kind: "dimma" },
  8: { label: "Lätta regnskurar", kind: "skurar", intensity: "lätt" },
  9: { label: "Regnskurar", kind: "skurar", intensity: "måttlig" },
  10: { label: "Kraftiga regnskurar", kind: "skurar", intensity: "kraftig" },
  11: { label: "Åskskurar", kind: "åska" },
  12: { label: "Lätta byar av snöblandat regn", kind: "snöblandat", intensity: "lätt" },
  13: { label: "Byar av snöblandat regn", kind: "snöblandat" },
  14: { label: "Kraftiga byar av snöblandat regn", kind: "snöblandat", intensity: "kraftig" },
  15: { label: "Lätta snöbyar", kind: "snö", intensity: "lätt" },
  16: { label: "Snöbyar", kind: "snö" },
  17: { label: "Kraftiga snöbyar", kind: "snö", intensity: "kraftig" },
  18: { label: "Lätt regn", kind: "regn", intensity: "lätt" },
  19: { label: "Regn", kind: "regn" },
  20: { label: "Kraftigt regn", kind: "regn", intensity: "kraftig" },
  21: { label: "Åska", kind: "åska" },
  22: { label: "Lätt snöblandat regn", kind: "snöblandat", intensity: "lätt" },
  23: { label: "Snöblandat regn", kind: "snöblandat" },
  24: { label: "Kraftigt snöblandat regn", kind: "snöblandat", intensity: "kraftig" },
  25: { label: "Lätt snöfall", kind: "snö", intensity: "lätt" },
  26: { label: "Snöfall", kind: "snö" },
  27: { label: "Ymnigt snöfall", kind: "snö", intensity: "kraftig" },
};

export function symbolLabel(code: number | undefined): string | undefined {
  return code ? SYMBOLS[code]?.label : undefined;
}

export function phenomenonFromSymbol(code: number | undefined): Phenomenon | undefined {
  if (!code) return undefined;
  const s = SYMBOLS[code];
  if (!s?.kind) return undefined;
  return { kind: s.kind, label: s.label, intensity: s.intensity, code: String(code) };
}

/** Kategorier grupperade för tidslinjens händelserad. */
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
