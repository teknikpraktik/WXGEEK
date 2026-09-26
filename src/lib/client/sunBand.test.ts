import { test } from "node:test";
import assert from "node:assert/strict";
import { SUN_MAX, SUN_MIN, sunBandLabels } from "./sunBand";
import { sunEvents, sunPath, type SunEvent } from "../sun";

const H = 3_600_000;
const TOP = 300;
const SUN_H = 48;
const y = (alt: number) => TOP + ((SUN_MAX - alt) / (SUN_MAX - SUN_MIN)) * SUN_H;

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

test("Karlstad 26 sep: uppgång och nedgång vid horisonten, middagshöjden ovanför toppen", () => {
  const start = Date.UTC(2026, 8, 25, 23); // 01:00 lokal tid
  const l = labelsFor(59.38, 13.5, start, 24);
  assert.deepEqual(
    l.map((k) => [k.kind, k.text, k.anchor]),
    [
      ["sunrise", "06:59", "end"],
      ["max", "29°", "middle"],
      ["sunset", "18:54", "start"],
    ],
  );
  const rise = l[0];
  // Tiden står till vänster om passagen och strax ovanför horisontlinjen, där kurvan inte går.
  assert.ok(rise.y < y(0) && rise.y > y(0) - 8);
  const max = l[1];
  assert.ok(max.y < y(29), "ovanför toppen");
});

test("sommar: toppen (54°) nära bandets överkant – maxhöjden under toppen, inom bandet", () => {
  const l = labelsFor(59.38, 13.5, Date.UTC(2026, 5, 20, 23), 24);
  const max = l.find((k) => k.kind === "max")!;
  assert.equal(max.text, "54°");
  assert.ok(max.y > y(54) && max.y <= TOP + SUN_H, `baslinje ${max.y}`);
});

test("vinter och polarnatt: fast skala, ingen påhittad uppgång", () => {
  const dec = labelsFor(59.38, 13.5, Date.UTC(2026, 11, 20, 23), 24);
  assert.equal(dec.find((k) => k.kind === "max")?.text, "7°");
  const polar = labelsFor(67.855, 20.225, Date.UTC(2026, 11, 20, 23), 24);
  assert.deepEqual(polar.map((k) => k.kind), ["max"], "bara maxhöjden, under horisonten");
  assert.equal(polar[0].text, "−1°");
});

test("etiketter som skulle krocka eller gå utanför diagrammet visas inte", () => {
  const x = (t: number) => (t / H) * 34;
  const base = { path: [], x, y, top: TOP, bottom: TOP + SUN_H, start: 0, end: 20 * H, width: x(20 * H) };
  // Ljus sommarnatt: nedgång 23:50 och uppgång 00:50 – tiderna ryms inte båda.
  const close: SunEvent[] = [
    { t: 10 * H - 10 * 60_000, kind: "sunset" },
    { t: 10 * H + 50 * 60_000, kind: "sunrise" },
  ];
  assert.equal(sunBandLabels({ ...base, events: close }).length, 1);
  // Uppgång precis i diagrammets vänsterkant: tiden skulle hamna utanför.
  assert.equal(sunBandLabels({ ...base, events: [{ t: 0.2 * H, kind: "sunrise" }] }).length, 0);
});
