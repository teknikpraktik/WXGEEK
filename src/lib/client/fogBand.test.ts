import { test } from "node:test";
import assert from "node:assert/strict";
import { FOG_SPREAD, fogBands, matchedRuns } from "./fogBand";

const H = 3_600_000;
const pt = (h: number, v: number) => ({ t: h * H, v });

test("dimrisk: spridning under 1 °C, med exakt gräns där spridningen passerar 1 °C", () => {
  assert.equal(FOG_SPREAD, 1);
  // Temperatur 10 °C, daggpunkt stiger 8 → 10 °C på 2 h: spridningen når 1 °C efter 1 h.
  const runs = matchedRuns([[pt(0, 10), pt(2, 10)]], [[pt(0, 8), pt(2, 10)]]);
  const bands = fogBands(runs);
  assert.equal(bands.length, 1);
  assert.equal(bands[0][0].t, 1 * H, "börjar där spridningen är exakt 1 °C");
  assert.equal(bands[0][0].hi - bands[0][0].lo, 1);
  assert.deepEqual(bands[0].at(-1), { t: 2 * H, hi: 10, lo: 10 }, "spridning 0 – kurvorna sammanfaller");
  // Spridning exakt 1 °C hela tiden: ingen dimrisk (villkoret är under 1 °C)
  assert.deepEqual(fogBands(matchedRuns([[pt(0, 10), pt(2, 10)]], [[pt(0, 9), pt(2, 9)]])), []);
});

test("bara tidsmatchade värden: samma tid i båda kurvorna krävs", () => {
  // Temperatur varje hel timme (SMHI-station), daggpunkt vid :20 och :50 (METAR) – inga par.
  const temp = [[pt(0, 10), pt(1, 10), pt(2, 10)]];
  const dew = [[pt(0 + 1 / 3, 10), pt(0 + 5 / 6, 10), pt(1 + 1 / 3, 10)]];
  assert.deepEqual(matchedRuns(temp, dew), []);
  assert.deepEqual(fogBands(matchedRuns(temp, dew)), []);
});

test("luckor överbryggas aldrig: en punkt som saknas i ena kurvan eller ett nytt segment bryter", () => {
  // Daggpunkt saknas kl 1 (METAR utan daggpunkt): temperaturen har en punkt emellan – följden bryts.
  const temp = [[pt(0, 5), pt(1, 5), pt(2, 5), pt(3, 5)]];
  const dew = [[pt(0, 5), pt(2, 5), pt(3, 5)]];
  const runs = matchedRuns(temp, dew);
  assert.deepEqual(runs.map((r) => r.map((p) => p.t / H)), [[0], [2, 3]]);
  // En ensam punkt ger ingen yta; 2–3 gör det
  assert.deepEqual(fogBands(runs).map((b) => b.map((p) => p.t / H)), [[2, 3]]);
  // Nytt segment i temperaturen (lucka i observationerna) bryter också
  const split = matchedRuns([[pt(0, 5), pt(1, 5)], [pt(3, 5), pt(4, 5)]], [[pt(0, 5), pt(1, 5), pt(3, 5), pt(4, 5)]]);
  assert.deepEqual(split.map((r) => r.map((p) => p.t / H)), [[0, 1], [3, 4]]);
  assert.deepEqual(fogBands(matchedRuns([[pt(0, 5)]], [])), []);
});
