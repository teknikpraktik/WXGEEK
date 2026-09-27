import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaf, splitTafGroups, type AwcTaf } from "../adapters/taf";
import { mergedForecastAt, tafMainAt, tafSupplementsAt, tafEndWithin } from "./forecast";
import { buildChart, cloudBaseFrac, matchedSpread, modelBaseOktas, snapshotAt } from "./timeline";
import type { ForecastPoint, WeatherBundle } from "../types";

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
    warnings: [],
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

test("BECMG: tidigare läge före intervallets mitt, nytt läge från mitten", () => {
  // BECMG 2318/2320 → 19Z
  const taf = normalizeTaf(ESNS, 20);
  const before = tafMainAt(taf, T(23, 17) * 1000)!;
  assert.equal(before.state.cavok, true);
  assert.equal(before.transition, undefined);

  const early = tafMainAt(taf, (T(23, 18) + 59 * 60) * 1000)!;
  assert.equal(early.state.cavok, true, "före mitten gäller CAVOK fortfarande");
  assert.ok(early.transition, "övergången redovisas");
  assert.equal(early.transition!.until, T(23, 19) * 1000);
  assert.equal(early.transition!.to.visibilityM, 300);

  const mid = tafMainAt(taf, T(23, 19) * 1000)!;
  assert.equal(mid.state.visibilityM, 300, "från mitten gäller det nya läget");
  assert.equal(mid.transition, undefined);
  assert.equal(mid.periodFrom, T(23, 19) * 1000);
  assert.equal(mid.state.windSpeedMs, before.state.windSpeedMs, "vinden ändras inte av BECMG utan vindgrupp");
  assert.equal(mid.state.cavok, undefined);
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
  assert.match(m.note ?? "", /TAF gives no precipitation/);
});

test("dimma i TAF:ens TEMPO (BCFG) ger dimsymbol under gruppens tid", () => {
  const taf: AwcTaf = {
    icaoId: "ESXX",
    issueTime: "2026-09-23T14:30:00.000Z",
    validTimeFrom: T(23, 15),
    validTimeTo: T(24, 15),
    rawTAF: "TAF ESXX 231430Z 2315/2415 17005KT 9999 BKN020 TEMPO 2318/2321 BCFG",
    lat: 57.7,
    lon: 12.0,
    fcsts: [
      { timeFrom: T(23, 15), timeTo: T(24, 15), timeBec: null, fcstChange: null, probability: null, wdir: 170, wspd: 5, wgst: null, visib: "6+", wxString: null, clouds: [{ cover: "BKN", base: 2000, type: null }] },
      { timeFrom: T(23, 18), timeTo: T(23, 21), timeBec: null, fcstChange: "TEMPO", probability: null, wdir: null, wspd: null, wgst: null, visib: "", wxString: "BCFG", clouds: [] },
    ],
  };
  const chart = buildChart(bundleWith(taf, smhiHours(T(23, 15), 12)), T(23, 15) * 1000);
  const fog = chart.lowVis.filter((v) => v.phenomenon);
  const hours = fog.map((v) => new Date((v.t0 + v.t1) / 2).getUTCHours());
  assert.deepEqual(hours, [18, 19, 20], "bara inom TEMPO 2318/2321");
  assert.ok(fog.every((v) => v.severe && v.label === "Fog patches (TEMPO)"));
});

// Riktig TAF från AWC 2026-09-25: dimman ska lätta till 08Z (BECMG 9999 utan NSW).
const ESOK: AwcTaf = {
  icaoId: "ESOK",
  issueTime: "2026-09-25T05:49:00.000Z",
  validTimeFrom: T(25, 6),
  validTimeTo: T(25, 15),
  rawTAF: "TAF AMD ESOK 250549Z 2506/2515 VRB03KT 0200 FG VV002 BECMG 2506/2508 9999 SCT020",
  lat: 59.44,
  lon: 13.34,
  fcsts: [
    { timeFrom: T(25, 6), timeTo: T(25, 6), timeBec: null, fcstChange: null, probability: null, wdir: "VRB", wspd: 3, wgst: null, visib: 0.12, vertVis: 200, wxString: "FG", clouds: [{ cover: "OVX", base: null, type: null }] },
    { timeFrom: T(25, 6), timeTo: T(25, 15), timeBec: T(25, 8), fcstChange: "BECMG", probability: null, wdir: "VRB", wspd: 3, wgst: null, visib: "6+", vertVis: 200, wxString: null, clouds: [{ cover: "SCT", base: 2000, type: null }] },
  ],
};

test("BECMG till sikt som utesluter dimman avslutar FG även utan NSW", () => {
  // BECMG 2506/2508 → dimman lättar i intervallets mitt, 07Z
  const taf = normalizeTaf(ESOK, 11);
  const early = (T(25, 6) + 30 * 60) * 1000;
  assert.deepEqual(tafMainAt(taf, early)!.state.phenomena?.map((p) => p.code), ["FG"], "dimma före mitten");
  const after = tafMainAt(taf, T(25, 7) * 1000)!.state;
  assert.equal(after.visibilityM, 10000);
  assert.deepEqual(after.phenomena, [], "9999 efter 0200 FG: dimman har lättat");
  // AWC för vidare VV002 till BECMG-gruppen – gruppens egen text (SCT020) gäller.
  assert.deepEqual(after.cloudLayers, [{ cover: "SCT", baseM: 610, type: undefined }]);
  assert.equal(tafMainAt(taf, early)!.state.cloudLayers?.[0].cover, "VV", "VV före mitten");

  const b = { ...bundleWith(ESOK, smhiHours(T(25, 6), 12)), forecastUntil: iso(T(25, 18)) };
  assert.deepEqual(mergedForecastAt(b, T(25, 12) * 1000).weather?.value, []);
  const fog = buildChart(b, T(25, 6) * 1000).lowVis.filter((v) => v.phenomenon);
  assert.deepEqual(
    fog.map((v) => new Date((v.t0 + v.t1) / 2).getUTCHours()),
    [6],
    "dimsymbol bara till BECMG-intervallets mitt (07Z), inte till TAF:ens slut",
  );
});

test("BECMG utan väder: dis står kvar om sikten tillåter det, nederbörd tills NSW", () => {
  const withBase = (base: string, wx: string, visib: number, becmg: string, becVis: number | string): AwcTaf => ({
    ...ESOK,
    rawTAF: `TAF ESOK 250549Z 2506/2515 VRB03KT ${base} OVC005 BECMG 2506/2508 ${becmg}`,
    fcsts: [
      { ...ESOK.fcsts[0], visib: visib, wxString: wx, clouds: [{ cover: "OVC", base: 500, type: null }] },
      { ...ESOK.fcsts[1], visib: becVis, clouds: [] },
    ],
  });
  const codes = (taf: AwcTaf) => tafMainAt(normalizeTaf(taf, 11), T(25, 9) * 1000)!.state.phenomena?.map((p) => p.code);
  assert.deepEqual(codes(withBase("3000 BR", "BR", 1.86, "4000", 2.49)), ["BR"], "dis vid 4 km är möjlig");
  assert.deepEqual(codes(withBase("3000 -RA BR", "-RA BR", 1.86, "9999", "6+")), ["-RA"], "regnet står kvar, disen lättar");
  assert.deepEqual(codes(withBase("0200 FG", "FG", 0.12, "3000", 1.86)), [], "3 km: ingen dimma (disen härleds ur sikten)");
});

test("nederbörd i prognosen: timmen som vald tid ligger i, trolig och möjlig mängd som staplarna", () => {
  // Timmen 16–17: troligen uppehåll (median 0), men upp till 0,3 mm möjligt.
  const pts = smhiHours(T(23, 15), 6).map((p, i) => ({
    ...p,
    precipitationMedianMm: 0,
    precipitationMm: i === 1 ? 0.1 : 0,
    precipitationMaxMm: i === 0 ? 0.4 : i === 1 ? 0.3 : 0,
    precipitationProbability: i === 1 ? 20 : 30,
  }));
  const b = bundleWith(null, pts);
  const half = mergedForecastAt(b, (T(23, 16) + 1800) * 1000).precipitation!.value;
  assert.deepEqual([half.from, half.to], [T(23, 16) * 1000, T(23, 17) * 1000], "16:30 → timmen 16–17, som stapeln under markören");
  assert.deepEqual([half.mm, half.possibleMm, half.probability], [0, 0.3, 20]);
  const full = mergedForecastAt(b, T(23, 16) * 1000).precipitation!.value;
  assert.equal(full.to, T(23, 16) * 1000, "hel timme → timmen som slutar då");

  const bar = buildChart(b, T(23, 15) * 1000).precipHours.find((h) => h.t0 === T(23, 16) * 1000)!;
  assert.deepEqual([bar.likely, bar.possible], [0, 0.3]);
});

test("BECMG räknas i intervallets mitt, också när AWC saknar intervallets slut", () => {
  // Riktig TAF 2026-09-26; AWC:s timeBec borttagen – sluttiden läses då ur "BECMG 2607/2609".
  const taf: AwcTaf = {
    icaoId: "ESOK",
    issueTime: "2026-09-26T05:30:00.000Z",
    validTimeFrom: T(26, 6),
    validTimeTo: T(26, 15),
    rawTAF: "TAF ESOK 260530Z 2606/2615 21005KT 9999 BKN015 PROB40 2606/2608 4000 -RADZ BKN008 BECMG 2607/2609 28012KT",
    lat: 59.44,
    lon: 13.34,
    fcsts: [
      { timeFrom: T(26, 6), timeTo: T(26, 7), timeBec: null, fcstChange: null, probability: null, wdir: 210, wspd: 5, wgst: null, visib: "6+", wxString: null, clouds: [{ cover: "BKN", base: 1500, type: null }] },
      { timeFrom: T(26, 6), timeTo: T(26, 8), timeBec: null, fcstChange: "PROB", probability: 40, wdir: null, wspd: null, wgst: null, visib: 2.49, wxString: "-RA -DZ", clouds: [{ cover: "BKN", base: 800, type: null }] },
      { timeFrom: T(26, 7), timeTo: T(26, 15), timeBec: null, fcstChange: "BECMG", probability: null, wdir: 280, wspd: 12, wgst: null, visib: "6+", wxString: null, clouds: [{ cover: "BKN", base: 1500, type: null }] },
    ],
  };
  const t = normalizeTaf(taf, 11);
  assert.equal(t.periods[2].becomingBy, new Date(T(26, 9) * 1000).toISOString());
  const during = tafMainAt(t, (T(26, 7) + 59 * 60) * 1000)!;
  assert.equal(during.state.windDirectionDeg, 210, "före mitten gäller tidigare vind");
  assert.ok(during.transition);
  assert.equal(tafMainAt(t, T(26, 8) * 1000)!.state.windDirectionDeg, 280, "ny vind från mitten, 08Z");
  assert.equal(tafMainAt(t, T(26, 12) * 1000)!.state.cloudLayers?.[0].cover, "BKN", "molnen står kvar – BECMG anger bara vind");
});

// Karlstad med METAR-station och SMHI-prognos med skikt och fuktighet – för panelerna.
function panelBundle(dew = 11): WeatherBundle {
  const station = { source: "METAR" as const, stationId: "ESOK", stationName: "Karlstad flygplats", latitude: 59.44, longitude: 13.34, distanceKm: 11 };
  const ob = (h: number, extra: object) => ({ timestamp: iso(T(25, h) + 20 * 60), source: "METAR" as const, stationId: "ESOK", latitude: 59.44, longitude: 13.34, temperatureC: 12, dewPointC: dew, ...extra });
  const pts = smhiHours(T(25, 6), 12).map((p) => ({ ...p, relativeHumidity: 90, lowCloudCoverOktas: 8, midCloudCoverOktas: 2, highCloudCoverOktas: 0 }));
  const base = bundleWith(null, pts);
  return {
    ...base,
    forecastUntil: iso(T(25, 18)),
    stations: [
      {
        key: "METAR:ESOK",
        station,
        observations: [
          ob(7, { cloudLayers: [{ cover: "FEW", baseM: 30 }, { cover: "BKN", baseM: 2500 }] }),
          ob(8, { cloudLayers: [{ cover: "OVC", baseM: 150 }] }),
        ],
      },
    ],
    selections: { temperature: { param: "temperature", stationKey: "METAR:ESOK", station, reason: "" } } as unknown as WeatherBundle["selections"],
  };
}

test("molnbas: varje METAR med alla lager observerat, SMHI:s bas med mängden i basens skikt därefter", () => {
  const chart = buildChart(panelBundle(), T(25, 9) * 1000);
  const c = chart.cloudBase;
  const obs = c.filter((x) => !x.forecast);
  // METAR 07:20: alla lager under 3 000 m; 08:20 OVC 150 m – den senaste ritad fram till NU
  assert.deepEqual(
    obs.map((h) => [new Date(h.t).getUTCHours(), h.layers.map((l) => `${l.cover} ${l.baseM}`)]),
    [
      [7, ["FEW 30", "BKN 2500"]],
      [8, ["OVC 150"]],
    ],
  );
  assert.equal(obs[0].source, "METAR");
  assert.equal(obs[1].t1, T(25, 9) * 1000, "senaste rapporten gäller fram till NU");
  assert.ok(obs[0].t0 < T(25, 7) * 1000 && obs[0].t0 > T(25, 6) * 1000, "inget före första rapporten – tomt, inte noll");
  const at = (h: number) => c.find((x) => x.t === T(25, h) * 1000 && x.forecast);
  // Prognos: SMHI:s bas 800 m med mängden låga moln (8/8), från NU
  assert.deepEqual(at(10)!.layers, [{ baseM: 800, cover: "OVC", oktas: 8 }]);
  assert.equal(at(10)!.source, "SMHI");
  assert.equal(at(9)!.t0, T(25, 9) * 1000, "prognosdelen börjar vid NU");
});

test("SMHI:s molnbas: 9999 (ingen bas) ger tom modelldel, mängden tas ur basens skikt – aldrig totalen", () => {
  const b = panelBundle();
  b.forecast!.points = b.forecast!.points.map((p, i) => (i === 3 ? { ...p, cloudBaseM: undefined, cloudCoverOktas: 5 } : p));
  const hour = buildChart(b, T(25, 9) * 1000).cloudBase.find((x) => x.t === Date.parse(b.forecast!.points[3].timestamp))!;
  assert.deepEqual(hour.layers, [], "moln men ingen bas: inget ritat");
  assert.match(hour.label, /no cloud base given/);

  assert.equal(modelBaseOktas(831, 8, 0), 8, "låg bas: låga moln");
  assert.equal(modelBaseOktas(2728, 0, 8), 8, "över 2 000 m: medelhöga moln");
  assert.equal(modelBaseOktas(1800, 0, 6), 6, "nära gränsen: det skikt som har moln");
  assert.equal(modelBaseOktas(900, 0, 6), undefined, "låg bas utan låga moln: okänd mängd");
});

test("molnbasens skala: logaritmisk från 100 m – låga höjder får mest plats", () => {
  assert.equal(cloudBaseFrac(0), 0);
  assert.equal(cloudBaseFrac(3000), 1);
  assert.equal(cloudBaseFrac(5000), 1, "över 3 000 m vid toppen");
  const f = [100, 300, 1000].map((m) => Math.round(cloudBaseFrac(m) * 100) / 100);
  assert.deepEqual(f, [0.2, 0.4, 0.7]);
});

test("symboler per tidssteg: varje timme där prognosen är timvis, glesare där den är glesare", () => {
  const start = T(25, 6);
  const pts: ForecastPoint[] = [
    ...smhiHours(start, 6).map((p) => ({ ...p, cloudCoverOktas: 2 })),
    // Efter 12Z tretimmarssteg
    ...[15, 18].map((h) => ({ timestamp: iso(T(25, h)), intervalStart: iso(T(25, h - 3)), temperatureC: 10, cloudCoverOktas: 8 })),
  ];
  const b = { ...bundleWith(null, pts), forecastUntil: iso(T(25, 19)) };
  const fcHours = buildChart(b, start * 1000).sky.filter((s) => s.forecast).map((s) => new Date(s.t).getUTCHours());
  assert.deepEqual(fcHours, [7, 8, 9, 10, 11, 12, 15, 18], "ingen interpolering mellan 12, 15 och 18");
});

test("daggpunkt: observerad ur METAR, prognos ur SMHI:s fuktighet – sammanfogade vid senaste observationen", () => {
  const b = panelBundle();
  const now = T(25, 9) * 1000;
  const chart = buildChart(b, now);
  assert.deepEqual(chart.dew.observed.flat().map((p) => p.v), [11, 11]);
  assert.deepEqual(chart.dew.forecast[0][0], { t: (T(25, 8) + 20 * 60) * 1000, v: 11 }, "prognosen börjar i senaste observationen");
  // Efter 3 h är spridningen SMHI:s (12 °C, 90 % → daggpunkt 10,4 °C)
  const dewAt = (h: number) => chart.dew.forecast.flat().find((p) => p.t === T(25, h) * 1000)!.v;
  assert.equal(dewAt(13), 10.4);
  // Avläsningen visar samma daggpunkt som kurvan vid en prognostid
  const snap = snapshotAt(b, T(25, 10) * 1000, now);
  assert.equal(snap.dewPoint?.value, dewAt(10));
  // Skalan tar med daggpunkterna
  assert.ok(chart.temp.domain[0] <= 10.4 - 1);
});

test("dimrisk i diagrammet: spridning under 1 °C – observerat där METAR:ens värden är lika, och i prognosen", () => {
  const now = T(25, 9) * 1000;
  const fog = buildChart(panelBundle(12), now).fogRisk;
  assert.equal(fog.length, 2, "observerat och prognos var för sig");
  // Observerat 09:20–10:20 lokal tid: 12/12 i samma rapporter – kurvorna sammanfaller
  assert.deepEqual(fog[0], [
    { t: (T(25, 7) + 20 * 60) * 1000, hi: 12, lo: 12 },
    { t: (T(25, 8) + 20 * 60) * 1000, hi: 12, lo: 12 },
  ]);
  // Prognosen börjar i senaste observationen och slutar där spridningen når 1 °C (SMHI 1,6 °C
  // klingar in över 3 h)
  const fc = fog[1];
  assert.equal(fc[0].t, (T(25, 8) + 20 * 60) * 1000);
  const last = fc.at(-1)!;
  assert.ok(last.t > T(25, 10) * 1000 && last.t < T(25, 11) * 1000, "slutar mellan 12 och 13 lokal tid");
  assert.ok(Math.abs(last.hi - last.lo - 1) < 1e-9);
  // 12/11 i rapporterna (spridning 1 °C): ingen dimrisk i observationerna
  assert.ok(buildChart(panelBundle(11), now).fogRisk.every((b) => b[0].t >= (T(25, 8) + 20 * 60) * 1000));
});

test("dimrisk bara med tidsmatchade värden: temperatur från SMHI-station och daggpunkt från METAR ger ingen", () => {
  const now = T(25, 9) * 1000;
  const smhiRef = { source: "SMHI" as const, stationId: "93220", stationName: "Karlstad flygplats", latitude: 59.44, longitude: 13.34, distanceKm: 11 };
  const b = panelBundle(12);
  const smhiObs = [7, 8].map((h) => ({ timestamp: iso(T(25, h)), source: "SMHI" as const, stationId: "93220", latitude: 59.44, longitude: 13.34, temperatureC: 12 }));
  const mixed: WeatherBundle = {
    ...b,
    stations: [...b.stations, { key: "SMHI:93220", station: smhiRef, observations: smhiObs }],
    selections: { temperature: { param: "temperature", stationKey: "SMHI:93220", station: smhiRef, reason: "" } } as unknown as WeatherBundle["selections"],
  };
  // Inga par i observationerna: temperaturen hel timme, daggpunkten :20
  const fog = buildChart(mixed, now).fogRisk;
  assert.ok(fog.every((band) => band[0].t >= T(25, 9) * 1000), "ingen yta före prognosens första gemensamma timme");
  // Avläsningen vid NU: ingen spridning – och alltså ingen "Fog risk"
  assert.equal(matchedSpread(snapshotAt(mixed, now, now)), undefined);
});

test("avläsningen: samma villkor som diagrammet – spridning under 1 °C med tidsmatchade värden", () => {
  const now = T(25, 9) * 1000;
  assert.equal(matchedSpread(snapshotAt(panelBundle(12), now, now)), 0);
  assert.equal(matchedSpread(snapshotAt(panelBundle(11), now, now)), 1, "1 °C är inte under 1 °C");
  // Prognos: temperatur och daggpunkt från samma SMHI-steg
  const sp = matchedSpread(snapshotAt(panelBundle(11), T(25, 14) * 1000, now));
  assert.ok(sp !== undefined && sp > 1, `${sp}`);
});
