import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaf, type AwcTaf } from "../adapters/taf";
import { normalizeMetar } from "../adapters/metar";
import { mergedForecastAt, probDecisions, probSupported, tafMainAt, wxCodes } from "./forecast";
import { buildChart, fogOf, snapshotAt, tafLowVisibility } from "./timeline";
import { fmtTime } from "../format";
import type { ForecastPoint, TafPeriod, WeatherBundle, WeatherObservation } from "../types";

// TAF-tolkningen: FM från sin tid, BECMG i intervallets mitt, PROB30/PROB40 bara när senaste
// METAR stöder gruppen och den börjar inom 3 h (eller redan pågår).

const T = (d: number, h: number, min = 0) => Date.UTC(2026, 8, d, h, min) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

/** METAR ur råtexten, via adaptern (lager, sikt, väder och VV som AWC levererar dem). */
function metar(raw: string): WeatherObservation {
  const m = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/)!;
  const body = raw.split(/\s(?:RMK|TEMPO|BECMG|NOSIG)\b/)[0];
  const clouds = [...body.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})/g)].map((c) => ({ cover: c[1], base: +c[2] * 100 }));
  return normalizeMetar({
    icaoId: "ESOK",
    obsTime: T(+m[1], +m[2], +m[3]),
    rawOb: raw,
    lat: 59.44,
    lon: 13.34,
    clouds,
    wxString: wxCodes(body).join(" ") || null,
  });
}

// Riktig TAF från AWC 2026-09-27 (AWC:s avkodning oförändrad).
const ESOK_27: AwcTaf = {
  icaoId: "ESOK",
  issueTime: "2026-09-27T05:30:00.000Z",
  validTimeFrom: T(27, 6),
  validTimeTo: T(27, 15),
  rawTAF: "TAF ESOK 270530Z 2706/2715 19004KT CAVOK PROB40 2706/2708 0100 FG VV002",
  lat: 59.44,
  lon: 13.34,
  name: "Karlstad Arpt",
  fcsts: [
    { timeFrom: T(27, 6), timeTo: T(27, 15), timeBec: null, fcstChange: null, probability: null, wdir: 190, wspd: 4, wgst: null, visib: "6+", vertVis: null, wxString: "NSW", clouds: [{ cover: "NSC", base: null, type: null }] },
    { timeFrom: T(27, 6), timeTo: T(27, 8), timeBec: null, fcstChange: "PROB", probability: 40, wdir: null, wspd: null, wgst: null, visib: 0.06, vertVis: 200, wxString: "FG", clouds: [{ cover: "OVX", base: null, type: null }] },
  ],
};

/** Samma TAF med PROB-gruppen flyttad till 12–14Z. */
const ESOK_LATE: AwcTaf = {
  ...ESOK_27,
  rawTAF: "TAF ESOK 270530Z 2706/2715 19004KT CAVOK PROB40 2712/2714 0100 FG VV002",
  fcsts: [ESOK_27.fcsts[0], { ...ESOK_27.fcsts[1], timeFrom: T(27, 12), timeTo: T(27, 14) }],
};

const FG_0300 = "METAR ESOK 270520Z AUTO 21003KT 0300 R03/1300D R21/0700N FG FEW008/// 06/06 Q1023";
const VIS_0500 = "METAR ESOK 270550Z AUTO 22004KT 0500 R03/P2000N R21/1000N NCD 08/08 Q1023";
const CAVOK = "METAR ESOK 270520Z AUTO 21003KT CAVOK 06/06 Q1023";

/** Karlstad: METAR ESOK, TAF ESOK och en klar SMHI-prognos från 05Z. */
function bundle(taf: AwcTaf, metars: string[]): WeatherBundle {
  const station = { source: "METAR" as const, stationId: "ESOK", stationName: "Karlstad flygplats", latitude: 59.44, longitude: 13.34, distanceKm: 11 };
  const sel = (param: string) => ({ param, stationKey: "METAR:ESOK", station, reason: "" });
  const points: ForecastPoint[] = Array.from({ length: 30 }, (_, i) => ({
    timestamp: iso(T(27, 5) + i * 3600),
    intervalStart: iso(T(27, 4) + i * 3600),
    temperatureC: 8,
    relativeHumidity: 90,
    windDirectionDeg: 200,
    windSpeedMs: 2,
    visibilityM: 10000,
    cloudCoverOktas: 0,
    lowCloudCoverOktas: 0,
  }));
  return {
    generatedAt: iso(T(27, 5, 30)),
    location: { latitude: 59.38, longitude: 13.5 },
    stations: [{ key: "METAR:ESOK", station, observations: metars.map(metar) }],
    selections: {
      temperature: sel("temperature"),
      wind: sel("wind"),
      gust: sel("gust"),
      visibility: sel("visibility"),
      cloudBase: sel("cloudBase"),
      phenomena: sel("phenomena"),
      precipitation: { param: "precipitation", stationKey: null, station: null, reason: "" },
    } as WeatherBundle["selections"],
    forecast: { source: "SMHI", model: "snow1g", createdTime: iso(T(27, 5)), referenceTime: iso(T(27, 5)), latitude: 59.38, longitude: 13.5, points },
    forecastUntil: iso(T(28, 5, 30)),
    taf: normalizeTaf(taf, 11),
    warnings: [],
    sources: [],
  };
}

const at = (h: number, min = 0) => T(27, h, min) * 1000;
const fogHoursLocal = (b: WeatherBundle, now: number) =>
  buildChart(b, now)
    .lowVis.filter((v) => v.forecast && v.phenomenon)
    .map((v) => fmtTime((v.t0 + v.t1) / 2));

// ---------------------------------------------------------------------------
// FM och BECMG
// ---------------------------------------------------------------------------

test("FM gäller från exakt angiven tid", () => {
  const taf: AwcTaf = {
    ...ESOK_27,
    rawTAF: "TAF ESOK 270530Z 2706/2715 19004KT 9999 SCT020 FM271130 25010KT 4000 -RA BKN008",
    fcsts: [
      { ...ESOK_27.fcsts[0], timeTo: T(27, 11, 30), visib: "6+", wxString: null, clouds: [{ cover: "SCT", base: 2000, type: null }] },
      { ...ESOK_27.fcsts[0], timeFrom: T(27, 11, 30), fcstChange: "FM", wdir: 250, wspd: 10, visib: 2.49, wxString: "-RA", clouds: [{ cover: "BKN", base: 800, type: null }] },
    ],
  };
  const t = normalizeTaf(taf, 11);
  const before = tafMainAt(t, at(11, 29))!.state;
  assert.deepEqual([before.windDirectionDeg, before.visibilityM, before.phenomena?.length], [190, 10000, 0]);
  const after = tafMainAt(t, at(11, 30))!.state;
  assert.deepEqual([after.windDirectionDeg, after.visibilityM, after.phenomena?.[0].code], [250, 4000, "-RA"]);
  assert.equal(after.cloudLayers?.[0].cover, "BKN");
});

test("BECMG gäller från intervallets mitt: BECMG 2708/2710 → 09Z", () => {
  const taf: AwcTaf = {
    ...ESOK_27,
    rawTAF: "TAF ESOK 270530Z 2706/2715 19004KT 9999 SCT020 BECMG 2708/2710 0800 BR BKN004",
    fcsts: [
      { ...ESOK_27.fcsts[0], timeTo: T(27, 8), visib: "6+", wxString: null, clouds: [{ cover: "SCT", base: 2000, type: null }] },
      { ...ESOK_27.fcsts[0], timeFrom: T(27, 8), timeBec: T(27, 10), fcstChange: "BECMG", visib: 0.5, wxString: "BR", clouds: [{ cover: "BKN", base: 400, type: null }] },
    ],
  };
  const t = normalizeTaf(taf, 11);
  const early = tafMainAt(t, at(8, 59))!;
  assert.equal(early.state.visibilityM, 10000, "före mitten gäller föregående läge");
  assert.equal(early.transition?.until, at(9));
  const mid = tafMainAt(t, at(9))!.state;
  assert.deepEqual([mid.visibilityM, mid.phenomena?.[0].code, mid.cloudLayers?.[0].cover], [800, "BR", "BKN"]);
  assert.equal(mid.windDirectionDeg, 190, "vinden står kvar – gruppen anger ingen vind");
});

// ---------------------------------------------------------------------------
// PROB40: tillämpas bara när senaste METAR stöder gruppen
// ---------------------------------------------------------------------------

test("dagens TAF: PROB40 FG tillämpas 08–10 lokal tid när METAR har dimma, därefter CAVOK", () => {
  const b = bundle(ESOK_27, [FG_0300]);
  const now = at(5, 30);
  const [d] = probDecisions(b, now);
  assert.equal(d.applied, true);
  assert.match(d.reason, /Supported by the latest METAR \(07:20\)/);

  const applied = [d.period];
  for (const t of [at(6), at(7), at(7, 59)]) {
    const m = mergedForecastAt(b, t, undefined, applied);
    assert.equal(m.visibility?.value.m, 100);
    assert.deepEqual(m.weather?.value.map((p) => p.code), ["FG"]);
    assert.deepEqual(m.clouds?.value.layers, [{ cover: "VV", baseM: 61 }]);
    assert.equal(m.visibility?.source.kind === "TAF" && m.visibility.source.group, "PROB40");
    assert.equal(m.wind?.source.kind === "TAF" && m.wind.source.group, undefined, "vinden kommer från huvudprognosen");
  }
  const after = mergedForecastAt(b, at(8), undefined, applied);
  assert.equal(after.clouds?.value.cavok, true, "08Z: CAVOK");
  assert.deepEqual(after.weather?.value, []);
  assert.equal(after.visibility?.value.m, 10000);

  // Diagrammet: dimsymbol 08 och 09 lokal tid, VV i molnbaspanelen, markering som tillämpad
  assert.deepEqual(fogHoursLocal(b, now), ["08:00", "09:00"]);
  const chart = buildChart(b, now);
  const cb = (t: number) => chart.cloudBase.find((x) => x.t === t && x.forecast)!;
  assert.deepEqual([cb(at(6)).vv, cb(at(6)).group, cb(at(6)).source], [61, "PROB40", "TAF"]);
  assert.deepEqual([cb(at(8)).vv, cb(at(8)).layers], [undefined, []]);
  assert.equal(chart.sky.find((s) => s.t === at(8))?.cavok, true);
  assert.deepEqual(
    chart.probMarks.map((p) => [p.t0, p.t1, p.applied, p.label]),
    [[at(6), at(8), true, "PROB40 FG"]],
  );

  // Avläsningen: sikten och dimman ur PROB40
  const snap = snapshotAt(b, at(7), now);
  assert.deepEqual([snap.visibility?.value.m, snap.visibility?.origin.group], [100, "PROB40"]);
  assert.deepEqual(fogOf(snap), { code: "FG", label: "Fog", severe: true, group: "PROB40" });
});

test("METAR med sikt högst 1 000 m men utan FG stöder också dimgruppen (senaste METAR 07:50, 0500)", () => {
  const b = bundle(ESOK_27, [FG_0300, VIS_0500]);
  assert.equal(probDecisions(b, at(5, 55))[0].applied, true);
});

test("METAR CAVOK: PROB40 FG tillämpas inte men markeras", () => {
  const b = bundle(ESOK_27, [CAVOK]);
  const now = at(5, 30);
  const [d] = probDecisions(b, now);
  assert.equal(d.applied, false);
  assert.match(d.reason, /Not supported by the latest METAR/);

  const m = mergedForecastAt(b, at(7), undefined, []);
  assert.equal(m.clouds?.value.cavok, true, "grundprognosen visas");
  assert.deepEqual(m.weather?.value, []);
  assert.deepEqual(fogHoursLocal(b, now), [], "ingen dimsymbol");
  const chart = buildChart(b, now);
  assert.deepEqual(
    chart.probMarks.map((p) => [p.t0, p.t1, p.applied, p.label]),
    [[at(6), at(8), false, "PROB40 FG"]],
  );
  assert.equal(chart.cloudBase.find((x) => x.t === at(7) && x.forecast)?.vv, undefined, "ingen VV i molnbasen");

  // Avläsningen visar grundprognosen; den lägre sikten står som PROB40 i undertexten
  const snap = snapshotAt(b, at(7), now);
  assert.equal(snap.visibility?.value.m, 10000);
  assert.equal(fogOf(snap), undefined);
  assert.deepEqual(tafLowVisibility(snap), { group: "PROB40", m: 100, atLeast: undefined });
});

test("PROB40 som börjar mer än 3 h efter senaste METAR tillämpas inte – förrän en senare METAR stöder den", () => {
  const b = bundle(ESOK_LATE, [FG_0300]);
  const [d] = probDecisions(b, at(5, 30));
  assert.equal(d.applied, false);
  assert.match(d.reason, /Starts more than 3 h after the latest METAR/);
  assert.equal(mergedForecastAt(b, at(13), undefined, []).clouds?.value.cavok, true);

  // 09:20Z med dimma: gruppen börjar 12Z, inom 3 h
  const later = bundle(ESOK_LATE, [FG_0300, FG_0300.replace("270520Z", "270920Z")]);
  assert.equal(probDecisions(later, at(9, 25))[0].applied, true);
});

test("tillämpningen upphör när en ny METAR inte längre stöder gruppen", () => {
  const b = bundle(ESOK_27, [FG_0300, CAVOK.replace("270520Z", "270620Z")]);
  const [d] = probDecisions(b, at(6, 25));
  assert.equal(d.applied, false);
  assert.match(d.reason, /08:20/, "beslutet gäller senaste METAR");
  assert.deepEqual(fogHoursLocal(b, at(6, 25)), []);
});

test("en METAR äldre än 2 h stöder ingen PROB-grupp", () => {
  const [d] = probDecisions(bundle(ESOK_27, [FG_0300]), at(7, 30));
  assert.equal(d.applied, false);
  assert.match(d.reason, /No recent METAR/);
});

// ---------------------------------------------------------------------------
// Stödreglerna
// ---------------------------------------------------------------------------

const group = (raw: string, p: Partial<TafPeriod>): TafPeriod => ({
  change: "PROB",
  probability: 30,
  from: iso(T(27, 6)),
  to: iso(T(27, 9)),
  summary: "",
  group: raw,
  ...p,
});
const ph = (code: string, kind: NonNullable<TafPeriod["phenomena"]>[number]["kind"]) => ({ code, kind, label: code });

test("nederbörd och åska: samma fenomen eller föregångare (VCSH för SHRA, VCTS för TS)", () => {
  const shra = group("PROB30 TEMPO 2706/2709 4000 SHRA BKN012", {
    visibilityM: 4000,
    phenomena: [ph("SHRA", "skurar")],
    cloudLayers: [{ cover: "BKN", baseM: 366 }],
    changes: ["visibility", "weather", "clouds"],
  });
  const ok = (raw: string) => probSupported(shra, metar(raw));
  assert.equal(ok("METAR ESOK 270520Z 20005KT 9999 VCSH FEW030 12/08 Q1015"), true, "VCSH");
  assert.equal(ok("METAR ESOK 270520Z 20005KT 9999 -RA BKN030 12/08 Q1015"), true, "regn – samma nederbördsslag");
  assert.equal(ok("METAR ESOK 270520Z 20005KT 9999 BKN010 12/08 Q1015"), false, "låga moln men inga skurar: gruppens väder avgör");

  const tsra = group("PROB30 TEMPO 2706/2709 TSRA", { phenomena: [ph("TSRA", "åska")], changes: ["weather"] });
  assert.equal(probSupported(tsra, metar("METAR ESOK 270520Z 20005KT 9999 VCTS SCT040CB 15/10 Q1012")), true, "VCTS");
  assert.equal(probSupported(tsra, metar("METAR ESOK 270520Z 20005KT 9999 -SHRA SCT040 15/10 Q1012")), false, "skurar utan åska");
});

test("utan väder: sikt högst 2 × gruppens, eller BKN/OVC/VV på högst 2 × gruppens höjd", () => {
  const low = group("PROB40 2706/2709 1500 BKN004", {
    visibilityM: 1500,
    cloudLayers: [{ cover: "BKN", baseM: 122 }],
    changes: ["visibility", "clouds"],
  });
  const ok = (raw: string) => probSupported(low, metar(raw));
  assert.equal(ok("METAR ESOK 270520Z 20005KT 3000 BKN030 12/11 Q1015"), true, "sikt 3 000 m ≤ 2 × 1 500 m");
  assert.equal(ok("METAR ESOK 270520Z 20005KT 9999 OVC007 12/11 Q1015"), true, "OVC 213 m ≤ 2 × 122 m");
  assert.equal(ok("METAR ESOK 270520Z 20005KT 9999 BKN009 12/11 Q1015"), false, "BKN 274 m är för högt");
  assert.equal(ok("METAR ESOK 270520Z 20005KT 9999 FEW003 12/11 Q1015"), false, "FEW räknas inte som tak");
});

test("PROB-grupp med väder över CAVOK: vädret gäller när gruppen tillämpas", () => {
  const taf: AwcTaf = {
    ...ESOK_27,
    rawTAF: "TAF ESOK 270530Z 2706/2715 19004KT CAVOK PROB30 TEMPO 2706/2709 SHRA",
    fcsts: [ESOK_27.fcsts[0], { ...ESOK_27.fcsts[1], fcstChange: "TEMPO", probability: 30, timeTo: T(27, 9), visib: null, vertVis: null, wxString: "SHRA", clouds: [] }],
  };
  const b = bundle(taf, ["METAR ESOK 270520Z 20005KT 9999 VCSH FEW030 12/08 Q1015"]);
  const [d] = probDecisions(b, at(5, 30));
  assert.equal(d.period.change, "PROB", "PROB30 TEMPO räknas som PROB");
  assert.equal(d.applied, true);
  const m = mergedForecastAt(b, at(7), undefined, [d.period]);
  assert.deepEqual(m.weather?.value.map((p) => p.code), ["SHRA"]);
  assert.equal(m.visibility?.value.m, 10000, "sikten från CAVOK står kvar");
});

test("rå TAF-grupp: väderkoder utan tid och moln", () => {
  assert.deepEqual(wxCodes("PROB40 2706/2708 0100 FG VV002"), ["FG"]);
  assert.deepEqual(wxCodes("METAR ESOK 270520Z AUTO 21003KT 0300 R03/1300D FG FEW008/// 06/06 Q1023"), ["FG"]);
  assert.deepEqual(wxCodes("TEMPO 2706/2709 4000 -SHRA VCTS BKN012CB"), ["-SHRA", "VCTS"]);
  assert.deepEqual(wxCodes("METAR ESOK 270520Z 9999 RERA NSC"), [], "tidigare väder (RE) räknas inte");
});
