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

test("temperature scale: examples of the desired framing", () => {
  assert.deepEqual(tempScale([11, 16]), [-5, 20], "mild: zero and −5 for 5 °C extra");
  assert.deepEqual(tempScale([4, 9]), [-5, 15]);
  assert.deepEqual(tempScale([-6, 3]), [-10, 10]);
  assert.deepEqual(tempScale([-23, -14]), [-30, -10], "clear cold: zero not forced");
  assert.deepEqual(tempScale([27, 36]), [20, 40], "clear heat: zero not forced");
  assert.deepEqual(tempScale([-12, 18]), [-15, 25], "large swing expands, never clips");
});

test("temperature scale handles constant, missing and extreme values", () => {
  assert.deepEqual(tempScale([12, 12, 12]), [-5, 15], "constant temperature: normal span");
  assert.deepEqual(tempScale([]), [-5, 15], "no data: fallback, never an empty span");
  assert.deepEqual(tempScale([NaN, Infinity, 5]), tempScale([5]), "non-numeric values ignored");
  const [lo, hi] = tempScale([-45, 42]);
  assert.ok(lo <= -47.5 && hi >= 44.5 && lo % 5 === 0 && hi % 5 === 0);
  for (const [a, b] of [[-40, -38], [30, 31], [0, 0], [-3, 22]]) {
    const [l, u] = tempScale([a, b]);
    assert.ok(u - l >= 20 && l <= a - 2 && u >= b + 2, `${a}…${b} → ${l}…${u}`);
  }
});

test("temperature scale is stable for small updates and never shrinks", () => {
  const prev: [number, number] = [-5, 20];
  assert.deepEqual(tempScale([-4, 19], prev), prev, "1 °C inside the limits: unchanged");
  assert.deepEqual(tempScale([12, 14], prev), prev, "narrower data: no shrink");
  const [l, u] = tempScale([12, 19.5], prev);
  assert.ok(u >= 22 && u - l >= 25, "moves when a value comes within 1 °C, keeping the span");
});

test("temperature ticks every 5 °C, sparser for very large spans", () => {
  assert.deepEqual(tempTicks([-10, 10]), [-10, -5, 0, 5, 10]);
  assert.deepEqual(tempTicks([-50, 45]), [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40]);
});
