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
import { fmtDateTime, localHour, fmtTime } from "@/lib/format";
import { FogIcon, SkyIcon, skyTitle } from "./SkyIcon";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;
/** Vald tid avrundas till 5 min – en pixel motsvarar knappt 2 minuter. */
const snap5 = (t: number) => Math.round(t / 300_000) * 300_000;

// Layout (px)
const TOP = 26; // NU / OBSERVERAT / PROGNOS
const CHART_H = 250; // temperatur (vänster axel) + droppar, dimma och vattenansamling vid marken
const GROUND_PAD = 6; // luft under marklinjen
const PRECIP_H = 30; // mm per timme
const WIND_H = 50;
const AXIS_H = 30;
/** Molnsymbolen ritas så här högt över temperaturkurvan (symbolens mitt, px). */
const SKY_LIFT = 17;
/** Nederbörden börjar vid molnsymbolens underkant. */
const SKY_BOTTOM = 7;

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
  const pad = viewW / 2;
  const x = useCallback((t: number) => ((t - start) / HOUR) * PX_PER_HOUR, [start]);
  const tAt = useCallback((scrollLeft: number) => start + (scrollLeft / PX_PER_HOUR) * HOUR, [start]);
  const maxOffsetH = Math.max(1, Math.round((until - now) / HOUR));

  // Layout
  const chartTop = TOP;
  const groundY = chartTop + CHART_H - GROUND_PAD;
  const chartBottom = chartTop + CHART_H;
  const precipTop = chartBottom;
  const axisTop = precipTop + PRECIP_H;
  const windTop = axisTop + AXIS_H + 2;
  const H = windTop + WIND_H;

  // Temperaturskala (°C, linjär); molnighet, nederbörd och vind ligger utanför ritytan.
  // Skalan fyller hela ritytan upp till överkanten, så att axeln följer bakgrunden.
  const plotH = CHART_H - GROUND_PAD;
  const [t0, t1] = data.temp.domain;
  // Symbolrad: varannan timme, var tredje på smala skärmar.
  const skyEvery = viewW > 0 && viewW < 520 ? 3 : 2;
  // Nederbördens skala: 0 till ett jämnt värde (minst 2 mm) över fönstrets största mängd.
  const precipMax = Math.max(2, Math.ceil(Math.max(0, ...data.precipHours.map((p) => p.possible))));
  const yTemp = useCallback((v: number) => groundY - 6 - ((v - t0) / (t1 - t0)) * (plotH - 6), [t0, t1, groundY, plotH]);

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
  const onScroll = () => {
    // Markörlinjen döljs vid NU (bara romben syns ovanpå den gröna NU-linjen).
    if (scroller.current) {
      const t = tAt(scroller.current.scrollLeft);
      const atNow = Math.abs(t - now) < 10 * 60 * 1000;
      cursorEl.current?.classList.toggle("at-now", atNow);
      if (cursorLabel.current) cursorLabel.current.textContent = fmtTime(snap5(t));
    }
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
  // Kalenderdygn i fönstret (gränser vid 00) – varannat dygn får en diskret bakgrund i tidsaxeln.
  const days = useMemo(() => {
    const cuts = [start, ...hours.filter((h) => h.h === 0 && h.t > start).map((h) => h.t), end];
    return cuts.slice(1).map((t1, i) => ({ t0: cuts[i], t1, alt: i % 2 === 1 }));
  }, [hours, start, end]);

  // Temperatur vid tiden t (linjärt mellan punkter) – molnen ligger på kurvan.
  const tempPts = useMemo(
    () => [...data.temp.observed.flat(), ...data.temp.forecast.flat()].sort((a, b) => a.t - b.t),
    [data.temp],
  );
  const skyY = useCallback(
    (t: number) => {
      const v = tempAt(tempPts, t);
      const y = v === undefined ? chartTop + CHART_H / 2 : yTemp(v) - SKY_LIFT;
      // Ovanför kurvan, men inte uppe i OBSERVED/FORECAST-raden.
      return Math.max(chartTop + 24, y);
    },
    [tempPts, yTemp, chartTop],
  );
  // Timmar med nederbörd får alltid en molnsymbol, så att regnet kommer ur ett moln.
  const wet = useMemo(() => {
    const all = [...data.precipObserved, ...data.precipForecast];
    return (t: number) => all.some((p) => p.drawT1 > t - HOUR / 2 && p.drawT0 < t + HOUR / 2);
  }, [data.precipObserved, data.precipForecast]);
  // Dimma/dis kring timmen t: rapporterad dimma/dis, sikt under 1 km, eller sikt under 5 km
  // utan nederbörd (annars är det nederbörden som skymmer). Dimma går före dis.
  const fogAt = useMemo(() => {
    return (t: number) =>
      data.lowVis
        .filter((v) => v.t1 > t - HOUR / 2 && v.t0 < t + HOUR / 2 && (v.phenomenon || v.severe || !wet(t)))
        .sort((a, b) => Number(b.severe) - Number(a.severe))[0];
  }, [data.lowVis, wet]);
  // Symboler: jämna klockslag, timmar med nederbörd, och minst en per dimperiod.
  const skyShown = useMemo(() => {
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
  }, [data.sky, skyEvery, wet, fogAt]);

  const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${yTemp(p.v).toFixed(1)}`).join("");
  const nowX = x(now);
  // Aktuell temperatur (senaste observation, annars första prognospunkten) färgar °C-rubriken.
  const nowTemp = data.temp.observed.at(-1)?.at(-1)?.v ?? data.temp.forecast[0]?.[0]?.v;

  return (
    <div className="tl" style={{ height: H }}>
      {/* Vänster axel: temperatur (°C) */}
      <div className="tl-yaxis" aria-hidden>
        <span className={`tl-axtitle temp ${tempSign(nowTemp)}`} style={{ top: 4 }}>
          °C
        </span>
        {t1 > 0 && <i className="tl-taxis warm" style={{ top: yTemp(t1), height: yTemp(Math.max(0, t0)) - yTemp(t1) }} />}
        {t0 < 0 && <i className="tl-taxis cold" style={{ top: yTemp(Math.min(0, t1)), height: yTemp(t0) - yTemp(Math.min(0, t1)) }} />}
        {data.temp.ticks.map((v) => (
          <span key={v} className={`tl-ttick ${tempSign(v)}`} style={{ top: yTemp(v) }}>
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
        <div style={{ width: W + pad * 2, height: H, position: "relative" }}>
          <svg
            width={W}
            height={H}
            style={{ position: "absolute", left: pad, top: 0 }}
            role="img"
            aria-label="Chart: cloud base in metres (left axis), temperature in °C (right axis), precipitation from the cloud base, wind below. Solid is observed, dashed is forecast."
          >
            <defs>
              {/* Temperatur: blått under noll, rött över – intensivare ju längre från noll */}
              <linearGradient id="tempgrad" gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={yTemp(t0)} y2={yTemp(t1)}>
                {tempStops(t0, t1).map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch" />
              </pattern>
              <pattern id="vv" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1="0" y1="0" x2="0" y2="4" className="tl-vv" />
              </pattern>
            </defs>

            {/* Bakgrund: observerat vs prognos */}
            <rect x={0} y={chartTop} width={nowX} height={H - chartTop} className="tl-bg-obs" />
            <rect x={nowX} y={chartTop} width={Math.max(0, W - nowX)} height={H - chartTop} fill="url(#hatch)" />

            {/* Rutnät: molnbasens nivåer, marklinje, fältgränser, dygnsgränser */}
            {/* Diskreta stödlinjer per 5 °C; 0 °C något tydligare */}
            {data.temp.ticks.map((v) => (
              <line key={`tg${v}`} x1={0} x2={W} y1={yTemp(v)} y2={yTemp(v)} className={v === 0 ? "tl-grid zero" : "tl-grid"} />
            ))}
            <line x1={0} x2={W} y1={groundY} y2={groundY} className="tl-ground" />
            <line x1={0} x2={W} y1={precipTop} y2={precipTop} className="tl-lanesep" />
            <line x1={0} x2={W} y1={windTop - 1} y2={windTop - 1} className="tl-lanesep" />

            {/* Nederbörd – droppar från molnbasen över hela tiden det regnar */}
            {[...data.precipObserved, ...data.precipForecast.map((p) => ({ ...p, fc: true }))].map((p, i) => (
              <PrecipStreaks
                key={`pr${i}`}
                p={p}
                forecast={"fc" in p}
                x={x}
                tAtX={(px) => start + (px / PX_PER_HOUR) * HOUR}
                fromY={skyY}
                toY={groundY - 1}
                unknownBase={false}
              />
            ))}

            {data.thunder.map((m, i) => (
              <text key={`th${i}`} x={(x(m.t0) + x(m.t1)) / 2} y={chartTop + 30} textAnchor="middle" className={`tl-thunder${m.forecast ? " fc" : ""}`}>
                ϟ<title>{m.label}</title>
              </text>
            ))}

            {/* Temperatur – överst */}
            {data.temp.forecast.map((s, i) => (
              <path key={`tf${i}`} d={pathOf(s)} className="tl-line fc" style={{ stroke: "url(#tempgrad)" }} />
            ))}
            {data.temp.observed.map((s, i) =>
              s.length === 1 ? (
                <circle key={`to${i}`} cx={x(s[0].t)} cy={yTemp(s[0].v)} r={2.5} style={{ fill: tempColor(s[0].v) }} />
              ) : (
                <path key={`to${i}`} d={pathOf(s)} className="tl-line obs" style={{ stroke: "url(#tempgrad)" }} />
              ),
            )}

            {/* Nederbörd per timme direkt under marklinjen: trolig mängd mörk, möjlig ljus */}
            {data.precipHours.map((p) => (
              <PrecipHourBar key={`ph${p.t0}`} p={p} x={x} base={precipTop + PRECIP_H - 3} max={precipMax} />
            ))}

            {/* Molnighet på temperaturkurvan; dimma/dis ersätter molnsymbolen */}
            {skyShown.map((k) => {
              const fog = fogAt(k.t);
              const what = fog ? fog.label : skyTitle(k);
              return (
                <g key={`sky${k.t}`} transform={`translate(${x(k.t)},${skyY(k.t)})`} className={`tl-skyicon${k.forecast ? " fc" : ""}`}>
                  {fog ? <FogIcon severe={fog.severe} /> : <SkyIcon sky={k} day={k.day} />}
                  <title>{`${fmtTime(k.t)}: ${what}${k.forecast ? " (forecast)" : ""}`}</title>
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
            {days
              .filter((d) => d.alt && d.t1 > d.t0)
              .map((d) => (
                <rect key={`day${d.t0}`} x={x(d.t0)} y={axisTop} width={x(d.t1) - x(d.t0)} height={AXIS_H} className="tl-axisband newday" />
              ))}
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
            <line x1={nowX} x2={nowX} y1={TOP - 6} y2={H} className="tl-now" />
            <text x={nowX} y={TOP - 11} className="tl-nowlabel" textAnchor="middle">
              NOW {fmtTime(now)}
            </text>
            <text x={nowX - 8} y={chartTop + 12} className="tl-side obs" textAnchor="end">
              ← OBSERVED
            </text>
            <text x={nowX + 8} y={chartTop + 12} className="tl-side fc" textAnchor="start">
              FORECAST →
            </text>

            {/* Nya dygnets namn till vänster om strecket – ovanpå NU-linjen, med kontur */}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <text key={`day${h.t}`} x={x(h.t) - 4} y={axisTop + 25} className="tl-daylabel" textAnchor="end">
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

      {/* Fast markör i mitten */}
      <div ref={cursorEl} className="tl-cursor at-now" style={{ top: TOP - 4, height: H - TOP + 4 }} aria-hidden>
        <span ref={cursorLabel} className="tl-cursor-label">
          {fmtTime(now)}
        </span>
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

/** Axelfärg: rött över noll, blått under. */
const tempSign = (v: number | undefined) => (v === undefined || v === 0 ? "zero" : v > 0 ? "warm" : "cold");

/** Temperaturfärg: blått vid kyla, rött vid värme, tydligt skifte vid 0 °C. */
export function tempColor(v: number): string {
  const lerp = (a: number[], b: number[], f: number) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
  const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  if (v <= 0) {
    // 0 → −20: ljusblått → djupblått
    const f = Math.min(1, -v / 20);
    return rgb(lerp([96, 165, 250], [30, 58, 138], f));
  }
  // 0 → +25: orange → rött → mörkrött
  const f = Math.min(1, v / 25);
  return f < 0.5 ? rgb(lerp([245, 158, 11], [220, 38, 38], f * 2)) : rgb(lerp([220, 38, 38], [127, 29, 29], (f - 0.5) * 2));
}

function tempStops(lo: number, hi: number) {
  const out: Array<{ offset: number; color: string }> = [];
  const n = Math.max(2, Math.ceil(hi - lo) * 2);
  for (let i = 0; i <= n; i++) {
    const v = lo + ((hi - lo) * i) / n;
    out.push({ offset: i / n, color: tempColor(v) });
    // Skarp övergång vid noll
    const next = lo + ((hi - lo) * (i + 1)) / n;
    if (i < n && v <= 0 && next > 0) {
      const z = (0 - lo) / (hi - lo);
      out.push({ offset: z, color: tempColor(0) }, { offset: z + 1e-4, color: tempColor(0.01) });
    }
  }
  return out;
}

/**
 * Nederbörd som droppar (regn) eller prickar (snö) från molnbasen till marken, spridda
 * över hela regnperioden. Tätare ju mer det regnar.
 */
function PrecipStreaks({
  p,
  forecast,
  x,
  tAtX,
  fromY,
  toY,
  unknownBase,
}: {
  p: Precip;
  forecast: boolean;
  x: (t: number) => number;
  /** Tiden vid x (invers av x) */
  tAtX: (x: number) => number;
  /** Molnets höjd (y) vid tiden t – dropparna börjar vid dess underkant */
  fromY: (t: number) => number;
  toY: number;
  unknownBase: boolean;
}) {
  const x0 = x(p.drawT0) + 1.5;
  const x1 = x(p.drawT1) - 1.5;
  if (x1 <= x0) return null;
  // Vertikalt avstånd mellan droppar efter mängd; okänd mängd (bara väderkod) = glest.
  const rowGap = p.mm === undefined ? 16 : p.mm < 0.5 ? 18 : p.mm < 2 ? 12 : p.mm < 5 ? 9 : 7;
  const colGap = 5.5;
  const snow = p.kind === "snö";
  const len = snow ? 0.1 : 4;
  const cols = Math.max(1, Math.floor((x1 - x0) / colGap) + 1);
  const step = cols > 1 ? (x1 - x0) / (cols - 1) : 0;
  let d = "";
  for (let c = 0; c < cols; c++) {
    const xx = x0 + c * step;
    const top = fromY(tAtX(xx)) + SKY_BOTTOM;
    // Förskjut varannan kolumn så att dropparna inte hamnar i rader.
    for (let y = top + 3 + ((c * 7) % rowGap); y + len < toY; y += rowGap) {
      d += `M${xx.toFixed(1)},${y.toFixed(1)}l-0.8,${len}`;
    }
  }
  const cls = `tl-precip k-${snow ? "sno" : "regn"}${forecast ? " fc" : ""}${unknownBase ? " nobase" : ""}`;
  // Prognos: dropparnas täckning speglar SMHI:s sannolikhet för nederbörd.
  const opacity = forecast && p.probability !== undefined ? 0.2 + 0.8 * Math.min(1, p.probability / 100) : undefined;
  return (
    <g className={cls} style={opacity !== undefined ? { opacity } : undefined}>
      <path d={d} />
      <title>
        {`${p.label}${p.mm !== undefined ? ` ${p.mm.toFixed(1)} mm` : ""}${p.probability !== undefined ? `, ${Math.round(p.probability)} %` : ""}${forecast ? " (forecast)" : " (observed)"}${unknownBase ? " – cloud base unknown" : ""}`}
      </title>
    </g>
  );
}

const PR_BAR_MAX = PRECIP_H - 14;
const fmtMm = (mm: number) => (mm < 10 ? mm.toFixed(1) : String(Math.round(mm)));
/**
 * En timmes nederbörd: stapel från nollinjen, linjär skala 0–max. Mörk del = trolig/uppmätt
 * mängd, ljus förlängning = möjlig (övre delen av SMHI:s spridning). Nollinjen ritas bara för
 * timmar med uppgift, så att saknade data inte ser ut som 0 mm.
 */
function PrecipHourBar({ p, x, base, max }: { p: PrecipHour; x: (t: number) => number; base: number; max: number }) {
  const x0 = x(p.t0) + 3;
  const w = Math.max(1, x(p.t1) - x(p.t0) - 6);
  const cx = (x(p.t0) + x(p.t1)) / 2;
  const h = (mm: number) => (mm <= 0 ? 0 : Math.max(1.5, (Math.min(mm, max) / max) * PR_BAR_MAX));
  const top = base - Math.max(h(p.likely), h(p.possible));
  const interval = `${fmtTime(p.t0)}–${fmtTime(p.t1)}`;
  return (
    <g className={`tl-prh ${p.kind === "snö" ? "snow" : "rain"}${p.forecast ? " fc" : ""}`}>
      <line x1={x(p.t0) + 1} x2={x(p.t1) - 1} y1={base + 0.5} y2={base + 0.5} className="zero" />
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
            {`≤${fmtMm(p.possible)}`}
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
