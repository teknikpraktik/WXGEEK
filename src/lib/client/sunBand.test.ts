import { test } from "node:test";
import assert from "node:assert/strict";
import { sunBandLabels, sunY, withHorizonCrossings } from "./sunBand";
import { sunEvents, sunPath, type SunEvent } from "../sun";

const H = 3_600_000;
const TOP = 300;
const SUN_H = 64;
const y = (alt: number) => sunY(alt, TOP, SUN_H);
const horizon = y(0);

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

test("tvådelad skala: 0°…60° på 65 % av höjden, −18°…0° på 35 %, klippt mot kanterna", () => {
  assert.equal(y(60), TOP);
  assert.equal(y(0), TOP + 0.65 * SUN_H);
  assert.equal(y(-18), TOP + SUN_H);
  assert.equal(y(-30), TOP + SUN_H, "under −18° klipps mot nederkanten");
  assert.equal(y(75), TOP, "över 60° mot överkanten");
  // De tre skymningszonerna lika höga
  const civil = y(-6) - y(0);
  assert.ok(Math.abs(civil - (y(-12) - y(-6))) < 1e-9 && Math.abs(civil - (y(-18) - y(-12))) < 1e-9);
  assert.ok(civil > 7, `${civil.toFixed(1)} px per skymningszon`);
});

test("horisontpassager läggs in exakt, så att den gula ytan börjar vid korsningen", () => {
  const pts = withHorizonCrossings([
    { t: 0, alt: -2 },
    { t: 600_000, alt: 2 },
    { t: 1_200_000, alt: 6 },
  ]);
  assert.deepEqual(pts[1], { t: 300_000, alt: 0 });
  assert.equal(pts.length, 4);
});

test("Karlstad 26 sep: uppgång och nedgång vid horisonten, middagshöjden ovanför toppen", () => {
  const start = Date.UTC(2026, 8, 25, 23); // 01:00 lokal tid
  const l = labelsFor(59.38, 13.5, start, 24);
  assert.deepEqual(
    l.map((k) => [k.kind, k.text, k.anchor]),
    [
      ["sunrise", "06:59", "start"],
      ["max", "29°", "middle"],
      ["sunset", "18:54", "end"],
    ],
  );
  // Tiderna står på dagsidan av passagen, ovanför kurvan: uppgångens tid till höger om uppgången.
  const x = (t: number) => ((t - start) / H) * 34;
  const rise = sunEvents(59.38, 13.5, start, start + 24 * H)[0].t;
  assert.ok(l[0].x > x(rise), "till höger om uppgången");
  const curveAtEnd = y(Math.max(...sunPath(59.38, 13.5, rise, rise + 60 * 60_000).map((p) => p.alt)));
  assert.ok(l[0].y < curveAtEnd, "ovanför kurvan under etiketten");
  assert.ok(l[1].y < y(29), "ovanför toppen");
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
  assert.equal(max.text, "54°");
  assert.ok(max.y > y(54) && max.y <= horizon - 1, `baslinje ${max.y}`);
});

test("vinter och polarnatt: fast skala, ingen påhittad uppgång", () => {
  const dec = labelsFor(59.38, 13.5, Date.UTC(2026, 11, 20, 23), 24);
  assert.equal(dec.find((k) => k.kind === "max")?.text, "7°");
  const polar = labelsFor(67.855, 20.225, Date.UTC(2026, 11, 20, 23), 24);
  assert.deepEqual(polar.map((k) => k.kind), ["max"], "bara maxhöjden, strax ovanför horisonten");
  assert.equal(polar[0].text, "−1°");
});

test("etiketter som skulle krocka eller gå utanför diagrammet visas inte", () => {
  const x = (t: number) => (t / H) * 34;
  const base = { path: [], x, y, top: TOP, bottom: TOP + SUN_H, start: 0, end: 20 * H, width: x(20 * H) };
  // Mycket kort dag (nära polcirkeln i december): uppgång 10:00, nedgång 11:20 – tiderna på
  // dagsidan ryms inte båda.
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
  // Nedgång precis i diagrammets vänsterkant och uppgång i högerkanten: tiderna skulle hamna utanför.
  assert.equal(sunBandLabels({ ...base, events: [{ t: 0.2 * H, kind: "sunset" }] }).length, 0);
  assert.equal(sunBandLabels({ ...base, events: [{ t: 19.8 * H, kind: "sunrise" }] }).length, 0);
});
