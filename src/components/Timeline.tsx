"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { FogIcon, SkyIcon, skyTitle } from "./SkyIcon";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;
/** Vald tid avrundas till 5 min – en pixel motsvarar knappt 2 minuter. */
const snap5 = (t: number) => Math.round(t / 300_000) * 300_000;

// Layout (px)
const TOP = 26; // NU-etiketten och vald tids etikett
/** Symbolrad ovanför temperaturdiagrammet: alla vädersymboler på samma höjd, skilda från kurvan
 *  – symboler som följde kurvan fick den att se ut som molnens undersida. Raden slutar ~5 px
 *  under regnstrecken, så att även en symbol med regn går fri från rubriken under. */
const SKY_ROW_H = 35;
/** Symbolens mitt i raden (px från radens överkant): solstrålar når ~13 px upp, regn ~17 px ner. */
const SKY_CY = 13;
/** Rubriken "Temperature °C" och luften ned till ritytan: rubriken står precis ovanför skalan
 *  utan att krocka med dess översta värde, och symbolerna läses inte som värden över skalans topp. */
const TITLE_H = 18;
const CHART_H = 220; // temperatur (vänster axel)
const PRECIP_H = 30; // mm per timme
const WIND_H = 50;
const AXIS_H = 30;
/** Vänsteraxelns bredd (.tl-yaxis) – den ligger över diagrammets vänsterkant. */
const AXIS_W = 60;
/** Markören (NU vid start) står en fjärdedel in i diagramytan: 25 % observerat, 75 % prognos. */
const CURSOR_AT = 0.25;
/** Vald tid räknas som NU inom 10 minuter (px) – då visas bara NU-linjen och dess etikett. */
const AT_NOW_PX = (10 / 60) * PX_PER_HOUR;
/** NOW-etiketten centreras när vald tid ligger minst så här långt bort (px), annars flyttas den
 *  till sidan bort från vald tids etikett, och döljs när även det skulle krocka. */
const NOW_LABEL_CLEAR_PX = 62;
const NOW_LABEL_SIDE_PX = 24;
/** Molnsymbolens underkant relativt dess mitt – regnet börjar här. */
const SKY_BOTTOM = 7;
/** Ungefärlig teckenbredd för temperaturetiketten ("11 °C", 11 px siffror). */
const TLAST_CHAR_W = 6.8;

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

  // Layout: NU-rad, symbolrad, rubrik "Temperature °C", temperatur, nederbörd, tidsaxel, vind
  const skyTop = TOP;
  const titleTop = skyTop + SKY_ROW_H;
  const chartTop = titleTop + TITLE_H;
  const chartBottom = chartTop + CHART_H;
  const precipTop = chartBottom;
  const axisTop = precipTop + PRECIP_H;
  const windTop = axisTop + AXIS_H + 2;
  const H = windTop + WIND_H;

  // Temperaturskala (°C, linjär) över hela ritytan: högsta värdet i överkanten, lägsta i
  // nederkanten – där fältgränsen mot nederbörden också är skalans nedersta linje.
  const [t0, t1] = data.temp.domain;
  // Symbolrad: varannan timme, var tredje på smala skärmar.
  const narrow = viewW > 0 && viewW < 520;
  const skyEvery = narrow ? 3 : 2;
  // Nederbördens skala: 0 till ett jämnt värde (minst 2 mm) över fönstrets största mängd.
  const precipMax = Math.max(2, Math.ceil(Math.max(0, ...data.precipHours.map((p) => p.possible))));
  const yTemp = useCallback((v: number) => chartBottom - ((v - t0) / (t1 - t0)) * CHART_H, [t0, t1, chartBottom]);

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
  const nowLabel = useRef<SVGTextElement>(null);
  const nowX = x(now);
  /**
   * Vald tid vid NU: bara NU-linjen och dess etikett. Annars får etiketterna aldrig överlappa.
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
      const lbl = nowLabel.current;
      if (!lbl) return;
      const side = atNow || ax >= NOW_LABEL_CLEAR_PX ? 0 : dx < 0 ? -1 : 1;
      lbl.setAttribute("x", String(nowX + side * 6));
      lbl.setAttribute("text-anchor", side < 0 ? "end" : side > 0 ? "start" : "middle");
      lbl.style.visibility = !atNow && ax < NOW_LABEL_SIDE_PX ? "hidden" : "";
    },
    [nowX, tAt],
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
      curveY: (px) => {
        const v = tempAt(tempPts, start + (px / PX_PER_HOUR) * HOUR);
        return v === undefined ? cy : yTemp(v);
      },
    });
    return { t: p.t, cx, cy, text, label };
  }, [data.temp.observed, x, yTemp, now, chartTop, chartBottom, tempPts, start]);
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
  // skärmar bara de jämna klockslagen, så att raden inte blir trång – vädret finns kvar i
  // staplarna och i avläsningen.
  const skyShown = useMemo(() => {
    if (narrow) return data.sky.filter((k) => localHour(k.t) % skyEvery === 0);
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
    return data.sky.filter((k) => out.has(k.t));
  }, [data.sky, narrow, skyEvery, wet, fogAt]);

  const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${yTemp(p.v).toFixed(1)}`).join("");

  return (
    <div className="tl" style={{ height: H }}>
      {/* Vänster axel: temperatur (°C) */}
      <div className="tl-yaxis" aria-hidden>
        {/* Bredare bakgrund bakom körfälten, där etiketterna är bredast ("Precip") */}
        <i className="tl-lanebg" style={{ top: precipTop }} />
        {/* Rubriken säger vad axeln är – ett ensamt "°C" gjorde kurvan tvetydig. Under
            symbolraden och precis ovanför skalan; bakgrunden täcker NU-linjen om den scrollas hit. */}
        <span className="tl-lane tl-ttitle" style={{ top: titleTop }}>
          Temperature °C
        </span>
        <i className="tl-taxis" style={{ top: yTemp(t1), height: yTemp(t0) - yTemp(t1) }} />
        {data.temp.ticks.map((v) => (
          <span key={v} className={v === t0 ? "tl-ttick bottom" : "tl-ttick"} style={{ top: yTemp(v) }}>
            {`${v}°`.replace("-", "−")}
          </span>
        ))}
        {data.precipHours.length > 0 && (
          <span className="tl-lane tl-lane-2" style={{ top: precipTop + 2 }}>
            Precip
            <br />
            mm/h
          </span>
        )}
        {/* Två rader, så att etiketten ryms i axelkolumnen och inte krockar med pilarna */}
        <span className="tl-lane tl-lane-2" style={{ top: windTop + 2 }}>
          Wind
          <br />
          m/s
        </span>
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
        aria-valuemin={MIN_OFFSET_H}
        aria-valuemax={maxOffsetH}
        aria-valuenow={0}
      >
        <div style={{ width: W + padL + padR, height: H, position: "relative" }}>
          <svg
            width={W}
            height={H}
            style={{ position: "absolute", left: padL, top: 0 }}
            role="img"
            aria-label="Chart: weather symbols in a row at the top, temperature in °C (left axis) with a dot at the latest observation, precipitation per hour and wind below. Solid is observed, dashed is forecast."
          >
            <defs>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch" />
              </pattern>
              <pattern id="vv" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1="0" y1="0" x2="0" y2="4" className="tl-vv" />
              </pattern>
            </defs>

            {/* Bakgrund: observerat vs prognos – bara ritytan och fälten under; symbolraden ligger
                på sidans bakgrund, utanför temperaturens rityta */}
            <rect x={0} y={chartTop} width={nowX} height={H - chartTop} className="tl-bg-obs" />
            <rect x={nowX} y={chartTop} width={Math.max(0, W - nowX)} height={H - chartTop} fill="url(#hatch)" />

            {/* Diskreta stödlinjer per 5 °C; 0 °C något tydligare. Den lägsta sammanfaller med
                fältgränsen nedan och ritas inte separat – en linje i nederkanten. */}
            {data.temp.ticks
              .filter((v) => v !== t0)
              .map((v) => (
                <line key={`tg${v}`} x1={0} x2={W} y1={yTemp(v)} y2={yTemp(v)} className={v === 0 ? "tl-grid zero" : "tl-grid"} />
              ))}
            <line x1={0} x2={W} y1={precipTop} y2={precipTop} className="tl-lanesep" />
            <line x1={0} x2={W} y1={windTop - 1} y2={windTop - 1} className="tl-lanesep" />

            {data.thunder.map((m, i) => (
              <text key={`th${i}`} x={(x(m.t0) + x(m.t1)) / 2} y={chartTop + 30} textAnchor="middle" className={`tl-thunder${m.forecast ? " fc" : ""}`}>
                ϟ<title>{m.label}</title>
              </text>
            ))}

            {/* Temperatur – överst */}
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

            {/* Nederbörd per timme direkt under marklinjen: trolig mängd mörk, möjlig ljus */}
            {data.precipHours.map((p) => (
              <PrecipHourBar key={`ph${p.t0}`} p={p} x={x} base={precipTop + PRECIP_H - 3} max={precipMax} />
            ))}

            {/* Vädersymboler i en egen rad ovanför diagrammet, alla på samma höjd och på sin timme
                i samma tidsskala; dimma/dis ersätter molnsymbolen */}
            {skyShown.map((k) => {
              const fog = fogAt(k.t);
              const rain = precipAt(k.t);
              const what = fog ? fog.label : skyTitle(k);
              const rainText = rain
                ? ` · ${rain.label}${rain.mm !== undefined ? ` ${rain.mm.toFixed(1)} mm` : ""}${rain.probability !== undefined ? `, ${Math.round(rain.probability)} %` : ""}`
                : "";
              return (
                <g key={`sky${k.t}`} transform={`translate(${x(k.t)},${skyY})`} className={`tl-skyicon${k.forecast ? " fc" : ""}`}>
                  {fog ? <FogIcon severe={fog.severe} /> : <SkyIcon sky={k} day={k.day} />}
                  {rain && <RainMarks kind={rain.kind} />}
                  <title>{`${fmtTime(k.t)}: ${what}${rainText}${k.forecast ? " (forecast)" : ""}`}</title>
                </g>
              );
            })}

            {/* Vind under diagrammet: pil + m/s (+ byar) */}
            {data.wind.map((a) => (
              <g key={a.t} transform={`translate(${x(a.t)},0)`} className={a.forecast ? "tl-wind fc" : "tl-wind"}>
                {a.deg !== undefined && !a.variable ? (
                  <g transform={`translate(0,${windTop + 11}) rotate(${a.deg})`}>
                    <path d="M0,-7 L0,6 M-3.5,2.5 L0,7 L3.5,2.5" />
                  </g>
                ) : (
                  <circle cy={windTop + 11} r={2.5} className="tl-wind-vrb" />
                )}
                <text y={windTop + 34} textAnchor="middle" className="tl-wind-speed">
                  {Math.round(a.speed)}
                </text>
                {a.gust !== undefined && a.gust >= a.speed + 3 && (
                  <text y={windTop + 45} textAnchor="middle" className="tl-wind-gust">
                    {Math.round(a.gust)}
                  </text>
                )}
                <title>{`${Math.round(a.speed)} m/s${a.gust ? `, gusts ${Math.round(a.gust)} m/s` : ""}${a.forecast ? " (forecast)" : ""}`}</title>
              </g>
            ))}

            {/* Tidsaxel direkt under diagrammet */}
            <rect x={0} y={axisTop} width={W} height={AXIS_H} className="tl-axisband" />
            <line x1={0} x2={W} y1={axisTop} y2={axisTop} className="tl-axisline" />
            {hours.map((h) => (
              <g key={h.t}>
                <line x1={x(h.t)} x2={x(h.t)} y1={axisTop} y2={axisTop + 4} className="tl-tick" />
                <text x={x(h.t)} y={axisTop + 13} className="tl-hour" textAnchor="middle">
                  {String(h.h).padStart(2, "0")}
                </text>
              </g>
            ))}
            {/* Dygnsskifte: streck genom tidsaxeln vid 00 (delar "00" på mitten) */}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <line key={`mid${h.t}`} x1={x(h.t)} x2={x(h.t)} y1={axisTop} y2={windTop - 1} className="tl-dayline" />
              ))}

            {/* NU */}
            <line x1={nowX} x2={nowX} y1={TOP - 6} y2={H} className="tl-now" shapeRendering="crispEdges" />
            <text ref={nowLabel} x={nowX} y={TOP - 11} className="tl-nowlabel" textAnchor="middle">
              NOW {fmtTime(now)}
            </text>
            {/* Döljs bara när temperaturetiketten behöver raden (mätningen högst i fönstret) */}
            <text
              x={nowX - 8}
              y={chartTop + 12}
              className="tl-side obs"
              textAnchor="end"
              visibility={lastTemp?.label.hideObserved ? "hidden" : undefined}
            >
              ← OBSERVED
            </text>
            <text x={nowX + 8} y={chartTop + 12} className="tl-side fc" textAnchor="start">
              FORECAST →
            </text>

            {/* Senaste temperaturobservationen – ovanpå NU-linjen, vid mätningens egen tid */}
            {lastTemp && (
              <g>
                <circle cx={lastTemp.cx} cy={lastTemp.cy} r={3.5} className="tl-tlast" />
                <text x={lastTemp.label.x} y={lastTemp.label.baseline} textAnchor="end" className="tl-tlast-label">
                  {lastTemp.text}
                </text>
                <title>{`Latest temperature observation, ${fmtTime(lastTemp.t)}: ${lastTemp.text}`}</title>
              </g>
            )}

            {/* Nya dygnets namn till höger om strecket – ovanpå NU-linjen, med kontur */}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <text key={`day${h.t}`} x={x(h.t) + 4} y={axisTop + 25} className="tl-daylabel" textAnchor="start">
                  {dayDate(h.t)}
                </text>
              ))}

            {/* Saknade data */}
            <Missing x={nowX - 20} y={chartTop + CHART_H / 2} text={data.missing.temp} anchor="end" />
            <Missing x={nowX - 20} y={windTop + 24} text={data.missing.wind} anchor="end" />
            <Missing x={nowX + 20} y={chartTop + CHART_H / 2} text={data.missing.forecast} anchor="start" />
          </svg>
        </div>
      </div>

      {/* Fast markör en fjärdedel in i diagramytan */}
      <div ref={cursorEl} className="tl-cursor at-now" style={{ left: cursorX, top: TOP - 4, height: H - TOP + 4 }} aria-hidden>
        <span ref={cursorLabel} className="tl-cursor-label" />
      </div>
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
 *  – korta nog att rymmas i symbolraden (slutar ~16 px under symbolens mitt). */
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

const PR_BAR_MAX = PRECIP_H - 14;
const fmtMm = (mm: number) => (mm < 10 ? mm.toFixed(1) : String(Math.round(mm)));
/**
 * En timmes nederbörd: stapel från nollinjen, linjär skala 0–max. Mörk del = trolig/uppmätt
 * mängd, ljus förlängning = möjlig (övre delen av SMHI:s spridning). Nollinjen ritas bara under
 * en trolig/uppmätt mängd; torra timmar ritas inte alls.
 */
function PrecipHourBar({ p, x, base, max }: { p: PrecipHour; x: (t: number) => number; base: number; max: number }) {
  if (p.possible <= 0) return null;
  const x0 = x(p.t0) + 3;
  const w = Math.max(1, x(p.t1) - x(p.t0) - 6);
  const cx = (x(p.t0) + x(p.t1)) / 2;
  const h = (mm: number) => (mm <= 0 ? 0 : Math.max(1.5, (Math.min(mm, max) / max) * PR_BAR_MAX));
  const top = base - Math.max(h(p.likely), h(p.possible));
  const interval = `${fmtTime(p.t0)}–${fmtTime(p.t1)}`;
  return (
    <g className={`tl-prh ${p.kind === "snö" ? "snow" : "rain"}${p.forecast ? " fc" : ""}`}>
      {p.likely > 0 && <line x1={x(p.t0) + 1} x2={x(p.t1) - 1} y1={base + 0.5} y2={base + 0.5} className="zero" />}
      {p.forecast && p.possible > p.likely && <rect x={x0} y={base - h(p.possible)} width={w} height={h(p.possible)} className="possible" />}
      {p.likely > 0 && <rect x={x0} y={base - h(p.likely)} width={w} height={h(p.likely)} className="likely" />}
      {p.likely > 0 ? (
        <text x={cx} y={top - 2} textAnchor="middle" className="likely">
          {fmtMm(p.likely)}
        </text>
      ) : (
        // Troligen uppehåll men nederbörd möjlig: visa övre gränsen som "upp till".
        p.possible > 0 && (
          <text x={cx} y={top - 2} textAnchor="middle" className="possible">
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
