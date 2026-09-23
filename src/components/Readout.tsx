"use client";

import type { ReactNode } from "react";
import { modelLayer, type Reading, type Snapshot } from "@/lib/client/timeline";
import {
  COVER_LABEL,
  COVER_OKTAS,
  fmtCloudLayer,
  fmtTime,
  oktasCover,
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
  const cloud = snap.cloud?.value;
  // SMHI (station or model): base with the low-cloud amount that belongs to it – never the total.
  const model = cloud && !cloud.layers?.length ? modelLayer(cloud) : null;
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
        <Cell label="Visibility" r={snap.visibility} old={stale(snap.visibility)} sub={cloud?.cavok ? "CAVOK" : undefined}>
          {snap.visibility && <Val {...splitUnit(fmtVisibility(snap.visibility.value.m, snap.visibility.value.atLeast))} />}
        </Cell>
        <Cell label="Cloud cover" r={snap.sky.kind === "MISSING" ? null : snap.cloud} old={stale(snap.cloud)} sub={skySub(snap)}>
          <Val
            v={skyCode(snap.sky.kind)}
            unit=""
            icon={
              <svg className="sky-inline" width={26} height={22} viewBox="-13 -11 26 22" aria-hidden>
                <SkyIcon sky={snap.sky} day={snap.day} />
              </svg>
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
      <p className="readout-clouds">{cloudDetail(snap, cloud, model)}</p>

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

type CloudVal = NonNullable<Snapshot["cloud"]>["value"];

type Model = ReturnType<typeof modelLayer>;

const skyCode = (k: Snapshot["sky"]["kind"]) => (k === "UNKNOWN" ? "?" : k === "MISSING" ? "–" : k);

/** Description of the simplified cover (largest category), with the category's interval. */
function skySub(snap: Snapshot): string {
  const k = snap.sky;
  switch (k.kind) {
    case "SKC":
      return k.fromSmhi ? "Clear · 0/8 · SMHI model (CAVOK)" : "Clear sky · 0/8";
    case "CAVOK":
      return "No cloud below 1,500 m";
    case "NSC":
      return "No significant cloud";
    case "UNKNOWN":
      return "Amount unknown";
    case "MISSING":
      return "";
    default:
      return `${COVER_LABEL[k.kind]} · ${COVER_OKTAS[k.kind]}${k.fromSmhi ? " · SMHI model (CAVOK)" : ""}`;
  }
}

/** Source and validity of the cloud reading. */
function cloudSource(snap: Snapshot): string {
  const o = snap.cloud?.origin;
  if (!o) return "";
  if (o.kind === "METAR") return `METAR ${o.stationId} ${fmtTime(o.timestamp)}`;
  if (o.kind === "SMHI") return `SMHI ${o.stationName ?? o.stationId} ${fmtTime(o.timestamp)}`;
  if (o.kind === "TAF") return `TAF ${o.stationId}${o.validFrom && o.validTo ? ` ${fmtTime(o.validFrom)}–${fmtTime(o.validTo)}` : ""}`;
  return `SMHI forecast ${fmtTime(o.timestamp)}`;
}

/** Detail line for the selected time: every layer with base, source and validity. */
function cloudDetail(snap: Snapshot, c: CloudVal | undefined, model: Model): string {
  if (!c) return "Clouds: no data for this time";
  const lines = cloudLines(c, model);
  const many = (c.layers?.length ?? 0) > 1 ? " (symbol = largest layer, a simplification)" : "";
  const smhi = snap.sky.fromSmhi ? " · cover from SMHI model" : "";
  return `Clouds${many}: ${lines.join(" / ") || "no layers"} · ${cloudSource(snap)}${smhi}`;
}

/** Every layer in full: "Broken · BKN · 5–7/8 · base 480 m". */
function cloudLines(c: CloudVal, model: Model): string[] {
  if (c.cavok) return ["CAVOK · no cloud below 1,500 m"];
  if (c.layers?.length) return c.layers.map((l) => fmtCloudLayer(l.cover, l.baseM, l.type));
  if (model) return [fmtCloudLayer(model.cover === "UNKNOWN" ? undefined : model.cover, model.baseM)];
  if (c.clear || c.oktas === 0) return ["Clear sky"];
  if (c.nsc) return ["No significant cloud"];
  const total = oktasCover(c.oktas);
  return total ? [fmtCloudLayer(total, undefined)] : [];
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
        <span className="sub">{sub || " "}</span>
      </dd>
    </div>
  );
}
