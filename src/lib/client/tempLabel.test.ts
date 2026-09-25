import { test } from "node:test";
import assert from "node:assert/strict";
import { placeTempLabel } from "./tempLabel";

// Rityta 56–276 px; raden med OBSERVED/FORECAST slutar vid 71 px; etiketten ~34 px bred;
// punkten vid x 380, NU-linjen vid 400.
const base = { cx: 380, nowX: 400, width: 34, plotTop: 56, plotBottom: 276, labelsBottom: 71 };
const flat = (y: number) => () => y;
/** Kurva genom punkten (380, cy): lutning k px per px åt vänster, plan till höger (prognosen). */
const bend = (cy: number, k: number) => (x: number) => (x < 380 ? cy + (380 - x) * k : cy);

/** Texten (8 px hög ovanför baslinjen, 34 px bred) får inte korsa kurvan eller lämna ritytan. */
function assertClear(cy: number, curve: (x: number) => number) {
  const l = placeTempLabel({ ...base, cy, curveY: curve });
  const top = l.baseline - 8;
  for (let x = l.x - 34; x <= l.x; x++) {
    const y = curve(x);
    assert.ok(y < top - 1 || y > l.baseline + 1, `kurvan (${x}, ${y}) i texten ${top}–${l.baseline}`);
  }
  assert.ok(top >= base.plotTop && l.baseline <= base.plotBottom, "inom ritytan");
  assert.ok(l.x <= base.nowX - 4, "före NU-linjen");
  return l;
}

test("temperaturetiketten: ovanför kurvan, högerjusterad mot punkten och vänster om NU-linjen", () => {
  assert.deepEqual(placeTempLabel({ ...base, cy: 160, curveY: flat(160) }), { x: 384, baseline: 152, above: true, hideObserved: false });
  // Mätningen gjord just nu: etiketten slutar ändå före NU-linjen.
  assert.ok(placeTempLabel({ ...base, cx: 399, cy: 160, curveY: flat(160) }).x <= base.nowX - 4);
});

test("temperaturetiketten går under kurvan när temperaturen fallit mot NU", () => {
  const l = assertClear(160, bend(160, -0.8));
  assert.equal(l.above, false);
});

test("hög temperatur nära ritytans topp: under när kurvan tillåter, annars i OBSERVED-raden", () => {
  assert.equal(assertClear(74, flat(74)).above, false);
  // Punkten är fönstrets högsta och kurvan stiger in underifrån: raden med OBSERVED lånas.
  const l = assertClear(74, bend(74, 0.5));
  assert.equal(l.hideObserved, true);
  // Bara 9 px under toppen (skalan ligger kvar) och brant stigning: bredvid punkten, fri från kurvan.
  assertClear(65, bend(65, 2));
  assertClear(65, bend(65, 0.26));
});

test("låg temperatur nära ritytans botten: etiketten stannar inom ritytan och fri från kurvan", () => {
  assertClear(268, flat(268));
  assertClear(258, bend(258, -0.5));
  // 9 px över botten och brant fall in i punkten.
  assertClear(267, bend(267, -2));
  assertClear(267, bend(267, -0.26));
});
