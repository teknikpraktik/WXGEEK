import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDateTime, fmtInterval, fmtOffset, fmtTime, fmtWindText, localHour } from "./format";

const H = 3_600_000;

test("lokal tid följer sommartid och normaltid (Europe/Stockholm)", () => {
  // Sommartid (UTC+2)
  assert.equal(fmtTime(Date.UTC(2026, 6, 1, 12, 0)), "14:00");
  // Normaltid (UTC+1)
  assert.equal(fmtTime(Date.UTC(2026, 0, 15, 12, 0)), "13:00");
  // Sommartidens slut 2026-10-25: 03:00 CEST blir 02:00 CET – klockslaget 02:xx förekommer två gånger.
  assert.equal(fmtTime(Date.UTC(2026, 9, 25, 0, 30)), "02:30");
  assert.equal(fmtTime(Date.UTC(2026, 9, 25, 1, 30)), "02:30");
  assert.equal(localHour(Date.UTC(2026, 9, 25, 2, 0)), 3);
});

test("datum och tid visas med veckodag och datumskifte i lokal tid", () => {
  // 22:30 UTC den 23 september = 00:30 den 24 september i Sverige.
  assert.equal(fmtDateTime(Date.UTC(2026, 8, 23, 22, 30)), "tors 24 sep, 00:30");
  assert.match(fmtDateTime(Date.UTC(2026, 8, 23, 14, 0)), /^ons 23 sep, 16:00$/);
});

test("intervall anges med hela timmar när det går", () => {
  const t0 = Date.UTC(2026, 8, 23, 17, 0);
  assert.equal(fmtInterval(t0, t0 + H), "19–20");
  assert.equal(fmtInterval(t0 + 30 * 60 * 1000, t0 + 90 * 60 * 1000), "19:30–20:30");
});

test("relativ tid i timmar och minuter", () => {
  assert.equal(fmtOffset(2.5 * H), "om 2 h 30 min");
  assert.equal(fmtOffset(-45 * 60 * 1000), "för 45 min sedan");
  assert.equal(fmtOffset(2 * 60 * 1000), "nu");
  assert.equal(fmtOffset(3 * H), "om 3 h");
});

test("vind i klartext med enhet, byar och vindstilla", () => {
  assert.equal(fmtWindText({ deg: 135, speed: 4 }, 7), "Från sydost · 4 m/s, byar 7 m/s");
  assert.equal(fmtWindText({ deg: 135, speed: 0.2 }), "Vindstilla");
  assert.equal(fmtWindText({ variable: true, speed: 2 }), "Varierande · 2 m/s");
  // Byar som knappt skiljer sig från medelvinden visas inte.
  assert.equal(fmtWindText({ deg: 270, speed: 5 }, 5.4), "Från väster · 5 m/s");
});
