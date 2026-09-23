import "server-only";
import { fetchJson } from "./http";
import { CACHE } from "./sources";
import type { Place } from "../types";

const NOMINATIM = "https://nominatim.openstreetmap.org";

type NominatimResult = {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  address?: Record<string, string>;
};

function detailFrom(r: NominatimResult): string | undefined {
  const parts = r.display_name.split(",").map((s) => s.trim());
  // "Karlstad, Karlstads kommun, Värmlands län, 652 24, Sverige" → "Karlstads kommun, Värmlands län"
  const rest = parts.slice(1).filter((p) => p !== "Sweden" && p !== "Sverige" && !/^\d{3} ?\d{2}$/.test(p));
  return rest.slice(0, 2).join(", ") || undefined;
}

export async function searchPlaces(q: string): Promise<Place[]> {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&countrycodes=se&format=jsonv2&limit=6&accept-language=en`;
  const res = (await fetchJson<NominatimResult[]>(url, { revalidate: CACHE.geocode })) ?? [];
  const seen = new Set<string>();
  return res
    .map((r) => ({
      name: r.name || r.display_name.split(",")[0],
      detail: detailFrom(r),
      latitude: Number(r.lat),
      longitude: Number(r.lon),
    }))
    .filter((p) => {
      const k = `${p.name}|${p.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export async function reversePlace(lat: number, lon: number): Promise<Place | null> {
  const url = `${NOMINATIM}/reverse?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&format=jsonv2&zoom=12&accept-language=en`;
  const r = await fetchJson<NominatimResult & { error?: string }>(url, { revalidate: CACHE.geocode });
  if (!r || r.error) return null;
  const a = r.address ?? {};
  const name = a.village || a.town || a.city || a.suburb || a.hamlet || a.municipality || r.name || "Unknown place";
  return { name, detail: a.municipality ?? a.county, latitude: lat, longitude: lon };
}
