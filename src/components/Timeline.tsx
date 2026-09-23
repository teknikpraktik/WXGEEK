"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Taf, TafPeriod } from "@/lib/types";
import { FUTURE_HOURS, HOUR, PAST_HOURS, type Meteogram, type Pt } from "@/lib/client/timeline";
import { fmtDay, localHour, fmtTime } from "@/lib/format";

const PX_PER_HOUR = 34;
const MIN_OFFSET_H = -PAST_HOURS;

// Körfält (px). Alla delar samma tidsaxel.
const TOP = 26; // NU / OBSERVERAT / PROGNOS
const TEMP_H = 128; // temperatur + nederbördsstaplar
const WIND_H = 44;
const CLOUD_H = 58; // molnlager, låg sikt, åska
const PRES_H = 30;
const TAF_H = 18;
const AXIS_H = 28;
const GAP = 6;
/** Nederbördsstaplarna får som mest så här stor del av temperaturfältet. */
const PRECIP_SHARE = 0.42;
const CLOUD_TOP_M = 3000;

type Props = {
  now: number;
  data: Meteogram;
  taf: Taf | null;
  /** Tid under markören */
  onCursor: (t: number) => void;
  /** Ökas för att be tidslinjen återgå till NU */
  recenterSignal: number;
};

export const Timeline = memo(function Timeline({ now, data, taf, onCursor, recenterSignal }: Props) {
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

  const tafPeriods = useMemo(
    () => (taf?.periods ?? []).filter((p) => p.change !== "BASE" && Date.parse(p.to) > start),
    [taf, start],
  );

  // Layout
  const tempTop = TOP;
  const tempBottom = tempTop + TEMP_H;
  const windTop = tempBottom + GAP;
  const cloudTop = windTop + WIND_H + GAP;
  const cloudBottom = cloudTop + CLOUD_H;
  const presTop = cloudBottom + GAP;
  const presBottom = presTop + PRES_H;
  const tafTop = presBottom + GAP;
  const axisTop = tafTop + (tafPeriods.length ? TAF_H + GAP : 0);
  const H = axisTop + AXIS_H;

  // Skalor
  const [t0, t1] = data.temp.domain;
  const yTemp = useCallback(
    (v: number) => tempBottom - 6 - ((v - t0) / (t1 - t0)) * (TEMP_H - 18),
    [t0, t1, tempBottom],
  );
  const yPrecip = (mm: number) => tempBottom - Math.min(1, mm / data.precipMax) * TEMP_H * PRECIP_SHARE;
  const yCloud = (m: number) => cloudBottom - 8 - Math.sqrt(Math.min(1, Math.max(0, m / CLOUD_TOP_M))) * (CLOUD_H - 14);
  const [p0, p1] = data.pressure.domain;
  const yPres = (v: number) => presBottom - 4 - ((v - p0) / (p1 - p0)) * (PRES_H - 8);

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

  const pathOf = (pts: Pt[], y: (v: number) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const nowX = x(now);
  const span = (a: number, b: number, inset = 0) => ({ x: x(a) + inset, width: Math.max(1, x(b) - x(a) - inset * 2) });

  return (
    <div className="tl" style={{ height: H }}>
      {/* Fast vänsterkant: temperaturskala och körfältsnamn */}
      <div className="tl-yaxis" aria-hidden>
        {data.temp.ticks.map((v) => (
          <span key={v} style={{ top: yTemp(v) }}>
            {`${v}°`.replace("-", "−")}
          </span>
        ))}
        <span className="tl-lane" style={{ top: windTop + 2 }}>
          Vind
        </span>
        <span className="tl-lane" style={{ top: cloudTop + 2 }}>
          Moln
        </span>
        <span className="tl-lane" style={{ top: presTop + 2 }}>
          Tryck
        </span>
        {tafPeriods.length > 0 && (
          <span className="tl-lane" style={{ top: tafTop + 3 }}>
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
            aria-label="Meteogram: temperatur och nederbörd, vind, moln och lufttryck. Heldraget är observerat, streckat är prognos."
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
            <rect x={0} y={tempTop} width={nowX} height={axisTop - tempTop} className="tl-bg-obs" />
            <rect x={nowX} y={tempTop} width={W - nowX} height={axisTop - tempTop} fill="url(#hatch)" />

            {/* Körfältsgränser och dygnsgränser */}
            {[windTop, cloudTop, presTop, ...(tafPeriods.length ? [tafTop] : [])].map((yy) => (
              <line key={yy} x1={0} x2={W} y1={yy - GAP / 2} y2={yy - GAP / 2} className="tl-lanesep" />
            ))}
            {hours
              .filter((h) => h.h === 0)
              .map((h) => (
                <line key={h.t} x1={x(h.t)} x2={x(h.t)} y1={tempTop} y2={axisTop + 14} className="tl-midnight" />
              ))}
            {data.temp.ticks.map((v) => (
              <line key={v} x1={0} x2={W} y1={yTemp(v)} y2={yTemp(v)} className="tl-grid" />
            ))}

            {/* ---- Temperatur + nederbörd ---- */}
            {data.precipObserved.map((b, i) => (
              <rect key={`po${i}`} {...span(b.t0, b.t1, 1)} y={yPrecip(b.v)} height={tempBottom - yPrecip(b.v)} className={`tl-precip k-${kindClass(b.kind)}`}>
                <title>{`${b.kind === "snö" ? "Snö" : "Regn"} ${b.v.toFixed(1).replace(".", ",")} mm (uppmätt)`}</title>
              </rect>
            ))}
            {data.precipStrips.map((s, i) => (
              <rect key={`ps${i}`} {...span(s.t0, s.t1, 0.5)} y={tempBottom - 4} height={4} className={`tl-precip k-${kindClass(s.kind)}`}>
                <title>{`${s.label} (observerat, mängd okänd)`}</title>
              </rect>
            ))}
            {data.precipForecast.map((b, i) => {
              const cx = (x(b.t0) + x(b.t1)) / 2;
              return (
                <g key={`pf${i}`}>
                  {b.max !== undefined && b.max > b.v && (
                    <line x1={cx} x2={cx} y1={yPrecip(b.max)} y2={yPrecip(b.v)} className="tl-whisker" />
                  )}
                  <rect {...span(b.t0, b.t1, 2)} y={yPrecip(b.v)} height={Math.max(1, tempBottom - yPrecip(b.v))} className={`tl-precip fc k-${kindClass(b.kind)}`}>
                    <title>{`${b.kind === "snö" ? "Snö" : "Regn"} ${b.v.toFixed(1).replace(".", ",")} mm (prognos${b.max ? `, upp till ${b.max.toFixed(1).replace(".", ",")}` : ""})`}</title>
                  </rect>
                </g>
              );
            })}
            {data.temp.forecast.map((s, i) => (
              <path key={`tf${i}`} d={pathOf(s, yTemp)} className="tl-line fc" />
            ))}
            {data.temp.observed.map((s, i) =>
              s.length === 1 ? (
                <circle key={`to${i}`} cx={x(s[0].t)} cy={yTemp(s[0].v)} r={2.5} className="tl-dot" />
              ) : (
                <path key={`to${i}`} d={pathOf(s, yTemp)} className="tl-line obs" />
              ),
            )}

            {/* ---- Vind ---- */}
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

            {/* ---- Moln, låg sikt, åska ---- */}
            <line x1={0} x2={W} y1={cloudBottom - 8} y2={cloudBottom - 8} className="tl-ground" />
            {data.lowVis.map((v, i) => (
              <rect key={`lv${i}`} {...span(v.t0, v.t1, 0.5)} y={cloudBottom - 7} height={7} className={`tl-lowvis${v.severe ? " severe" : ""}${v.forecast ? " fc" : ""}`}>
                <title>{`${v.label}${v.forecast ? " (prognos)" : ""}`}</title>
              </rect>
            ))}
            {data.cloudsObserved.map((c, i) => (
              <rect
                key={`co${i}`}
                {...span(c.t0, c.t1, 0.5)}
                y={yCloud(c.baseM) - 2.5}
                height={5}
                className={c.cover === "VV" ? "tl-cloud vv" : "tl-cloud"}
                style={{ opacity: c.cover === "VV" ? 1 : c.opacity }}
              >
                <title>{`${c.cover === "MODEL" ? "Molnbas" : c.cover} ${Math.round(c.baseM)} m`}</title>
              </rect>
            ))}
            {data.cloudsForecast.map((c, i) => (
              <rect key={`cf${i}`} {...span(c.t0, c.t1, 1)} y={yCloud(c.baseM) - 2.5} height={5} className="tl-cloud fc" style={{ opacity: c.opacity }}>
                <title>{`Molnbas ${Math.round(c.baseM)} m (prognos)`}</title>
              </rect>
            ))}
            {data.thunder.map((m, i) => (
              <text key={`th${i}`} x={(x(m.t0) + x(m.t1)) / 2} y={cloudTop + 11} textAnchor="middle" className={`tl-thunder${m.forecast ? " fc" : ""}`}>
                ϟ<title>{m.label}</title>
              </text>
            ))}

            {/* ---- Lufttryck ---- */}
            {data.pressure.forecast.map((s, i) => (
              <path key={`pf${i}`} d={pathOf(s, yPres)} className="tl-line fc thin" />
            ))}
            {data.pressure.observed.map((s, i) => (
              <path key={`po${i}`} d={pathOf(s, yPres)} className="tl-line obs thin" />
            ))}

            {/* ---- TAF ---- */}
            {tafPeriods.map((p, i) => (
              <TafBand key={i} p={p} x={x} top={tafTop} />
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
            <text x={nowX - 8} y={tempTop + 12} className="tl-side obs" textAnchor="end">
              ← OBSERVERAT
            </text>
            <text x={nowX + 8} y={tempTop + 12} className="tl-side fc" textAnchor="start">
              PROGNOS →
            </text>

            {/* Saknade data */}
            <Missing x={nowX - 20} y={tempTop + TEMP_H / 2} text={data.missing.temp} anchor="end" />
            <Missing x={nowX - 20} y={windTop + 24} text={data.missing.wind} anchor="end" />
            <Missing x={nowX - 20} y={cloudTop + 30} text={data.missing.clouds} anchor="end" />
            <Missing x={nowX - 20} y={presTop + 18} text={data.missing.pressure} anchor="end" />
            <Missing x={nowX + 20} y={tempTop + TEMP_H / 2} text={data.missing.forecast} anchor="start" />
          </svg>
        </div>
      </div>

      {/* Fast markör i mitten */}
      <div className="tl-cursor" style={{ top: TOP - 4, height: axisTop - TOP + 4 }} aria-hidden />
    </div>
  );
});

const kindClass = (k: "regn" | "snö") => (k === "snö" ? "sno" : "regn");

function Missing({ x, y, text, anchor }: { x: number; y: number; text?: string; anchor: "start" | "end" }) {
  if (!text) return null;
  return (
    <text x={x} y={y} className="tl-missing" textAnchor={anchor}>
      {text}
    </text>
  );
}

function TafBand({ p, x, top }: { p: TafPeriod; x: (t: number) => number; top: number }) {
  const t0 = Date.parse(p.from);
  const t1 = Date.parse(p.to);
  const label =
    p.change === "TEMPO" ? "TEMPO" : p.change === "PROB" ? `PROB${p.probability ?? ""}` : p.change === "BECMG" ? "BECMG" : "FM";
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
