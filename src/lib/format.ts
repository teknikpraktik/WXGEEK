import { compass } from "./geo";

const TZ = "Europe/Stockholm";

const timeFmt = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat("sv-SE", { weekday: "short", timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "numeric", timeZone: TZ });
const hourFmt = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", hourCycle: "h23", timeZone: TZ });
const ymdFmt = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

export const fmtTime = (t: number | string) => timeFmt.format(new Date(t));
export const fmtDay = (t: number | string) => dayFmt.format(new Date(t)).replace(".", "");
export const fmtDate = (t: number | string) => dateFmt.format(new Date(t)).replace(".", "");
export const localHour = (t: number) => parseInt(hourFmt.format(new Date(t)), 10) % 24;
export const localYmd = (t: number) => ymdFmt.format(new Date(t));

/** "idag 14:00", "imorgon 06:00", "tors 15:00" */
export function fmtRelativeDay(t: number, now: number): string {
  const d = localYmd(t);
  if (d === localYmd(now)) return fmtTime(t);
  if (d === localYmd(now + 86_400_000)) return `imorgon ${fmtTime(t)}`;
  if (d === localYmd(now - 86_400_000)) return `igår ${fmtTime(t)}`;
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

const nf0 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Minus som typografiskt minustecken. */
const minus = (s: string) => s.replace("-", "−");

export function fmtTemp(c: number | undefined, decimals = true): string {
  if (c === undefined) return "–";
  // Heltal från METAR visas utan decimal för att inte antyda större precision.
  const s = decimals && !Number.isInteger(c) ? nf1.format(c) : nf0.format(Math.round(c));
  return minus(s === "-0" ? "0" : s);
}

export const fmtWindSpeed = (ms: number | undefined) => (ms === undefined ? "–" : nf0.format(Math.round(ms)));

export function fmtWindDir(deg: number | undefined, variable?: boolean): string {
  if (variable) return "Varierande";
  if (deg === undefined) return "";
  return compass(deg);
}

export function fmtVisibility(m: number | undefined, atLeast?: boolean): string {
  if (m === undefined) return "–";
  if (m >= 10000) return atLeast !== false ? "≥ 10 km" : "10 km";
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  if (m < 5000) return `${nf1.format(Math.round(m / 100) / 10)} km`;
  return `${nf0.format(Math.round(m / 1000))} km`;
}

/** Molnbas: 10 m-steg under 1 km, 100 m-steg över – METAR:s upplösning är 30 m. */
export function fmtCloudBase(m: number | undefined): string {
  if (m === undefined) return "–";
  const r = m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100;
  return `${r} m`;
}

export const fmtPressure = (h: number | undefined) => (h === undefined ? "–" : String(Math.round(h)));
export const fmtPercent = (p: number | undefined) => (p === undefined ? "–" : `${nf0.format(Math.round(p))} %`);

export function fmtPrecip(mm: number | undefined): string {
  if (mm === undefined) return "–";
  if (mm === 0) return "0 mm";
  if (mm < 0.1) return "< 0,1 mm";
  return `${nf1.format(mm)} mm`;
}

export const fmtDistance = (km: number) => (km < 1 ? "< 1 km" : `${nf0.format(Math.round(km))} km`);

/** "6 min sedan", "1 h 20 min sedan" */
export function fmtAge(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "nyss";
  if (min < 60) return `${min} min sedan`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 || h >= 3 ? `${h} h sedan` : `${h} h ${m} min sedan`;
}

/** "om 3 h", "för 2 h sedan" */
export function fmtOffset(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h === 0) return "nu";
  return h > 0 ? `om ${h} h` : `för ${-h} h sedan`;
}

export const COVER_LABEL: Record<string, string> = {
  FEW: "Få moln",
  SCT: "Spridda moln",
  BKN: "Brutet molntäcke",
  OVC: "Mulet",
  VV: "Skymd himmel",
};

export function fmtOktas(o: number | undefined): string {
  if (o === undefined) return "–";
  if (o === 0) return "Klart";
  if (o <= 2) return "Nästan klart";
  if (o <= 4) return "Halvklart";
  if (o <= 6) return "Molnigt";
  return "Mulet";
}
