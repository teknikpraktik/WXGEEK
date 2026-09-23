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

test("temperature scale: 20 °C span on multiples of 5 with 2 °C margin", () => {
  assert.deepEqual(tempScale([12, 16]), [5, 25]);
  assert.deepEqual(tempScale([-3, 1]), [-10, 10]);
  assert.deepEqual(tempTicks([-10, 10]), [-10, -5, 0, 5, 10]);
  // Larger variation than 20 °C expands in steps of 5 and never clips.
  const [lo, hi] = tempScale([-8, 21]);
  assert.ok(lo <= -10 && hi >= 23 && (hi - lo) % 5 === 0);
});

test("temperature scale is stable for small updates and shifts in 5 °C steps", () => {
  const prev: [number, number] = [5, 25];
  assert.deepEqual(tempScale([7, 23], prev), prev, "within 1 °C of the limits: unchanged");
  assert.deepEqual(tempScale([12, 24.5], prev), [10, 30], "moves up by one step");
  // An expanded span is not shrunk automatically.
  assert.deepEqual(tempScale([12, 14], [0, 30]), [0, 30]);
});
