"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CLOUD_TICKS, CLOUD_TOP_M, HOUR, PAST_HOURS, type ChartData, type Precip, type Pt } from "@/lib/client/timeline";
import { fmtDay, localHour, fmtTime } from "@/lib/format";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;

// Layout (px)
const TOP = 26; // NU / OBSERVERAT / PROGNOS
const CHART_H = 210; // molnbas (vänster axel) + temperatur (höger axel) + nederbörd
const GROUND_PAD = 6; // luft under marklinjen
const WIND_H = 44;
const AXIS_H = 28;
const GAP = 6;

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
  const windTop = chartBottom + GAP;
  const axisTop = windTop + WIND_H + GAP;
  const H = axisTop + AXIS_H;

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

  // Starta på NU, och följ med NU så länge användaren står där.
  useLayoutEffect(() => {
    if (viewW && followNow.current) scrollToTime(now);
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

  const onScroll = () => {
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
      onCursor(t);
    });
  };

  // Musdrag på desktop (touch använder native scroll).
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
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
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !scroller.current) return;
    // Klick: centrera den klickade tidpunkten.
    const rect = scroller.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scroller.current.scrollLeft - pad;
    scrollToTime(start + (clickX / PX_PER_HOUR) * HOUR, true);
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
        <span className="tl-axtitle" style={{ top: chartTop + 2 }}>
          moln m
        </span>
        {CLOUD_TICKS.filter((m) => m > 0).map((m) => (
          <span key={m} style={{ top: yCloud(m) }}>
            {m >= 1000 ? `${m / 1000} km` : m}
          </span>
        ))}
        <span className="tl-lane" style={{ top: windTop + 2 }}>
          Vind
        </span>
      </div>
      {/* Höger axel: temperatur (°C) */}
      <div className="tl-yaxis right" aria-hidden>
        <span className="tl-axtitle" style={{ top: chartTop + 2 }}>
          °C
        </span>
        {data.temp.ticks.map((v) => (
          <span key={v} style={{ top: yTemp(v) }}>
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
            <rect x={0} y={chartTop} width={nowX} height={axisTop - chartTop} className="tl-bg-obs" />
            <rect x={nowX} y={chartTop} width={Math.max(0, W - nowX)} height={axisTop - chartTop} fill="url(#hatch)" />

            {/* Rutnät: molnbasens nivåer, marklinje, fältgränser, dygnsgränser */}
            {CLOUD_TICKS.filter((m) => m > 0).map((m) => (
              <line key={m} x1={0} x2={W} y1={yCloud(m)} y2={yCloud(m)} className="tl-grid" />
            ))}
            <line x1={0} x2={W} y1={groundY} y2={groundY} className="tl-ground" />
            {[windTop].map((yy) => (
              <line key={yy} x1={0} x2={W} y1={yy - GAP / 2} y2={yy - GAP / 2} className="tl-lanesep" />
            ))}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <line key={h.t} x1={x(h.t)} x2={x(h.t)} y1={chartTop} y2={axisTop + 14} className="tl-midnight" />
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

            {/* Nederbörd – faller från molnbasen */}
            {[...data.precipObserved, ...data.precipForecast.map((p) => ({ ...p, fc: true }))].map((p, i) => (
              <PrecipStreaks
                key={`pr${i}`}
                p={p}
                forecast={"fc" in p}
                x={x}
                fromY={p.fromM !== undefined ? yCloud(p.fromM) + 4 : chartTop + 18}
                toY={groundY - 1}
                unknownBase={p.fromM === undefined}
              />
            ))}

            {/* Moln */}
            {data.cloudsObserved.map((c, i) => (
              <rect
                key={`co${i}`}
                {...span(c.t0, c.t1, 0.5)}
                y={yCloud(c.baseM) - 3.5}
                height={7}
                rx={1.5}
                className={c.cover === "VV" ? "tl-cloud vv" : "tl-cloud"}
                style={c.cover === "VV" ? undefined : { fill: cloudFill(c.density) }}
              >
                <title>{`${c.cover === "MODEL" ? "Molnbas" : c.cover} ${Math.round(c.baseM)} m`}</title>
              </rect>
            ))}
            {data.cloudsForecast.map((c, i) => (
              <rect key={`cf${i}`} {...span(c.t0, c.t1, 1)} y={yCloud(c.baseM) - 3.5} height={7} rx={1.5} className="tl-cloud fc" style={{ fill: cloudFill(c.density) }}>
                <title>{`Molnbas ${Math.round(c.baseM)} m (prognos)`}</title>
              </rect>
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

            {/* Tidsaxel */}
            {hours.map((h) => (
              <g key={h.t}>
                <line x1={x(h.t)} x2={x(h.t)} y1={axisTop} y2={axisTop + (h.h % 3 === 0 ? 6 : 3)} className="tl-tick" />
                {h.h % 3 === 0 && (
                  <text x={x(h.t)} y={axisTop + 17} className="tl-hour" textAnchor="middle">
                    {h.h === 0 ? fmtDay(h.t + HOUR) : String(h.h).padStart(2, "0")}
                  </text>
                )}
              </g>
            ))}

            {/* NU */}
            <line x1={nowX} x2={nowX} y1={TOP - 6} y2={axisTop} className="tl-now" />
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
      <div className="tl-cursor" style={{ top: TOP - 4, height: axisTop - TOP + 4 }} aria-hidden />
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

/** Molnfärg: ljust för få moln, mörkare grått ju mer av himlen som täcks. */
const cloudFill = (density: number) =>
  `color-mix(in srgb, var(--cloud-dense) ${Math.round(15 + density * 85)}%, var(--cloud-thin))`;

/** Nederbördsstreck från molnbasen till marken. Fler streck = mer nederbörd. */
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
  const x0 = x(p.t0);
  const w = x(p.t1) - x0;
  const perHour = p.mm === undefined ? 1.5 : p.mm < 0.5 ? 1 : p.mm < 2 ? 2 : p.mm < 5 ? 3 : 5;
  const n = Math.max(1, Math.round((w / PX_PER_HOUR) * perHour));
  const cls = `tl-precip k-${p.kind === "snö" ? "sno" : "regn"}${forecast ? " fc" : ""}${unknownBase ? " nobase" : ""}`;
  if (toY - fromY < 4) return null;
  return (
    <g className={cls}>
      {Array.from({ length: n }, (_, i) => {
        const xx = x0 + (w * (i + 0.5)) / n;
        return <line key={i} x1={xx} x2={xx - 3} y1={fromY + (i % 2) * 5} y2={toY} />;
      })}
      <title>
        {`${p.label}${p.mm !== undefined ? ` ${p.mm.toFixed(1).replace(".", ",")} mm` : ""}${forecast ? " (prognos)" : " (observerat)"}${unknownBase ? " – molnbas okänd" : ""}`}
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
