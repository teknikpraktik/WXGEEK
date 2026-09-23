import type { CloudLayer } from "../types";
import type { ChartData, Snapshot } from "./timeline";
import { fmtTime } from "../format";

// ---------------------------------------------------------------------------
// Populärvetenskaplig beskrivning av vädret just nu (engelska), byggd regelbaserat
// ur samma data som diagrammet. Inga påhittade värden: saknas en uppgift hoppas
// stycket över.
// ---------------------------------------------------------------------------

const DIR = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const dirWord = (deg: number) => DIR[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Beaufort-skalan (m/s, övre gräns) med engelska namn. */
const BEAUFORT: Array<[number, string]> = [
  [0.3, "calm"],
  [1.6, "light air"],
  [3.4, "light breeze"],
  [5.5, "gentle breeze"],
  [8, "moderate breeze"],
  [10.8, "fresh breeze"],
  [13.9, "strong breeze"],
  [17.2, "near gale"],
  [20.8, "gale"],
  [24.5, "strong gale"],
  [28.5, "storm"],
  [32.7, "violent storm"],
];
function beaufort(ms: number): { force: number; name: string } {
  const i = BEAUFORT.findIndex(([max]) => ms < max);
  return i === -1 ? { force: 12, name: "hurricane-force wind" } : { force: i, name: BEAUFORT[i][1] };
}

const COVER_WORDS: Record<string, string> = {
  FEW: "a few scattered clouds (1–2 eighths of the sky)",
  SCT: "scattered cloud covering 3–4 eighths of the sky",
  BKN: "broken cloud covering 5–7 eighths of the sky",
  OVC: "a complete overcast (8/8)",
};

/** Daggpunkt ur rå-METAR: "15/14", "M02/M05". */
export function dewPointFromMetar(raw: string | undefined): number | undefined {
  const m = raw?.match(/\s(M?\d{2})\/(M?\d{2})\s/);
  if (!m) return undefined;
  return Number(m[2].replace("M", "-"));
}

/** Relativ fuktighet (%) med Magnus formel. */
export function relativeHumidity(t: number, td: number): number {
  const g = (x: number) => (17.62 * x) / (243.12 + x);
  return Math.round(100 * Math.exp(g(td) - g(t)));
}

const round = (v: number) => Math.round(v);
/** Höjder avrundas till 10 m – METAR anger molnbas i hundratal fot. */
const r10 = (m: number) => Math.round(m / 10) * 10;
const mm = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

function cloudParagraph(snap: Snapshot): string | null {
  const c = snap.cloud?.value;
  if (!c) return null;
  if (c.cavok) {
    return "The sky is officially “CAVOK” – ceiling and visibility OK: no cloud below 1,500 m, at least 10 km visibility and no significant weather. From an aviation point of view, it doesn't get much better.";
  }
  const layers: CloudLayer[] = (c.layers ?? []).filter((l) => l.cover !== "VV");
  const vv = c.layers?.find((l) => l.cover === "VV");
  if (vv) {
    return `The sky is obscured: fog or precipitation is so dense that no cloud base can be seen, and the observer can only see about ${r10(vv.baseM)} m straight up.`;
  }
  if (!layers.length) {
    if (c.oktas !== undefined) {
      if (c.oktas === 0) return "The model shows a clear sky.";
      return `The forecast model puts about ${c.oktas} eighths of the sky under cloud${c.baseM !== undefined ? `, with a base near ${r10(c.baseM)} m` : ""}.`;
    }
    return c.nsc ? "No significant cloud is reported – any clouds are high and harmless." : null;
  }
  const low = layers[0];
  const parts: string[] = [];
  const h = low.baseM;
  const cover = COVER_WORDS[low.cover] ?? "cloud";
  if (h < 300) {
    parts.push(
      `There is ${cover} with a base only about ${r10(h)} m above the ground – roughly the height of a ${Math.max(5, Math.round(h / 3 / 5) * 5)}-storey building. Cloud this low is usually stratus: a grey sheet that forms when moist air is cooled to its dew point close to the surface.`,
    );
  } else if (h < 2000) {
    parts.push(
      `There is ${cover} at about ${r10(h)} m. These are low clouds, typically stratocumulus or cumulus – lumpy, grey-white cloud formed as air rises and cools until its moisture condenses.`,
    );
  } else {
    parts.push(
      `The lowest cloud, ${cover}, sits at about ${r10(h)} m – mid-level cloud such as altocumulus, made of water droplets several kilometres up.`,
    );
  }
  const higher = layers.slice(1).filter((l) => l.cover === "BKN" || l.cover === "OVC");
  if (higher.length) parts.push(`Above it lies more cloud, ${higher.map((l) => `${l.cover === "OVC" ? "overcast" : "broken"} at ${r10(l.baseM)} m`).join(" and ")}.`);
  if (layers.some((l) => l.type === "CB")) {
    parts.push(
      "Cumulonimbus (CB) is reported – towering shower and thunderstorm clouds whose tops can reach 10 km. They bring sudden downpours, gusty winds and sometimes hail and lightning.",
    );
  } else if (layers.some((l) => l.type === "TCU")) {
    parts.push("Towering cumulus (TCU) is reported – fast-growing cloud towers that show the air is unstable and can develop into showers.");
  }
  return parts.join(" ");
}

function airParagraph(snap: Snapshot): string | null {
  const t = snap.temperature?.value;
  if (t === undefined) return null;
  const td = dewPointFromMetar(snap.metar?.raw);
  const parts = [`The air temperature is ${round(t)} °C.`];
  if (td !== undefined && td <= t + 0.5) {
    const spread = t - td;
    const rh = Math.min(100, relativeHumidity(t, td));
    parts.push(`The dew point – the temperature at which the air would become saturated – is ${td} °C, giving a relative humidity of about ${rh} %.`);
    if (spread <= 2) {
      parts.push("With so little difference, the air is almost saturated: expect damp conditions, low cloud, mist or drizzle, and fog if the air cools further.");
    } else if (spread >= 10) {
      parts.push("The large gap means the air is dry, so clouds form high up, if at all, and anything wet dries quickly.");
    }
    if (spread > 2) {
      parts.push(`A rule of thumb puts the base of convective cloud at about 125 m per degree of spread – here roughly ${Math.round((spread * 125) / 50) * 50} m.`);
    }
  }
  return parts.join(" ");
}

function windParagraph(snap: Snapshot): string | null {
  const w = snap.wind?.value;
  if (!w || w.speed === undefined) return null;
  const b = beaufort(w.speed);
  if (b.force === 0) return "The air is calm – smoke rises vertically.";
  const from = w.variable || w.deg === undefined ? "from varying directions" : `from the ${dirWord(w.deg)}`;
  const parts = [`The wind is a ${b.name} (Beaufort ${b.force}) ${from}, averaging ${round(w.speed)} m/s.`];
  const gust = snap.gust?.value;
  if (gust !== undefined && gust >= w.speed + 3) {
    parts.push(`Gusts reach ${round(gust)} m/s – short bursts caused by turbulent eddies that bring faster-moving air down from higher up.`);
  }
  return parts.join(" ");
}

function precipParagraph(snap: Snapshot, chart: ChartData, now: number): string | null {
  const parts: string[] = [];
  const ph = snap.phenomena?.value ?? [];
  const falling = ph.find((p) => ["regn", "duggregn", "snö", "snöblandat", "hagel", "skurar", "underkylt"].includes(p.kind));
  if (falling) {
    const extra =
      falling.kind === "duggregn"
        ? " Drizzle consists of very small drops falling from low, shallow cloud."
        : falling.kind === "skurar"
          ? " Showers come from individual convective clouds, so they start and stop abruptly."
          : falling.kind === "underkylt"
            ? " Freezing precipitation falls as liquid but freezes on contact with cold surfaces – a serious icing hazard."
            : "";
    parts.push(`Right now: ${falling.label.toLowerCase()}.${extra}`);
  }
  const past = chart.precipHours.filter((p) => !p.forecast).reduce((s, p) => s + p.likely, 0);
  if (past >= 0.1) parts.push(`The nearest rain gauge has collected ${mm(past)} mm over the past 12 hours.`);
  const next = chart.precipHours.filter((p) => p.forecast && p.t1 > now);
  const likely = next.reduce((s, p) => s + p.likely, 0);
  const possible = next.reduce((s, p) => s + p.possible, 0);
  if (possible >= 0.1) {
    parts.push(
      likely >= 0.1
        ? `SMHI's ensemble forecast – many model runs with slightly different starting points – gives a likely ${mm(likely)} mm over the next 12 hours, possibly up to ${mm(possible)} mm.`
        : `SMHI's ensemble forecast – many model runs with slightly different starting points – mostly stays dry over the next 12 hours, but some runs give up to ${mm(possible)} mm.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

function trendParagraph(chart: ChartData, now: number): string | null {
  const pts = chart.temp.forecast.flat().filter((p) => p.t > now);
  if (pts.length < 2) return null;
  const nowV = chart.temp.observed.at(-1)?.at(-1)?.v ?? pts[0].v;
  const min = pts.reduce((a, b) => (b.v < a.v ? b : a));
  const max = pts.reduce((a, b) => (b.v > a.v ? b : a));
  if (max.v - nowV >= 2 && max.t < min.t) {
    return `Over the next 12 hours the temperature rises to about ${round(max.v)} °C around ${fmtTime(max.t)}, then falls to about ${round(min.v)} °C.`;
  }
  if (nowV - min.v >= 2) {
    return `Over the next 12 hours the temperature falls to about ${round(min.v)} °C around ${fmtTime(min.t)}${
      max.t > min.t && max.v - min.v >= 2 ? `, before climbing back to about ${round(max.v)} °C` : ""
    }.`;
  }
  if (max.v - nowV >= 2) return `Over the next 12 hours the temperature rises to about ${round(max.v)} °C around ${fmtTime(max.t)}.`;
  return `The temperature stays fairly steady over the next 12 hours, between ${round(min.v)} and ${round(max.v)} °C.`;
}

function visibilityParagraph(snap: Snapshot): string | null {
  const v = snap.visibility?.value;
  if (!v || v.atLeast || v.m >= 5000) return null;
  if (v.m < 1000) return `Visibility is only ${round(v.m)} m – by definition that is fog: countless tiny water droplets suspended in the air.`;
  return `Visibility is reduced to ${(v.m / 1000).toFixed(1)} km by mist or precipitation – tiny droplets or particles scatter the light.`;
}

/** Stycken med förklarande text om vädret vid NU. */
export function explainWeather(snapNow: Snapshot, chart: ChartData, now: number): string[] {
  return [
    cloudParagraph(snapNow),
    airParagraph(snapNow),
    windParagraph(snapNow),
    visibilityParagraph(snapNow),
    precipParagraph(snapNow, chart, now),
    trendParagraph(chart, now),
  ].filter((p): p is string => !!p);
}
