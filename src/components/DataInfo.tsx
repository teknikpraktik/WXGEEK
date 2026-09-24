"use client";

import type { StationRef, WeatherBundle, WeatherWarning } from "@/lib/types";
import type { Snapshot } from "@/lib/client/timeline";
import type { AviationAlert } from "@/lib/client/alerts";
import { fmtDateTime, fmtDistance } from "@/lib/format";

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

/** "Torsby flygplats, 12 km away" – the airport a METAR/TAF is from, in plain text. */
const place = (name: string, km: number) => `${name}, ${fmtDistance(km)} away`;

/**
 * Raw METAR and TAF at the bottom of the page, under the airport they are from. The raw text
 * already starts with METAR/TAF, so there is no separate label. Service errors are shown when present.
 */
export function DataInfo({ bundle, snap }: { bundle: WeatherBundle; snap: Snapshot }) {
  const down = bundle.sources.filter((s) => s.failed && s.message);
  const metar = snap.metar;
  const metarStation = metar
    ? bundle.stations.find((s) => s.station.source === "METAR" && s.station.stationId === metar.stationId)?.station
    : undefined;
  const taf = bundle.taf;
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
      {metar && (
        <>
          {metarStation && <p className="raw-place">{place(metarStation.stationName, metarStation.distanceKm)}</p>}
          <p className="raw-line">
            <code className="raw-text">{metar.raw}</code>
          </p>
        </>
      )}
      {taf && (
        <>
          {/* Same airport as the METAR above: the place is not repeated */}
          {taf.stationId !== metar?.stationId && <p className="raw-place">{place(taf.stationName ?? taf.stationId, taf.distanceKm)}</p>}
          <p className="raw-line">
            <code className="raw-text">{taf.raw}</code>
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Källor i sidfoten, på en rad: stationerna som används, TAF och SMHI:s prognos.
// ---------------------------------------------------------------------------

const stationName = (s: StationRef) => (s.source === "METAR" ? `METAR ${s.stationId} ${s.stationName}` : `SMHI ${s.stationName}`);

/** Discreet one-line list of the sources in use. */
export function SourceNote({ bundle, now }: { bundle: WeatherBundle; now: number }) {
  const stations = new Map<string, StationRef>();
  for (const sel of Object.values(bundle.selections ?? {})) {
    if (sel?.stationKey && sel.station) stations.set(sel.stationKey, sel.station);
  }
  const taf = bundle.taf && Date.parse(bundle.taf.validTo) > now ? bundle.taf : null;
  const sources = [
    ...[...stations.values()].map((s) => `${stationName(s)} (${Math.round(s.distanceKm)} km)`),
    ...(taf ? [`TAF ${taf.stationId}`] : []),
    ...(bundle.forecast ? [`SMHI forecast ${bundle.forecast.model}`] : []),
  ];
  if (!sources.length) return null;
  return <span className="source-note">Sources: {sources.join(" · ")}</span>;
}
