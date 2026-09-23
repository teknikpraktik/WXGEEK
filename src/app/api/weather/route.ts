import { NextResponse, type NextRequest } from "next/server";
import { buildWeatherBundle } from "@/lib/server/bundle";
import { isRoughlySweden } from "@/lib/geo";

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }
  if (!isRoughlySweden(lat, lon)) {
    return NextResponse.json({ error: "WXGEEK currently covers Sweden only" }, { status: 422 });
  }
  // Avrunda till ~1 km: bättre CDN-träffar och ingen exakt position i loggar/uppströms.
  const rLat = Math.round(lat * 100) / 100;
  const rLon = Math.round(lon * 100) / 100;
  try {
    const bundle = await buildWeatherBundle(rLat, rLon);
    return NextResponse.json(bundle, {
      headers: {
        // CDN: 2 min färskt, därefter stale-while-revalidate i 5 min.
        "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    console.error("weather bundle failed", e);
    return NextResponse.json({ error: "Could not load weather data" }, { status: 502 });
  }
}
