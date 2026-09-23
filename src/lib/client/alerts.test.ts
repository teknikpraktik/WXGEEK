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

test("warnings only for weather with societal impact: TS, CB, strong wind, heavy/freezing precipitation", () => {
  assert.deepEqual(
    significantItems({
      phenomena: [
        { kind: "åska", label: "Thunderstorm with rain" },
        { kind: "regn", label: "Heavy rain", intensity: "kraftig", code: "+RA" },
        { kind: "underkylt", label: "Freezing drizzle", intensity: "måttlig", code: "FZDZ" },
      ],
      visibilityM: 800,
      windSpeedMs: 9,
      windGustMs: 22,
      cloudLayers: [
        { cover: "BKN", baseM: 120 },
        { cover: "SCT", baseM: 900, type: "CB" },
        { cover: "BKN", baseM: 1200, type: "TCU" },
      ],
    }),
    ["Thunderstorm with rain", "Heavy rain", "Freezing drizzle", "Gusts 22 m/s", "CB at 900 m"],
  );
  assert.deepEqual(significantItems({ windSpeedMs: 15 }), ["Wind 15 m/s"]);
});

test("fog, low visibility, low cloud, moderate precipitation and fresh wind are not warnings", () => {
  assert.deepEqual(
    significantItems({
      phenomena: [
        { kind: "dimma", label: "Fog", code: "FG" },
        { kind: "regn", label: "Rain", intensity: "måttlig", code: "RA" },
        { kind: "hagel", label: "Small hail showers", intensity: "måttlig", code: "SHGS" },
      ],
      visibilityM: 300,
      windSpeedMs: 12,
      windGustMs: 18,
      cloudLayers: [
        { cover: "OVC", baseM: 120 },
        { cover: "VV", baseM: 60 },
      ],
    }),
    [],
  );
});

test("TAF: a low ceiling is not a warning, TEMPO with CB is – with its validity", () => {
  const alerts = aviationAlerts(bundle(ESGG), T(23, 16) * 1000, T(24, 3) * 1000);
  // OVC003 (≈ 90 m) in the main forecast gives no warning.
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].when, "TAF TEMPO 19–01");
  assert.deepEqual(alerts[0].items, ["CB at 610 m"]);
});

test("no TAF, no METAR → no alerts", () => {
  assert.deepEqual(aviationAlerts(bundle(null), T(23, 16) * 1000, T(24, 3) * 1000), []);
});
