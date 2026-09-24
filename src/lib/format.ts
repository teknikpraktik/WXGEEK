// Formatting for the UI (English). Times are local to Sweden (Europe/Stockholm),
// which handles summer/winter time.

const TZ = "Europe/Stockholm";
const LOCALE = "en-GB";

const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: TZ });
const hourFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", hourCycle: "h23", timeZone: TZ });
const ymdFmt = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });
const dateParts = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "numeric", timeZone: TZ });
// Egna förkortningar: en-GB ger numera "Sept" för september.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtTime = (t: number | string) => timeFmt.format(new Date(t));
export const fmtDay = (t: number | string) => dayFmt.format(new Date(t));
export const localHour = (t: number) => parseInt(hourFmt.format(new Date(t)), 10) % 24;
export const localYmd = (t: number) => ymdFmt.format(new Date(t));

/** "Wed 23 Sep, 16:22" in local time. */
export function fmtDateTime(t: number): string {
  const p = Object.fromEntries(dateParts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${MONTHS[parseInt(p.month, 10) - 1]}, ${fmtTime(t)}`;
}

/** Time interval in local time: "15–16" for whole hours, otherwise "15:30–16:30". */
export function fmtInterval(from: number, to: number): string {
  const whole = (t: number) => fmtTime(t).endsWith(":00");
  const f = (t: number) => (whole(from) && whole(to) ? fmtTime(t).slice(0, 2) : fmtTime(t));
  return `${f(from)}–${f(to)}`;
}

/** "in 2 h 30 min", "45 min ago", "now" – rounded to 5 min */
export function fmtOffset(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60000 / 5) * 5;
  if (min === 0) return "now";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const txt = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return ms > 0 ? `in ${txt}` : `${txt} ago`;
}

/** "6 min ago", "1 h 20 min ago" */
export function fmtAge(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 || h >= 3 ? `${h} h ago` : `${h} h ${m} min ago`;
}

const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Typographic minus sign. */
const minus = (s: string) => s.replace("-", "−");

/** Temperature and dew point in whole degrees, as in METAR. */
export function fmtTemp(c: number | undefined): string {
  if (c === undefined) return "–";
  const s = nf0.format(Math.round(c));
  return minus(s === "-0" ? "0" : s);
}

export const fmtWindSpeed = (ms: number | undefined) => (ms === undefined ? "–" : nf0.format(Math.round(ms)));

/** Wind direction (where the wind comes from) in whole tens of degrees: "050°", "180°". */
export function fmtWindDeg(deg: number): string {
  const r = (Math.round(deg / 10) * 10) % 360;
  const d = r === 0 ? 360 : r;
  return `${String(d).padStart(3, "0")}°`;
}

/** "From 140° · 4 m/s, gusts 7 m/s", "Calm", "Variable · 2 m/s" */
export function fmtWindText(w: { deg?: number; variable?: boolean; speed?: number } | undefined, gust?: number): string {
  if (!w || w.speed === undefined) return "Missing";
  if (w.speed < 0.5) return "Calm";
  const dir = w.variable ? "Variable" : w.deg !== undefined ? `From ${fmtWindDeg(w.deg)}` : "";
  const g = gust !== undefined && gust >= w.speed + 1 ? `, gusts ${fmtWindSpeed(gust)} m/s` : "";
  return `${dir}${dir ? " · " : ""}${fmtWindSpeed(w.speed)} m/s${g}`;
}

export function fmtVisibility(m: number | undefined, atLeast?: boolean): string {
  if (m === undefined) return "–";
  if (m >= 10000) return atLeast !== false ? "≥ 10 km" : "10 km";
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  if (m < 5000) return `${nf1.format(Math.round(m / 100) / 10)} km`;
  return `${nf0.format(Math.round(m / 1000))} km`;
}

/** Daggpunkt ur temperatur och relativ fuktighet (Magnus, Alduchov–Eskridge). */
export function dewPointFromRh(tC: number, rh: number): number {
  const a = 17.625, b = 243.04;
  const g = Math.log(Math.max(1, Math.min(100, rh)) / 100) + (a * tC) / (b + tC);
  return (b * g) / (a - g);
}

/** Cloud base: 10 m steps below 1 km, 100 m above – METAR resolution is 30 m. */
export function fmtCloudBase(m: number | undefined): string {
  if (m === undefined) return "–";
  const r = m < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 100) * 100;
  return `${r} m`;
}

export function fmtPrecip(mm: number | undefined): string {
  if (mm === undefined) return "–";
  if (mm === 0) return "0 mm";
  if (mm < 0.1) return "< 0.1 mm";
  return `${nf1.format(mm)} mm`;
}

export const fmtDistance = (km: number) => (km < 1 ? "< 1 km" : `${nf0.format(Math.round(km))} km`);

/** METAR/TAF cover groups in words. */
export const COVER_LABEL: Record<string, string> = {
  FEW: "Few",
  SCT: "Scattered",
  BKN: "Broken",
  OVC: "Overcast",
  VV: "Sky obscured",
};

/** Eighths of the sky (oktas) that each METAR/TAF cover group means. */
export const COVER_OKTAS: Record<string, string> = {
  FEW: "1–2/8",
  SCT: "3–4/8",
  BKN: "5–7/8",
  OVC: "8/8",
  VV: "8/8",
};

/** Oktas → METAR category (FEW 1–2, SCT 3–4, BKN 5–7, OVC 8). 0 = no cloud. */
export function oktasCover(o: number | undefined): "FEW" | "SCT" | "BKN" | "OVC" | undefined {
  if (o === undefined || o <= 0) return undefined;
  return o <= 2 ? "FEW" : o <= 4 ? "SCT" : o <= 7 ? "BKN" : "OVC";
}

/**
 * One cloud layer as text, with the category's interval – never an invented exact number of oktas.
 * "Broken · BKN · 5–7/8 · base 480 m", "Amount unknown · base 480 m", "Broken · BKN · 5–7/8 · base unknown".
 */
export function fmtCloudLayer(cover: string | undefined, baseM: number | undefined, type?: string): string {
  const base = baseM === undefined ? "base unknown" : `base ${fmtCloudBase(baseM)}`;
  if (cover === "VV") return `Sky obscured · VV · 8/8 · vertical visibility ${baseM === undefined ? "unknown" : fmtCloudBase(baseM)}`;
  if (!cover || !COVER_LABEL[cover]) return `Amount unknown · ${base}`;
  return `${COVER_LABEL[cover]} · ${cover} · ${COVER_OKTAS[cover]}${type ? ` · ${type}` : ""} · ${base}`;
}

/** SMHI cloudiness in oktas, as words. */
export function fmtOktas(o: number | undefined): string {
  if (o === undefined) return "–";
  if (o === 0) return "Clear";
  if (o <= 2) return "Few";
  if (o <= 4) return "Scattered";
  if (o <= 7) return "Broken";
  return "Overcast";
}
