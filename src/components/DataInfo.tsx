"use client";

import type { WeatherBundle, WeatherWarning } from "@/lib/types";
import type { Snapshot } from "@/lib/client/timeline";
import type { AviationAlert } from "@/lib/client/alerts";
import { fmtDateTime } from "@/lib/format";

const LEVEL_LABEL: Record<WeatherWarning["level"], string> = {
  RED: "Red warning",
  ORANGE: "Orange warning",
  YELLOW: "Yellow warning",
  MESSAGE: "Message",
  SIGMET: "SIGMET",
};

function period(from?: string, to?: string): string {
  if (!from && !to) return "";
  if (from && to) {
    const a = Date.parse(from);
    const b = Date.parse(to);
    return b - a < 24 * 3_600_000 ? `${fmtDateTime(a)}–${fmtDateTime(b).split(", ")[1]}` : `${fmtDateTime(a)} – ${fmtDateTime(b)}`;
  }
  return from ? `from ${fmtDateTime(Date.parse(from))}` : `until ${fmtDateTime(Date.parse(to!))}`;
}

/** SMHI warnings, SIGMETs and significant weather from METAR/TAF – under the chart. */
export function Warnings({ warnings, alerts }: { warnings: WeatherWarning[]; alerts: AviationAlert[] }) {
  if (!warnings.length && !alerts.length) return null;
  return (
    <section className="warnings" aria-label="Warnings">
      {warnings.map((w) => (
        <div key={w.id} className={`warning lvl-${w.level.toLowerCase()}`}>
          <p className="warning-head">
            <span className="warning-level">{LEVEL_LABEL[w.level]}</span>
            <span className="warning-title">{w.title}</span>
          </p>
          <p className="warning-meta">
            {w.source === "SMHI" ? "SMHI" : "Aviation"}
            {w.area ? ` · ${w.area}` : ""}
            {period(w.from, w.to) ? ` · ${period(w.from, w.to)}` : ""}
          </p>
          {w.text && <p className="warning-text">{w.text}</p>}
        </div>
      ))}
      {alerts.map((a) => (
        <div key={a.id} className="warning lvl-aviation">
          <p className="warning-head">
            <span className="warning-level">
              {a.stationId} · {a.when}
            </span>
            <span className="warning-title">{a.items.join(" · ")}</span>
          </p>
        </div>
      ))}
    </section>
  );
}

/** Raw METAR and TAF at the bottom of the page. Service errors are shown when present. */
export function DataInfo({ bundle, snap }: { bundle: WeatherBundle; snap: Snapshot }) {
  const down = bundle.sources.filter((s) => s.failed && s.message);
  return (
    <section className="datainfo" aria-label="METAR and TAF">
      {down.length > 0 && (
        <p className="used">
          {down.map((s) => (
            <span key={s.id} className="down">
              {s.label}: {s.message}
            </span>
          ))}
        </p>
      )}
      {snap.metar && (
        <p className="raw-line">
          <span className="raw-tag">METAR</span>
          <code className="raw-text">{snap.metar.raw}</code>
        </p>
      )}
      {bundle.taf && (
        <p className="raw-line">
          <span className="raw-tag">TAF</span>
          <code className="raw-text">{bundle.taf.raw}</code>
        </p>
      )}
    </section>
  );
}
