import { test } from "node:test";
import assert from "node:assert/strict";
import { smhiStationName } from "./smhi-obs";

test("SMHI:s stationsnamn stavas som flygplatsnamnen i appen", () => {
  assert.equal(smhiStationName("Karlstad Flygplats"), "Karlstad flygplats");
  assert.equal(smhiStationName("  Kilsbergen-Suttarboda  A "), "Kilsbergen-Suttarboda A");
  assert.equal(smhiStationName("Flygplatsvägen"), "Flygplatsvägen", "bara hela ordet");
});
