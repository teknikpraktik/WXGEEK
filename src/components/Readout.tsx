"use client";

import type { ReactNode } from "react";
import type { Reading, Snapshot } from "@/lib/client/timeline";
import {
  COVER_LABEL,
  COVER_OKTAS,
  fmtTime,
  fmtPrecip,
  fmtTemp,
  fmtVisibility,
  fmtWindDeg,
  fmtWindSpeed,
} from "@/lib/format";
import { WindArrow } from "./WindArrow";
import { SkyIcon } from "./SkyIcon";

type Props = {
  snap: Snapshot;
  now: number;
  /** The timeline is rendered below the summary */
  children?: ReactNode;
};

/** Observations older than this are marked as old at NOW. */
const STALE_MS = 90 * 60 * 1000;

export function Readout({ snap, now, children }: Props) {
  const w = snap.wind?.value;
  const gust = snap.gust?.value;
  const pr = snap.precipitation?.value;
  const stale = (r: Reading<unknown>) =>
    snap.mode === "now" && !!r && (r.origin.kind === "METAR" || r.origin.kind === "SMHI") && now - r.origin.timestamp > STALE_MS;

  return (
    <section className={`readout readout-${snap.mode}`} aria-live="polite">
      <dl className="readout-grid">
        <Cell label="Temperature" r={snap.temperature} old={stale(snap.temperature)}>
          {snap.temperature && <Val v={fmtTemp(snap.temperature.value)} unit="°C" />}
        </Cell>
        <Cell label="Wind" r={snap.wind} old={stale(snap.wind)} sub={w ? windSub(w, gust) : undefined}>
          {w && (
            <Val
              v={w.speed !== undefined && w.speed < 0.5 ? "0" : fmtWindSpeed(w.speed)}
              unit="m/s"
              icon={w.deg !== undefined && !w.variable && (w.speed ?? 0) >= 0.5 ? <WindArrow deg={w.deg} size={18} /> : undefined}
            />
          )}
        </Cell>
        <Cell label="Visibility" r={snap.visibility} old={stale(snap.visibility)}>
          {snap.visibility && <Val {...splitUnit(fmtVisibility(snap.visibility.value.m, snap.visibility.value.atLeast))} />}
        </Cell>
        <Cell label="Cloud cover" r={snap.sky.kind === "MISSING" ? null : snap.cloud} old={stale(snap.cloud)} sub={skySub(snap)}>
          <Val
            v={skyCode(snap.sky.kind)}
            unit=""
            icon={
              // Symboler som bara är text (CAVOK, NSC, ?) upprepar värdet – visas inte här.
              !TEXT_SKY.has(snap.sky.kind) && (
                <svg className="sky-inline" width={26} height={22} viewBox="-13 -11 26 22" aria-hidden>
                  <SkyIcon sky={snap.sky} day={snap.day} />
                </svg>
              )
            }
          />
        </Cell>
        {/* Precipitation only when there is data; its column is always reserved so the other cells never move */}
        {pr && (
          <Cell label="Precipitation" r={snap.precipitation} old={stale(snap.precipitation)} sub={precipSub(snap)}>
            <Val {...splitUnit(fmtPrecip(pr.mm))} />
          </Cell>
        )}
      </dl>

      <p className="readout-summary">{weatherSummary(snap)}</p>

      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

function windSub(w: { deg?: number; variable?: boolean; speed?: number }, gust: number | undefined): string {
  if (w.speed !== undefined && w.speed < 0.5) return "Calm";
  const dir = w.variable ? "Variable" : w.deg !== undefined ? `From ${fmtWindDeg(w.deg)}` : "";
  const g = gust !== undefined && gust >= (w.speed ?? 0) + 1 ? `gusts ${fmtWindSpeed(gust)} m/s` : "";
  return [dir, g].filter(Boolean).join(" · ");
}

const TEXT_SKY = new Set<Snapshot["sky"]["kind"]>(["CAVOK", "NSC", "UNKNOWN", "MISSING"]);

const skyCode = (k: Snapshot["sky"]["kind"]) => (k === "UNKNOWN" ? "?" : k === "MISSING" ? "–" : k);

/** Description of the simplified cover (largest category), with the category's interval. */
function skySub(snap: Snapshot): string {
  const k = snap.sky;
  switch (k.kind) {
    case "SKC":
      return "Clear sky · 0/8";
    case "CAVOK":
      return "No cloud below 1,500 m";
    case "NSC":
      return "No significant cloud";
    case "UNKNOWN":
      return "Amount unknown";
    case "MISSING":
      return "";
    default:
      return `${COVER_LABEL[k.kind]} · ${COVER_OKTAS[k.kind]}`;
  }
}

function precipSub(snap: Snapshot): string {
  const pr = snap.precipitation?.value;
  if (!pr) return "";
  const iv = `${fmtTime(pr.from)}–${fmtTime(pr.to)}`;
  return snap.precipProbability ? `${iv} · ${Math.round(snap.precipProbability.value)} %` : iv;
}

function weatherSummary(snap: Snapshot): string {
  const ph = snap.phenomena;
  if (ph?.value.length) return ph.value.map((p) => p.label).join(", ");
  if (snap.forecastSummary) return snap.forecastSummary;
  return " ";
}

/** Value + unit, same typography for all quantities. */
function Val({ v, unit, icon }: { v: string; unit: string; icon?: ReactNode }) {
  return (
    <span className="val">
      {icon}
      <b>
        {v.startsWith("≥") ? (
          <>
            <span className="val-prefix">≥</span>
            {v.slice(1)}
          </>
        ) : (
          v
        )}
      </b>
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

/** "≥ 10 km" → { v: "≥10", unit: "km" } */
function splitUnit(s: string): { v: string; unit: string } {
  const i = s.lastIndexOf(" ");
  const v = (i < 0 ? s : s.slice(0, i)).replace("≥ ", "≥");
  return { v, unit: i < 0 ? "" : s.slice(i + 1) };
}

function Cell<T>({
  label,
  r,
  sub,
  old,
  children,
}: {
  label: string;
  r: Reading<T>;
  sub?: string;
  old?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`cell${r ? "" : " cell-missing"}${old ? " cell-old" : ""}`}>
      <dt>
        {label}
        {old && <span className="old-flag"> · old</span>}
      </dt>
      <dd>
        {r ? children : <span className="val missing-val">–</span>}
        {/* The sub line always reserves its height so the grid never jumps */}
        <span className="sub" title={sub || undefined}>
          {sub || " "}
        </span>
      </dd>
    </div>
  );
}
