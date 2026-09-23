"use client";

import type { ParamKey, StationRef, WeatherBundle, WeatherWarning } from "@/lib/types";
import type { Origin, Reading, Snapshot } from "@/lib/client/timeline";
import type { AviationAlert } from "@/lib/client/alerts";
import { fmtDateTime, fmtTime } from "@/lib/format";

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

// ---------------------------------------------------------------------------
// Källor i sidfoten: var observationerna, värdena vid NU och prognosen kommer ifrån.
// ---------------------------------------------------------------------------

const PARAMS: Array<[ParamKey, string]> = [
  ["temperature", "temperature"],
  ["wind", "wind"],
  ["gust", "gusts"],
  ["visibility", "visibility"],
  ["cloudBase", "cloud"],
  ["phenomena", "weather"],
  ["precipitation", "precipitation"],
];

const stationName = (s: StationRef) => (s.source === "METAR" ? `METAR ${s.stationId} ${s.stationName}` : `SMHI ${s.stationName}`);

function originName(o: Origin): string {
  if (o.kind === "METAR") return `METAR ${o.stationId} ${fmtTime(o.timestamp)}`;
  if (o.kind === "SMHI") return `SMHI ${o.stationName ?? o.stationId} ${fmtTime(o.timestamp)}`;
  if (o.kind === "TAF") return `TAF ${o.stationId}`;
  return `SMHI forecast ${fmtTime(o.timestamp)}`;
}

/** Discreet source lines in the footer: observed, now and forecast. */
export function SourceNote({ bundle, nowSnap, now }: { bundle: WeatherBundle; nowSnap: Snapshot; now: number }) {
  // Observerat: vald station per parameter, grupperat per station.
  const byStation = new Map<string, { station: StationRef; params: string[] }>();
  const missing: string[] = [];
  for (const [key, label] of PARAMS) {
    const sel = bundle.selections?.[key];
    if (!sel?.stationKey || !sel.station) {
      missing.push(label);
      continue;
    }
    const e = byStation.get(sel.stationKey) ?? { station: sel.station, params: [] };
    e.params.push(label);
    byStation.set(sel.stationKey, e);
  }
  const observed = [
    ...[...byStation.values()].map((e) => `${stationName(e.station)}, ${Math.round(e.station.distanceKm)} km (${e.params.join(", ")})`),
    ...(missing.length ? [`no ${missing.join(" or ")} observation nearby`] : []),
  ].join(" · ");

  // Nu: källan för varje värde vid NU, grupperat per källa och tid.
  const readings: Array<[string, Reading<unknown>]> = [
    ["temperature", nowSnap.temperature],
    ["wind", nowSnap.wind],
    ["gusts", nowSnap.gust],
    ["visibility", nowSnap.visibility],
    ["cloud", nowSnap.cloud],
    ["weather", nowSnap.phenomena],
    ["precipitation", nowSnap.precipitation],
  ];
  const byOrigin = new Map<string, string[]>();
  for (const [label, r] of readings) {
    if (!r) continue;
    const k = originName(r.origin);
    byOrigin.set(k, [...(byOrigin.get(k) ?? []), label]);
  }
  const nowText = [...byOrigin].map(([o, ps]) => `${o} (${ps.join(", ")})`).join(" · ");

  // Prognos: TAF där den gäller, SMHI:s punktprognos för resten.
  const taf = bundle.taf && Date.parse(bundle.taf.validTo) > now ? bundle.taf : null;
  const f = bundle.forecast;
  const forecast = [
    ...(taf
      ? [`TAF ${taf.stationId}, ${Math.round(taf.distanceKm)} km, until ${fmtTime(Date.parse(taf.validTo))} (wind, visibility, cloud, weather)`]
      : []),
    ...(f
      ? [`SMHI point forecast ${f.model}, issued ${fmtTime(Date.parse(f.referenceTime))} (${taf ? "temperature, precipitation and the rest" : "all values"})`]
      : []),
  ].join(" · ");

  return (
    <div className="source-note">
      <span>Observed: {observed || "no station nearby"}</span>
      <span>Now: {nowText || "no current observation"}</span>
      <span>Forecast: {forecast || "not available"}</span>
    </div>
  );
}
