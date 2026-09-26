import { test } from "node:test";
import assert from "node:assert/strict";
import { dewPointFromRh, fmtDateTime, fmtInterval, fmtOffset, fmtTemp, fmtTime, fmtWindFrom, fmtWindText, localHour } from "./format";

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
  assert.equal(fmtWindText({ deg: 136, speed: 4 }, 7), "From SE 140° · 4 m/s, gusts 7 m/s");
  assert.equal(fmtWindText({ deg: 135, speed: 0.2 }), "Calm");
  assert.equal(fmtWindText({ variable: true, speed: 2 }), "Variable · 2 m/s");
  assert.equal(fmtWindText({ deg: 44, speed: 5 }), "From NE 040° · 5 m/s");
  assert.equal(fmtWindText({ deg: 357, speed: 5 }), "From N 360° · 5 m/s");
  // Väderstrecket följer de avrundade graderna, så att text och siffra aldrig säger olika saker
  assert.deepEqual([231, 244, 247, 250, 316, 338].map(fmtWindFrom), ["From SW 230°", "From SW 240°", "From W 250°", "From W 250°", "From NW 320°", "From N 340°"]);
  // Gusts barely above the mean wind are not shown.
  assert.equal(fmtWindText({ deg: 270, speed: 5 }, 5.4), "From W 270° · 5 m/s");
});

test("temperature and dew point in whole degrees, with a typographic minus", () => {
  assert.equal(fmtTemp(12.4), "12");
  assert.equal(fmtTemp(11.6), "12");
  assert.equal(fmtTemp(-0.4), "0");
  assert.equal(fmtTemp(-2.6), "−3");
  assert.equal(fmtTemp(undefined), "–");
});

test("dew point from temperature and relative humidity (Magnus)", () => {
  const dp = (t: number, rh: number) => Math.round(dewPointFromRh(t, rh) * 10) / 10;
  assert.equal(dp(20, 100), 20);
  assert.equal(dp(20, 50), 9.3);
  assert.equal(dp(-5, 80), -7.9);
});
