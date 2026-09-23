import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDateTime, fmtInterval, fmtOffset, fmtTime, fmtWindText, localHour } from "./format";

const H = 3_600_000;

test("local time follows summer and winter time (Europe/Stockholm)", () => {
  // Sommartid (UTC+2)
  assert.equal(fmtTime(Date.UTC(2026, 6, 1, 12, 0)), "14:00");
  // Normaltid (UTC+1)
  assert.equal(fmtTime(Date.UTC(2026, 0, 15, 12, 0)), "13:00");
  // Sommartidens slut 2026-10-25: 03:00 CEST blir 02:00 CET – klockslaget 02:xx förekommer två gånger.
  assert.equal(fmtTime(Date.UTC(2026, 9, 25, 0, 30)), "02:30");
  assert.equal(fmtTime(Date.UTC(2026, 9, 25, 1, 30)), "02:30");
  assert.equal(localHour(Date.UTC(2026, 9, 25, 2, 0)), 3);
});

test("date and time with weekday and date change in local time", () => {
  // 22:30 UTC den 23 september = 00:30 den 24 september i Sverige.
  assert.equal(fmtDateTime(Date.UTC(2026, 8, 23, 22, 30)), "Thu 24 Sep, 00:30");
  assert.equal(fmtDateTime(Date.UTC(2026, 8, 23, 14, 0)), "Wed 23 Sep, 16:00");
});

test("intervals use whole hours when possible", () => {
  const t0 = Date.UTC(2026, 8, 23, 17, 0);
  assert.equal(fmtInterval(t0, t0 + H), "19–20");
  assert.equal(fmtInterval(t0 + 30 * 60 * 1000, t0 + 90 * 60 * 1000), "19:30–20:30");
});

test("relative time in hours and minutes", () => {
  assert.equal(fmtOffset(2.5 * H), "in 2 h 30 min");
  assert.equal(fmtOffset(-45 * 60 * 1000), "45 min ago");
  assert.equal(fmtOffset(2 * 60 * 1000), "now");
  assert.equal(fmtOffset(3 * H), "in 3 h");
});

test("wind text with degrees in tens, unit, gusts and calm", () => {
  assert.equal(fmtWindText({ deg: 136, speed: 4 }, 7), "From 140° · 4 m/s, gusts 7 m/s");
  assert.equal(fmtWindText({ deg: 135, speed: 0.2 }), "Calm");
  assert.equal(fmtWindText({ variable: true, speed: 2 }), "Variable · 2 m/s");
  assert.equal(fmtWindText({ deg: 44, speed: 5 }), "From 040° · 5 m/s");
  assert.equal(fmtWindText({ deg: 357, speed: 5 }), "From 360° · 5 m/s");
  // Gusts barely above the mean wind are not shown.
  assert.equal(fmtWindText({ deg: 270, speed: 5 }, 5.4), "From 270° · 5 m/s");
});
