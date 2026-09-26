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

test("temperature scale: autoscaled with at least 10°, 0° included when the lowest value is within 5°", () => {
  assert.deepEqual(tempScale([11, 16]), [8, 20], "mild: no zero, 1° margin, even steps");
  assert.deepEqual(tempScale([4, 9]), [0, 10], "within 5° of zero: 0° is the bottom");
  assert.deepEqual(tempScale([-4, -1]), [-10, 0], "just below zero: 0° is the top");
  assert.deepEqual(tempScale([-6, 3]), [-8, 4], "crossing zero");
  assert.deepEqual(tempScale([-23, -14]), [-24, -12], "clear cold: zero not forced");
  assert.deepEqual(tempScale([27, 36]), [26, 38], "clear heat: zero not forced");
  assert.deepEqual(tempScale([-12, 18]), [-15, 20], "large swing: 5° steps, never clips");
});

test("temperature scale handles constant, missing and extreme values", () => {
  assert.deepEqual(tempScale([12, 12, 12]), [6, 18], "constant temperature: minimum span");
  assert.deepEqual(tempScale([]), [0, 10], "no data: fallback, never an empty span");
  assert.deepEqual(tempScale([NaN, Infinity, 5]), tempScale([5]), "non-numeric values ignored");
  assert.deepEqual(tempScale([-45, 42]), [-50, 50]);
  for (const [a, b] of [[-40, -38], [30, 31], [0, 0], [-3, 22], [0.5, 3]]) {
    const [l, u] = tempScale([a, b]);
    assert.ok(u - l >= 10 && l <= a - 1 && u >= b + 1, `${a}…${b} → ${l}…${u}`);
    if (Math.abs(a) <= 5) assert.ok(l <= 0 && u >= 0, `0° included for ${a}…${b}`);
  }
});

test("temperature scale is stable for small updates and never shrinks", () => {
  const prev: [number, number] = [0, 10];
  assert.deepEqual(tempScale([2, 8], prev), prev, "inside the limits: unchanged");
  assert.deepEqual(tempScale([4, 5], prev), prev, "narrower data: no shrink");
  const [l, u] = tempScale([2, 9.8], prev);
  assert.ok(u >= 10.8 && u - l >= 10, "moves when a value comes within 0.5 °C, keeping the span");
});

test("temperature ticks every 2 °C, sparser for larger spans", () => {
  assert.deepEqual(tempTicks([0, 10]), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(tempTicks([-15, 20]), [-15, -10, -5, 0, 5, 10, 15, 20]);
  assert.deepEqual(tempTicks([-50, 50]), [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]);
});
