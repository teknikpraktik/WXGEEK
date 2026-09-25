import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutSunMarks } from "./sunMarks";
import { sunEvents, type SunEvent } from "../sun";

const H = 3_600_000;
const MIN = 60_000;

test("solmarkeringar: lokal tid, gryningens start och skymningens slut, bara inom fönstret", () => {
  // Karlstad, fönstret fre 25 sep 05:00 – lör 26 sep 04:00 lokal tid; nu 09:41.
  const start = Date.UTC(2026, 8, 25, 3);
  const end = start + 23 * H;
  const now = Date.UTC(2026, 8, 25, 7, 41);
  const x = (t: number) => ((t - start) / H) * 34;
  const events = sunEvents(59.379, 13.504, start - 12 * H, end + 12 * H);
  const { marks } = layoutSunMarks({ events, start, end, now, x, midnights: [{ t: Date.UTC(2026, 8, 25, 22), text: "Sat 26 Sep" }] });
  assert.deepEqual(
    marks.map((m) => [m.text, m.detail, m.label]),
    [
      ["Sunrise 06:57", "Civil dawn from 06:16", true],
      ["Sunset 18:57", "Civil dusk until 19:37", true],
    ],
    "lördagens soluppgång (06:59) ligger utanför fönstret",
  );
  assert.equal(marks[0].x, x(marks[0].t), "symbolen på händelsens exakta tid");
});

test("solmarkeringar nära midnatt: tiden döljs vid krock, dygnsetiketten flyttas om det går", () => {
  const start = 0;
  const x = (t: number) => (t / H) * 34;
  const m = 10 * H;
  const day = [{ t: m, text: "Sat 26 Sep" }];
  // Ljus sommarnatt: solnedgång 23:50, soluppgång 00:50 utan gryning emellan.
  const summer: SunEvent[] = [
    { t: m - 10 * MIN, kind: "sunset" },
    { t: m + 50 * MIN, kind: "sunrise" },
  ];
  const a = layoutSunMarks({ events: summer, start, end: 20 * H, now: 0, x, midnights: day });
  assert.deepEqual(a.marks.map((k) => k.label), [false, false], "tiderna skulle krocka med dygnsetiketten och varandra");
  assert.deepEqual(a.marks.map((k) => k.detail), ["Civil twilight all night", "Civil twilight all night"]);
  assert.equal(a.dayLeft.size, 0, "symboler på båda sidor: etiketten står kvar");

  // Bara en soluppgång strax efter midnatt: dygnsetiketten flyttas till vänster om strecket.
  const b = layoutSunMarks({ events: [{ t: m + 60 * MIN, kind: "sunrise" }], start, end: 20 * H, now: 0, x, midnights: day });
  assert.ok(b.dayLeft.has(m));
  assert.equal(b.marks[0].label, true);
});
