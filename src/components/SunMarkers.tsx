"use client";

import { useEffect, useState } from "react";
import { fmtTime } from "@/lib/format";
import { ICON_W, type SunMark } from "@/lib/client/sunMarks";

/**
 * Markeringarna som knappar över tidsaxeln: tooltip vid hovring, tangentbordsfokus och tryck
 * (ett tryck utanför stänger den). Ett musdrag som börjar på en markering flyttar grafen och
 * öppnar ingen tooltip.
 */
export function SunMarkers({
  marks,
  left,
  top,
  tipBottom,
  wasDrag,
}: {
  marks: SunMark[];
  /** Diagrammets vänsterkant i den scrollade ytan */
  left: number;
  /** Markeringarnas överkant och tooltipens underkant (px) */
  top: number;
  tipBottom: number;
  wasDrag: () => boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => {
    if (pinned === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".tl-sun"))) setPinned(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);
  const tip = marks.find((m) => m.t === (pinned ?? focus ?? hover));

  return (
    <>
      {marks.map((m) => (
        <button
          key={m.t}
          type="button"
          className={`tl-sun ${m.kind}`}
          style={{ left: left + m.x - ICON_W / 2, top }}
          aria-label={[m.text, m.detail].filter(Boolean).join(", ")}
          onPointerEnter={(e) => e.pointerType === "mouse" && setHover(m.t)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          onFocus={() => setFocus(m.t)}
          onBlur={() => setFocus(null)}
          onClick={() => !wasDrag() && setPinned((p) => (p === m.t ? null : m.t))}
        >
          <svg viewBox="0 0 14 11" width={ICON_W} height={11} aria-hidden>
            <path className="tl-sun-disc" d="M3,10 A4,4 0 0 1 11,10 Z" />
            <path className="tl-sun-line" d="M0.5,10.5 H13.5" />
            <path className="tl-sun-arrow" d={m.kind === "sunrise" ? "M7,5 V1 M5.3,2.7 L7,1 L8.7,2.7" : "M7,1 V5 M5.3,3.3 L7,5 L8.7,3.3"} />
          </svg>
          {m.label && <span className="tl-sun-time">{fmtTime(m.t)}</span>}
        </button>
      ))}
      {tip && (
        <div className="tl-sun-tip" role="tooltip" style={{ left: left + tip.x, top: tipBottom }}>
          <b>{tip.text}</b>
          {tip.detail && <span>{tip.detail}</span>}
        </div>
      )}
    </>
  );
}
