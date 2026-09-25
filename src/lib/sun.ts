const rad = Math.PI / 180;

/**
 * Solens geometriska höjd över horisonten (grader) vid tiden t (ms) – NOAA:s solkalkylator
 * (Jean Meeus, Astronomical Algorithms). Soluppgång och solnedgång blir rätt inom någon minut
 * upp till 72° latitud; den förenklade varianten (Spencers serier) kunde fela 3–5 min kring
 * dagjämningarna.
 */
export function solarElevation(lat: number, lon: number, t: number): number {
  const T = (t / 86_400_000 + 2440587.5 - 2451545) / 36525; // julianska sekel sedan J2000
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360; // medellongitud
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T); // medelanomali
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T); // banans excentricitet
  const C =
    Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad); // skenbar longitud
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad); // ekliptikans lutning
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = // minuter
    (4 / rad) *
    (y * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(M * rad) +
      4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * M * rad));

  const minutes = (((t % 86_400_000) + 86_400_000) % 86_400_000) / 60_000; // UTC-minuter på dygnet
  const trueSolarMin = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolarMin / 4 - 180) * rad;
  const cosZenith =
    Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / rad;
}

/** Solhöjd vid soluppgång och solnedgång: övre kanten i horisonten, med refraktion. */
export const SUNRISE_ALT = -0.833;
/** Borgerlig gryning börjar och borgerlig skymning slutar när solen står 6° under horisonten. */
export const CIVIL_ALT = -6;

/** Dag = solen över horisonten (med hänsyn till refraktion). */
export const isDaylight = (lat: number, lon: number, t: number) => solarElevation(lat, lon, t) > SUNRISE_ALT;

/**
 * dawn: borgerlig gryning börjar (−6°, uppåt), sunrise, sunset, dusk: borgerlig skymning slutar
 * (−6°, nedåt).
 */
export type SunEvent = { t: number; kind: "dawn" | "sunrise" | "sunset" | "dusk" };

const STEP = 5 * 60_000;
const LIMITS = [
  { alt: CIVIL_ALT, up: "dawn", down: "dusk" },
  { alt: SUNRISE_ALT, up: "sunrise", down: "sunset" },
] as const;

/**
 * Solhändelser mellan from och to (ms), som passager av solhöjden genom gränserna: sök i steg
 * om 5 min och halvera intervallet ned till en sekund. Når solen inte en gräns – midnattssol,
 * polarnatt eller ljusa sommarnätter – finns ingen passage och ingen händelse hittas på.
 */
export function sunEvents(lat: number, lon: number, from: number, to: number): SunEvent[] {
  const out: SunEvent[] = [];
  const elev = (t: number) => solarElevation(lat, lon, t);
  let t0 = from;
  let e0 = elev(t0);
  while (t0 < to) {
    const t1 = Math.min(t0 + STEP, to);
    const e1 = elev(t1);
    for (const l of LIMITS) {
      if (e0 - l.alt < 0 === e1 - l.alt < 0) continue;
      const rising = e1 > e0;
      let a = t0;
      let b = t1;
      while (b - a > 1000) {
        const m = (a + b) / 2;
        if (elev(m) - l.alt < 0 === rising) a = m;
        else b = m;
      }
      out.push({ t: Math.round((a + b) / 2), kind: rising ? l.up : l.down });
    }
    t0 = t1;
    e0 = e1;
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Nattgrad ur solhöjden: 0 = dag (solen uppe), 1 = natt (solen mer än 6° under horisonten),
 * linjärt däremellan under borgerlig gryning och skymning.
 */
export const nightness = (elev: number) => Math.min(1, Math.max(0, (SUNRISE_ALT - elev) / (SUNRISE_ALT - CIVIL_ALT)));

/**
 * Nattgraden mellan from och to som punkter att interpolera linjärt mellan: exakt vid varje
 * solhändelse och var 5:e minut under gryning och skymning; där den är konstant (dag, natt)
 * bara ändpunkterna.
 */
export function nightProfile(lat: number, lon: number, from: number, to: number): Array<{ t: number; n: number }> {
  const pts: Array<{ t: number; n: number }> = [];
  for (let t = from; t < to; t += STEP) pts.push({ t, n: nightness(solarElevation(lat, lon, t)) });
  pts.push({ t: to, n: nightness(solarElevation(lat, lon, to)) });
  for (const e of sunEvents(lat, lon, from, to)) pts.push({ t: e.t, n: e.kind === "dawn" || e.kind === "dusk" ? 1 : 0 });
  pts.sort((a, b) => a.t - b.t);
  return pts.filter((p, i) => i === 0 || i === pts.length - 1 || p.n !== pts[i - 1].n || p.n !== pts[i + 1].n);
}
