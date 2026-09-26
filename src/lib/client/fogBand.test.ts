import { test } from "node:test";
import assert from "node:assert/strict";
import { fogBands } from "./fogBand";

const H = 3_600_000;

test("dimrisk: ytan mellan kurvorna där spridningen är högst 2 °C, med exakt gräns", () => {
  // Temperatur 10 °C, daggpunkt stiger 5 → 9 °C på 3 h: spridningen når 2 °C efter 2 h 15 min.
  const bands = fogBands([[{ t: 0, v: 10 }, { t: 3 * H, v: 10 }]], [[{ t: 0, v: 5 }, { t: 3 * H, v: 9 }]]);
  assert.equal(bands.length, 1);
  const b = bands[0];
  assert.equal(b[0].t, 2.25 * H, "börjar där spridningen passerar 2 °C");
  assert.ok(Math.abs(b[0].hi - b[0].lo - 2) < 1e-9);
  assert.equal(b.at(-1)!.t, 3 * H);
  assert.ok(b.every((p) => p.hi - p.lo <= 2 + 1e-9));
});

test("dimrisk: aldrig över luckor i data eller där bara en kurva finns", () => {
  const temp = [
    [{ t: 0, v: 5 }, { t: H, v: 5 }],
    [{ t: 3 * H, v: 5 }, { t: 4 * H, v: 5 }],
  ];
  const dew = [[{ t: 0, v: 4 }, { t: 4 * H, v: 4 }]];
  const bands = fogBands(temp, dew);
  assert.equal(bands.length, 2, "två ytor – luckan i temperaturen bryter");
  assert.ok(bands.every((b) => b.every((p) => p.t <= H || p.t >= 3 * H)));
  assert.deepEqual(fogBands(temp, []), []);
});
