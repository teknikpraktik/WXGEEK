import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChart, modeAt, segments, snapshotAt } from "./timeline";
import type { WeatherBundle, WeatherObservation } from "../types";

const H = 3_600_000;
const now = Date.UTC(2026, 8, 23, 14, 0);
const iso = (t: number) => new Date(t).toISOString();
const station = { source: "METAR" as const, stationId: "ESXX", stationName: "Test", latitude: 59, longitude: 13, distanceKm: 5 };
const sel = (param: string, key: string | null) => ({ param, stationKey: key, station: key ? station : null, reason: "" });

function bundle(obs: WeatherObservation[], precipStation = false): WeatherBundle {
  return {
    generatedAt: iso(now),
    location: { latitude: 59, longitude: 13 },
    stations: [{ key: "METAR:ESXX", station, observations: obs }],
    selections: {
      temperature: sel("temperature", "METAR:ESXX"),
      wind: sel("wind", "METAR:ESXX"),
      gust: sel("gust", "METAR:ESXX"),
      visibility: sel("visibility", "METAR:ESXX"),
      cloudBase: sel("cloudBase", "METAR:ESXX"),
      phenomena: sel("phenomena", "METAR:ESXX"),
      precipitation: sel("precipitation", precipStation ? "METAR:ESXX" : null),
    },
    forecast: null,
    forecastUntil: iso(now + 12 * H),
    taf: null,
    sources: [],
  } as WeatherBundle;
}

const ob = (t: number, temperatureC: number): WeatherObservation => ({
  timestamp: iso(t),
  source: "METAR",
  stationId: "ESXX",
  latitude: 59,
  longitude: 13,
  temperatureC,
  windSpeedMs: 3,
  windDirectionDeg: 180,
});

test("läge: senaste observation vid NU, observerat bakåt, prognos framåt", () => {
  assert.equal(modeAt(now, now), "now");
  assert.equal(modeAt(now - 2 * H, now), "observed");
  assert.equal(modeAt(now + 2 * H, now), "forecast");
});

test("NU visar senaste observation med dess faktiska tid", () => {
  const b = bundle([ob(now - 3 * H, 10), ob(now - 25 * 60 * 1000, 12)]);
  const s = snapshotAt(b, now, now);
  assert.equal(s.temperature?.value, 12);
  assert.equal(s.temperature?.origin.timestamp, now - 25 * 60 * 1000);
});

test("för gammal observation presenteras inte som en mätning nu", () => {
  const b = bundle([ob(now - 3 * H, 10)]);
  assert.equal(snapshotAt(b, now, now).temperature, null);
});

test("observerat läge väljer observationen närmast vald tid, inom tolerans", () => {
  const b = bundle([ob(now - 4 * H, 8), ob(now - 3 * H, 9)]);
  assert.equal(snapshotAt(b, now - 3 * H - 10 * 60 * 1000, now).temperature?.value, 9);
  // Ingen observation inom ±35 min → saknas, inte närmaste långt bort.
  assert.equal(snapshotAt(b, now - 6 * H, now).temperature, null);
});

test("saknad nederbördsmätare ger 'saknas', inte noll", () => {
  const b = bundle([ob(now - 20 * 60 * 1000, 12)], false);
  assert.equal(snapshotAt(b, now, now).precipitation, null);
});

test("luckor i historiken dras inte ihop och fylls inte med prognos", () => {
  const segs = segments(
    [
      { t: 0, v: 1 },
      { t: H, v: 2 },
      { t: 5 * H, v: 3 },
    ],
    100 * 60 * 1000,
  );
  assert.equal(segs.length, 2);
  const chart = buildChart(bundle([ob(now - 10 * H, 5), ob(now - 9.5 * H, 5), ob(now - 2 * H, 8)]), now);
  assert.equal(chart.temp.observed.length, 2, "luckan mellan -9,5 h och -2 h syns");
  assert.equal(chart.temp.forecast.length, 0, "ingen prognos när SMHI saknas");
  assert.equal(chart.missing.forecast, "Prognos saknas");
});
