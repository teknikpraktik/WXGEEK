import { test } from "node:test";
import assert from "node:assert/strict";
import { skyOf, tempScale, tempTicks } from "./timeline";

test("cloud symbol uses the largest category among layers, never summed", () => {
  assert.equal(skyOf({ layers: [{ cover: "FEW", baseM: 150 }, { cover: "OVC", baseM: 900 }] }).kind, "OVC");
  assert.equal(skyOf({ layers: [{ cover: "SCT", baseM: 300 }, { cover: "SCT", baseM: 1200 }] }).kind, "SCT");
  assert.equal(skyOf({ layers: [{ cover: "BKN", baseM: 480, type: "CB" }] }).kind, "BKN");
});

test("CAVOK, NSC and missing data are never shown as clear sky", () => {
  assert.equal(skyOf({ cavok: true }).kind, "CAVOK");
  assert.deepEqual(skyOf({ cavok: true }, 3), { kind: "SCT", fromSmhi: true, cavok: true });
  assert.equal(skyOf({ cavok: true }, 0).kind, "SKC");
  assert.equal(skyOf({ nsc: true }).kind, "NSC");
  assert.equal(skyOf(undefined).kind, "MISSING");
  assert.equal(skyOf({ baseM: 480 }).kind, "UNKNOWN");
  assert.equal(skyOf({ clear: true }).kind, "SKC");
  assert.equal(skyOf({ oktas: 0 }).kind, "SKC");
  assert.equal(skyOf({ oktas: 6 }).kind, "BKN");
});

test("temperature scale is fixed per season", () => {
  assert.deepEqual(tempScale([12, 16], 8), [-5, 20], "autumn");
  assert.deepEqual(tempScale([12, 16], 3), [-5, 20], "spring");
  assert.deepEqual(tempScale([12, 16], 6), [0, 30], "summer");
  assert.deepEqual(tempScale([-3, 1], 0), [-20, 10], "winter");
  assert.deepEqual(tempTicks([-5, 20]), [-5, 0, 5, 10, 15, 20]);
});

test("temperature scale expands in 5 °C steps with 2 °C margin and never shrinks", () => {
  assert.deepEqual(tempScale([12, 19], 8), [-5, 25], "19 °C + margin exceeds 20");
  assert.deepEqual(tempScale([-24, 0], 1), [-30, 10]);
  assert.deepEqual(tempScale([12, 14], 8, [-5, 25]), [-5, 25], "previous expansion is kept");
});
