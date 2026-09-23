import { NextResponse, type NextRequest } from "next/server";
import { reversePlace } from "@/lib/server/geocode";

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Ogiltiga koordinater" }, { status: 400 });
  }
  // ~1 km upplösning räcker för ett ortsnamn.
  const rLat = Math.round(lat * 100) / 100;
  const rLon = Math.round(lon * 100) / 100;
  try {
    const place = await reversePlace(rLat, rLon);
    return NextResponse.json(
      { place },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
    );
  } catch {
    return NextResponse.json({ place: null });
  }
}
