import { test } from "node:test";
import assert from "node:assert/strict";
import { CIVIL_ALT, SUNRISE_ALT, nightProfile, solarElevation, sunEvents } from "./sun";

const MIN = 60_000;
const H = 60 * MIN;
const local = (t: number) => new Date(t).toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => Date.parse(iso); // lokal midnatt uttryckt i UTC
const events = (lat: number, lon: number, from: number, hours = 24) => sunEvents(lat, lon, from, from + hours * H);

test("soluppgång och solnedgång stämmer med publicerade tider (±1 min)", () => {
  // Malmö midsommar: 04:24 och 21:55 (timeanddate.com)
  const malmo = events(55.605, 13.0, day("2026-06-20T22:00:00Z"));
  const near = (t: number | undefined, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const [lh, lm] = local(t!).split(":").map(Number);
    return Math.abs(lh * 60 + lm - (h * 60 + m)) <= 1;
  };
  assert.ok(near(malmo.find((e) => e.kind === "sunrise")?.t, "04:24"));
  assert.ok(near(malmo.find((e) => e.kind === "sunset")?.t, "21:55"));
  // Karlstad kring höstdagjämningen: soluppgång 06:50 den 22 september (timeanddate.com)
  const ksd = events(59.379, 13.504, day("2026-09-21T22:00:00Z"));
  assert.ok(near(ksd.find((e) => e.kind === "sunrise")?.t, "06:50"));
});

test("händelserna ligger där solhöjden passerar gränserna, i rätt ordning", () => {
  const ev = events(59.33, 18.07, day("2026-09-24T22:00:00Z"));
  assert.deepEqual(ev.map((e) => e.kind), ["dawn", "sunrise", "sunset", "dusk"]);
  for (const e of ev) {
    const alt = e.kind === "dawn" || e.kind === "dusk" ? CIVIL_ALT : SUNRISE_ALT;
    assert.ok(Math.abs(solarElevation(59.33, 18.07, e.t) - alt) < 0.01, `${e.kind} vid ${alt}°`);
  }
});

test("midnattssol och polarnatt: inga påhittade händelser", () => {
  const summer = day("2026-06-20T22:00:00Z");
  assert.deepEqual(events(67.855, 20.225, summer), [], "Kiruna vid midsommar: solen går aldrig ned");
  assert.ok(nightProfile(67.855, 20.225, summer, summer + 24 * H).every((p) => p.n === 0), "dag hela dygnet");

  const winter = day("2026-12-20T23:00:00Z");
  const ev = events(67.855, 20.225, winter);
  assert.deepEqual(ev.map((e) => e.kind), ["dawn", "dusk"], "Kiruna vid vintersolståndet: bara borgerlig gryning och skymning mitt på dagen");
  const noon = nightProfile(67.855, 20.225, winter, winter + 24 * H).filter((p) => p.t > ev[0].t && p.t < ev[1].t);
  assert.ok(noon.every((p) => p.n > 0 && p.n < 1), "skymningsljus, varken dag eller natt");
});

test("ljusa sommarnätter: skymning hela natten, aldrig full natt", () => {
  const from = day("2026-06-20T22:00:00Z");
  const ev = events(65.584, 22.154, from); // Luleå
  assert.deepEqual(ev.map((e) => e.kind), ["sunset", "sunrise"]);
  const night = nightProfile(65.584, 22.154, from, from + 24 * H);
  assert.ok(Math.max(...night.map((p) => p.n)) < 1);
});

test("nattgraden över midnatt: natt, gryning, dag, skymning, natt – utan hopp", () => {
  const from = day("2026-09-24T22:00:00Z") - 6 * H; // 18:00 dagen före
  const pts = nightProfile(59.379, 13.504, from, from + 36 * H);
  assert.equal(pts[0].n, 0, "dag kl. 18");
  assert.ok(pts.some((p) => p.n === 1), "natt");
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / MIN;
    // Under gryning och skymning högst 5 min mellan punkterna och små steg
    if (pts[i].n !== pts[i - 1].n) assert.ok(dt <= 5.01 && Math.abs(pts[i].n - pts[i - 1].n) < 0.2, `steg vid ${local(pts[i].t)}`);
  }
});
