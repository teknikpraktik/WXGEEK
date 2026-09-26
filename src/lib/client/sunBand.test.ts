import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_ALT, sunBandLabels, sunCurveSegments, sunY, withHorizonCrossings } from "./sunBand";
import { sunEvents, sunPath, type SunEvent } from "../sun";

const H = 3_600_000;
const TOP = 300;
const SUN_H = 84;
const y = (alt: number) => sunY(alt, TOP, SUN_H);
const horizon = y(0);
const KSD = [59.38, 13.5] as const;

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

/** Den ritade kurvans solhöjd vid tiden t: linjärt mellan kurvans punkter (som i SVG:n). */
function drawnAlt(segs: Array<Array<{ t: number; alt: number }>>, t: number): number | undefined {
  for (const s of segs) {
    for (let i = 1; i < s.length; i++) {
      if (t >= s[i - 1].t && t <= s[i].t) return s[i - 1].alt + ((s[i].alt - s[i - 1].alt) * (t - s[i - 1].t)) / (s[i].t - s[i - 1].t);
    }
  }
  return undefined;
}

test("geometrisk skala: horisonten vid 0°, 0°…60° på 65 % av höjden, tre lika höga skymningszoner", () => {
  assert.equal(y(60), TOP);
  assert.equal(y(0), TOP + 0.65 * SUN_H);
  assert.equal(y(-18), TOP + SUN_H);
  assert.equal(y(-30), TOP + SUN_H, "under −18° klipps mot nederkanten");
  assert.equal(y(75), TOP, "över 60° mot överkanten");
  const civil = y(-6) - y(0);
  assert.ok(Math.abs(civil - (y(-12) - y(-6))) < 1e-9 && Math.abs(civil - (y(-18) - y(-12))) < 1e-9);
  assert.ok(civil > 9, `${civil.toFixed(1)} px per zon`);
});

test("horisontpassager (0°) läggs in exakt, så att den gula ytan börjar vid korsningen", () => {
  const pts = withHorizonCrossings([
    { t: 0, alt: -2 },
    { t: 600_000, alt: 2 },
    { t: 1_200_000, alt: 6 },
  ]);
  assert.deepEqual(pts[1], { t: 300_000, alt: 0 });
  assert.equal(pts.length, 4);
});

test("Karlstad 26 sep: markörerna ligger på kurvan – upp- och nedgång vid −0,833°, gryning och skymning vid −6°", () => {
  const day = Date.UTC(2026, 8, 25, 22);
  const events = sunEvents(...KSD, day, day + 24 * H);
  const segs = sunCurveSegments(sunPath(...KSD, day, day + 24 * H), events);
  for (const e of events) {
    const a = drawnAlt(segs, e.t);
    assert.ok(a !== undefined && Math.abs(a - EVENT_ALT[e.kind]) < 1e-9, `${e.kind}: kurvan vid ${a}° i stället för ${EVENT_ALT[e.kind]}°`);
  }
  // Nedgången 18:54 ligger strax under horisontlinjen – kurvan är inte förskjuten
  const set = events.find((e) => e.kind === "sunset")!;
  assert.ok(y(drawnAlt(segs, set.t)!) > horizon, "18:54 under horisontlinjen");
  // Skymningen 19:34 exakt på −6°-linjen
  const dusk = events.find((e) => e.kind === "dusk")!;
  assert.ok(Math.abs(y(drawnAlt(segs, dusk.t)!) - y(-6)) < 1e-9);
  // Geometriskt korsar kurvan 0° några minuter efter uppgången och före nedgången
  const zero = withHorizonCrossings(sunPath(...KSD, day, day + 24 * H)).filter((p) => p.alt === 0);
  const rise = events.find((e) => e.kind === "sunrise")!;
  assert.equal(zero.length, 2);
  assert.ok(zero[0].t - rise.t > 5 * 60_000 && zero[0].t - rise.t < 10 * 60_000, "0° 5–10 min efter uppgången");
  assert.ok(set.t - zero[1].t > 5 * 60_000 && set.t - zero[1].t < 10 * 60_000, "0° 5–10 min före nedgången");
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
  assert.equal(sunCurveSegments(sunPath(...KSD, start, start + 24 * H)).length, 2);
});

test("Karlstad 26 sep: namngivna etiketter vid markörerna och maxhöjden vid toppen", () => {
  const start = Date.UTC(2026, 8, 25, 23); // 01:00 lokal tid
  const l = labelsFor(...KSD, start, 24);
  assert.deepEqual(
    l.map((k) => [k.kind, k.text]),
    [
      ["dawn", "Civil dawn 06:18"],
      ["sunrise", "Sunrise 06:59"],
      ["max", "Sun alt. max 29°"],
      ["sunset", "Sunset 18:54"],
      ["dusk", "Civil dusk 19:34"],
    ],
  );
  const x = (t: number) => ((t - start) / H) * 34;
  const ev = sunEvents(...KSD, start, start + 24 * H);
  const at = (k: string) => x(ev.find((e) => e.kind === k)!.t);
  const lab = (k: string) => l.find((e) => e.kind === k)!;
  // Uppgången till höger om sin markör, nedgången till vänster (dagsidan)
  assert.ok(lab("sunrise").x0 > at("sunrise") && lab("sunrise").x0 - at("sunrise") < 6);
  assert.ok(lab("sunset").x1 < at("sunset") && at("sunset") - lab("sunset").x1 < 6);
  // Gryningen slutar vid sin markör, skymningen börjar vid sin (nattsidan)
  assert.ok(Math.abs(lab("dawn").x1 - at("dawn")) <= 2 && Math.abs(lab("dusk").x0 - at("dusk")) <= 2);
  assert.ok(lab("max").y < y(29), "ovanför toppen");
});

test("all text ligger ovanför horisonten och inom bandet – aldrig på de mörka skymningszonerna", () => {
  for (const start of [Date.UTC(2026, 8, 25, 23), Date.UTC(2026, 5, 20, 23), Date.UTC(2026, 11, 20, 23)]) {
    for (const k of labelsFor(...KSD, start, 30)) {
      assert.ok(k.y <= horizon - 1 && k.y - 9 >= TOP + 1, `${k.text} vid ${k.y}`);
    }
  }
});

test("sommar: toppen (54°) nära bandets överkant – maxhöjden under toppen, på den gula ytan", () => {
  const max = labelsFor(...KSD, Date.UTC(2026, 5, 20, 23), 24).find((k) => k.kind === "max")!;
  assert.equal(max.text, "Sun alt. max 54°");
  assert.ok(max.y > y(54) && max.y <= horizon - 1, `baslinje ${max.y}`);
});

test("vinter och polarnatt: fast skala, ingen påhittad uppgång", () => {
  const dec = labelsFor(...KSD, Date.UTC(2026, 11, 20, 23), 24);
  assert.equal(dec.find((k) => k.kind === "max")?.text, "Sun alt. max 7°");
  const polar = labelsFor(67.855, 20.225, Date.UTC(2026, 11, 20, 23), 24);
  assert.ok(!polar.some((k) => k.kind === "sunrise" || k.kind === "sunset"), "ingen uppgång eller nedgång");
  assert.equal(polar.find((k) => k.kind === "max")?.text, "Sun alt. max −1°");
});

test("etiketter som skulle krocka eller gå utanför diagrammet visas inte", () => {
  const x = (t: number) => (t / H) * 34;
  const base = { path: [], x, y, top: TOP, bottom: TOP + SUN_H, start: 0, end: 20 * H, width: x(20 * H) };
  // Mycket kort dag: uppgång 10:00, nedgång 11:20 – nedgången flyttas upp en rad i stället för att krocka.
  const short: SunEvent[] = [
    { t: 10 * H, kind: "sunrise" },
    { t: 11 * H + 20 * 60_000, kind: "sunset" },
  ];
  const both = sunBandLabels({ ...base, events: short });
  assert.equal(both.length, 2);
  assert.notEqual(both[0].y, both[1].y, "på varsin rad");
  // Ljus sommarnatt: nedgång 23:50 och uppgång 00:50 står på varsin yttre sida – båda ryms.
  const night: SunEvent[] = [
    { t: 10 * H - 10 * 60_000, kind: "sunset" },
    { t: 10 * H + 50 * 60_000, kind: "sunrise" },
  ];
  assert.equal(sunBandLabels({ ...base, events: night }).length, 2);
  // Nedgång i vänsterkanten och uppgång i högerkanten: dagsidan ryms inte – etiketten står på
  // markörens andra sida i stället för att hamna utanför.
  const edgeSet = sunBandLabels({ ...base, events: [{ t: 0.2 * H, kind: "sunset" }] });
  assert.deepEqual(edgeSet.map((k) => k.anchor), ["start"]);
  assert.ok(edgeSet[0].x0 > x(0.2 * H));
  const edgeRise = sunBandLabels({ ...base, events: [{ t: 19.8 * H, kind: "sunrise" }] });
  assert.deepEqual(edgeRise.map((k) => k.anchor), ["end"]);
  assert.ok(edgeRise[0].x1 < x(19.8 * H));
  // Fullt på båda raderna: upp- och nedgång går före gryningen, som inte visas.
  const crowd: SunEvent[] = [
    { t: 10 * H, kind: "sunrise" },
    { t: 12 * H + 40 * 60_000, kind: "sunset" },
    { t: 12 * H + 40 * 60_000, kind: "dawn" },
  ];
  assert.deepEqual(sunBandLabels({ ...base, events: crowd }).map((k) => k.kind), ["sunrise", "sunset"]);
});

test("ingen etikett korsar NU-linjen: nedgången byter sida, maxhöjden flyttas åt sidan", () => {
  const start = Date.UTC(2026, 8, 25, 23);
  const end = start + 24 * H;
  const x = (t: number) => ((t - start) / H) * 34;
  const ev = sunEvents(...KSD, start, end);
  const path = sunPath(...KSD, start - H, end + H);
  const set = ev.find((e) => e.kind === "sunset")!;
  const noonX = x(Date.UTC(2026, 8, 26, 11)); // ungefär solens högsta punkt (13 lokal tid)
  const labels = (avoid: number[]) => sunBandLabels({ path, events: ev, start, end, x, y, top: TOP, bottom: TOP + SUN_H, width: x(end), avoid });
  // NU 30 min före nedgången: dagsidans etikett skulle korsa linjen – den står på nattsidan
  const nowSet = x(set.t) - 17;
  const l1 = labels([nowSet]).find((k) => k.kind === "sunset")!;
  assert.equal(l1.anchor, "start");
  assert.ok(l1.x0 > nowSet + 3);
  // NU mitt i maxetiketten: den flyttas så att linjen går fri
  const l2 = labels([noonX + 10]).find((k) => k.kind === "max")!;
  assert.ok(l2.x1 < noonX + 10 - 3 || l2.x0 > noonX + 10 + 3, `${l2.x0}–${l2.x1}`);
  for (const k of labels([nowSet, noonX + 10])) assert.ok(!(nowSet > k.x0 - 3 && nowSet < k.x1 + 3), k.text);
});
