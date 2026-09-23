/**
 * Solens höjd över horisonten (grader) – förenklad NOAA-algoritm, noggrann nog för
 * att avgöra dag/natt i diagrammet (±1°).
 */
export function solarElevation(lat: number, lon: number, t: number): number {
  const rad = Math.PI / 180;
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = (t - start) / 86_400_000;
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  const trueSolarMin = hours * 60 + eqTime + 4 * lon;
  const hourAngle = (trueSolarMin / 4 - 180) * rad;
  const cosZenith =
    Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / rad;
}

/** Dag = solen över horisonten (med hänsyn till refraktion, −0,833°). */
export const isDaylight = (lat: number, lon: number, t: number) => solarElevation(lat, lon, t) > -0.833;
