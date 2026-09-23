"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CLOUD_TICKS,
  CLOUD_TOP_M,
  HOUR,
  PAST_HOURS,
  type AccPt,
  type ChartData,
  type CloudBlock,
  type Precip,
  type Pt,
} from "@/lib/client/timeline";
import { fmtDay, localHour, fmtTime } from "@/lib/format";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;
/** Vald tid avrundas till 5 min – en pixel motsvarar knappt 2 minuter. */
const snap5 = (t: number) => Math.round(t / 300_000) * 300_000;

// Layout (px)
const TOP = 26; // NU / OBSERVERAT / PROGNOS
const CHART_H = 210; // molnbas (vänster axel) + temperatur (höger axel) + nederbörd
const GROUND_PAD = 6; // luft under marklinjen
const WIND_H = 44;
const AXIS_H = 26;
const RIGHT_AXIS_W = 40;
const CLOUD_H = 12;

type Props = {
  now: number;
  /** Prognosfönstrets slut (ms) */
  until: number;
  data: ChartData;
  /** Tid under markören */
  onCursor: (t: number) => void;
  /** Ökas för att be tidslinjen återgå till NU */
  recenterSignal: number;
  /** Steg en timme bakåt (-1) eller framåt (+1); `n` ökas vid varje tryck */
  stepSignal: { dir: -1 | 1; n: number };
};

export const Timeline = memo(function Timeline({ now, until, data, onCursor, recenterSignal, stepSignal }: Props) {
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
  const axisTop = chartBottom;
  const windTop = axisTop + AXIS_H + 2;
  const H = windTop + WIND_H;

  // Skalor: molnbas (m, kvadratrot) och temperatur (°C, linjär) delar ytan
  const plotH = CHART_H - GROUND_PAD - 22;
  const yCloud = (m: number) => groundY - Math.sqrt(Math.min(1, Math.max(0, m / CLOUD_TOP_M))) * plotH;
  const [t0, t1] = data.temp.domain;
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

  // Steg till föregående/nästa hela timme, begränsat till fönstret.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const el = scroller.current;
    if (!el) return;
    const t = tAt(el.scrollLeft);
    const target =
      stepSignal.dir > 0 ? Math.floor(t / HOUR + 1e-6) * HOUR + HOUR : Math.ceil(t / HOUR - 1e-6) * HOUR - HOUR;
    followNow.current = false;
    scrollToTime(Math.min(end, Math.max(start, target)), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSignal]);

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

  // Temperaturaxeln sitter dikt an mot diagrammets högerkant; när kanten är utanför
  // vyn stannar den vid vyns högerkant.
  const rightAxis = useRef<HTMLDivElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const placeRightAxis = useCallback(() => {
    const el = scroller.current;
    const ax = rightAxis.current;
    if (!el || !ax) return;
    const chartEnd = pad + W - el.scrollLeft;
    ax.style.transform = `translateX(${Math.round(Math.min(el.clientWidth - RIGHT_AXIS_W, chartEnd + 4))}px)`;
  }, [pad, W]);
  useLayoutEffect(() => {
    placeRightAxis();
  });

  const cursorLabel = useRef<HTMLSpanElement>(null);
  const onScroll = () => {
    placeRightAxis();
    // Markörlinjen döljs vid NU (bara romben syns ovanpå den gröna NU-linjen).
    if (scroller.current) {
      const t = tAt(scroller.current.scrollLeft);
      const atNow = Math.abs(t - now) < 10 * 60 * 1000;
      cursorEl.current?.classList.toggle("at-now", atNow);
      if (cursorLabel.current) cursorLabel.current.textContent = `Vald ${fmtTime(snap5(t))}`;
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

  const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${yTemp(p.v).toFixed(1)}`).join("");
  const nowX = x(now);
  const span = (a: number, b: number, inset = 0) => ({ x: x(a) + inset, width: Math.max(1, x(b) - x(a) - inset * 2) });

  return (
    <div className="tl" style={{ height: H }}>
      {/* Vänster axel: molnbas (m) */}
      <div className="tl-yaxis" aria-hidden>
        <span className="tl-axtitle" style={{ top: 4 }}>
          Molnbas m
        </span>
        {CLOUD_TICKS.filter((m) => m > 0).map((m) => (
          <span key={m} style={{ top: yCloud(m) }}>
            {m >= 1000 ? `${m / 1000} km` : m}
          </span>
        ))}
        <span className="tl-lane" style={{ top: windTop + 2 }}>
          Vind m/s
        </span>
      </div>
      {/* Höger axel: temperatur (°C) */}
      <div className="tl-yaxis right" aria-hidden ref={rightAxis} style={{ width: RIGHT_AXIS_W }}>
        <span className="tl-axtitle temp" style={{ top: 4 }}>
          °C
        </span>
        {data.temp.ticks.map((v) => (
          <span key={v} style={{ top: yTemp(v), color: tempColor(v) }}>
            {`${v}°`.replace("-", "−")}
          </span>
        ))}
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
        aria-label="Tidslinje. Pil vänster och höger flyttar en timme, N går till nu."
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
            aria-label="Diagram: molnbas i meter (vänster axel), temperatur i grader (höger axel), nederbörd från molnbasen, vind under. Heldraget är observerat, streckat är prognos."
          >
            <defs>
              {/* Temperatur: blått under noll, rött över – intensivare ju längre från noll */}
              <linearGradient id="tempgrad" gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={yTemp(t0)} y2={yTemp(t1)}>
                {tempStops(t0, t1).map((s) => (
                  <stop key={s.offset} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
              <linearGradient id="fog" x1={0} x2={0} y1={0} y2={1}>
                <stop offset={0} className="fog-top" />
                <stop offset={1} className="fog-bottom" />
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
            {CLOUD_TICKS.filter((m) => m > 0).map((m) => (
              <line key={m} x1={0} x2={W} y1={yCloud(m)} y2={yCloud(m)} className="tl-grid" />
            ))}
            <line x1={0} x2={W} y1={groundY} y2={groundY} className="tl-ground" />
            <line x1={0} x2={W} y1={windTop - 1} y2={windTop - 1} className="tl-lanesep" />
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <line key={h.t} x1={x(h.t)} x2={x(h.t)} y1={chartTop} y2={H} className="tl-midnight" />
              ))}

            {/* Dimma / dis: ljusgrått marknära lager (dimma högre och tätare än dis) */}
            {data.lowVis.map((v, i) => {
              const top = yCloud(v.severe ? 150 : 60);
              return (
                <rect
                  key={`lv${i}`}
                  {...span(v.t0, v.t1)}
                  y={top}
                  height={groundY - top}
                  fill="url(#fog)"
                  className={`tl-fog${v.severe ? " severe" : ""}${v.forecast ? " fc" : ""}`}
                >
                  <title>{`${v.label}${v.forecast ? " (prognos)" : ""}`}</title>
                </rect>
              );
            })}

            {/* Vattenansamling vid marken: löpande summa, observerat heldraget, prognos ljusare */}
            <WaterLayer water={data.water} x={x} groundY={groundY} />

            {/* Nederbörd – droppar från molnbasen över hela tiden det regnar */}
            {[...data.precipObserved, ...data.precipForecast.map((p) => ({ ...p, fc: true }))].map((p, i) => (
              <PrecipStreaks
                key={`pr${i}`}
                p={p}
                forecast={"fc" in p}
                x={x}
                fromY={p.fromM !== undefined ? yCloud(p.fromM) + 1 : chartTop + 18}
                toY={groundY - 1}
                unknownBase={p.fromM === undefined}
              />
            ))}

            {/* Moln */}
            {mergeClouds(data.cloudsObserved).map((c, i) => (
              <path
                key={`co${i}`}
                d={cloudPath(x(c.t0) + 0.5, x(c.t1) - 0.5, yCloud(c.baseM), CLOUD_H)}
                className={c.cover === "MODEL" ? "tl-cloud unknown" : "tl-cloud"}
                style={c.cover === "MODEL" ? undefined : { fill: c.cover === "VV" ? "url(#vv)" : cloudFill(c.density) }}
              >
                <title>{`${c.cover === "MODEL" ? "Molnbas" : c.cover} ${Math.round(c.baseM)} m`}</title>
              </path>
            ))}
            {mergeClouds(data.cloudsForecast).map((c, i) => (
              <path
                key={`cf${i}`}
                d={cloudPath(x(c.t0) + 1, x(c.t1) - 1, yCloud(c.baseM), CLOUD_H)}
                className="tl-cloud fc"
                style={{ fill: cloudFill(c.density) }}
              >
                <title>{`Molnbas ${Math.round(c.baseM)} m (prognos)`}</title>
              </path>
            ))}
            {/* Klar himmel: sol på dagen, måne på natten */}
            {data.clear.map((c) => (
              <g
                key={`sun${c.t}`}
                transform={`translate(${x(c.t)},${yCloud(1800)})`}
                className={`tl-sky${c.forecast ? " fc" : ""}`}
              >
                {c.day ? <SunIcon /> : <MoonIcon />}
                <title>{c.label}</title>
              </g>
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

            {/* Vind under diagrammet: pil + m/s (+ byar) */}
            {data.wind.map((a) => (
              <g key={a.t} transform={`translate(${x(a.t)},0)`} className={a.forecast ? "tl-wind fc" : "tl-wind"}>
                {a.deg !== undefined && !a.variable ? (
                  <g transform={`translate(0,${windTop + 10}) rotate(${a.deg})`}>
                    <path d="M0,-7 L0,6 M-3.5,2.5 L0,7 L3.5,2.5" />
                  </g>
                ) : (
                  <circle cy={windTop + 10} r={2.5} className="tl-wind-vrb" />
                )}
                <text y={windTop + 29} textAnchor="middle" className="tl-wind-speed">
                  {Math.round(a.speed)}
                </text>
                {a.gust !== undefined && a.gust >= a.speed + 3 && (
                  <text y={windTop + 40} textAnchor="middle" className="tl-wind-gust">
                    {Math.round(a.gust)}
                  </text>
                )}
                <title>{`${Math.round(a.speed)} m/s${a.gust ? `, byar ${Math.round(a.gust)} m/s` : ""}${a.forecast ? " (prognos)" : ""}`}</title>
              </g>
            ))}

            {/* Tidsaxel direkt under diagrammet */}
            <rect x={0} y={axisTop} width={W} height={AXIS_H} className="tl-axisband" />
            <line x1={0} x2={W} y1={axisTop} y2={axisTop} className="tl-axisline" />
            {hours.map((h) => (
              <g key={h.t}>
                <line
                  x1={x(h.t)}
                  x2={x(h.t)}
                  y1={axisTop}
                  y2={axisTop + (h.h % 3 === 0 ? 5 : 3)}
                  className={h.h % 3 === 0 ? "tl-tick major" : "tl-tick"}
                />
                {h.h % 3 === 0 && (
                  <text x={x(h.t)} y={axisTop + 18} className={h.h === 0 ? "tl-hour day" : "tl-hour"} textAnchor="middle">
                    {h.h === 0 ? fmtDay(h.t) : `${String(h.h).padStart(2, "0")}:00`}
                  </text>
                )}
              </g>
            ))}

            {/* Där TAF slutar och SMHI tar över */}
            {data.tafEnd && (
              <g className="tl-tafend">
                <line x1={x(data.tafEnd.t)} x2={x(data.tafEnd.t)} y1={chartTop + 16} y2={axisTop} />
                {(() => {
                  // Nära högerkanten (där temperaturaxeln sitter) läggs texten till vänster om linjen.
                  const nearEnd = x(data.tafEnd.t) > W - 150;
                  const tx = x(data.tafEnd.t) + (nearEnd ? -4 : 4);
                  const anchor = nearEnd ? "end" : "start";
                  return (
                    <>
                      <text x={tx} y={chartTop + 26} textAnchor={anchor}>
                        TAF {data.tafEnd.stationId} slutar {fmtTime(data.tafEnd.t)}
                      </text>
                      <text x={tx} y={chartTop + 38} textAnchor={anchor}>
                        SMHI fortsätter
                      </text>
                    </>
                  );
                })()}
              </g>
            )}

            {/* NU */}
            <line x1={nowX} x2={nowX} y1={TOP - 6} y2={H} className="tl-now" />
            <text x={nowX} y={TOP - 11} className="tl-nowlabel" textAnchor="middle">
              NU {fmtTime(now)}
            </text>
            <text x={nowX - 8} y={chartTop + 12} className="tl-side obs" textAnchor="end">
              ← OBSERVERAT
            </text>
            <text x={nowX + 8} y={chartTop + 12} className="tl-side fc" textAnchor="start">
              PROGNOS →
            </text>

            {/* Saknade data */}
            <Missing x={nowX - 20} y={chartTop + CHART_H / 2} text={data.missing.temp} anchor="end" />
            <Missing x={nowX - 20} y={chartTop + CHART_H / 2 + 16} text={data.missing.clouds} anchor="end" />
            <Missing x={nowX - 20} y={windTop + 24} text={data.missing.wind} anchor="end" />
            <Missing x={nowX + 20} y={chartTop + CHART_H / 2} text={data.missing.forecast} anchor="start" />
          </svg>
        </div>
      </div>

      {/* Fast markör i mitten */}
      <div ref={cursorEl} className="tl-cursor at-now" style={{ top: TOP - 4, height: H - TOP + 4 }} aria-hidden>
        <span ref={cursorLabel} className="tl-cursor-label">
          Vald {fmtTime(now)}
        </span>
      </div>
    </div>
  );
});

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
 * Molnform: platt underkant vid molnbasen (yb) och två–tre rundade toppar ovanför.
 * Mittersta toppen är högst.
 */
export function cloudPath(x0: number, x1: number, yb: number, h: number): string {
  const w = x1 - x0;
  if (w < 5) return `M${x0},${yb}h${w}v${-h * 0.6}h${-w}Z`;
  const n = Math.max(2, Math.round(w / 12));
  const shoulder = yb - h * 0.38;
  const seg = w / n;
  // Toppar i varierande höjd – högst i mitten, lägre mot kanterna.
  const PATTERN = [0.62, 0.5, 0.7, 0.55, 0.66, 0.48];
  let d = `M${x0.toFixed(1)},${yb.toFixed(1)} L${x0.toFixed(1)},${shoulder.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const xe = x0 + seg * (i + 1);
    const edge = i === 0 || i === n - 1 ? 0.8 : 1;
    const ry = (h * PATTERN[i % PATTERN.length] * edge).toFixed(1);
    d += ` A${(seg / 2).toFixed(1)},${ry} 0 0 1 ${xe.toFixed(1)},${shoulder.toFixed(1)}`;
  }
  return `${d} L${x1.toFixed(1)},${yb.toFixed(1)} Z`;
}

/** Slår ihop angränsande molnblock på samma höjd och med samma täthet till ett längre moln. */
function mergeClouds(blocks: CloudBlock[]): CloudBlock[] {
  const sorted = [...blocks].sort((a, b) => a.baseM - b.baseM || a.t0 - b.t0);
  const out: CloudBlock[] = [];
  for (const b of sorted) {
    const prev = out.find(
      (o) =>
        o.cover === b.cover &&
        Math.abs(o.density - b.density) < 0.01 &&
        Math.abs(o.baseM - b.baseM) <= 20 &&
        b.t0 - o.t1 <= 60 * 1000 &&
        b.t0 >= o.t0,
    );
    if (prev) prev.t1 = Math.max(prev.t1, b.t1);
    else out.push({ ...b });
  }
  return out;
}

/** Förklaring som bara visar det som faktiskt finns i diagrammet, med samma symboler. */
export function ChartLegend({ data }: { data: ChartData }) {
  const precip = [...data.precipObserved, ...data.precipForecast];
  const items: Array<{ key: string; label: string; icon: React.ReactNode }> = [];
  const icon = (children: React.ReactNode) => (
    <svg width={22} height={14} viewBox="0 0 22 14" aria-hidden>
      {children}
    </svg>
  );
  const grad = (
    <defs>
      <linearGradient id="lg-temp" gradientUnits="userSpaceOnUse" x1={1} x2={21} y1={0} y2={0}>
        <stop offset={0} stopColor={tempColor(-10)} />
        <stop offset={0.45} stopColor={tempColor(0)} />
        <stop offset={0.55} stopColor={tempColor(1)} />
        <stop offset={1} stopColor={tempColor(20)} />
      </linearGradient>
    </defs>
  );
  // En rad för temperaturen: heldraget = observerat, streckat = prognos (som i diagrammet).
  if (data.temp.observed.length || data.temp.forecast.length)
    items.push({
      key: "t",
      label: "Temperatur (höger axel)",
      icon: icon(
        <>
          {grad}
          <line x1={1} x2={11} y1={7} y2={7} className="lg-line" style={{ stroke: "url(#lg-temp)" }} />
          <line x1={13} x2={21} y1={7} y2={7} className="lg-line dashed" style={{ stroke: "url(#lg-temp)" }} />
        </>,
      ),
    });
  if (data.cloudsObserved.length || data.cloudsForecast.length)
    items.push({
      key: "cl",
      label: "Moln: höjd = molnbas, gråton = molnmängd",
      icon: icon(
        <>
          <path d={cloudPath(1, 10, 12, 10)} style={{ fill: cloudFill(0.3) }} />
          <path d={cloudPath(11, 21, 12, 10)} style={{ fill: cloudFill(1) }} />
        </>,
      ),
    });
  if ([...data.cloudsObserved, ...data.cloudsForecast].some((c) => c.cover === "MODEL" && c.density === 0.6))
    items.push({
      key: "cu",
      label: "Molnbas, molnmängd okänd",
      icon: icon(<path d={cloudPath(4, 18, 12, 10)} className="tl-cloud unknown" />),
    });
  if (precip.some((p) => p.kind === "regn"))
    items.push({
      key: "ra",
      label: "Regn (tätare = mer)",
      icon: icon(
        <g className="tl-precip k-regn">
          <line x1={8} x2={6} y1={1} y2={13} />
          <line x1={14} x2={12} y1={1} y2={13} />
        </g>,
      ),
    });
  if (precip.some((p) => p.kind === "snö"))
    items.push({
      key: "sn",
      label: "Snö",
      icon: icon(
        <g className="tl-precip k-sno">
          <line x1={8} x2={6} y1={1} y2={13} />
          <line x1={14} x2={12} y1={1} y2={13} />
        </g>,
      ),
    });
  const acc = [...data.water.observed, ...data.water.forecast];
  if (acc.some((p) => p.rainMm >= 0.1))
    items.push({
      key: "wa",
      label: "Regn, summa (mm)",
      icon: icon(
        <g className="tl-water">
          <path d="M1,13 L7,11 L14,9 L21,7 L21,13 Z" className="water-fill" />
          <path d="M1,13 L7,11 L14,9 L21,7" className="water-top" />
        </g>,
      ),
    });
  if (acc.some((p) => p.snowCm >= 0.1))
    items.push({
      key: "sd",
      label: "Snödjup, uppskattat (cm)",
      icon: icon(
        <g className="tl-water">
          <path d="M1,13 L7,11 L14,9 L21,7 L21,13 Z" className="snow-fill" />
          <path d="M1,13 L7,11 L14,9 L21,7" className="snow-top" />
        </g>,
      ),
    });
  if (data.lowVis.length)
    items.push({ key: "fg", label: "Dimma / dis", icon: icon(<rect x={1} y={3} width={20} height={10} className="lg-fog" />) });
  if (data.thunder.length)
    items.push({ key: "th", label: "Åska", icon: icon(<text x={11} y={12} textAnchor="middle" className="tl-thunder">ϟ</text>) });
  if (data.clear.some((c) => c.day))
    items.push({ key: "su", label: "Klart", icon: icon(<g transform="translate(11,7) scale(0.8)"><SunIcon /></g>) });
  if (data.clear.some((c) => !c.day))
    items.push({ key: "mo", label: "Klart, natt", icon: icon(<g transform="translate(11,7) scale(0.8)"><MoonIcon /></g>) });
  if (data.wind.length)
    items.push({
      key: "wi",
      label: "Vind: pilen visar vart vinden blåser",
      icon: icon(
        <g transform="translate(11,7) rotate(225)" className="tl-wind">
          <path d="M0,-6 L0,5 M-3,2 L0,6 L3,2" />
        </g>,
      ),
    });

  return (
    <div className="legend-wrap">
      <div className="legend">
        {items.map((it) => (
          <span key={it.key} className="lgi">
            {it.icon}
            {it.label}
          </span>
        ))}
      </div>
      <p className="legend-note">
        Heldraget = observerat, streckat = prognos. Molnbasskalan är komprimerad uppåt (kvadratrot) så att låga moln
        syns tydligt. Nederbördsmängd per timme och källor finns i detaljerna nedan.
      </p>
    </div>
  );
}

function SunIcon() {
  return (
    <g className="sun">
      <circle r={4.5} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <line key={i} x1={Math.cos(a) * 6.5} y1={Math.sin(a) * 6.5} x2={Math.cos(a) * 9} y2={Math.sin(a) * 9} />;
      })}
    </g>
  );
}

function MoonIcon() {
  return <path className="moon" d="M2.5,-6.5 A7,7 0 1,0 6.5,3.5 A5.5,5.5 0 1,1 2.5,-6.5 Z" />;
}

/** Molnfärg: ljust för få moln, mörkare grått ju mer av himlen som täcks. */
const cloudFill = (density: number) =>
  `color-mix(in srgb, var(--cloud-dense) ${Math.round(15 + density * 85)}%, var(--cloud-thin))`;

/**
 * Nederbörd som droppar (regn) eller prickar (snö) från molnbasen till marken, spridda
 * över hela regnperioden. Tätare ju mer det regnar.
 */
function PrecipStreaks({
  p,
  forecast,
  x,
  fromY,
  toY,
  unknownBase,
}: {
  p: Precip;
  forecast: boolean;
  x: (t: number) => number;
  fromY: number;
  toY: number;
  unknownBase: boolean;
}) {
  if (toY - fromY < 4) return null;
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
    // Förskjut varannan kolumn så att dropparna inte hamnar i rader.
    for (let y = fromY + 3 + ((c * 7) % rowGap); y + len < toY; y += rowGap) {
      d += `M${xx.toFixed(1)},${y.toFixed(1)}l-0.8,${len}`;
    }
  }
  const cls = `tl-precip k-${snow ? "sno" : "regn"}${forecast ? " fc" : ""}${unknownBase ? " nobase" : ""}`;
  return (
    <g className={cls}>
      <path d={d} />
      <title>
        {`${p.label}${p.mm !== undefined ? ` ${p.mm.toFixed(1).replace(".", ",")} mm` : ""}${forecast ? " (prognos)" : " (observerat)"}${unknownBase ? " – molnbas okänd" : ""}`}
      </title>
    </g>
  );
}

/**
 * Ansamling vid marken: snölager (uppskattat snödjup, cm) underst och vatten (regn, mm)
 * ovanpå. Observerat heldraget fram till NU, prognos ljusare med streckad kant.
 */
const ACC_MAX_PX = 20;
function WaterLayer({ water, x, groundY }: { water: ChartData["water"]; x: (t: number) => number; groundY: number }) {
  const last = water.forecast.at(-1) ?? water.observed.at(-1);
  const maxRain = Math.max(0, ...[...water.observed, ...water.forecast].map((p) => p.rainMm));
  const maxSnow = Math.max(0, ...[...water.observed, ...water.forecast].map((p) => p.snowCm));
  if (!last || (maxRain < 0.1 && maxSnow < 0.1)) return null;
  // Egna skalor: regn 5 px/mm upp till 4 mm, snö 2 px/cm upp till 10 cm; därefter komprimerat.
  const half = maxRain >= 0.1 && maxSnow >= 0.1 ? ACC_MAX_PX / 2 : ACC_MAX_PX;
  const rainPx = (mm: number) => mm * (half / Math.max(4, maxRain));
  const snowPx = (cm: number) => cm * (half / Math.max(10, maxSnow));
  const ySnow = (p: AccPt) => groundY - snowPx(p.snowCm);
  const yRain = (p: AccPt) => ySnow(p) - rainPx(p.rainMm);
  const band = (pts: AccPt[], top: (p: AccPt) => number, bottom: (p: AccPt) => number) =>
    pts.length < 2
      ? ""
      : pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${top(p).toFixed(1)}`).join(" ") +
        " " +
        [...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${bottom(p).toFixed(1)}`).join(" ") +
        " Z";
  const edge = (pts: AccPt[], top: (p: AccPt) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${top(p).toFixed(1)}`).join(" ");
  const fmt = (n: number) => n.toFixed(1).replace(".", ",");
  const labelFor = (p: AccPt | undefined, cls: string) => {
    if (!p) return null;
    const parts = [
      p.rainMm >= 0.1 ? `${fmt(p.rainMm)} mm` : "",
      p.snowCm >= 0.1 ? `≈ ${fmt(p.snowCm)} cm snö` : "",
    ].filter(Boolean);
    if (!parts.length) return null;
    return (
      <text x={x(p.t) + 3} y={yRain(p) - 3} className={`tl-water-label ${cls}`}>
        {parts.join(" · ")}
      </text>
    );
  };
  const obsEnd = water.observed.at(-1);
  const fcEnd = water.forecast.at(-1);
  const same = (a?: AccPt, b?: AccPt) =>
    !!a && !!b && Math.abs(a.rainMm - b.rainMm) < 0.1 && Math.abs(a.snowCm - b.snowCm) < 0.1;
  const layer = (pts: AccPt[], fc: boolean) =>
    pts.length > 1 && (
      <>
        {maxSnow >= 0.1 && <path d={band(pts, ySnow, () => groundY)} className={`snow-fill${fc ? " fc" : ""}`} />}
        {maxRain >= 0.1 && <path d={band(pts, yRain, ySnow)} className={`water-fill${fc ? " fc" : ""}`} />}
        {maxSnow >= 0.1 && <path d={edge(pts, ySnow)} className={`snow-top${fc ? " fc" : ""}`} />}
        {maxRain >= 0.1 && <path d={edge(pts, yRain)} className={`water-top${fc ? " fc" : ""}`} />}
      </>
    );
  return (
    <g className="tl-water">
      {layer(water.observed, false)}
      {layer(water.forecast, true)}
      {!same(obsEnd, fcEnd) && labelFor(obsEnd, "obs")}
      {labelFor(fcEnd, "fc")}
      <title>
        {`Nederbörd, summa: ${obsEnd ? `${fmt(obsEnd.rainMm)} mm regn, ≈ ${fmt(obsEnd.snowCm)} cm snö uppmätt` : "ingen mätning"}${fcEnd ? `; med prognosen ${fmt(fcEnd.rainMm)} mm regn, ≈ ${fmt(fcEnd.snowCm)} cm snö` : ""}. Snödjup uppskattat (1 mm vatten ≈ 1 cm nysnö).`}
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
