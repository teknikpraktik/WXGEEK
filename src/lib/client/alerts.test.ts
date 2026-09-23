import { test } from "node:test";
import assert from "node:assert/strict";
import { aviationAlerts, significantItems } from "./alerts";
import { normalizeTaf, type AwcTaf } from "../adapters/taf";
import type { WeatherBundle } from "../types";

const T = (d: number, h: number) => Date.UTC(2026, 8, d, h) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

const ESGG: AwcTaf = {
  icaoId: "ESGG",
  issueTime: "2026-09-23T14:30:00.000Z",
  validTimeFrom: T(23, 15),
  validTimeTo: T(24, 15),
  rawTAF: "TAF ESGG 231430Z 2315/2415 17005KT 6000 OVC003 TEMPO 2317/2323 4000 SHRA BR SCT003 BKN020CB",
  lat: 57.66,
  lon: 12.28,
  fcsts: [
    { timeFrom: T(23, 15), timeTo: T(24, 15), timeBec: null, fcstChange: null, probability: null, wdir: 170, wspd: 5, wgst: null, visib: 3.73, wxString: null, clouds: [{ cover: "OVC", base: 300, type: null }] },
    { timeFrom: T(23, 17), timeTo: T(23, 23), timeBec: null, fcstChange: "TEMPO", probability: null, wdir: null, wspd: null, wgst: null, visib: 2.49, wxString: "SHRA BR", clouds: [{ cover: "SCT", base: 300, type: null }, { cover: "BKN", base: 2000, type: "CB" }] },
  ],
};

const bundle = (taf: AwcTaf | null): WeatherBundle =>
  ({
    generatedAt: iso(T(23, 15)),
    location: { latitude: 57.7, longitude: 12 },
    stations: [],
    selections: {},
    forecast: null,
    forecastUntil: iso(T(24, 3)),
    taf: taf ? normalizeTaf(taf, 12) : null,
    warnings: [],
    sources: [],
  }) as unknown as WeatherBundle;

test("significant items: thunderstorm, CB, low visibility, strong gusts, low ceiling", () => {
  assert.deepEqual(
    significantItems({
      phenomena: [{ kind: "åska", label: "Thunderstorm with rain" }],
      visibilityM: 800,
      windSpeedMs: 9,
      windGustMs: 15,
      cloudLayers: [{ cover: "BKN", baseM: 120 }, { cover: "SCT", baseM: 900, type: "CB" }],
    }),
    ["Thunderstorm with rain", "Visibility 800 m", "Gusts 15 m/s", "BKN at 120 m", "CB at 900 m"],
  );
  assert.deepEqual(significantItems({ visibilityM: 8000, windSpeedMs: 4, cloudLayers: [{ cover: "BKN", baseM: 600 }] }), []);
});

test("TAF: low main-forecast ceiling and TEMPO with CB become alerts with their validity", () => {
  const alerts = aviationAlerts(bundle(ESGG), T(23, 16) * 1000, T(24, 3) * 1000);
  assert.equal(alerts.length, 2);
  // OVC003 = 300 ft ≈ 90 m is a low ceiling.
  assert.equal(alerts[0].when, "TAF until Thu 24 Sep, 17:00");
  assert.ok(alerts[0].items.includes("OVC at 90 m"));
  assert.equal(alerts[1].when, "TAF TEMPO 19–01");
  assert.ok(alerts[1].items.includes("CB at 610 m"));
});

test("no TAF, no METAR → no alerts", () => {
  assert.deepEqual(aviationAlerts(bundle(null), T(23, 16) * 1000, T(24, 3) * 1000), []);
});
