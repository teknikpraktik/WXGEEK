import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaf, splitTafGroups, type AwcTaf } from "../adapters/taf";
import { mergedForecastAt, tafMainAt, tafSupplementsAt, tafEndWithin } from "./forecast";
import type { ForecastPoint, WeatherBundle } from "../types";

const H = 3_600_000;
const T = (d: number, h: number) => Date.UTC(2026, 8, d, h) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

// Riktiga TAF:er från AWC 2026-09-23 (avkodningen som AWC levererar den).
const ESGG: AwcTaf = {
  icaoId: "ESGG",
  issueTime: "2026-09-23T14:30:00.000Z",
  validTimeFrom: T(23, 15),
  validTimeTo: T(24, 15),
  rawTAF:
    "TAF ESGG 231430Z 2315/2415 17005KT 6000 OVC003 TEMPO 2315/2317 1200 RA BR OVC005 TEMPO 2317/2323 4000 SHRA BR SCT003 BKN020CB BECMG 2323/2401 BKN030 PROB40 2401/2412 BKN007",
  lat: 57.66,
  lon: 12.28,
  name: "Goteborg/Landvetter",
  fcsts: [
    { timeFrom: T(23, 15), timeTo: T(23, 23), timeBec: null, fcstChange: null, probability: null, wdir: 170, wspd: 5, wgst: null, visib: 3.73, wxString: null, clouds: [{ cover: "OVC", base: 300, type: null }] },
    { timeFrom: T(23, 15), timeTo: T(23, 17), timeBec: null, fcstChange: "TEMPO", probability: null, wdir: null, wspd: null, wgst: null, visib: 0.75, wxString: "RA BR", clouds: [{ cover: "OVC", base: 500, type: null }] },
    { timeFrom: T(23, 17), timeTo: T(23, 23), timeBec: null, fcstChange: "TEMPO", probability: null, wdir: null, wspd: null, wgst: null, visib: 2.49, wxString: "SHRA BR", clouds: [{ cover: "SCT", base: 300, type: null }, { cover: "BKN", base: 2000, type: "CB" }] },
    { timeFrom: T(23, 23), timeTo: T(24, 15), timeBec: T(24, 1), fcstChange: "BECMG", probability: null, wdir: 170, wspd: 5, wgst: null, visib: 3.73, wxString: null, clouds: [{ cover: "BKN", base: 3000, type: null }] },
    { timeFrom: T(24, 1), timeTo: T(24, 12), timeBec: null, fcstChange: "PROB", probability: 40, wdir: null, wspd: null, wgst: null, visib: "", wxString: null, clouds: [{ cover: "BKN", base: 700, type: null }] },
  ],
};

const ESNS: AwcTaf = {
  icaoId: "ESNS",
  issueTime: "2026-09-23T14:30:00.000Z",
  validTimeFrom: T(23, 15),
  validTimeTo: T(23, 22),
  rawTAF: "TAF ESNS 231430Z 2315/2322 17007KT CAVOK BECMG 2318/2320 0300 FG VV002",
  lat: 64.62,
  lon: 21.08,
  fcsts: [
    { timeFrom: T(23, 15), timeTo: T(23, 18), timeBec: null, fcstChange: null, probability: null, wdir: 170, wspd: 7, wgst: null, visib: "6+", wxString: "NSW", clouds: [{ cover: "NSC", base: null, type: null }] },
    { timeFrom: T(23, 18), timeTo: T(23, 22), timeBec: T(23, 20), fcstChange: "BECMG", probability: null, wdir: 170, wspd: 7, wgst: null, visib: 0.19, wxString: "FG", clouds: [{ cover: "OVX", base: null, type: null }] },
  ],
};

function bundleWith(taf: AwcTaf | null, pts: ForecastPoint[]): WeatherBundle {
  return {
    generatedAt: iso(T(23, 15)),
    location: { latitude: 57.7, longitude: 12.0 },
    stations: [],
    selections: {} as WeatherBundle["selections"],
    forecast: { source: "SMHI", model: "snow1g", createdTime: iso(T(23, 14)), referenceTime: iso(T(23, 14)), latitude: 57.7, longitude: 12.0, points: pts },
    forecastUntil: iso(T(24, 3)),
    taf: taf ? normalizeTaf(taf, 12) : null,
    sources: [],
  };
}

const smhiHours = (from: number, n: number): ForecastPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: iso(from + (i + 1) * 3600),
    intervalStart: iso(from + i * 3600),
    temperatureC: 12,
    windDirectionDeg: 200,
    windSpeedMs: 3,
    visibilityM: 10000,
    cloudBaseM: 800,
    cloudCoverOktas: 6,
    precipitationMm: 0,
  }));

test("rå-TAF delas i samma grupper som AWC:s avkodning", () => {
  assert.equal(splitTafGroups(ESGG.rawTAF).length, ESGG.fcsts.length);
  assert.equal(splitTafGroups(ESNS.rawTAF).length, ESNS.fcsts.length);
  assert.deepEqual(splitTafGroups("TAF X 1Z 0100/0106 10005KT 9999 FEW020 PROB30 TEMPO 0102/0104 SHRA"), [
    "X 1Z 0100/0106 10005KT 9999 FEW020",
    "PROB30 TEMPO 0102/0104 SHRA",
  ]);
});

test("CAVOK, VV och sikt i meter läses ur råtexten", () => {
  const taf = normalizeTaf(ESNS, 20);
  assert.equal(taf.periods[0].cavok, true);
  assert.equal(taf.periods[0].visibilityM, 10000);
  const becmg = taf.periods[1];
  assert.equal(becmg.visibilityM, 300);
  assert.equal(becmg.cloudLayers?.[0].cover, "VV");
  assert.equal(becmg.cloudLayers?.[0].baseM, 61); // VV002 = 200 ft
  assert.deepEqual(becmg.changes?.sort(), ["clouds", "visibility", "weather"]);
});

test("BECMG: tidigare läge under övergången, nytt läge först efter becomingBy", () => {
  const taf = normalizeTaf(ESNS, 20);
  const before = tafMainAt(taf, T(23, 17) * 1000)!;
  assert.equal(before.state.cavok, true);
  assert.equal(before.transition, undefined);

  const during = tafMainAt(taf, T(23, 19) * 1000)!;
  assert.equal(during.state.cavok, true, "under övergången gäller CAVOK fortfarande");
  assert.ok(during.transition, "övergången redovisas");
  assert.equal(during.transition!.until, T(23, 20) * 1000);
  assert.equal(during.transition!.to.visibilityM, 300);

  const after = tafMainAt(taf, T(23, 21) * 1000)!;
  assert.equal(after.state.visibilityM, 300);
  assert.equal(after.state.windSpeedMs, before.state.windSpeedMs, "vinden ändras inte av BECMG utan vindgrupp");
  assert.equal(after.state.cavok, undefined);
});

test("BECMG med bara moln behåller vind och sikt från huvudprognosen", () => {
  const taf = normalizeTaf(ESGG, 12);
  const after = tafMainAt(taf, T(24, 2) * 1000)!;
  assert.deepEqual(after.state.changes, ["clouds"]);
  assert.equal(after.state.cloudLayers?.[0].baseM, 914); // BKN030
  assert.equal(after.state.visibilityM, 6000);
});

test("TAF gäller inte utanför giltighetstiden och dras inte ut", () => {
  const taf = normalizeTaf(ESNS, 20);
  assert.equal(tafMainAt(taf, T(23, 22) * 1000), null);
  assert.equal(tafMainAt(taf, T(23, 14) * 1000), null);
});

test("TEMPO och PROB är kompletterande grupper, inte värden", () => {
  const taf = normalizeTaf(ESGG, 12);
  const sup = tafSupplementsAt(taf, T(23, 16) * 1000);
  assert.equal(sup.length, 1);
  assert.equal(sup[0].change, "TEMPO");
  // Huvudprognosens sikt påverkas inte av TEMPO 1200 m.
  assert.equal(tafMainAt(taf, T(23, 16) * 1000)!.state.visibilityM, 6000);
  const prob = tafSupplementsAt(taf, T(24, 5) * 1000);
  assert.equal(prob[0].change, "PROB");
  assert.equal(prob[0].probability, 40);
  assert.match(prob[0].summary, /210 m/, "PROB-texten anger vad sannolikheten gäller (BKN007 = 700 fot ≈ 210 m)");
});

test("TAF först för vind/sikt/moln/väder; SMHI för temperatur och nederbörd; SMHI efter TAF:s slut", () => {
  const b = bundleWith(ESNS, smhiHours(T(23, 15), 12));
  const inTaf = mergedForecastAt(b, T(23, 16) * 1000);
  assert.equal(inTaf.wind?.source.kind, "TAF");
  assert.equal(inTaf.visibility?.source.kind, "TAF");
  assert.equal(inTaf.clouds?.value.cavok, true);
  assert.equal(inTaf.clouds?.value.baseM, undefined, "ingen påhittad molnbas vid CAVOK");
  assert.equal(inTaf.temperature?.source.kind, "SMHI-PROGNOS");
  assert.equal(inTaf.precipitation?.source.kind, "SMHI-PROGNOS");

  const afterTaf = mergedForecastAt(b, T(23, 23) * 1000);
  assert.equal(afterTaf.wind?.source.kind, "SMHI-PROGNOS");
  assert.equal(afterTaf.clouds?.source.kind, "SMHI-PROGNOS");
  assert.equal(tafEndWithin(b, T(23, 15) * 1000, T(24, 3) * 1000), T(23, 22) * 1000);
});

test("utan TAF används SMHI för allt", () => {
  const m = mergedForecastAt(bundleWith(null, smhiHours(T(23, 15), 6)), T(23, 17) * 1000);
  assert.equal(m.wind?.source.kind, "SMHI-PROGNOS");
  assert.equal(m.visibility?.source.kind, "SMHI-PROGNOS");
  assert.deepEqual(m.supplements, []);
});

test("variabel som TAF saknar kompletteras av SMHI", () => {
  const noVis: AwcTaf = {
    ...ESNS,
    rawTAF: "TAF ESNS 231430Z 2315/2322 17007KT SCT030",
    fcsts: [{ ...ESNS.fcsts[0], visib: null, wxString: null, clouds: [{ cover: "SCT", base: 3000, type: null }] }],
  };
  const m = mergedForecastAt(bundleWith(noVis, smhiHours(T(23, 15), 6)), T(23, 17) * 1000);
  assert.equal(m.wind?.source.kind, "TAF");
  assert.equal(m.visibility?.source.kind, "SMHI-PROGNOS");
});

test("motsägelse mellan TAF och SMHI om nederbörd förklaras", () => {
  const pts = smhiHours(T(23, 15), 6).map((p) => ({ ...p, precipitationMm: 0.6 }));
  const m = mergedForecastAt(bundleWith(ESNS, pts), T(23, 16) * 1000);
  assert.match(m.note ?? "", /TAF anger ingen nederbörd/);
});
