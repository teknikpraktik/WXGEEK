import { test } from "node:test";
import assert from "node:assert/strict";
import { CIVIL_ALT, SUNRISE_ALT, solarElevation, sunEvents, sunPath } from "./sun";

const MIN = 60_000;
const H = 60 * MIN;
const local = (t: number) => new Date(t).toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** Inom en minut från den väntade lokala tiden */
const near = (t: number | undefined, hhmm: string) => t !== undefined && Math.abs(minutes(local(t)) - minutes(hhmm)) <= 1;
const KSD = [59.38, 13.5] as const;
/** Dygnets högsta solhöjd (grader), ur banan var 10:e minut */
const noonAlt = (lat: number, lon: number, dayStartUtc: number) => Math.max(...sunPath(lat, lon, dayStartUtc, dayStartUtc + 24 * H).map((p) => p.alt));
const kinds = (ev: Array<{ kind: string }>) => ev.map((e) => e.kind);

test("Karlstad 26 september 2026: soluppgång 06:59, solnedgång 18:54, middagshöjd 29–30°", () => {
  const day = Date.UTC(2026, 8, 25, 22); // lokal midnatt
  const ev = sunEvents(...KSD, day, day + 24 * H);
  assert.deepEqual(kinds(ev), ["dawn", "sunrise", "sunset", "dusk"]);
  const at = (k: string) => ev.find((e) => e.kind === k)?.t;
  assert.ok(near(at("sunrise"), "06:59"), `soluppgång ${local(at("sunrise")!)}`);
  assert.ok(near(at("sunset"), "18:54"), `solnedgång ${local(at("sunset")!)}`);
  const max = noonAlt(...KSD, day);
  assert.ok(max >= 29 && max <= 30, `middagshöjd ${max.toFixed(2)}°`);
});

test("fast skala året runt: middagshöjd ~7° vid vintersolståndet och ~54° vid sommarsolståndet", () => {
  const dec = noonAlt(...KSD, Date.UTC(2026, 11, 20, 23));
  const jun = noonAlt(...KSD, Date.UTC(2026, 5, 20, 22));
  assert.ok(Math.abs(dec - 7) < 0.6, `21 dec ${dec.toFixed(2)}°`);
  assert.ok(Math.abs(jun - 54) < 0.6, `21 jun ${jun.toFixed(2)}°`);
});

test("solbanan: ett värde var 10:e minut över hela intervallet", () => {
  const from = Date.UTC(2026, 8, 25, 12);
  const path = sunPath(...KSD, from, from + 6 * H);
  assert.equal(path.length, 37);
  assert.ok(path.every((p, i) => p.t === from + i * 10 * MIN));
});

test("händelserna ligger där solhöjden passerar −0,833° och −6°", () => {
  const day = Date.UTC(2026, 8, 25, 22);
  for (const e of sunEvents(...KSD, day, day + 24 * H)) {
    const alt = e.kind === "dawn" || e.kind === "dusk" ? CIVIL_ALT : SUNRISE_ALT;
    assert.ok(Math.abs(solarElevation(...KSD, e.t) - alt) < 0.01, `${e.kind} vid ${alt}°`);
  }
  // Malmö midsommar: 04:24 och 21:55 enligt publicerade tider
  const malmo = sunEvents(55.605, 13.0, Date.UTC(2026, 5, 20, 22), Date.UTC(2026, 5, 21, 22));
  assert.ok(near(malmo.find((e) => e.kind === "sunrise")?.t, "04:24") && near(malmo.find((e) => e.kind === "sunset")?.t, "21:55"));
});

test("polarfall: ingen påhittad uppgång eller nedgång, men banan finns", () => {
  const summer = Date.UTC(2026, 5, 20, 22);
  assert.deepEqual(sunEvents(67.855, 20.225, summer, summer + 24 * H), [], "midnattssol i Kiruna");
  assert.ok(sunPath(67.855, 20.225, summer, summer + 24 * H).every((p) => p.alt > SUNRISE_ALT));
  const winter = Date.UTC(2026, 11, 20, 23);
  assert.deepEqual(kinds(sunEvents(67.855, 20.225, winter, winter + 24 * H)), ["dawn", "dusk"], "polarnatt: bara borgerlig skymning mitt på dagen");
  assert.ok(noonAlt(67.855, 20.225, winter) < SUNRISE_ALT);
  // Ljus sommarnatt i Luleå: solen når aldrig −6° – nedgång och uppgång utan skymning emellan
  const lul = Date.UTC(2026, 5, 20, 22);
  assert.deepEqual(kinds(sunEvents(65.584, 22.154, lul, lul + 24 * H)), ["sunset", "sunrise"]);
});
