"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { HOUR, PAST_HOURS, type Arrow, type ChartData, type Precip, type PrecipHour, type Pt } from "@/lib/client/timeline";
import { fmtDateTime, localHour, fmtTemp, fmtTime, showGust, tempSign } from "@/lib/format";
import { placeTempLabel } from "@/lib/client/tempLabel";
import {
  EVENT_ALT,
  SUN_TEXT_H,
  SUN_ZONES,
  sunBandLabels,
  sunCurveSegments,
  sunEventText,
  sunY,
  withHorizonCrossings,
} from "@/lib/client/sunBand";
import type { SunEvent } from "@/lib/sun";
import { FogIcon, SkyIcon, skyTitle } from "./SkyIcon";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;
/** Vald tid avrundas till 5 min – en pixel motsvarar knappt 2 minuter. */
const snap5 = (t: number) => Math.round(t / 300_000) * 300_000;

// Layout (px). Fem grupper på samma tidsaxel, uppifrån: tidsaxel, moln och nederbörd, temperatur
// och daggpunkt, vind, ljus. Varje grupp har en rubrikrad; mellan grupperna lika mycket luft på
// var sida om en tunn avgränsare.
/**
 * Tidsaxeln: överst en egen tunn pillrad – NOW, vald tid, "← OBSERVED | FORECAST →" och datum vid
 * dygnsbytet – och under den timtalen, så att pillerna aldrig döljer ett timtal. Axellinjen nederst.
 * Axeln är ett eget lager som ligger fast under sidhuvudet när sidan scrollas (sticky) och följer
 * panelernas horisontella scroll.
 */
const AXIS_H = 40;
const PILL_TOP = 2;
const PILL_BASE = 14;
const HOUR_BASE = AXIS_H - 8;
/** Halva bredden av ett timtal ("14", 12 px siffror) */
const HOUR_HALF_W = 8;
const GAP = 6;
const RUBRIC_H = 18;
/** Vädersymbolerna (molnsymbol med regnstreck) och deras mitt i raden. */
const SKY_H = 32;
const SKY_CY = 13;
/** NU-linjens streckmönster ("3 3") – axelns del slutar på en hel period, så att mönstret
 *  fortsätter obrutet ned genom panelerna. */
const NOW_DASH = 6;
/** Nederbörd per timme; skalan minst 0–2 mm/h. */
const PRECIP_H = 40;
/** Temperatur och daggpunkt. */
const TEMP_H = 148;
const WIND_H = 44;
/** Ljus: geometrisk solhöjd −18°…60° i tvådelad skala. */
const SUN_H = 92;
/** Vänsteraxelns bredd (.tl-yaxis) – den ligger över diagrammets vänsterkant. */
const AXIS_W = 60;
/** Markören (NU vid start och efter Now) står en femtedel in i ritytan: 20 % observerat, 80 %
 *  prognos – med samma pixlar per timme på båda sidor. */
const CURSOR_AT = 0.2;
/** Vald tid räknas som NU inom 10 minuter (px) – då visas bara NU-linjen och dess pill. */
const AT_NOW_PX = (10 / 60) * PX_PER_HOUR;
/** Now-knappen visas när vald tid ligger mer än så här långt från NU (eller NU-linjen är utanför vyn). */
const NOW_BTN_AWAY_PX = PX_PER_HOUR;
/** Molnsymbolens underkant relativt dess mitt – regnet börjar här. */
const SKY_BOTTOM = 7;
/** Halva symbolbredden: symboler som skulle klippas av vyns kanter döljs. */
const SKY_HALF_W = 13;
/** Ungefärlig teckenbredd för temperaturetiketten ("11 °C", 12 px siffror). */
const TLAST_CHAR_W = 7.2;
/** Dimriskytans minsta höjd (px) – annars försvinner den där kurvorna sammanfaller. */
const FOG_MIN_PX = 6;
/** Nederbördens värden: siffror 12 px (mono), "max" 10 px */
const MM_CHAR_W = 7.2;
const MAX_PREFIX_W = 22;
/** Vindens värden, uppmätta bredder (px): medelvindens siffror i 12 px tabellsiffror; byarna
 *  " (12)" i 10 px – mellanslag, parentes och siffra – så att "6 (12)" ryms varje timme. */
const WIND_DIGIT_W = 7.2;
const WIND_SPACE_W = 2.4;
const WIND_PAREN_W = 3.35;
const WIND_GUST_DIGIT_W = 6;
/** Vindpilens halva bredd och minsta luft mellan två vindvärden (px) */
const WIND_ARROW_HW = 8;
const WIND_GAP = 4;

/** Rubrikernas varianter, längst först – den längsta som ryms före NU-linjen visas. */
const RUBRIC_TEXT = {
  clouds: ["Clouds & precipitation", "Clouds & precip.", "Clouds/precip.", "Clouds"],
  temp: ["Temperature", "Temp."],
} as const;
/** Luft mellan rubriken och NU-linjen (px) */
const RUBRIC_CLEAR = 6;
/** Solhändelser vars egen etikett inte syns får en etikett vid kanten när de ligger så här nära den (px). */
const EDGE_NEAR = 100;

type Props = {
  now: number;
  /** Prognosfönstrets slut (ms) */
  until: number;
  data: ChartData;
  /** Tid under markören */
  onCursor: (t: number) => void;
  /** Ökas för att be tidslinjen återgå till NU */
  recenterSignal: number;
};

export const Timeline = memo(function Timeline({ now, until, data, onCursor, recenterSignal }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const sunDescId = useId();
  const [viewW, setViewW] = useState(0);
  const followNow = useRef(true);
  const raf = useRef(0);

  // Tidsaxeln är fast förankrad i timmen, så att den inte "glider" när NU flyttas.
  const start = useMemo(() => Math.floor(now / HOUR) * HOUR - PAST_HOURS * HOUR, [now]);
  const end = Math.max(Math.ceil(until / HOUR) * HOUR, start + (PAST_HOURS + 1) * HOUR);
  const W = ((end - start) / HOUR) * PX_PER_HOUR;
  // Markörens läge i vyn. Utfyllnaden till vänster är lika stor, så att scrollLeft alltid är
  // markörens x i SVG:n, och utfyllnaden till höger gör att hela fönstret nås åt båda hållen.
  const cursorX = Math.round(AXIS_W + CURSOR_AT * Math.max(0, viewW - AXIS_W));
  const padL = cursorX;
  const padR = Math.max(0, viewW - cursorX);
  const x = useCallback((t: number) => ((t - start) / HOUR) * PX_PER_HOUR, [start]);
  const tAt = useCallback((scrollLeft: number) => start + (scrollLeft / PX_PER_HOUR) * HOUR, [start]);
  const maxOffsetH = Math.max(1, Math.round((until - now) / HOUR));
  const narrow = viewW > 0 && viewW < 520;

  // Grupperna uppifrån, med avgränsare mitt i luften mellan dem
  const cloudTop = AXIS_H + GAP; // tidsaxelns linje avgränsar första gruppen
  const skyTop = cloudTop + RUBRIC_H;
  const precipTop = skyTop + SKY_H + 4;
  const cloudBottom = precipTop + PRECIP_H;
  const tempTop = cloudBottom + 2 * GAP + 1;
  const chartTop = tempTop + RUBRIC_H;
  const chartBottom = chartTop + TEMP_H;
  const windPanelTop = chartBottom + 2 * GAP + 1;
  const windTop = windPanelTop + RUBRIC_H;
  const windBottom = windTop + WIND_H;
  const lightTop = windBottom + 2 * GAP + 1;
  const sunTop = lightTop + RUBRIC_H;
  const H = sunTop + SUN_H + 4;
  const separators = [cloudBottom + GAP, chartBottom + GAP, windBottom + GAP];

  // Temperaturskala (°C, linjär) över hela ritytan
  const [t0, t1] = data.temp.domain;
  const yTemp = useCallback((v: number) => chartBottom - ((v - t0) / (t1 - t0)) * TEMP_H, [t0, t1, chartBottom]);
  // Gränsen mellan rött (över 0 °C) och blått (under) i temperaturpanelen, 0 (överkant) … 1 (nederkant)
  const zeroOff = Math.min(1, Math.max(0, (yTemp(0) - chartTop) / TEMP_H));
  // Nederbördens skala: 0 till ett jämnt värde (minst 2 mm) över fönstrets största mängd.
  const precipMax = Math.max(2, Math.ceil(Math.max(0, ...data.precipHours.map((p) => p.possible))));

  // Mät vyn
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scrollToTime = useCallback(
    (t: number, smooth = false) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTo({ left: x(t), behavior: smooth ? "smooth" : "auto" });
    },
    [x],
  );

  // När axelns start flyttas en timme: behåll användarens tidpunkt.
  const prevStart = useRef(start);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && prevStart.current !== start && !followNow.current) {
      el.scrollLeft -= ((start - prevStart.current) / HOUR) * PX_PER_HOUR;
    }
    prevStart.current = start;
  }, [start]);

  // Pågående interaktion (drag/scroll) – då flyttar vi aldrig grafen programmässigt.
  const interacting = useRef(false);
  const interactTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markInteraction = () => {
    interacting.current = true;
    clearTimeout(interactTimer.current);
    interactTimer.current = setTimeout(() => (interacting.current = false), 1500);
  };

  // Starta på NU, och följ med NU så länge användaren står där och inte interagerar.
  useLayoutEffect(() => {
    if (viewW && followNow.current && !interacting.current) scrollToTime(now);
  }, [viewW, now, scrollToTime]);

  /** Tillbaka till NU med en animerad scroll (Now-knappen, loggan, tangenten N). */
  const goNow = useCallback(() => {
    followNow.current = true;
    scrollToTime(now, true);
  }, [now, scrollToTime]);

  const firstRecenter = useRef(true);
  useEffect(() => {
    if (firstRecenter.current) {
      firstRecenter.current = false;
      return;
    }
    goNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal]);

  // Timmarkeringar
  const hours = useMemo(() => {
    const out: Array<{ t: number; h: number }> = [];
    for (let t = start; t <= end; t += HOUR) out.push({ t, h: localHour(t) });
    return out;
  }, [start, end]);

  // Ljus: geometrisk solhöjd i tvådelad fast skala (−18°…0° på 35 %, 0°…60° på 65 %), kurvan var
  // 10:e minut på samma tidsaxel och dold under −18°; gul yta bara där solen är över horisonten.
  // Markörer på kurvan vid soluppgång och solnedgång (−0,833°) och borgerlig gryning och skymning (−6°).
  const nowX = x(now);
  const ySun = useCallback((alt: number) => sunY(alt, sunTop, SUN_H), [sunTop]);
  const sunWindow = useMemo(() => data.sun.path.filter((p) => p.t >= start - HOUR && p.t <= end + HOUR), [data.sun.path, start, end]);
  const sunEvents = useMemo(() => data.sun.events.filter((e) => e.t >= start && e.t <= end), [data.sun.events, start, end]);
  const sunCurves = useMemo(
    () =>
      sunCurveSegments(sunWindow, sunEvents).map((seg) => seg.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${ySun(p.alt).toFixed(1)}`).join("")),
    [sunWindow, sunEvents, x, ySun],
  );
  const sunFill = useMemo(() => {
    const pts = withHorizonCrossings(sunWindow);
    if (!pts.length) return "";
    const y0 = ySun(0).toFixed(1);
    const edge = pts.map((p) => `L${x(p.t).toFixed(1)},${ySun(Math.max(0, p.alt)).toFixed(1)}`).join("");
    return `M${x(pts[0].t).toFixed(1)},${y0}${edge}L${x(pts[pts.length - 1].t).toFixed(1)},${y0}Z`;
  }, [sunWindow, x, ySun]);
  const sunLabels = useMemo(
    () =>
      sunBandLabels({
        path: data.sun.path,
        events: sunEvents,
        start,
        end,
        x,
        y: ySun,
        top: sunTop,
        bottom: sunTop + SUN_H,
        width: W,
        avoid: [nowX],
        // Standardvyn: från vänsteraxeln till vyns högerkant med NU en femtedel in
        view: viewW ? [nowX - (cursorX - AXIS_W), nowX + (viewW - cursorX)] : undefined,
      }),
    [data.sun.path, sunEvents, start, end, x, ySun, sunTop, W, nowX, viewW, cursorX],
  );
  const horizonY = ySun(0);

  const cursorEl = useRef<HTMLDivElement>(null);
  const axisCursorEl = useRef<HTMLDivElement>(null);
  const cursorLabel = useRef<HTMLSpanElement>(null);
  const nowPill = useRef<HTMLSpanElement>(null);
  const nowBtn = useRef<HTMLButtonElement>(null);
  const axisTrack = useRef<HTMLDivElement>(null);
  const axisSvg = useRef<SVGSVGElement>(null);
  const svgEl = useRef<SVGSVGElement>(null);
  const obsLabel = useRef<SVGTextElement>(null);
  const fcLabel = useRef<SVGTextElement>(null);
  const sunEdgeL = useRef<SVGTextElement>(null);
  const sunEdgeR = useRef<SVGTextElement>(null);
  const gustWord = useRef<HTMLSpanElement>(null);
  const windNowEl = useRef<SVGGElement>(null);
  const nowGapLine = useRef<SVGLineElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  // Rubrikerna i den längsta variant som ryms före NU-linjen (uppmätt i rubrikens egen typografi);
  // "(gusts)" stryks där inte ens det ryms.
  const [fit, setFit] = useState({ clouds: 0, temp: 0, gusts: true });
  useLayoutEffect(() => {
    const m = measure.current;
    if (!m || !viewW) return;
    const room = cursorX - 16 - RUBRIC_CLEAR;
    // Samma uppbyggnad som rubrikerna: enheten och "(gusts)" utan versaler
    const width = (text: string, unit = "") => {
      m.textContent = text;
      if (unit) {
        const u = document.createElement("span");
        u.className = "u";
        u.textContent = unit;
        m.appendChild(u);
      }
      return m.getBoundingClientRect().width;
    };
    const first = (texts: readonly string[], unit = "") => {
      const i = texts.findIndex((t) => width(t, unit) <= room);
      return i < 0 ? texts.length - 1 : i;
    };
    const next = { clouds: first(RUBRIC_TEXT.clouds), temp: first(RUBRIC_TEXT.temp, " °C"), gusts: width("Wind", " m/s (gusts)") <= room };
    m.textContent = "";
    setFit((f) => (f.clouds === next.clouds && f.temp === next.temp && f.gusts === next.gusts ? f : next));
  }, [cursorX, viewW]);
  /**
   * Pillraden: NOW som en flagga till höger om NU-linjen – till vänster om vald tids etikett
   * annars skulle krocka, och dold när även det krockar. "← OBSERVED" och "FORECAST →" på var
   * sida om NOW-pillen, datum vid dygnsbytet; det som krockar eller inte ryms döljs. Timtalen har
   * en egen rad och döljs vid vyns kanter och under Now-knappen. Allt som vänsteraxeln eller vyns
   * högerkant skulle klippa – symboler, vindpilar, etiketter – döljs hellre än visas halvt.
   * Solhändelser utanför vyn står vid närmaste kant med pil, t.ex. "← Sunrise 06:59".
   * Markörens etikett sätts bara här (React renderar den tom) – annars skriver en omrendering,
   * t.ex. när klockan går, över vald tid med aktuell tid.
   */
  const placeMarkers = useCallback(
    (scrollLeft: number) => {
      // Tidsaxeln följer panelerna. Där webbläsaren har scrolldrivna animationer sköts det av
      // kompositorn (exakt, se globals.css); detta är reserven och gäller annars.
      const el = scroller.current;
      const track = axisTrack.current;
      if (track) {
        track.style.transform = `translate3d(${-scrollLeft}px,0,0)`;
        if (el) track.style.setProperty("--tl-shift", `${Math.max(0, el.scrollWidth - el.clientWidth)}px`);
      }
      if (cursorLabel.current) cursorLabel.current.textContent = fmtTime(snap5(tAt(scrollLeft)));
      const atNow = Math.abs(nowX - scrollLeft) < AT_NOW_PX;
      cursorEl.current?.classList.toggle("at-now", atNow);
      axisCursorEl.current?.classList.toggle("at-now", atNow);
      const pill = nowPill.current;
      const svg = svgEl.current;
      const ax = axisSvg.current;
      if (!pill || !svg || !ax) return;
      // Ritytans synliga del i SVG:ns x: från vänsteraxelns kant till vyns högerkant.
      const visL = scrollLeft - (cursorX - AXIS_W);
      const visR = scrollLeft + (viewW - cursorX);
      const outside = (a: number, b: number) => viewW > 0 && (a < visL + 1 || b > visR - 1);
      type Span = [number, number];
      const cross = (a: Span, b: Span) => a[1] > b[0] && a[0] < b[1];

      // Now-knappen längst till höger i axeln: bara när NU-linjen är utanför vyn eller vald tid
      // ligger mer än en timme från NU.
      const btn = nowBtn.current;
      const away = viewW > 0 && (Math.abs(scrollLeft - nowX) > NOW_BTN_AWAY_PX || nowX < visL || nowX > visR);
      let btnBox: Span | null = null;
      if (btn) {
        btn.classList.toggle("shown", away);
        if (away) btnBox = [visR - (viewW - btn.offsetLeft) - 6, visR];
      }

      // Pillraden
      const pw = pill.offsetWidth;
      const cw = atNow ? 0 : (cursorLabel.current?.offsetWidth ?? 0);
      const cursorBox: Span | null = cw ? [scrollLeft - cw / 2 - 4, scrollLeft + cw / 2 + 4] : null;
      let px0 = nowX - 1;
      if (cursorBox && cross([px0, px0 + pw], cursorBox)) px0 = nowX + 1 - pw;
      const pillShown = !(cursorBox && cross([px0, px0 + pw], cursorBox)) && !outside(px0, px0 + pw);
      pill.style.transform = `translateX(${Math.round(px0 - nowX)}px)`;
      pill.style.visibility = pillShown ? "" : "hidden";
      const taken: Span[] = [];
      if (pillShown) taken.push([px0 - 4, px0 + pw + 4]);
      if (cursorBox) taken.push(cursorBox);
      const free = (a: number, b: number) => !outside(a, b) && !taken.some((s) => cross([a, b], s));
      ax.querySelectorAll<SVGTextElement>(".tl-daylabel").forEach((d) => {
        const a = Number(d.getAttribute("x"));
        const b = a + d.getComputedTextLength();
        const ok = free(a, b);
        d.style.visibility = ok ? "" : "hidden";
        if (ok) taken.push([a - 6, b + 6]);
      });
      const left = pillShown ? px0 : nowX;
      const right = pillShown ? px0 + pw : nowX;
      const obs = obsLabel.current;
      if (obs) {
        obs.setAttribute("x", String(left - 6));
        let ok = false;
        for (const text of ["← OBSERVED", "← OBS."]) {
          obs.textContent = text;
          if ((ok = free(left - 6 - obs.getComputedTextLength(), left - 6))) break;
        }
        obs.style.visibility = ok ? "" : "hidden";
      }
      const fc = fcLabel.current;
      if (fc) {
        fc.setAttribute("x", String(right + 6));
        fc.style.visibility = free(right + 6, right + 6 + fc.getComputedTextLength()) ? "" : "hidden";
      }
      // Timtalen döljs vid vyns kanter och under Now-knappen. Timtalet närmast NU flyttas några
      // pixlar åt sidan, så att NU-linjen inte går rakt genom siffrorna (strecket står kvar).
      ax.querySelectorAll<SVGTextElement>(".tl-hour").forEach((h) => {
        const hx = Number(h.dataset.x);
        const d = nowX - hx;
        const lx = Math.abs(d) < HOUR_HALF_W + 3 ? (d >= 0 ? nowX - 3 - HOUR_HALF_W : nowX + 3 + HOUR_HALF_W) : hx;
        h.setAttribute("x", String(lx));
        const box: Span = [lx - HOUR_HALF_W, lx + HOUR_HALF_W];
        h.style.visibility = outside(box[0], box[1]) || (btnBox && cross(box, btnBox)) ? "hidden" : "";
      });

      // Allt med utsträckning (data-l/data-r) som vyns kanter skulle klippa
      for (const root of [svg, ax]) {
        root.querySelectorAll<SVGElement>("[data-l]").forEach((e) => {
          e.style.visibility = outside(Number(e.dataset.l), Number(e.dataset.r)) ? "hidden" : "";
        });
      }
      // NU-linjen går obruten genom vindpanelen när vinden vid NU inte syns (vid vyns kanter) eller saknas
      const windNow = windNowEl.current;
      if (nowGapLine.current) nowGapLine.current.style.visibility = windNow && windNow.style.visibility !== "hidden" ? "hidden" : "";
      // "(gusts)" i vindrubriken bara när minst ett byvärde syns (och ordet ryms)
      if (gustWord.current) {
        const any = [...svg.querySelectorAll<SVGGElement>(".tl-wind.has-gust")].some((g) => g.style.visibility !== "hidden");
        gustWord.current.style.display = any && fit.gusts ? "" : "none";
      }

      // Solhändelser vid kanten: utanför vyn med pil ("← Sunrise 06:59"), och händelser nära
      // kanten vars egen etikett klipps – på en rad där etiketten inte krockar med någon annan.
      const labels = [...svg.querySelectorAll<SVGTextElement>(".tl-sunband .label")];
      const labelBoxes = labels
        .filter((l) => l.style.visibility !== "hidden")
        .map((l) => {
          const y = Number(l.getAttribute("y"));
          return [Number(l.dataset.l), Number(l.dataset.r), y - SUN_TEXT_H - 4, y + 4] as [number, number, number, number];
        });
      const labelled = (e: SunEvent) =>
        labels.some((l) => l.dataset.kind === e.kind && Number(l.dataset.t) === e.t && l.style.visibility !== "hidden");
      const rows = [horizonY - 4, horizonY - 18, horizonY - 32].filter((b) => b - SUN_TEXT_H >= sunTop + 1);
      const edge = (e_: SVGTextElement | null, e: SunEvent | undefined, side: "left" | "right") => {
        if (!e_) return;
        e_.style.visibility = "hidden";
        if (!e || !viewW) return;
        const out = side === "left" ? x(e.t) < visL : x(e.t) > visR;
        e_.textContent = !out ? sunEventText(e) : side === "left" ? `← ${sunEventText(e)}` : `${sunEventText(e)} →`;
        const w = e_.getComputedTextLength();
        const a = side === "left" ? visL + 4 : visR - 4 - w;
        e_.setAttribute("x", String(side === "left" ? a : visR - 4));
        for (const base of rows) {
          const box: [number, number, number, number] = [a - 4, a + w + 4, base - SUN_TEXT_H - 4, base + 4];
          if (nowX > box[0] && nowX < box[1]) break; // aldrig över NU-linjen
          if (labelBoxes.some((b) => box[0] < b[1] && b[0] < box[1] && box[2] < b[3] && b[2] < box[3])) continue;
          e_.setAttribute("y", String(base));
          e_.style.visibility = "visible";
          labelBoxes.push(box);
          return;
        }
      };
      edge(sunEdgeL.current, sunEvents.filter((e) => x(e.t) < visL + EDGE_NEAR && !labelled(e)).at(-1), "left");
      edge(sunEdgeR.current, sunEvents.find((e) => x(e.t) > visR - EDGE_NEAR && !labelled(e)), "right");
    },
    [nowX, tAt, cursorX, viewW, horizonY, sunTop, sunEvents, x, fit.gusts],
  );
  useLayoutEffect(() => placeMarkers(scroller.current?.scrollLeft ?? 0));
  const onScroll = () => {
    if (scroller.current) placeMarkers(scroller.current.scrollLeft);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const t = tAt(el.scrollLeft);
      followNow.current = Math.abs(t - now) < 5 * 60 * 1000;
      const offH = Math.round((t - now) / HOUR);
      el.setAttribute("aria-valuenow", String(offH));
      el.setAttribute(
        "aria-valuetext",
        offH === 0 ? "Now" : offH < 0 ? `${-offH} hours ago, observed` : `in ${offH} hours, forecast`,
      );
      onCursor(snap5(t));
    });
  };

  // Musdrag på desktop (touch använder native scroll).
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    markInteraction();
    if (e.pointerType !== "mouse" || !scroller.current) return;
    drag.current = { x: e.clientX, left: scroller.current.scrollLeft, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !scroller.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 3) drag.current.moved = true;
    scroller.current.scrollLeft = drag.current.left - dx;
  };
  // Tid väljs genom att dra – ett klick flyttar inte grafen.
  const onPointerUp = () => {
    drag.current = null;
  };

  // Den fasta tidsaxeln ligger utanför scrollytan: drag (mus och touch) och horisontell hjulscroll
  // på den flyttar panelerna. Lodräta svep på touch scrollar sidan (touch-action: pan-y).
  const axisDrag = useRef<{ x: number; left: number; id: number } | null>(null);
  const onAxisDown = (e: React.PointerEvent) => {
    if (!scroller.current || (e.target as Element).closest(".tl-now-btn")) return;
    markInteraction();
    axisDrag.current = { x: e.clientX, left: scroller.current.scrollLeft, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onAxisMove = (e: React.PointerEvent) => {
    const d = axisDrag.current;
    if (!d || d.id !== e.pointerId || !scroller.current) return;
    markInteraction();
    scroller.current.scrollLeft = d.left - (e.clientX - d.x);
  };
  const endAxisDrag = () => {
    axisDrag.current = null;
  };
  const onAxisWheel = (e: React.WheelEvent) => {
    if (scroller.current && Math.abs(e.deltaX) > Math.abs(e.deltaY)) scroller.current.scrollLeft += e.deltaX;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = scroller.current;
    if (!el) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const t = tAt(el.scrollLeft);
      const step = e.shiftKey ? 6 * HOUR : HOUR;
      scrollToTime(Math.round(t / HOUR) * HOUR + (e.key === "ArrowLeft" ? -step : step), true);
    } else if (e.key === "Home" || e.key.toLowerCase() === "n") {
      e.preventDefault();
      goNow();
    }
  };

  // Temperatur och daggpunkt vid tiden t (linjärt mellan punkter) – för temperaturetikettens
  // placering, så att texten inte hamnar på någon av kurvorna.
  const tempPts = useMemo(
    () => [...data.temp.observed.flat(), ...data.temp.forecast.flat()].sort((a, b) => a.t - b.t),
    [data.temp],
  );
  const dewPts = useMemo(
    () => [...data.dew.observed.flat(), ...data.dew.forecast.flat()].sort((a, b) => a.t - b.t),
    [data.dew],
  );
  // Alla vädersymboler på samma höjd i symbolraden, oberoende av temperatur och molnbas.
  const skyY = skyTop + SKY_CY;
  const histW = cursorX - AXIS_W;

  // Senaste temperaturobservationen: punkt vid mätningens egen tid (aldrig flyttad till NU) och
  // mätvärdet bredvid, placerat så att det inte krockar med kurvan, NU-linjen eller ritytans kant.
  const lastTemp = useMemo(() => {
    const p = data.temp.observed.at(-1)?.at(-1);
    if (!p) return null;
    const text = `${fmtTemp(p.v)} °C`;
    const cx = x(p.t);
    const cy = yTemp(p.v);
    const label = placeTempLabel({
      cx,
      cy,
      nowX: x(now),
      width: text.length * TLAST_CHAR_W,
      plotTop: chartTop,
      plotBottom: chartBottom,
      labelsBottom: chartTop + 2,
      // Den smala historiken på mobil: etiketten hålls till höger om vänsteraxeln vid NU.
      minX: viewW ? x(now) - histW + 2 : undefined,
      curveY: (px) => {
        const v = tempAt(tempPts, start + (px / PX_PER_HOUR) * HOUR);
        return v === undefined ? cy : yTemp(v);
      },
      otherCurves: [
        (px) => {
          const t = start + (px / PX_PER_HOUR) * HOUR;
          if (!dewPts.length || t < dewPts[0].t || t > dewPts[dewPts.length - 1].t) return undefined;
          const v = tempAt(dewPts, t);
          return v === undefined ? undefined : yTemp(v);
        },
      ],
    });
    return { t: p.t, cx, cy, text, label, sign: tempSign(p.v) };
  }, [data.temp.observed, x, yTemp, now, chartTop, chartBottom, tempPts, dewPts, start, viewW, histW]);

  // Dimrisk: ytan mellan temperatur och daggpunkt där spridningen är under 1 °C – minst
  // FOG_MIN_PX hög, så att den syns även där kurvorna sammanfaller. Ingen text: betraktaren
  // förstår själv vad ytan betyder.
  const fogPaths = useMemo(
    () =>
      data.fogRisk.map((b) => {
        const ys = b.map((p) => {
          const hi = yTemp(p.hi);
          const lo = yTemp(p.lo);
          const mid = (hi + lo) / 2;
          return lo - hi < FOG_MIN_PX ? [mid - FOG_MIN_PX / 2, mid + FOG_MIN_PX / 2] : [hi, lo];
        });
        const top = b.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${ys[i][0].toFixed(1)}`).join("");
        const bottom = b.map((p, i) => [p, i] as const).reverse().map(([p, i]) => `L${x(p.t).toFixed(1)},${ys[i][1].toFixed(1)}`).join("");
        return `${top}${bottom}Z`;
      }),
    [data.fogRisk, x, yTemp],
  );

  // Nederbörd kring timmen t – ger regn under molnsymbolen. En observerad symbol använder bara
  // observationer och en prognossymbol bara prognosen, så att den senaste observationen inte
  // färgar nästa timmes prognos.
  const precipAt = useMemo(() => {
    return (t: number, forecast: boolean) =>
      (forecast ? data.precipForecast : data.precipObserved).find((p) => p.drawT1 > t - HOUR / 2 && p.drawT0 < t + HOUR / 2);
  }, [data.precipObserved, data.precipForecast]);
  // Dimma/dis kring timmen t: rapporterad dimma/dis, sikt under 1 km, eller sikt under 5 km
  // utan nederbörd (annars är det nederbörden som skymmer). Dimma går före dis. Som nederbörden:
  // observerat för observerade symboler, prognos för prognossymboler.
  const fogAt = useMemo(() => {
    return (t: number, forecast: boolean) =>
      data.lowVis
        .filter(
          (v) => v.forecast === forecast && v.t1 > t - HOUR / 2 && v.t0 < t + HOUR / 2 && (v.phenomenon || v.severe || !precipAt(t, forecast)),
        )
        .sort((a, b) => Number(b.severe) - Number(a.severe))[0];
  }, [data.lowVis, precipAt]);
  // Symboler: en per timme där data är timvis, annars en per datasteg – aldrig en symbol som går
  // utanför diagrammets ändar (vyns kanter döljer dem i placeMarkers).
  const skyShown = useMemo(
    () => data.sky.filter((k) => x(k.t) - SKY_HALF_W >= 0 && x(k.t) + SKY_HALF_W <= W),
    [data.sky, x, W],
  );

  // Nederbördens värden: medianen som siffra, ensemblens maximum som "max 0.4" när medianen är
  // under 0,1 mm. Över stapeln, eller bredvid NU-linjen när den annars skulle korsa texten; en
  // etikett som skulle krocka med föregående visas inte (stapeln står kvar).
  const precipLabels = useMemo(() => {
    const out = new Map<number, PrecipLabel>();
    let lastR = -Infinity;
    for (const p of data.precipHours) {
      if (p.possible <= 0) continue;
      const w = p.likely > 0 ? fmtMm(p.likely).length * MM_CHAR_W : MAX_PREFIX_W + fmtMm(p.possible).length * MM_CHAR_W;
      const cx = (x(p.t0) + x(p.t1)) / 2;
      let label: PrecipLabel = { x: cx, anchor: "middle", x0: cx - w / 2, x1: cx + w / 2 };
      if (nowX > label.x0 - 3 && nowX < label.x1 + 3) {
        label = x(p.t1) - nowX >= nowX - x(p.t0)
          ? { x: nowX + 4, anchor: "start", x0: nowX + 4, x1: nowX + 4 + w }
          : { x: nowX - 4, anchor: "end", x0: nowX - 4 - w, x1: nowX - 4 };
      }
      if (label.x0 < lastR + 3) continue;
      out.set(p.t0, label);
      lastR = label.x1;
    }
    return out;
  }, [data.precipHours, x, nowX]);

  // Vind varje timme: pil och medelvind, byarna inom parentes i samma rad ("6 (9)", byarna
  // mindre) när de är minst 1 m/s över medelvinden – och vinden vid NU på NU-linjen, samma som
  // avläsningen (den observationen står inte också vid sin egen tid). En timme vars pil skulle
  // krocka med pilen vid NU visas inte; ett värde som skulle krocka med värdet vid NU eller med
  // föregående (tvåsiffrig medelvind med byar) står bara som pil.
  const wind = useMemo(() => {
    const item = (a: Arrow, cx: number) => {
      const speed = Math.round(a.speed);
      const gust = showGust(a.speed, a.gust) ? Math.round(a.gust) : undefined;
      const len = (n: number) => String(n).length;
      const w = len(speed) * WIND_DIGIT_W + (gust !== undefined ? WIND_SPACE_W + 2 * WIND_PAREN_W + len(gust) * WIND_GUST_DIGIT_W : 0);
      return { a, cx, speed, gust, w, hw: Math.max(WIND_ARROW_HW, w / 2), label: true };
    };
    const atNow = data.windNow ? item(data.windNow, nowX) : undefined;
    const hours: WindItem[] = [];
    let lastR = -Infinity;
    for (const a of data.wind) {
      if (!a.forecast && a.t === data.windNow?.observedAt) continue;
      const it = item(a, x(a.t));
      const d = Math.abs(it.cx - nowX);
      if (atNow && d < 2 * WIND_ARROW_HW + WIND_GAP) continue;
      it.label = (!atNow || d >= (it.w + atNow.w) / 2 + WIND_GAP) && it.cx - it.w / 2 >= lastR + WIND_GAP;
      if (it.label) lastR = it.cx + it.w / 2;
      hours.push(it);
    }
    return { hours, atNow };
  }, [data.wind, data.windNow, x, nowX]);
  // NU-linjens lucka bakom vinden vid NU, i streckmönstrets takt så att mönstret fortsätter obrutet
  // nedanför. placeMarkers drar linjen genom luckan när värdet inte syns.
  const onDash = (y: number, round: (v: number) => number) => AXIS_H + round((y - AXIS_H) / NOW_DASH) * NOW_DASH;
  const nowGap = [onDash(windTop + 2, Math.floor), onDash(windTop + 40, Math.ceil)];

  const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${yTemp(p.v).toFixed(1)}`).join("");
  const tint = Math.max(0, Math.min(W, nowX));

  return (
    <div className="tl" style={{ height: H }}>
      {/* Fast tidsaxel: följer med när sidan scrollas (sticky under sidhuvudet) och följer panelernas
          horisontella scroll. Bakgrunden täcker det som scrollar under den. */}
      <div
        className="tl-axis"
        style={{ height: AXIS_H }}
        onPointerDown={onAxisDown}
        onPointerMove={onAxisMove}
        onPointerUp={endAxisDrag}
        onPointerCancel={endAxisDrag}
        onWheel={onAxisWheel}
      >
        <div className="tl-axis-clip" aria-hidden>
          <div ref={axisTrack} className="tl-axis-track" style={{ width: W + padL + padR }}>
            <svg ref={axisSvg} width={W} height={AXIS_H} style={{ position: "absolute", left: padL, top: 0 }}>
              {tint > 0 && <rect x={0} y={0} width={tint} height={AXIS_H} className="tl-obs-tint" />}
              {/* Dygnsbyte – bara i tidsaxeln */}
              {hours
                .filter((h) => h.h === 0)
                .map((h) => (
                  <line key={`dl${h.t}`} x1={x(h.t)} x2={x(h.t)} y1={0} y2={AXIS_H} className="tl-dayline" shapeRendering="crispEdges" />
                ))}
              {/* Pillraden (etiketterna placeras i placeMarkers), timtal (glesare på smal skärm) och
                  streck ned mot axellinjen */}
              <line x1={0} x2={W} y1={AXIS_H - 0.5} y2={AXIS_H - 0.5} className="tl-axisline" />
              {hours.map((h) => (
                <g key={h.t}>
                  <line x1={x(h.t)} x2={x(h.t)} y1={AXIS_H - 4} y2={AXIS_H} className="tl-tick" />
                  {(!narrow || h.h % 2 === 0) && (
                    <text x={x(h.t)} data-x={x(h.t)} y={HOUR_BASE} className="tl-hour" textAnchor="middle">
                      {String(h.h).padStart(2, "0")}
                    </text>
                  )}
                </g>
              ))}
              {hours
                .filter((h) => h.h === 0)
                .map((h) => (
                  <text key={`day${h.t}`} x={x(h.t) + 4} y={PILL_BASE} className="tl-daylabel" textAnchor="start">
                    {dayDate(h.t)}
                  </text>
                ))}
              <text ref={obsLabel} x={nowX - 6} y={PILL_BASE} className="tl-side obs" textAnchor="end">
                ← OBSERVED
              </text>
              <text ref={fcLabel} x={nowX + 6} y={PILL_BASE} className="tl-side fc" textAnchor="start">
                FORECAST →
              </text>
              <line x1={nowX} x2={nowX} y1={AXIS_H % NOW_DASH} y2={AXIS_H} className="tl-now" shapeRendering="crispEdges" />
            </svg>
            {/* NOW-pillen i pillraden; läget (flagga till höger eller vänster om linjen) sätts i placeMarkers */}
            <span ref={nowPill} className="tl-nowpill" style={{ left: padL + nowX, top: PILL_TOP }}>
              NOW {fmtTime(now)}
            </span>
          </div>
        </div>
        {/* Markörens del i axeln och dess etikett i pillraden */}
        <div ref={axisCursorEl} className="tl-cursor tl-cursor-axis at-now" style={{ left: cursorX, top: 0, height: AXIS_H }} aria-hidden>
          <span ref={cursorLabel} className="tl-cursor-label" style={{ top: PILL_TOP }} />
        </div>
        {/* Now: längst till höger i timtalens rad, bara när man panorerat bort från NU. Tryckytan är
            minst 44 × 44 px. */}
        <button ref={nowBtn} type="button" className="tl-now-btn" onClick={goNow} aria-label="Back to now">
          Now
        </button>
      </div>

      {/* Fast vänsterkolumn: gruppernas rubriker (samma plats och typografi), skalor och radnamn */}
      <div className="tl-yaxis" aria-hidden>
        <span className="tl-rubric" style={{ top: cloudTop }}>
          {RUBRIC_TEXT.clouds[fit.clouds]}
        </span>
        <span className="tl-rowlabel two" style={{ top: precipTop + PRECIP_H / 2 }}>
          Precip
          <br />
          mm/h
        </span>
        <span className="tl-rubric" style={{ top: tempTop }}>
          {RUBRIC_TEXT.temp[fit.temp]} <span className="u">°C</span>
        </span>
        <i className="tl-taxis" style={{ top: chartTop, height: TEMP_H, ["--zero" as string]: `${(zeroOff * 100).toFixed(2)}%` } as React.CSSProperties} />
        {data.temp.ticks.map((v) => (
          <span key={v} className={`${v === t0 ? "tl-ttick lo" : v === t1 ? "tl-ttick hi" : "tl-ttick"} ${tempSign(v)}`} style={{ top: yTemp(v) }}>
            {`${v}°`.replace("-", "−")}
          </span>
        ))}
        <span className="tl-rubric" style={{ top: windPanelTop }}>
          Wind <span className="u">m/s</span>
          <span ref={gustWord} className="u">
            {" "}
            (gusts)
          </span>
        </span>
        <span className="tl-rubric" style={{ top: lightTop }}>
          Light
        </span>
        {/* Mäter rubrikernas bredd i deras egen typografi */}
        <span ref={measure} className="tl-rubric measure" />
      </div>
      <div
        ref={scroller}
        className="tl-scroller"
        style={{ top: AXIS_H }}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Timeline. Left and right arrows move one hour, N returns to now."
        aria-describedby={sunLabels.length ? sunDescId : undefined}
        aria-valuemin={MIN_OFFSET_H}
        aria-valuemax={maxOffsetH}
        aria-valuenow={0}
      >
        <div style={{ width: W + padL + padR, height: H - AXIS_H, position: "relative" }}>
          <svg
            ref={svgEl}
            width={W}
            height={H - AXIS_H}
            style={{ position: "absolute", left: padL, top: 0 }}
            role="img"
            aria-label="Chart in five panels on one time axis: time; clouds (weather symbols) and precipitation per hour; temperature and dew point; wind with gusts; and daylight as the sun's altitude. Solid is observed, dashed is forecast."
          >
            {/* Temperatur och daggpunkt: rött över 0 °C, blått under – skarp gräns vid 0°-linjen */}
            <defs>
              <linearGradient id="tl-sign-temp" className="tl-sign" gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={chartTop} y2={chartBottom}>
                <stop offset={zeroOff} className="pos" />
                <stop offset={zeroOff} className="neg" />
              </linearGradient>
              <linearGradient id="tl-sign-dew" className="tl-sign dew" gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={chartTop} y2={chartBottom}>
                <stop offset={zeroOff} className="pos" />
                <stop offset={zeroOff} className="neg" />
              </linearGradient>
            </defs>
            {/* Samma koordinater som hela diagrammet – tidsaxeln (0–AXIS_H) ligger i eget lager ovanför */}
            <g transform={`translate(0,${-AXIS_H})`}>
              {/* Mycket svag ton över hela observationsdelen, i alla grupper */}
              {tint > 0 && <rect x={0} y={AXIS_H} width={tint} height={H - AXIS_H} className="tl-obs-tint" />}

              {/* Ljusets bakgrund: skymningszonerna som horisontella band under horisonten, gul yta
                  bara mellan kurvan och horisonten där solen är uppe – ovanför neutral. */}
              <g className="tl-sunband">
                {SUN_ZONES.map((z) => (
                  <rect key={z.zone} x={0} y={ySun(z.top)} width={W} height={ySun(z.bottom) - ySun(z.top)} className={`zone ${z.zone}`} />
                ))}
                <path d={sunFill} className="fill" />
              </g>

              {/* Svaga gridlinjer för varje hel timme genom alla grupper – något tydligare vid 00, 06,
                  12 och 18 */}
              {hours.map((h) => (
                <line
                  key={`vg${h.t}`}
                  x1={x(h.t)}
                  x2={x(h.t)}
                  y1={AXIS_H}
                  y2={H}
                  className={h.h % 6 === 0 ? "tl-vgrid major" : "tl-vgrid"}
                  shapeRendering="crispEdges"
                />
              ))}
              {/* Tunna avgränsare mellan grupperna */}
              {separators.map((y) => (
                <line key={`sep${y}`} x1={0} x2={W} y1={y} y2={y} className="tl-panelsep" shapeRendering="crispEdges" />
              ))}

              {/* Diskreta stödlinjer för temperaturen; 0 °C tydligare när den ryms i skalan. Kanterna
                  ritas som gruppens ram – som 0°-linje när skalan slutar på 0 °C. */}
              {data.temp.ticks
                .filter((v) => v !== t0 && v !== t1)
                .map((v) => (
                  <line key={`tg${v}`} x1={0} x2={W} y1={yTemp(v)} y2={yTemp(v)} className={v === 0 ? "tl-grid zero" : "tl-grid"} />
                ))}
              <line x1={0} x2={W} y1={chartTop} y2={chartTop} className={t1 === 0 ? "tl-grid zero" : "tl-grid"} />
              <line x1={0} x2={W} y1={chartBottom} y2={chartBottom} className={t0 === 0 ? "tl-grid zero" : "tl-grid"} />

              {data.thunder.map((m, i) => (
                <text key={`th${i}`} x={(x(m.t0) + x(m.t1)) / 2} y={chartTop + 16} textAnchor="middle" className={`tl-thunder${m.forecast ? " fc" : ""}`}>
                  ϟ<title>{m.label}</title>
                </text>
              ))}

              {/* Dimrisk mellan kurvorna, sedan daggpunkt och temperatur överst */}
              {fogPaths.map((d, i) => (
                <path key={`fog${i}`} d={d} className="tl-fogrisk" />
              ))}
              {data.dew.forecast.map((s, i) => (
                <path key={`df${i}`} d={pathOf(s)} className="tl-line fc dew" />
              ))}
              {data.dew.observed.map((s, i) =>
                s.length === 1 ? (
                  <circle key={`do${i}`} cx={x(s[0].t)} cy={yTemp(s[0].v)} r={2} className="tl-dot dew" />
                ) : (
                  <path key={`do${i}`} d={pathOf(s)} className="tl-line obs dew" />
                ),
              )}
              {data.temp.forecast.map((s, i) => (
                <path key={`tf${i}`} d={pathOf(s)} className="tl-line fc temp" />
              ))}
              {data.temp.observed.map((s, i) =>
                s.length === 1 ? (
                  <circle key={`to${i}`} cx={x(s[0].t)} cy={yTemp(s[0].v)} r={2.5} className="tl-dot temp" />
                ) : (
                  <path key={`to${i}`} d={pathOf(s)} className="tl-line obs temp" />
                ),
              )}

              {/* Nederbörd per timme: trolig mängd (median) mörk, ensemblens maximum ljust */}
              {data.precipHours.map((p) => (
                <PrecipHourBar key={`ph${p.t0}`} p={p} x={x} base={precipTop + PRECIP_H - 2} max={precipMax} label={precipLabels.get(p.t0)} />
              ))}

              {/* Solbanan ovanpå gridlinjerna: horisonten vid 0°, kurvan (dold under −18°), markörer och etiketter */}
              <g className="tl-sunband">
                <line x1={0} x2={W} y1={horizonY} y2={horizonY} className="horizon" />
                {sunCurves.map((d, i) => (
                  <path key={`sun${i}`} d={d} className="curve" />
                ))}
                {sunEvents.map((e) => (
                  <circle key={`m${e.kind}${e.t}`} cx={x(e.t)} cy={ySun(EVENT_ALT[e.kind])} r={e.kind === "sunrise" || e.kind === "sunset" ? 3 : 2.5} className={`mark ${e.kind}`}>
                    <title>{sunEventText(e)}</title>
                  </circle>
                ))}
                {sunLabels.map((l) => (
                  <text key={`${l.kind}${l.t}`} x={l.x} y={l.y} textAnchor={l.anchor} data-l={l.x0} data-r={l.x1} data-kind={l.kind} data-t={l.t} className={`label ${l.kind}`}>
                    {l.text}
                  </text>
                ))}
                {/* Solhändelser utanför vyn, vid närmaste kant – texten och läget sätts i placeMarkers */}
                <text ref={sunEdgeL} className="edge" textAnchor="start" />
                <text ref={sunEdgeR} className="edge" textAnchor="end" />
              </g>

              {/* Vädersymboler överst i molngruppen, alla på samma höjd och på sin timme; dimma/dis
                  ersätter molnsymbolen */}
              {skyShown.map((k) => {
                const fogK = fogAt(k.t, k.forecast);
                const rain = precipAt(k.t, k.forecast);
                const what = fogK ? fogK.label : skyTitle(k);
                const rainText = rain
                  ? ` · ${rain.label}${rain.mm !== undefined ? ` ${rain.mm.toFixed(1)} mm` : ""}${rain.probability !== undefined ? `, ${Math.round(rain.probability)} %` : ""}`
                  : "";
                return (
                  <g key={`sky${k.t}`} data-l={x(k.t) - SKY_HALF_W} data-r={x(k.t) + SKY_HALF_W} transform={`translate(${x(k.t)},${skyY})`} className={`tl-skyicon${k.forecast ? " fc" : ""}`}>
                    {fogK ? <FogIcon severe={fogK.severe} /> : <SkyIcon sky={k} day={k.day} />}
                    {rain && <RainMarks kind={rain.kind} />}
                    <title>{`${fmtTime(k.t)}: ${what}${rainText}${k.forecast ? " (forecast)" : ""}`}</title>
                  </g>
                );
              })}

              {/* Vind varje timme: pilen visar åt vilket håll vinden blåser; medelvind och byar inom parentes i samma rad */}
              {wind.hours.map((it) => (
                <WindMark key={it.a.t} it={it} top={windTop} />
              ))}

              {/* NU genom alla grupper – med en lucka bakom vinden vid NU (fylls när värdet inte syns) */}
              <line x1={nowX} x2={nowX} y1={AXIS_H} y2={nowGap[0]} className="tl-now" shapeRendering="crispEdges" />
              <line ref={nowGapLine} x1={nowX} x2={nowX} y1={nowGap[0]} y2={nowGap[1]} className="tl-now" shapeRendering="crispEdges" />
              <line x1={nowX} x2={nowX} y1={nowGap[1]} y2={H} className="tl-now" shapeRendering="crispEdges" />
              {/* Vinden vid NU: senaste observationen, samma som avläsningen */}
              {wind.atNow && <WindMark ref={windNowEl} it={wind.atNow} top={windTop} observedAt={data.windNow?.observedAt} />}

              {/* Senaste temperaturobservationen – ovanpå NU-linjen, vid mätningens egen tid */}
              {lastTemp && (
                <g>
                  <circle cx={lastTemp.cx} cy={lastTemp.cy} r={3.5} className={`tl-tlast ${lastTemp.sign}`} />
                  <text
                    x={lastTemp.label.x}
                    y={lastTemp.label.baseline}
                    textAnchor="end"
                    data-l={lastTemp.label.x - lastTemp.text.length * TLAST_CHAR_W}
                    data-r={lastTemp.label.x}
                    className={`tl-tlast-label ${lastTemp.sign}`}
                  >
                    {lastTemp.text}
                  </text>
                  <title>{`Latest temperature observation, ${fmtTime(lastTemp.t)}: ${lastTemp.text}`}</title>
                </g>
              )}

              {/* Saknade data */}
              <Missing x={nowX - 20} y={chartTop + TEMP_H / 2} text={data.missing.temp} anchor="end" />
              <Missing x={nowX - 20} y={windTop + 24} text={data.missing.wind} anchor="end" />
              <Missing x={nowX + 20} y={chartTop + TEMP_H / 2} text={data.missing.forecast} anchor="start" />
            </g>
          </svg>
        </div>
      </div>
      <p id={sunDescId} className="sr-only">
        {sunLabels.map((l) => `${l.text}`).join(". ")}
      </p>

      {/* Fast markör en femtedel in i ritytan (panelernas del – axelns del ligger i tidsaxeln) */}
      <div ref={cursorEl} className="tl-cursor at-now" style={{ left: cursorX, top: AXIS_H, height: H - AXIS_H }} aria-hidden />
    </div>
  );
});

/** Linjär interpolation i sorterade punkter; utanför kurvan används närmaste ände. */
function tempAt(pts: Pt[], t: number): number | undefined {
  if (!pts.length) return undefined;
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return pts[pts.length - 1].v;
}

/** "Thu 24 Sep" */
const dayDate = (t: number) => fmtDateTime(t).split(", ")[0];

/** Regn under molnsymbolen: tre korta streck (snö: prickar), x och y relativt symbolens underkant
 *  – korta nog att rymmas i symbolraden (slutar ~17 px under symbolens mitt). */
const RAIN_MARKS: Array<[number, number]> = [
  [-6, 2],
  [0, 4],
  [6, 2],
];
const RAIN_LEN = 5;

/**
 * Nederbörd som symbol: några korta streck eller prickar direkt under molnet, samma längd oavsett
 * var kurvan ligger. Signalerar bara att det regnar/snöar – mängden visas av timstaplarna.
 */
function RainMarks({ kind }: { kind: Precip["kind"] }) {
  const snow = kind === "snö";
  const d = RAIN_MARKS.map(([dx, dy]) => `M${dx},${SKY_BOTTOM + dy}${snow ? "l0,0.1" : `l-1.6,${RAIN_LEN}`}`).join("");
  return (
    <g className={`tl-precip k-${snow ? "sno" : "regn"}`}>
      <path d={d} />
    </g>
  );
}

/** Stapelns största höjd – plats för värdet ovanför inom bandet. */
const PR_BAR_MAX = PRECIP_H - 16;
const fmtMm = (mm: number) => (mm < 10 ? mm.toFixed(1) : String(Math.round(mm)));
/**
 * En timmes nederbörd: stapel från nollinjen, linjär skala 0–max (minst 2 mm/h). Mörk del =
 * uppmätt eller trolig mängd (SMHI-ensemblens median), ljus förlängning = ensemblens maximum.
 * Värdet står ovanför stapeln från 0,1 mm/h: medianen som siffra, och när medianen är under
 * 0,1 mm ensemblens maximum som "max 0.4" – ingen övre gräns, så aldrig "≤". Torra timmar ritas inte.
 */
type PrecipLabel = { x: number; anchor: "start" | "middle" | "end"; x0: number; x1: number };

/** Vind vid en tidpunkt i diagrammet: x, avrundade värden, värdets bredd och om värdet får plats. */
type WindItem = { a: Arrow; cx: number; speed: number; gust?: number; w: number; hw: number; label: boolean };

/**
 * Vind: pilen visar åt vilket håll vinden blåser (en punkt vid varierande vind), under den
 * medelvinden och byarna inom parentes i samma rad, "6 (9)". Utan plats för värdet bara pilen.
 * `observedAt`: vinden vid NU – observationens tid i verktygstipset.
 */
function WindMark({ it, top, observedAt, ref }: { it: WindItem; top: number; observedAt?: number; ref?: Ref<SVGGElement> }) {
  const { a, cx, speed, gust, label } = it;
  const hw = label ? it.hw : WIND_ARROW_HW;
  const when = observedAt !== undefined ? ` (observed ${fmtTime(observedAt)})` : a.forecast ? " (forecast)" : "";
  return (
    <g
      ref={ref}
      transform={`translate(${cx},0)`}
      data-l={cx - hw}
      data-r={cx + hw}
      className={`tl-wind${a.forecast ? " fc" : ""}${label && gust !== undefined ? " has-gust" : ""}`}
    >
      {a.deg !== undefined && !a.variable ? (
        <g transform={`translate(0,${top + 12}) rotate(${a.deg})`}>
          <path d="M0,-7 L0,6 M-3.5,2.5 L0,7 L3.5,2.5" />
        </g>
      ) : (
        <circle cy={top + 12} r={2.5} className="tl-wind-vrb" />
      )}
      {label && (
        <text y={top + 35} textAnchor="middle" className="tl-wind-speed">
          {speed}
          {gust !== undefined && <tspan className="gust">{` (${gust})`}</tspan>}
        </text>
      )}
      <title>{`${observedAt !== undefined ? "Now: " : ""}${speed} m/s${gust !== undefined ? `, gusts ${gust} m/s` : ""}${when}`}</title>
    </g>
  );
}

function PrecipHourBar({ p, x, base, max, label }: { p: PrecipHour; x: (t: number) => number; base: number; max: number; label?: PrecipLabel }) {
  if (p.possible <= 0) return null;
  const x0 = x(p.t0) + 3;
  const w = Math.max(1, x(p.t1) - x(p.t0) - 6);
  const h = (mm: number) => (mm <= 0 ? 0 : Math.max(1.5, (Math.min(mm, max) / max) * PR_BAR_MAX));
  const top = base - Math.max(h(p.likely), h(p.possible));
  const interval = `${fmtTime(p.t0)}–${fmtTime(p.t1)}`;
  const edge = label ? { "data-l": label.x0, "data-r": label.x1 } : {};
  return (
    <g className={`tl-prh ${p.kind === "snö" ? "snow" : "rain"}${p.forecast ? " fc" : ""}`}>
      {p.likely > 0 && <line x1={x(p.t0) + 1} x2={x(p.t1) - 1} y1={base + 0.5} y2={base + 0.5} className="zero" />}
      {p.forecast && p.possible > p.likely && <rect x={x0} y={base - h(p.possible)} width={w} height={h(p.possible)} className="possible" />}
      {p.likely > 0 && <rect x={x0} y={base - h(p.likely)} width={w} height={h(p.likely)} className="likely" />}
      {label &&
        (p.likely > 0 ? (
          <text x={label.x} y={top - 3} textAnchor={label.anchor} className="likely" {...edge}>
            {fmtMm(p.likely)}
          </text>
        ) : (
          // Troligen uppehåll men nederbörd möjlig: ensemblens största mängd, märkt "max".
          <text x={label.x} y={top - 3} textAnchor={label.anchor} className="possible" {...edge}>
            <tspan className="mx">max </tspan>
            {fmtMm(p.possible)}
          </text>
        ))}
      <title>
        {p.forecast
          ? `${p.likely > 0 ? `Median ${fmtMm(p.likely)} mm` : "Most likely dry (median under 0.1 mm)"} during ${interval}${p.possible > p.likely ? `; ensemble maximum ${fmtMm(p.possible)} mm` : ""} (SMHI)`
          : `${fmtMm(p.likely)} mm during ${interval} (measured)`}
      </title>
    </g>
  );
}

function Missing({ x, y, text, anchor }: { x: number; y: number; text?: string; anchor: "start" | "end" }) {
  if (!text) return null;
  return (
    <text x={x} y={y} className="tl-missing" textAnchor={anchor}>
      {text}
    </text>
  );
}
