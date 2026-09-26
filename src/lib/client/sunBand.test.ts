import { test } from "node:test";
import assert from "node:assert/strict";
import { HORIZON, sunBandLabels, sunCurveSegments, sunY, withHorizonCrossings } from "./sunBand";
import { sunEvents, sunPath, type SunEvent } from "../sun";

const H = 3_600_000;
const TOP = 300;
const SUN_H = 64;
const y = (alt: number) => sunY(alt, TOP, SUN_H);
const horizon = y(HORIZON);

function labelsFor(lat: number, lon: number, start: number, hours = 36) {
  const end = start + hours * H;
  const x = (t: number) => ((t - start) / H) * 34;
  return sunBandLabels({
    path: sunPath(lat, lon, start - H, end + H),
    events: sunEvents(lat, lon, start, end),
    start,
    end,
    x,
    y,
    top: TOP,
    bottom: TOP + SUN_H,
    width: x(end),
  });
}

test("tvådelad skala: horisonten…60° på 65 % av höjden, −18°…horisonten på 35 %, klippt mot kanterna", () => {
  assert.equal(HORIZON, -0.833, "horisontlinjen vid soluppgångens och solnedgångens höjd");
  assert.equal(y(60), TOP);
  assert.equal(y(HORIZON), TOP + 0.65 * SUN_H);
  assert.equal(y(-18), TOP + SUN_H);
  assert.equal(y(-30), TOP + SUN_H, "under −18° klipps mot nederkanten");
  assert.equal(y(75), TOP, "över 60° mot överkanten");
  const civil = y(-6) - y(HORIZON);
  const nautical = y(-12) - y(-6);
  assert.ok(Math.abs(nautical - (y(-18) - y(-12))) < 1e-9, "nautisk och astronomisk lika höga");
  assert.ok(civil > 6 && nautical > 7, `${civil.toFixed(1)} och ${nautical.toFixed(1)} px`);
});

test("horisontpassager läggs in exakt, så att den gula ytan börjar vid korsningen", () => {
  const pts = withHorizonCrossings([
    { t: 0, alt: HORIZON - 2 },
    { t: 600_000, alt: HORIZON + 2 },
    { t: 1_200_000, alt: HORIZON + 6 },
  ]);
  assert.equal(pts[1].alt, HORIZON);
  assert.ok(Math.abs(pts[1].t - 300_000) < 1e-6);
  assert.equal(pts.length, 4);
});

test("Karlstad 26 sep: kurvan korsar horisontlinjen just vid ↑ 06:59 och ↓ 18:54", () => {
  const day = Date.UTC(2026, 8, 25, 22);
  const crossings = withHorizonCrossings(sunPath(59.38, 13.5, day, day + 24 * H)).filter((p) => p.alt === HORIZON);
  const events = sunEvents(59.38, 13.5, day, day + 24 * H).filter((e) => e.kind === "sunrise" || e.kind === "sunset");
  assert.equal(crossings.length, 2);
  // Solbanan är linjär mellan 10-minuterspunkterna – korsningen ligger inom en halv minut
  crossings.forEach((c, i) => assert.ok(Math.abs(c.t - events[i].t) < 30_000, `${events[i].kind}: ${(c.t - events[i].t) / 1000} s`));
  // Den ritade kurvan har samma korsningspunkter – skalan knäcker vid horisonten, så de måste
  // finnas som punkter och inte bara uppstå mellan tiominuterspunkterna.
  const drawn = sunCurveSegments(sunPath(59.38, 13.5, day, day + 24 * H)).flat().filter((p) => p.alt === HORIZON);
  assert.deepEqual(drawn.map((p) => p.t), crossings.map((p) => p.t));
});

test("kurvan döljs under −18° – ingen platt linje mot nederkanten", () => {
  const segs = sunCurveSegments([
    { t: 0, alt: -10 },
    { t: 600_000, alt: -20 },
    { t: 1_200_000, alt: -30 },
    { t: 1_800_000, alt: -16 },
    { t: 2_400_000, alt: -8 },
  ]);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].at(-1), { t: 480_000, alt: -18 }, "slutar exakt vid −18°");
  assert.ok(segs.flat().every((p) => p.alt >= -18));
  // Karlstad en septembernatt: solen under −18° runt midnatt ger ett avbrott i kurvan
  const start = Date.UTC(2026, 8, 25, 12);
  assert.equal(sunCurveSegments(sunPath(59.38, 13.5, start, start + 24 * H)).length, 2);
});

test("Karlstad 26 sep: ↑ och ↓ vid passagen, maxhöjden ovanför toppen, gryning och skymning diskret", () => {
  const start = Date.UTC(2026, 8, 25, 23); // 01:00 lokal tid
  const l = labelsFor(59.38, 13.5, start, 24);
  assert.deepEqual(
    l.map((k) => [k.kind, k.text]),
    [
      ["dawn", "06:18"],
      ["sunrise", "↑ 06:59"],
      ["max", "Max 29°"],
      ["sunset", "↓ 18:54"],
      ["dusk", "19:34"],
    ],
  );
  // Uppgångens tid på dagsidan av passagen, ovanför kurvan under etiketten
  const x = (t: number) => ((t - start) / H) * 34;
  const rise = sunEvents(59.38, 13.5, start, start + 24 * H).find((e) => e.kind === "sunrise")!.t;
  const riseLabel = l.find((k) => k.kind === "sunrise")!;
  assert.ok(riseLabel.x > x(rise), "till höger om uppgången");
  const curveAtEnd = y(Math.max(...sunPath(59.38, 13.5, rise, rise + 70 * 60_000).map((p) => p.alt)));
  assert.ok(riseLabel.y < curveAtEnd, "ovanför kurvan under etiketten");
  assert.ok(l.find((k) => k.kind === "max")!.y < y(29), "ovanför toppen");
});

test("all text ligger ovanför horisonten och inom bandet – aldrig på de mörka skymningszonerna", () => {
  for (const start of [Date.UTC(2026, 8, 25, 23), Date.UTC(2026, 5, 20, 23), Date.UTC(2026, 11, 20, 23)]) {
    for (const k of labelsFor(59.38, 13.5, start, 30)) {
      assert.ok(k.y <= horizon - 1 && k.y - 8 >= TOP + 1, `${k.text} vid ${k.y}`);
    }
  }
});

test("sommar: toppen (54°) nära bandets överkant – maxhöjden under toppen, på den gula ytan", () => {
  const max = labelsFor(59.38, 13.5, Date.UTC(2026, 5, 20, 23), 24).find((k) => k.kind === "max")!;
  assert.equal(max.text, "Max 54°");
  assert.ok(max.y > y(54) && max.y <= horizon - 1, `baslinje ${max.y}`);
});

test("vinter och polarnatt: fast skala, ingen påhittad uppgång", () => {
  const dec = labelsFor(59.38, 13.5, Date.UTC(2026, 11, 20, 23), 24);
  assert.equal(dec.find((k) => k.kind === "max")?.text, "Max 7°");
  const polar = labelsFor(67.855, 20.225, Date.UTC(2026, 11, 20, 23), 24);
  assert.ok(!polar.some((k) => k.kind === "sunrise" || k.kind === "sunset"), "ingen uppgång eller nedgång");
  assert.equal(polar.find((k) => k.kind === "max")?.text, "Max −1°");
});

test("etiketter som skulle krocka eller gå utanför diagrammet visas inte", () => {
  const x = (t: number) => (t / H) * 34;
  const base = { path: [], x, y, top: TOP, bottom: TOP + SUN_H, start: 0, end: 20 * H, width: x(20 * H) };
  // Mycket kort dag: uppgång 10:00, nedgång 11:20 – tiderna på dagsidan ryms inte båda.
  const short: SunEvent[] = [
    { t: 10 * H, kind: "sunrise" },
    { t: 11 * H + 20 * 60_000, kind: "sunset" },
  ];
  assert.equal(sunBandLabels({ ...base, events: short }).length, 1);
  // Ljus sommarnatt: nedgång 23:50 och uppgång 00:50 står på varsin yttre sida – båda ryms.
  const night: SunEvent[] = [
    { t: 10 * H - 10 * 60_000, kind: "sunset" },
    { t: 10 * H + 50 * 60_000, kind: "sunrise" },
  ];
  assert.equal(sunBandLabels({ ...base, events: night }).length, 2);
  // Nedgång i vänsterkanten och uppgång i högerkanten: tiderna skulle hamna utanför.
  assert.equal(sunBandLabels({ ...base, events: [{ t: 0.2 * H, kind: "sunset" }] }).length, 0);
  assert.equal(sunBandLabels({ ...base, events: [{ t: 19.8 * H, kind: "sunrise" }] }).length, 0);
  // Gryningens tid står tillbaka för uppgångens när de skulle krocka.
  const tight: SunEvent[] = [
    { t: 10 * H, kind: "dawn" },
    { t: 10 * H + 5 * 60_000, kind: "sunrise" },
  ];
  assert.deepEqual(sunBandLabels({ ...base, events: tight }).map((k) => k.kind), ["sunrise"]);
});
