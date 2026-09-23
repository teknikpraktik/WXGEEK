import { NextResponse, type NextRequest } from "next/server";
import { searchPlaces } from "@/lib/server/geocode";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 80) {
    return NextResponse.json({ error: "Enter at least two characters" }, { status: 400 });
  }
  try {
    const places = await searchPlaces(q);
    return NextResponse.json(
      { places },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "Place search is not responding" }, { status: 502 });
  }
}
