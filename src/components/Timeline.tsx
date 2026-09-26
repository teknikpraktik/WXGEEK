"use client";

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  HOUR,
  PAST_HOURS,
  type ChartData,
  type Precip,
  type PrecipHour,
  type Pt,
} from "@/lib/client/timeline";
import { fmtDateTime, localHour, fmtTemp, fmtTime } from "@/lib/format";
import { placeTempLabel } from "@/lib/client/tempLabel";
import { fogBands } from "@/lib/client/fogBand";
import { HORIZON, SUN_ZONES, sunBandLabels, sunCurveSegments, sunY, withHorizonCrossings } from "@/lib/client/sunBand";
import { FogIcon, SkyIcon, skyTitle } from "./SkyIcon";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;
/** Vald tid avrundas till 5 min – en pixel motsvarar knappt 2 minuter. */
const snap5 = (t: number) => Math.round(t / 300_000) * 300_000;

// Layout (px). Fem grupper på samma tidsaxel, uppifrån: tidsaxel, moln och nederbörd, temperatur
// och daggpunkt, vind, ljus. Varje grupp har en rubrikrad; mellan grupperna lika mycket luft på
// var sida om en tunn avgränsare.
/** Tidsaxeln överst: NOW-pillen och datum, timtal, axellinjen i nederkanten. */
const AXIS_H = 36;
const GAP = 6;
const RUBRIC_H = 15;
/** Vädersymbolerna (molnsymbol med regnstreck) och deras mitt i raden. */
const SKY_H = 32;
const SKY_CY = 13;
/** Molntäcke i tre skikt (högt överst) och taket ur TAF. */
const CLOUD_ROW_H = 8;
const CEIL_H = 13;
/** Nederbörd per timme; skalan minst 0–2 mm/h. */
const PRECIP_H = 36;
/** Temperatur och daggpunkt – en tredjedel lägre än förut (220 px). */
const TEMP_H = 148;
const WIND_H = 50;
/** Ljus: solhöjd −18°…60° i tvådelad skala. */
const SUN_H = 64;
/** Vänsteraxelns bredd (.tl-yaxis) – den ligger över diagrammets vänsterkant. */
const AXIS_W = 60;
/** Markören (NU vid start och efter Now) står en femtedel in i ritytan: 20 % observerat, 80 %
 *  prognos – med samma pixlar per timme på båda sidor, så att historiken är en fjärdedel av
 *  den synliga prognosen (t.ex. ~4 h bakåt och ~16 h framåt på en dator). */
const CURSOR_AT = 0.2;
/** Bredd på "← OBSERVED" (9,5 px siffror, 10 tecken). Ryms den inte i den synliga historiken
 *  vid NU – på mobil – står "← OBS." med tätare spärrning. */
const OBS_LABEL_W = 69;
/** Bredd på kortformen "← OBS." */
const OBS_SHORT_W = 40;
/** Vald tid räknas som NU inom 10 minuter (px) – då visas bara NU-linjen och dess etikett. */
const AT_NOW_PX = (10 / 60) * PX_PER_HOUR;
/** NOW-pillen centreras när vald tid ligger minst så här långt bort (px), annars flyttas den
 *  till sidan bort från vald tids etikett, och döljs när även det skulle krocka. */
const NOW_LABEL_CLEAR_PX = 62;
const NOW_LABEL_SIDE_PX = 24;
/** Molnsymbolens underkant relativt dess mitt – regnet börjar här. */
const SKY_BOTTOM = 7;
/** Halva symbolbredden: symboler som skulle klippas av vyns kanter döljs. */
const SKY_HALF_W = 13;
/** Ungefärlig teckenbredd för temperaturetiketten ("11 °C", 11 px siffror). */
const TLAST_CHAR_W = 6.8;
/** Dimrisk: ytan mellan temperatur och daggpunkt där spridningen är högst så här stor (°C). */
const FOG_SPREAD = 2;

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
  // Synlig historik vid NU (px): ritytans femtedel mellan vänsteraxeln och NU-linjen.
  const histW = cursorX - AXIS_W;
  const obsShort = viewW > 0 && histW < OBS_LABEL_W + 8;
  const narrow = viewW > 0 && viewW < 520;

  // Grupperna uppifrån, med avgränsare mitt i luften mellan dem
  const cloudTop = AXIS_H + GAP; // tidsaxelns linje avgränsar första gruppen
  const skyTop = cloudTop + RUBRIC_H;
  const rowsTop = skyTop + SKY_H;
  const ceilTop = rowsTop + 3 * CLOUD_ROW_H + 4;
  const precipTop = ceilTop + CEIL_H;
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
  // Symbolrad: varannan timme, var tredje på smala skärmar.
  const skyEvery = narrow ? 3 : 2;
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

  const firstRecenter = useRef(true);
  useEffect(() => {
    if (firstRecenter.current) {
      firstRecenter.current = false;
      return;
    }
    followNow.current = true;
    scrollToTime(now, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal]);

  const cursorEl = useRef<HTMLDivElement>(null);
  const cursorLabel = useRef<HTMLSpanElement>(null);
  const nowPill = useRef<HTMLSpanElement>(null);
  const svgEl = useRef<SVGSVGElement>(null);
  const nowX = x(now);
  /**
   * Vald tid vid NU: bara NU-linjen och dess pill. Annars får pillerna aldrig överlappa: NOW
   * flyttas åt sidan eller döljs. Timtal och datum under pillerna döljs. Allt som vänsteraxeln
   * eller vyns högerkant skulle klippa – symboler, vindpilar, etiketter, timtal – döljs hellre än
   * visas halvt, och takets värde följer med in i vyn så länge perioden syns.
   * Markörens etikett sätts bara här (React renderar den tom) – annars skriver en omrendering,
   * t.ex. när klockan går, över vald tid med aktuell tid.
   */
  const placeMarkers = useCallback(
    (scrollLeft: number) => {
      if (cursorLabel.current) cursorLabel.current.textContent = fmtTime(snap5(tAt(scrollLeft)));
      const dx = nowX - scrollLeft; // NU relativt vald tid (markören står på scrollLeft i SVG:n)
      const ax = Math.abs(dx);
      const atNow = ax < AT_NOW_PX;
      cursorEl.current?.classList.toggle("at-now", atNow);
      const pill = nowPill.current;
      const svg = svgEl.current;
      if (!pill || !svg) return;
      // Ritytans synliga del i SVG:ns x: från vänsteraxelns kant till vyns högerkant.
      const visL = scrollLeft - (cursorX - AXIS_W);
      const visR = scrollLeft + (viewW - cursorX);
      const outside = (a: number, b: number) => viewW > 0 && (a < visL + 1 || b > visR - 1);
      const side = atNow || ax >= NOW_LABEL_CLEAR_PX ? 0 : dx < 0 ? -1 : 1;
      pill.style.transform = side === 0 ? "translateX(-50%)" : side < 0 ? "translateX(calc(-100% - 6px))" : "translateX(6px)";
      const pw = pill.offsetWidth;
      const px0 = side === 0 ? nowX - pw / 2 : side < 0 ? nowX - 6 - pw : nowX + 6;
      const pillShown = (atNow || ax >= NOW_LABEL_SIDE_PX) && !outside(px0, px0 + pw);
      pill.style.visibility = pillShown ? "" : "hidden";
      const covered: Array<[number, number]> = [];
      if (pillShown) covered.push([px0 - 4, px0 + pw + 4]);
      const cw = atNow ? 0 : (cursorLabel.current?.offsetWidth ?? 0);
      if (cw) covered.push([scrollLeft - cw / 2 - 4, scrollLeft + cw / 2 + 4]);
      const hidden = (a: number, b: number) => outside(a, b) || covered.some(([c, d]) => b > c && a < d);
      svg.querySelectorAll<SVGTextElement>(".tl-hour").forEach((h) => {
        const hx = Number(h.getAttribute("x"));
        h.style.visibility = hidden(hx - 7, hx + 7) ? "hidden" : "";
      });
      svg.querySelectorAll<SVGTextElement>(".tl-daylabel").forEach((d) => {
        const dx0 = Number(d.getAttribute("x"));
        d.style.visibility = hidden(dx0, dx0 + d.getComputedTextLength()) ? "hidden" : "";
      });
      svg.querySelectorAll<SVGElement>("[data-l]").forEach((el) => {
        el.style.visibility = outside(Number(el.dataset.l), Number(el.dataset.r)) ? "hidden" : "";
      });
      svg.querySelectorAll<SVGTextElement>(".tl-ceiling text").forEach((t) => {
        const a = Math.max(Number(t.dataset.x0), visL) + 3;
        t.setAttribute("x", String(a));
        t.style.visibility = a + t.getComputedTextLength() > Math.min(Number(t.dataset.x1), visR) - 2 ? "hidden" : "";
      });
    },
    [nowX, tAt, cursorX, viewW],
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
        offH === 0 ? "Nu" : offH < 0 ? `${-offH} timmar sedan, observerat` : `om ${offH} timmar, prognos`,
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
      followNow.current = true;
      scrollToTime(now, true);
    }
  };

  // Timmarkeringar
  const hours = useMemo(() => {
    const out: Array<{ t: number; h: number }> = [];
    for (let t = start; t <= end; t += HOUR) out.push({ t, h: localHour(t) });
    return out;
  }, [start, end]);

  // Temperatur vid tiden t (linjärt mellan punkter) – för temperaturetikettens placering.
  const tempPts = useMemo(
    () => [...data.temp.observed.flat(), ...data.temp.forecast.flat()].sort((a, b) => a.t - b.t),
    [data.temp],
  );
  // Alla vädersymboler på samma höjd i symbolraden, oberoende av temperatur och molnbas.
  const skyY = skyTop + SKY_CY;

  // Senaste temperaturobservationen: punkt vid mätningens egen tid (aldrig flyttad till NU) och
  // mätvärdet bredvid, placerat så att det inte krockar med kurvan, NU-linjen eller rubrikerna.
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
      labelsBottom: chartTop + 15, // raden med OBSERVED/FORECAST
      // Den smala historiken på mobil: etiketten hålls till höger om vänsteraxeln vid NU.
      minX: viewW ? x(now) - histW + 2 : undefined,
      curveY: (px) => {
        const v = tempAt(tempPts, start + (px / PX_PER_HOUR) * HOUR);
        return v === undefined ? cy : yTemp(v);
      },
    });
    return { t: p.t, cx, cy, text, label };
  }, [data.temp.observed, x, yTemp, now, chartTop, chartBottom, tempPts, start, viewW, histW]);

  // Dimrisk: ytan mellan temperatur och daggpunkt där spridningen är högst 2 °C.
  const fogPaths = useMemo(
    () =>
      fogBands([...data.temp.observed, ...data.temp.forecast], [...data.dew.observed, ...data.dew.forecast], FOG_SPREAD).map((b) => {
        const top = b.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${yTemp(p.hi).toFixed(1)}`).join("");
        const bottom = [...b].reverse().map((p) => `L${x(p.t).toFixed(1)},${yTemp(p.lo).toFixed(1)}`).join("");
        return `${top}${bottom}Z`;
      }),
    [data.temp, data.dew, x, yTemp],
  );

  // Ljus: solhöjden i tvådelad fast skala (−18°…horisonten på 35 %, horisonten…60° på 65 %),
  // kurvan var 10:e minut på samma tidsaxel och dold under −18°; gul yta bara där solen är uppe.
  // Horisontlinjen ligger vid −0,833°, så att kurvan korsar den vid soluppgången och solnedgången.
  const ySun = useCallback((alt: number) => sunY(alt, sunTop, SUN_H), [sunTop]);
  const sunWindow = useMemo(() => data.sun.path.filter((p) => p.t >= start - HOUR && p.t <= end + HOUR), [data.sun.path, start, end]);
  const sunCurves = useMemo(
    () => sunCurveSegments(sunWindow).map((seg) => seg.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${ySun(p.alt).toFixed(1)}`).join("")),
    [sunWindow, x, ySun],
  );
  const sunFill = useMemo(() => {
    const pts = withHorizonCrossings(sunWindow);
    if (!pts.length) return "";
    const y0 = ySun(HORIZON).toFixed(1);
    const edge = pts.map((p) => `L${x(p.t).toFixed(1)},${ySun(Math.max(HORIZON, p.alt)).toFixed(1)}`).join("");
    return `M${x(pts[0].t).toFixed(1)},${y0}${edge}L${x(pts[pts.length - 1].t).toFixed(1)},${y0}Z`;
  }, [sunWindow, x, ySun]);
  const sunLabels = useMemo(
    () => sunBandLabels({ path: data.sun.path, events: data.sun.events, start, end, x, y: ySun, top: sunTop, bottom: sunTop + SUN_H, width: W }),
    [data.sun.path, data.sun.events, start, end, x, ySun, sunTop, W],
  );
  // Nederbörd kring timmen t (observerad eller prognos) – ger regn under molnsymbolen.
  const precipAt = useMemo(() => {
    const all = [...data.precipObserved, ...data.precipForecast];
    return (t: number) => all.find((p) => p.drawT1 > t - HOUR / 2 && p.drawT0 < t + HOUR / 2);
  }, [data.precipObserved, data.precipForecast]);
  const wet = useCallback((t: number) => !!precipAt(t), [precipAt]);
  // Dimma/dis kring timmen t: rapporterad dimma/dis, sikt under 1 km, eller sikt under 5 km
  // utan nederbörd (annars är det nederbörden som skymmer). Dimma går före dis.
  const fogAt = useMemo(() => {
    return (t: number) =>
      data.lowVis
        .filter((v) => v.t1 > t - HOUR / 2 && v.t0 < t + HOUR / 2 && (v.phenomenon || v.severe || !wet(t)))
        .sort((a, b) => Number(b.severe) - Number(a.severe))[0];
  }, [data.lowVis, wet]);
  // Symboler: jämna klockslag, timmar med nederbörd, och minst en per dimperiod. På smala
  // skärmar bara de jämna klockslagen, så att raden inte blir trång. Aldrig en symbol som går
  // utanför diagrammets ändar.
  const skyShown = useMemo(() => {
    const inside = (t: number) => x(t) - SKY_HALF_W >= 0 && x(t) + SKY_HALF_W <= W;
    if (narrow) return data.sky.filter((k) => localHour(k.t) % skyEvery === 0 && inside(k.t));
    const regular = (t: number) => localHour(t) % skyEvery === 0 || wet(t);
    const out = new Set<number>();
    let run: number[] = [];
    const flush = () => {
      if (run.length && !run.some(regular)) out.add(run[Math.floor(run.length / 2)]);
      run = [];
    };
    for (const k of data.sky) {
      if (regular(k.t)) out.add(k.t);
      if (fogAt(k.t)) run.push(k.t);
      else flush();
    }
    flush();
    return data.sky.filter((k) => out.has(k.t) && inside(k.t));
  }, [data.sky, narrow, skyEvery, wet, fogAt, x, W]);

  const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${yTemp(p.v).toFixed(1)}`).join("");
  const rowY = (i: number) => rowsTop + i * (CLOUD_ROW_H + 1); // 0 högt, 1 medel, 2 lågt

  return (
    <div className="tl" style={{ height: H }}>
      {/* Fast vänsterkolumn: gruppernas rubriker (samma plats och typografi), skalor och radnamn */}
      <div className="tl-yaxis" aria-hidden>
        <span className="tl-rubric" style={{ top: cloudTop }}>
          {narrow ? "Clouds & precip." : "Clouds & precipitation"}
        </span>
        {data.cloudCover.length > 0 &&
          ["High", "Mid", "Low"].map((r, i) => (
            <span key={r} className="tl-rowlabel" style={{ top: rowY(i) + CLOUD_ROW_H / 2 }}>
              {r}
            </span>
          ))}
        {data.ceilings.length > 0 && (
          <span className="tl-rowlabel" style={{ top: ceilTop + CEIL_H / 2 }}>
            Ceiling
          </span>
        )}
        <span className="tl-rowlabel" style={{ top: precipTop + PRECIP_H - 8 }}>
          mm/h
        </span>
        <span className="tl-rubric" style={{ top: tempTop }}>
          Temperature <span className="u">°C</span>
        </span>
        <i className="tl-taxis" style={{ top: chartTop, height: TEMP_H }} />
        {data.temp.ticks.map((v) => (
          <span key={v} className={v === t0 ? "tl-ttick lo" : v === t1 ? "tl-ttick hi" : "tl-ttick"} style={{ top: yTemp(v) }}>
            {`${v}°`.replace("-", "−")}
          </span>
        ))}
        <span className="tl-rubric" style={{ top: windPanelTop }}>
          Wind (gusts) <span className="u">m/s</span>
        </span>
        <span className="tl-rubric" style={{ top: lightTop }}>
          Light
        </span>
      </div>
      {/* Temperaturgruppens förklaring, högerställd i rubrikraden – långt från NU-linjen */}
      <div className="tl-legend" style={{ top: tempTop }} aria-hidden>
        <i className="lg temp" />
        Temp
        <i className="lg dew" />
        Dew point
        <i className="lg fogrisk" />
        Spread ≤ {FOG_SPREAD}°
      </div>
      <div
        ref={scroller}
        className="tl-scroller"
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
        <div style={{ width: W + padL + padR, height: H, position: "relative" }}>
          <svg
            ref={svgEl}
            width={W}
            height={H}
            style={{ position: "absolute", left: padL, top: 0 }}
            role="img"
            aria-label="Chart in five panels on one time axis: time; clouds (weather symbols, low, mid and high cloud cover, ceiling from the TAF) and precipitation per hour; temperature and dew point; wind with gusts; and daylight as the sun's altitude. Solid is observed, dashed is forecast."
          >
            <defs>
              <pattern id="vv" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1="0" y1="0" x2="0" y2="4" className="tl-vv" />
              </pattern>
            </defs>

            {/* Ljusets bakgrund: skymningszonerna som horisontella band under horisonten, gul yta
                bara mellan kurvan och horisonten där solen är uppe – ovanför neutral. */}
            <g className="tl-sunband">
              {SUN_ZONES.map((z) => (
                <rect key={z.zone} x={0} y={ySun(z.top)} width={W} height={ySun(z.bottom) - ySun(z.top)} className={`zone ${z.zone}`} />
              ))}
              <path d={sunFill} className="fill" />
            </g>

            {/* Molntäcke per timme i tre skikt – tonen efter åttondelarna; okänt skikt lämnas tomt */}
            <g className="tl-cloudcover">
              {data.cloudCover.map((c) =>
                (["high", "mid", "low"] as const).map((layer, i) =>
                  c[layer] ? (
                    <rect
                      key={`${c.t}${layer}`}
                      x={x(c.t) - PX_PER_HOUR / 2 + 0.5}
                      y={rowY(i)}
                      width={PX_PER_HOUR - 1}
                      height={CLOUD_ROW_H}
                      fillOpacity={Math.min(1, c[layer]! / 8)}
                      className={c.forecast ? "cc fc" : "cc"}
                    >
                      <title>{`${fmtTime(c.t)} ${layer} cloud ${Math.round(c[layer]!)}/8 – ${c.label}`}</title>
                    </rect>
                  ) : null,
                ),
              )}
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

            {/* Tak ur TAF: en markering per period med värdet i meter och källan; efter TAF:ens
                giltighetstid ingenting */}
            <g className="tl-ceiling">
              {data.ceilings.map((c, i) => {
                const x0 = x(c.t0);
                const x1 = x(c.t1);
                const y = ceilTop + CEIL_H - 3;
                const text = `${c.cover === "VV" ? "VV " : ""}${Math.round(c.baseM / 10) * 10} m`;
                const first = i === 0 || data.ceilings[i - 1].t1 !== c.t0;
                const labelW = (text.length + (first ? 4 : 0)) * 5.6 + 4;
                return (
                  <g key={`ceil${c.t0}`}>
                    <line x1={x0} x2={x1} y1={y} y2={y} className="line" />
                    <line x1={x0} x2={x0} y1={y - 4} y2={y} className="line" />
                    {x1 - x0 >= labelW && (
                      <text x={x0 + 3} y={y - 2} data-x0={x0} data-x1={x1} className="value">
                        {first && <tspan className="via">TAF </tspan>}
                        {text}
                      </text>
                    )}
                    <title>{`Ceiling ${text} (${c.cover}), TAF ${c.stationId}, ${fmtTime(c.t0)}–${fmtTime(c.t1)}`}</title>
                  </g>
                );
              })}
            </g>

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
              <text key={`th${i}`} x={(x(m.t0) + x(m.t1)) / 2} y={chartTop + 30} textAnchor="middle" className={`tl-thunder${m.forecast ? " fc" : ""}`}>
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

            {/* Nederbörd per timme: trolig mängd mörk, möjlig ljus */}
            {data.precipHours.map((p) => (
              <PrecipHourBar key={`ph${p.t0}`} p={p} x={x} base={precipTop + PRECIP_H - 2} max={precipMax} />
            ))}

            {/* Solbanan ovanpå gridlinjerna: horisonten vid 0°, kurvan (dold under −18°) och etiketterna */}
            <g className="tl-sunband">
              <line x1={0} x2={W} y1={ySun(HORIZON)} y2={ySun(HORIZON)} className="horizon" />
              {sunCurves.map((d, i) => (
                <path key={`sun${i}`} d={d} className="curve" />
              ))}
              {sunLabels.map((l) => (
                <text key={`${l.kind}${l.t}`} x={l.x} y={l.y} textAnchor={l.anchor} data-l={l.x0} data-r={l.x1} className={`label ${l.kind}`}>
                  {l.text}
                </text>
              ))}
            </g>

            {/* Vädersymboler överst i molngruppen, alla på samma höjd och på sin timme; dimma/dis
                ersätter molnsymbolen */}
            {skyShown.map((k) => {
              const fog = fogAt(k.t);
              const rain = precipAt(k.t);
              const what = fog ? fog.label : skyTitle(k);
              const rainText = rain
                ? ` · ${rain.label}${rain.mm !== undefined ? ` ${rain.mm.toFixed(1)} mm` : ""}${rain.probability !== undefined ? `, ${Math.round(rain.probability)} %` : ""}`
                : "";
              return (
                <g key={`sky${k.t}`} data-l={x(k.t) - SKY_HALF_W} data-r={x(k.t) + SKY_HALF_W} transform={`translate(${x(k.t)},${skyY})`} className={`tl-skyicon${k.forecast ? " fc" : ""}`}>
                  {fog ? <FogIcon severe={fog.severe} /> : <SkyIcon sky={k} day={k.day} />}
                  {rain && <RainMarks kind={rain.kind} />}
                  <title>{`${fmtTime(k.t)}: ${what}${rainText}${k.forecast ? " (forecast)" : ""}`}</title>
                </g>
              );
            })}

            {/* Vind: pil och medelvind, byar under i avvikande ton inom parentes */}
            {data.wind.map((a) => {
              const gust = a.gust !== undefined && a.gust >= a.speed + 3 ? a.gust : undefined;
              const hw = gust !== undefined ? 11 : 7;
              return (
              <g key={a.t} transform={`translate(${x(a.t)},0)`} data-l={x(a.t) - hw} data-r={x(a.t) + hw} className={a.forecast ? "tl-wind fc" : "tl-wind"}>
                {a.deg !== undefined && !a.variable ? (
                  <g transform={`translate(0,${windTop + 11}) rotate(${a.deg})`}>
                    <path d="M0,-7 L0,6 M-3.5,2.5 L0,7 L3.5,2.5" />
                  </g>
                ) : (
                  <circle cy={windTop + 11} r={2.5} className="tl-wind-vrb" />
                )}
                <text y={windTop + 32} textAnchor="middle" className="tl-wind-speed">
                  {Math.round(a.speed)}
                </text>
                {gust !== undefined && (
                  <text y={windTop + 44} textAnchor="middle" className="tl-wind-gust">
                    ({Math.round(gust)})
                  </text>
                )}
                <title>{`${Math.round(a.speed)} m/s${a.gust ? `, gusts ${Math.round(a.gust)} m/s` : ""}${a.forecast ? " (forecast)" : ""}`}</title>
              </g>
              );
            })}

            {/* Tidsaxel överst: timtal (glesare på smal skärm), streck ned mot axellinjen och datum
                vid dygnsbytet på pillernas rad */}
            <line x1={0} x2={W} y1={AXIS_H} y2={AXIS_H} className="tl-axisline" />
            {hours.map((h) => (
              <g key={h.t}>
                <line x1={x(h.t)} x2={x(h.t)} y1={AXIS_H - 4} y2={AXIS_H} className="tl-tick" />
                {(!narrow || h.h % 2 === 0) && (
                  <text x={x(h.t)} y={AXIS_H - 8} className="tl-hour" textAnchor="middle">
                    {String(h.h).padStart(2, "0")}
                  </text>
                )}
              </g>
            ))}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <g key={`day${h.t}`}>
                  {/* Bara i datumraden – inte genom timtalet "00" */}
                  <line x1={x(h.t)} x2={x(h.t)} y1={2} y2={AXIS_H - 20} className="tl-dayline" />
                  <text x={x(h.t) + 4} y={12} className="tl-daylabel" textAnchor="start">
                    {dayDate(h.t)}
                  </text>
                </g>
              ))}

            {/* NU genom alla grupper */}
            <line x1={nowX} x2={nowX} y1={2} y2={H} className="tl-now" shapeRendering="crispEdges" />
            {/* Döljs bara när temperaturetiketten behöver raden (mätningen högst i fönstret).
                Kortform när historiken vid NU är för smal för hela ordet (mobil). */}
            <text
              x={nowX - (obsShort ? 6 : 8)}
              y={chartTop + 12}
              className={obsShort ? "tl-side obs short" : "tl-side obs"}
              textAnchor="end"
              data-l={nowX - (obsShort ? 6 + OBS_SHORT_W : 8 + OBS_LABEL_W)}
              data-r={nowX - (obsShort ? 6 : 8)}
              visibility={lastTemp?.label.hideObserved ? "hidden" : undefined}
            >
              {obsShort ? "← OBS." : "← OBSERVED"}
            </text>
            <text x={nowX + 8} y={chartTop + 12} className="tl-side fc" textAnchor="start" data-l={nowX + 8} data-r={nowX + 8 + OBS_LABEL_W}>
              FORECAST →
            </text>

            {/* Senaste temperaturobservationen – ovanpå NU-linjen, vid mätningens egen tid */}
            {lastTemp && (
              <g>
                <circle cx={lastTemp.cx} cy={lastTemp.cy} r={3.5} className="tl-tlast" />
                <text
                  x={lastTemp.label.x}
                  y={lastTemp.label.baseline}
                  textAnchor="end"
                  data-l={lastTemp.label.x - lastTemp.text.length * TLAST_CHAR_W}
                  data-r={lastTemp.label.x}
                  className="tl-tlast-label"
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
          </svg>
          {/* NOW-pillen ovanför tidsaxeln; läget åt sidan sätts i placeMarkers */}
          <span ref={nowPill} className="tl-nowpill" style={{ left: padL + nowX, top: 1 }}>
            NOW {fmtTime(now)}
          </span>
        </div>
      </div>
      <p id={sunDescId} className="sr-only">
        {sunLabels.map((l) => `${SUN_WORD[l.kind]} ${l.text.replace(/^[↑↓] |^Max /, "")}`).join(". ")}
      </p>

      {/* Fast markör en femtedel in i ritytan; dess pill på samma rad som NOW-pillen */}
      <div ref={cursorEl} className="tl-cursor at-now" style={{ left: cursorX, top: 0, height: H }} aria-hidden>
        <span ref={cursorLabel} className="tl-cursor-label" style={{ top: 1 }} />
      </div>
    </div>
  );
});

/** Ord för skärmläsare till solens etiketter */
const SUN_WORD = { max: "Sun highest", sunrise: "Sunrise", sunset: "Sunset", dawn: "Civil dawn begins", dusk: "Civil dusk ends" } as const;

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
const PR_BAR_MAX = PRECIP_H - 14;
const fmtMm = (mm: number) => (mm < 10 ? mm.toFixed(1) : String(Math.round(mm)));
/**
 * En timmes nederbörd: stapel från nollinjen, linjär skala 0–max (minst 2 mm/h). Mörk del =
 * trolig/uppmätt mängd, ljus förlängning = möjlig (övre delen av SMHI:s spridning). Värdet står
 * ovanför stapeln från 0,1 mm/h; torra timmar ritas inte alls.
 */
function PrecipHourBar({ p, x, base, max }: { p: PrecipHour; x: (t: number) => number; base: number; max: number }) {
  if (p.possible <= 0) return null;
  const x0 = x(p.t0) + 3;
  const w = Math.max(1, x(p.t1) - x(p.t0) - 6);
  const cx = (x(p.t0) + x(p.t1)) / 2;
  const h = (mm: number) => (mm <= 0 ? 0 : Math.max(1.5, (Math.min(mm, max) / max) * PR_BAR_MAX));
  const top = base - Math.max(h(p.likely), h(p.possible));
  // Värdets bredd (10 px siffror, "≤" mindre) – det döljs när vyns kanter skulle klippa det.
  const lw = p.likely > 0 ? fmtMm(p.likely).length * 6 : fmtMm(p.possible).length * 6 + 5;
  const edge = { "data-l": cx - lw / 2, "data-r": cx + lw / 2 };
  const interval = `${fmtTime(p.t0)}–${fmtTime(p.t1)}`;
  return (
    <g className={`tl-prh ${p.kind === "snö" ? "snow" : "rain"}${p.forecast ? " fc" : ""}`}>
      {p.likely > 0 && <line x1={x(p.t0) + 1} x2={x(p.t1) - 1} y1={base + 0.5} y2={base + 0.5} className="zero" />}
      {p.forecast && p.possible > p.likely && <rect x={x0} y={base - h(p.possible)} width={w} height={h(p.possible)} className="possible" />}
      {p.likely > 0 && <rect x={x0} y={base - h(p.likely)} width={w} height={h(p.likely)} className="likely" />}
      {p.likely > 0 ? (
        <text x={cx} y={top - 2} textAnchor="middle" className="likely" {...edge}>
          {fmtMm(p.likely)}
        </text>
      ) : (
        // Troligen uppehåll men nederbörd möjlig: visa övre gränsen som "upp till".
        p.possible > 0 && (
          <text x={cx} y={top - 2} textAnchor="middle" className="possible" {...edge}>
            <tspan className="le">≤</tspan>
            {fmtMm(p.possible)}
          </text>
        )
      )}
      <title>
        {p.forecast
          ? `${p.likely > 0 ? `Expected ${fmtMm(p.likely)} mm` : "Most likely dry"} during ${interval}${p.possible > p.likely ? `, possibly up to ${fmtMm(p.possible)} mm` : ""} (SMHI ensemble)`
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
