import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceLine, type SourceItem } from "./sourceLine";
import type { Origin } from "./timeline";

const Z = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h, m); // september, UTC
const metar = (t: number, stationName: string | undefined = "Karlstad flygplats"): Origin => ({ kind: "METAR", stationId: "ESOK", stationName, timestamp: t });
const smhi = (t: number, stationName = "Kilsbergen-Suttarboda A"): Origin => ({ kind: "SMHI", stationId: "94180", stationName, timestamp: t });
const items = (o: Origin, ...what: string[]): SourceItem[] => what.map((w) => ({ what: w, origin: o }));

test("en källa: mättid i lokal tid (sommartid) och stationens namn", () => {
  const o = metar(Z(25, 7, 20));
  assert.equal(
    sourceLine("now", Z(25, 7, 41), Z(25, 7, 41), items(o, "temperature", "dew point", "wind", "visibility", "clouds")),
    "Observed at 09:20 local time · Karlstad flygplats",
  );
});

test("vintertid: UTC+1", () => {
  const t = Date.UTC(2026, 0, 15, 8, 20);
  assert.equal(sourceLine("now", t, t, items(metar(t), "temperature", "wind")), "Observed at 09:20 local time · Karlstad flygplats");
});

test("värden från andra stationer eller tider tillskrivs inte huvudkällan", () => {
  const line = sourceLine("now", Z(25, 7, 41), Z(25, 7, 41), [
    ...items(metar(Z(25, 7, 20), "Örebro flygplats"), "temperature", "wind", "visibility", "clouds"),
    ...items(smhi(Z(25, 7)), "precipitation"),
  ]);
  assert.equal(line, "Observed at 09:20 local time · Örebro flygplats; precipitation 08–09 · Kilsbergen-Suttarboda A");

  const mixed = sourceLine("now", Z(25, 7, 41), Z(25, 7, 41), [
    ...items(smhi(Z(25, 7)), "temperature", "dew point"),
    ...items(metar(Z(25, 7, 20)), "wind", "gusts", "visibility", "clouds"),
  ]);
  assert.equal(mixed, "Observed at 09:20 local time · Karlstad flygplats; temperature at 09:00 · Kilsbergen-Suttarboda A");
});

test("byar och daggpunkt nämns bara när de har en egen källa", () => {
  const line = sourceLine("now", Z(25, 7, 41), Z(25, 7, 41), [
    ...items(metar(Z(25, 7, 20)), "temperature", "dew point", "wind", "visibility", "clouds"),
    ...items(smhi(Z(25, 7)), "gusts"),
  ]);
  assert.equal(line, "Observed at 09:20 local time · Karlstad flygplats; gusts at 09:00 · Kilsbergen-Suttarboda A");
});

test("datum när observationen är från en annan lokal dag än nu", () => {
  // 23:50 lokal tid den 24:e, nu 00:10 den 25:e (samma UTC-dag, olika lokal dag)
  assert.equal(
    sourceLine("now", Z(24, 22, 10), Z(24, 22, 10), items(metar(Z(24, 21, 50)), "temperature")),
    "Observed on Thu 24 Sep at 23:50 local time · Karlstad flygplats",
  );
});

test("saknad metadata: ingen påhittad station eller tid", () => {
  const t = Z(25, 7, 20);
  assert.equal(sourceLine("now", t, t, items({ kind: "METAR", stationId: "ESOK", timestamp: t }, "wind")), "Observed at 09:20 local time · ESOK");
  assert.equal(sourceLine("now", t, t, items({ kind: "SMHI", timestamp: t }, "wind")), "Observed at 09:20 local time");
  assert.equal(sourceLine("now", t, t, []), "");
});

test("prognos: källorna med vad de gäller, inga observationer", () => {
  const taf: Origin = { kind: "TAF", stationId: "ESOK", stationName: "Karlstad flygplats", timestamp: Z(25, 6), validFrom: Z(25, 8), validTo: Z(25, 15) };
  const s: Origin = { kind: "SMHI-PROGNOS", latitude: 59.4, longitude: 13.5, timestamp: Z(25, 12) };
  const line = sourceLine("forecast", Z(25, 12), Z(25, 7, 41), [
    ...items(s, "temperature", "dew point"),
    ...items(taf, "wind", "visibility", "clouds"),
    ...items({ ...s, timestamp: Z(25, 13) }, "precipitation"),
  ]);
  assert.equal(line, "Forecast for 14:00 · TAF Karlstad flygplats; temperature, precipitation · SMHI");
  assert.equal(
    sourceLine("forecast", Z(26, 2, 30), Z(25, 7, 41), items(s, "temperature")),
    "Forecast for Sat 26 Sep at 04:30 · SMHI",
  );
});
