"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Taf, TafPeriod } from "@/lib/types";
import {
  FUTURE_HOURS,
  HOUR,
  PAST_HOURS,
  type EventBlock,
  type PlotData,
  type Pt,
} from "@/lib/client/timeline";
import { fmtDay, localHour, fmtTime } from "@/lib/format";

const PX_PER_HOUR = 34;
const TOP = 26; // band för NU / OBSERVERAT / PROGNOS
const PLOT_H = 168;
const ARROW_H = 22;
const EVENT_H = 14;
const TAF_H = 18;
const AXIS_H = 30;
const MIN_OFFSET_H = -PAST_HOURS;

type Props = {
  now: number;
  plot: PlotData;
  events: EventBlock[];
  taf: Taf | null;
  /** Tid under markören */
  onCursor: (t: number) => void;
  /** Ökas för att be tidslinjen återgå till NU */
  recenterSignal: number;
};

export const Timeline = memo(function Timeline({ now, plot, events, taf, onCursor, recenterSignal }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const followNow = useRef(true);
  const raf = useRef(0);

  // Tidsaxeln är fast förankrad i timmen, så att den inte "glider" när NU flyttas.
  const start = useMemo(() => Math.floor(now / HOUR) * HOUR - PAST_HOURS * HOUR, [now]);
  const end = start + (PAST_HOURS + FUTURE_HOURS + 1) * HOUR;
  const W = ((end - start) / HOUR) * PX_PER_HOUR;
  const pad = viewW / 2;
  const x = useCallback((t: number) => ((t - start) / HOUR) * PX_PER_HOUR, [start]);
  const tAt = useCallback((scrollLeft: number) => start + (scrollLeft / PX_PER_HOUR) * HOUR, [start]);

  const hasArrows = plot.param === "wind" && (plot.arrows?.length ?? 0) > 0;
  const tafPeriods = useMemo(
    () => (taf?.periods ?? []).filter((p) => p.change !== "BASE" && Date.parse(p.to) > start),
    [taf, start],
  );
  const plotTop = TOP;
  const plotBottom = TOP + PLOT_H;
  const arrowsTop = plotBottom;
  const eventsTop = arrowsTop + (hasArrows ? ARROW_H : 0) + 6;
  const tafTop = eventsTop + EVENT_H + 6;
  const axisTop = tafTop + (tafPeriods.length ? TAF_H + 4 : 0);
  const H = axisTop + AXIS_H;

  // Y-skala
  const [d0, d1] = plot.domain;
  const y = useCallback(
    (v: number) => {
      const c = Math.max(d0, Math.min(d1, v));
      const f = plot.scale === "sqrt" ? Math.sqrt((c - d0) / (d1 - d0)) : (c - d0) / (d1 - d0);
      return plotBottom - f * (PLOT_H - 10);
    },
    [d0, d1, plot.scale, plotBottom],
  );

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
      el.setAttribute("aria-valuetext", offH === 0 ? "Nu" : offH < 0 ? `${-offH} timmar sedan, observerat` : `om ${offH} timmar, prognos`);
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

  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const nowX = x(now);

  return (
    <div className="tl" style={{ height: H }}>
      {/* Y-axel (fast, ovanpå den scrollande grafen) */}
      <div className="tl-yaxis" aria-hidden>
        {plot.ticks.map((v) => (
          <span key={v} style={{ top: y(v) }}>
            {plot.formatTick(v)}
          </span>
        ))}
        <span className="tl-unit" style={{ top: 6 }}>
          {plot.unit}
        </span>
        <span className="tl-rowlabel" style={{ top: eventsTop + EVENT_H / 2 }}>
          Väder
        </span>
        {tafPeriods.length > 0 && (
          <span className="tl-rowlabel" style={{ top: tafTop + TAF_H / 2 }}>
            TAF
          </span>
        )}
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
        aria-valuemax={FUTURE_HOURS}
        aria-valuenow={0}
      >
        <div style={{ width: W + pad * 2, height: H, position: "relative" }}>
          <svg
            width={W}
            height={H}
            style={{ position: "absolute", left: pad, top: 0 }}
            role="img"
            aria-label={`Graf: ${plot.unit}. Heldragen linje är observerat, streckad är prognos.`}
          >
            <defs>
              <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch" />
              </pattern>
              <pattern id="vv" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1="0" y1="0" x2="0" y2="4" className="tl-vv" />
              </pattern>
            </defs>

            {/* Bakgrund: observerat vs prognos */}
            <rect x={0} y={plotTop} width={nowX} height={axisTop - plotTop} className="tl-bg-obs" />
            <rect x={nowX} y={plotTop} width={W - nowX} height={axisTop - plotTop} fill="url(#hatch)" />

            {/* Dygnsgränser */}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <line key={h.t} x1={x(h.t)} x2={x(h.t)} y1={plotTop} y2={axisTop + 16} className="tl-midnight" />
              ))}

            {/* Rutnät */}
            {plot.ticks.map((v) => (
              <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} className="tl-grid" />
            ))}

            {/* Data */}
            <PlotLayers plot={plot} x={x} y={y} path={path} plotBottom={plotBottom} />

            {/* Vindpilar */}
            {hasArrows &&
              plot.arrows!.map((a) => (
                <g
                  key={a.t}
                  transform={`translate(${x(a.t)},${arrowsTop + ARROW_H / 2}) rotate(${a.deg})`}
                  className={a.forecast ? "tl-arrow fc" : "tl-arrow"}
                >
                  <path d="M0,-7 L0,6 M-3.5,2.5 L0,7 L3.5,2.5" />
                </g>
              ))}

            {/* Väderfenomen */}
            <line x1={0} x2={W} y1={eventsTop + EVENT_H / 2} y2={eventsTop + EVENT_H / 2} className="tl-eventbase" />
            {events.map((e, i) => (
              <rect
                key={i}
                x={x(e.t0) + 0.5}
                y={eventsTop}
                width={Math.max(2, x(e.t1) - x(e.t0) - 1)}
                height={EVENT_H}
                rx={2}
                className={`tl-ev ev-${groupClass(e.group)}${e.forecast ? " fc" : ""}`}
              >
                <title>{`${e.label} (${e.forecast ? "prognos" : "observerat"})`}</title>
              </rect>
            ))}

            {/* TAF-intervall */}
            {tafPeriods.map((p, i) => (
              <TafBand key={i} p={p} x={x} top={tafTop} />
            ))}

            {/* Tidsaxel */}
            {hours.map((h) => (
              <g key={h.t}>
                <line
                  x1={x(h.t)}
                  x2={x(h.t)}
                  y1={axisTop}
                  y2={axisTop + (h.h % 3 === 0 ? 6 : 3)}
                  className="tl-tick"
                />
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
            <text x={nowX - 8} y={plotTop + 13} className="tl-side obs" textAnchor="end">
              ← OBSERVERAT
            </text>
            <text x={nowX + 8} y={plotTop + 13} className="tl-side fc" textAnchor="start">
              PROGNOS →
            </text>

            {/* Saknade data */}
            {plot.observedMissing && (
              <text x={nowX - 20} y={plotTop + PLOT_H / 2} className="tl-missing" textAnchor="end">
                {plot.observedMissing}
              </text>
            )}
            {plot.forecastMissing && (
              <text x={nowX + 20} y={plotTop + PLOT_H / 2} className="tl-missing" textAnchor="start">
                {plot.forecastMissing}
              </text>
            )}
          </svg>
        </div>
      </div>

      {/* Fast markör i mitten */}
      <div className="tl-cursor" style={{ top: TOP - 4, height: axisTop - TOP + 4 }} aria-hidden />
    </div>
  );

});

function groupClass(g: EventBlock["group"]) {
  return g === "snö" ? "sno" : g === "åska" ? "aska" : g;
}

function TafBand({ p, x, top }: { p: TafPeriod; x: (t: number) => number; top: number }) {
  const t0 = Date.parse(p.from);
  const t1 = Date.parse(p.to);
  const label =
    p.change === "TEMPO"
      ? "TEMPO"
      : p.change === "PROB"
        ? `PROB${p.probability ?? ""}`
        : p.change === "BECMG"
          ? "BECMG"
          : "FM";
  const w = x(t1) - x(t0);
  return (
    <g className={`tl-taf taf-${p.change.toLowerCase()}`}>
      <rect x={x(t0)} y={top} width={Math.max(2, w)} height={TAF_H} rx={2} />
      {p.change === "BECMG" && p.becomingBy && (
        <line x1={x(Date.parse(p.becomingBy))} x2={x(Date.parse(p.becomingBy))} y1={top} y2={top + TAF_H} />
      )}
      {w > 60 && (
        <text x={x(t0) + 5} y={top + 12.5}>
          {label} · {p.summary}
        </text>
      )}
      <title>{`${label}: ${p.summary}`}</title>
    </g>
  );
}

function PlotLayers({
  plot,
  x,
  y,
  path,
  plotBottom,
}: {
  plot: PlotData;
  x: (t: number) => number;
  y: (v: number) => number;
  path: (pts: Pt[]) => string;
  plotBottom: number;
}) {
  return (
    <g>
      {/* Molnbas: block per lager */}
      {plot.observedClouds?.map((c, i) => (
        <rect
          key={`oc${i}`}
          x={x(c.t0) + 0.5}
          y={y(c.baseM) - 3}
          width={Math.max(1, x(c.t1) - x(c.t0) - 1)}
          height={6}
          className={c.cover === "VV" ? "tl-cloud vv" : "tl-cloud"}
          style={{ opacity: c.cover === "VV" ? 1 : c.opacity }}
        >
          <title>{`${c.cover === "MODEL" ? "Molnbas" : c.cover} ${Math.round(c.baseM)} m`}</title>
        </rect>
      ))}
      {plot.forecastClouds?.map((c, i) => (
        <rect
          key={`fc${i}`}
          x={x(c.t0) + 1}
          y={y(c.baseM) - 3}
          width={Math.max(1, x(c.t1) - x(c.t0) - 2)}
          height={6}
          className="tl-cloud fc"
          style={{ opacity: c.opacity }}
        />
      ))}

      {/* Nederbörd: staplar */}
      {plot.observedBars?.map((b, i) => (
        <rect
          key={`ob${i}`}
          x={x(b.t0) + 1}
          y={y(b.v)}
          width={Math.max(1, x(b.t1) - x(b.t0) - 2)}
          height={Math.max(0, plotBottom - y(b.v))}
          className="tl-bar"
        />
      ))}
      {plot.forecastBars?.map((b, i) => (
        <g key={`fb${i}`}>
          {b.max !== undefined && b.max > b.v && (
            <line
              x1={(x(b.t0) + x(b.t1)) / 2}
              x2={(x(b.t0) + x(b.t1)) / 2}
              y1={y(b.max)}
              y2={y(b.v)}
              className="tl-whisker"
            />
          )}
          <rect
            x={x(b.t0) + 2}
            y={y(b.v)}
            width={Math.max(1, x(b.t1) - x(b.t0) - 4)}
            height={Math.max(0, plotBottom - y(b.v))}
            className="tl-bar fc"
          />
        </g>
      ))}

      {/* Linjer */}
      {plot.forecastSecondary?.map((s, i) => (
        <path key={`fs${i}`} d={path(s)} className="tl-line fc secondary" />
      ))}
      {plot.forecast.map((s, i) => (
        <path key={`f${i}`} d={path(s)} className="tl-line fc" />
      ))}
      {plot.observed.map((s, i) =>
        s.length === 1 ? (
          <circle key={`o${i}`} cx={x(s[0].t)} cy={y(s[0].v)} r={2.5} className="tl-dot" />
        ) : (
          <path key={`o${i}`} d={path(s)} className="tl-line obs" />
        ),
      )}
      {plot.observedSecondary?.map((p, i) => (
        <g key={`os${i}`} className="tl-gust">
          <line x1={x(p.t) - 4} x2={x(p.t) + 4} y1={y(p.v)} y2={y(p.v)} />
          <title>{`Byar ${Math.round(p.v)} m/s`}</title>
        </g>
      ))}
    </g>
  );
}
