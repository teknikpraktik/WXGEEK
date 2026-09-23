import { test } from "node:test";
import assert from "node:assert/strict";
import { dewPointFromMetar, relativeHumidity } from "./explain";

test("dew point is read from the raw METAR", () => {
  assert.equal(dewPointFromMetar("METAR ESGP 231850Z AUTO 16005KT 9000 -RA OVC019 15/14 Q1015"), 14);
  assert.equal(dewPointFromMetar("METAR ESSA 010650Z 36010KT CAVOK M02/M05 Q1030"), -5);
  assert.equal(dewPointFromMetar("METAR ESSA 010650Z 36010KT CAVOK Q1030"), undefined);
});

test("relative humidity from temperature and dew point", () => {
  assert.equal(relativeHumidity(15, 15), 100);
  assert.equal(relativeHumidity(15, 14), 94);
  assert.ok(relativeHumidity(25, 5) < 30);
});
