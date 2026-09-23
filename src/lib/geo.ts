const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

/** Bounding box runt en punkt, radie i km. */
export function bboxAround(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos(toRad(lat)));
  return { latMin: lat - dLat, lonMin: lon - dLon, latMax: lat + dLat, lonMax: lon + dLon };
}

/** Grovt Sverige + närliggande hav. Används för rimlighetskontroll av koordinater. */
export function isRoughlySweden(lat: number, lon: number): boolean {
  return lat >= 54.5 && lat <= 69.5 && lon >= 10 && lon <= 24.5;
}

const COMPASS = ["N", "NO", "O", "SO", "S", "SV", "V", "NV"] as const;

const COMPASS_WORD = ["norr", "nordost", "öster", "sydost", "söder", "sydväst", "väster", "nordväst"] as const;

/** Vindriktning (varifrån det blåser) i klartext: "sydost". */
export function compassWord(deg: number): string {
  return COMPASS_WORD[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Vindriktning (varifrån det blåser) som svensk kompassriktning. */
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Point-in-polygon (ray casting). Ring = [[lon, lat], ...]. */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** GeoJSON Polygon/MultiPolygon contains the point (holes respected). */
export function geometryContains(
  geom: { type: string; coordinates: unknown } | null | undefined,
  lon: number,
  lat: number,
): boolean {
  if (!geom) return false;
  const inPolygon = (poly: number[][][]) =>
    poly.length > 0 && pointInRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => pointInRing(lon, lat, hole));
  if (geom.type === "Polygon") return inPolygon(geom.coordinates as number[][][]);
  if (geom.type === "MultiPolygon") return (geom.coordinates as number[][][][]).some(inPolygon);
  return false;
}
