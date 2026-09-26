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

/** Dag = solen över horisonten (med hänsyn till refraktion). */
export const isDaylight = (lat: number, lon: number, t: number) => solarElevation(lat, lon, t) > SUNRISE_ALT;

export type SunEvent = { t: number; kind: "sunrise" | "sunset" };

/** Solbanan: solhöjden (grader) var 10:e minut mellan from och to (ms). */
export function sunPath(lat: number, lon: number, from: number, to: number, step = 10 * 60_000): Array<{ t: number; alt: number }> {
  const out: Array<{ t: number; alt: number }> = [];
  for (let t = from; t <= to; t += step) out.push({ t, alt: solarElevation(lat, lon, t) });
  return out;
}

/**
 * Soluppgångar och solnedgångar mellan from och to (ms): passager av solhöjden genom −0,833°,
 * sökta i steg om 5 min och halverade ned till en sekund. Midnattssol och polarnatt har ingen
 * passage – då hittas inga händelser.
 */
export function sunEvents(lat: number, lon: number, from: number, to: number): SunEvent[] {
  const out: SunEvent[] = [];
  const elev = (t: number) => solarElevation(lat, lon, t) - SUNRISE_ALT;
  let t0 = from;
  let e0 = elev(t0);
  while (t0 < to) {
    const t1 = Math.min(t0 + 5 * 60_000, to);
    const e1 = elev(t1);
    if (e0 < 0 !== e1 < 0) {
      const rising = e1 > e0;
      let a = t0;
      let b = t1;
      while (b - a > 1000) {
        const m = (a + b) / 2;
        if (elev(m) < 0 === rising) a = m;
        else b = m;
      }
      out.push({ t: Math.round((a + b) / 2), kind: rising ? "sunrise" : "sunset" });
    }
    t0 = t1;
    e0 = e1;
  }
  return out;
}
