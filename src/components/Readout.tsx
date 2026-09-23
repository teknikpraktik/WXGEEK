"use client";

import type { ReactNode } from "react";
import type { Origin, Reading, Snapshot } from "@/lib/client/timeline";
import {
  COVER_LABEL,
  fmtAge,
  fmtCloudBase,
  fmtDistance,
  fmtOktas,
  fmtOffset,
  fmtPercent,
  fmtPrecip,
  fmtPressure,
  fmtRelativeDay,
  fmtTemp,
  fmtTime,
  fmtVisibility,
  fmtWindDir,
  fmtWindSpeed,
} from "@/lib/format";
import { WindArrow } from "./WindArrow";

type Props = {
  snap: Snapshot;
  now: number;
  forecastCreated?: string;
  /** Tidslinjen renderas mellan huvudvärdet och rutnätet */
  children?: ReactNode;
};

/** Äldre än så här markeras observationen som gammal vid NU. */
const STALE_MS = 90 * 60 * 1000;

export function Readout({ snap, now, forecastCreated, children }: Props) {
  const { mode } = snap;
  const isFc = mode === "forecast";

  const status =
    mode === "now" ? (
      <>
        <span className="tag tag-now">NU</span>
        <span className="mono">{fmtTime(now)}</span>
      </>
    ) : mode === "observed" ? (
      <>
        <span className="tag tag-obs">OBSERVERAT</span>
        <span className="mono">{fmtRelativeDay(snap.time, now)}</span>
        <span className="muted">{fmtOffset(snap.time - now)}</span>
      </>
    ) : (
      <>
        <span className="tag tag-fc">PROGNOS</span>
        <span className="mono">{fmtRelativeDay(snap.temperature?.origin.timestamp ?? snap.time, now)}</span>
        <span className="muted">{fmtOffset(snap.time - now)}</span>
      </>
    );

  const phen = snap.phenomena?.value?.[0]?.label ?? (isFc ? snap.forecastSummary : undefined);
  const w = snap.wind?.value;
  const gust = snap.gust?.value;
  const cloud = snap.cloud?.value;
  const lowest = cloud?.layers?.[0];
  // Primär källa = temperaturens. Andra celler visar bara källa när den avviker.
  const primary = snap.temperature?.origin ?? snap.wind?.origin;
  const cellProps = { now, mode, primary };

  return (
    <section className={`readout readout-${mode}`}>
      <div className="readout-status">
        {status}
      </div>

      <div className="readout-main">
        <div className="readout-temp">
          {snap.temperature ? (
            <>
              <span className="big mono">{fmtTemp(snap.temperature.value)}</span>
              <span className="big-unit">°C</span>
            </>
          ) : (
            <span className="missing">
              {isFc ? "Ingen temperaturprognos" : "Ingen aktuell temperaturmätning"}
            </span>
          )}
        </div>
        <div className="readout-headline">
          {phen && <span className="headline-phen">{phen}</span>}
        </div>
        {!isFc && primary && <PrimarySrc o={primary} {...cellProps} />}
      </div>

      {children}

      <dl className="readout-grid">
        <Cell label="Vind" r={snap.wind} {...cellProps} missing={isFc ? "–" : "Ingen aktuell vindmätning"}>
          {w && (
            <>
              {w.deg !== undefined && !w.variable && <WindArrow deg={w.deg} />}
              {fmtWindDir(w.deg, w.variable)} <b className="mono">{fmtWindSpeed(w.speed)}</b> m/s
              {gust !== undefined && gust >= (w.speed ?? 0) + 1 && (
                <span className="sub">
                  byar <b className="mono small-b">{fmtWindSpeed(gust)}</b> m/s
                </span>
              )}
            </>
          )}
        </Cell>
        <Cell label="Sikt" r={snap.visibility} {...cellProps} missing={isFc ? "–" : "Ingen aktuell siktobservation"}>
          {snap.visibility && <b className="mono">{fmtVisibility(snap.visibility.value.m, snap.visibility.value.atLeast)}</b>}
        </Cell>
        <Cell label="Molnbas" r={snap.cloud} {...cellProps} missing={isFc ? "–" : "Ingen molnbasobservation"}>
          {cloud &&
            (lowest ? (
              <>
                <b className="mono">{fmtCloudBase(lowest.baseM)}</b>
                <span className="sub">
                  {COVER_LABEL[lowest.cover]}
                  {lowest.type === "CB" ? " · bymoln (CB)" : lowest.type === "TCU" ? " · tornande cumulus" : ""}
                </span>
              </>
            ) : cloud.baseM !== undefined ? (
              <>
                <b className="mono">{fmtCloudBase(cloud.baseM)}</b>
                {cloud.oktas !== undefined && <span className="sub">{fmtOktas(cloud.oktas)}</span>}
              </>
            ) : cloud.nsc || cloud.oktas === 0 ? (
              <span className="note">Inga betydande moln</span>
            ) : cloud.oktas !== undefined ? (
              <span className="note">{fmtOktas(cloud.oktas)}</span>
            ) : null)}
        </Cell>
        <Cell label="Lufttryck" r={snap.pressure} {...cellProps} missing={isFc ? "–" : "Ingen tryckmätning"}>
          {snap.pressure && (
            <>
              <b className="mono">{fmtPressure(snap.pressure.value)}</b> hPa
              {snap.pressureTrend !== undefined && <span className="sub">{fmtTrend(snap.pressureTrend)}</span>}
            </>
          )}
        </Cell>
        <Cell label="Luftfuktighet" r={snap.humidity} {...cellProps} missing={isFc ? "–" : "Ingen fuktmätning"}>
          {snap.humidity && <b className="mono">{fmtPercent(snap.humidity.value)}</b>}
        </Cell>
        {snap.precipitation && (
          <Cell label={isFc ? "Nederbörd" : "Nederbörd, 1 h"} r={snap.precipitation} {...cellProps} missing="–">
            <b className="mono">{fmtPrecip(snap.precipitation.value.mm)}</b>
            {isFc && snap.precipitation.value.probability !== undefined && snap.precipitation.value.probability > 0 && (
              <span className="sub">{Math.round(snap.precipitation.value.probability)} % risk</span>
            )}
          </Cell>
        )}
      </dl>

      {isFc && (
        <p className="readout-foot">
          SMHI prognos (snow1g) för platsen{forecastCreated ? ` · beräknad ${fmtTime(forecastCreated)}` : ""}. En
          prognos är en modellberäkning, inte en mätning.
        </p>
      )}

      {snap.taf.length > 0 && (
        <div className="readout-taf">
          {snap.taf.map((p, i) => (
            <div key={i}>
              <span className="tag tag-taf">
                {p.change === "TEMPO"
                  ? "Tillfälligt"
                  : p.change === "PROB"
                    ? `${p.probability ?? ""} % risk`
                    : p.change === "BECMG"
                      ? "Övergång"
                      : "Ändring"}
              </span>{" "}
              {fmtTime(p.from)}–{fmtTime(p.to)}: {p.summary}
            </div>
          ))}
          <span className="muted small">Enligt flygplatsprognos (TAF)</span>
        </div>
      )}
    </section>
  );
}

function Cell<T>({
  label,
  r,
  now,
  mode,
  missing,
  primary,
  children,
}: {
  label: string;
  r: Reading<T>;
  now: number;
  mode: Snapshot["mode"];
  primary?: Origin;
  missing: string;
  children: ReactNode;
}) {
  return (
    <div className={`cell${r ? "" : " cell-missing"}`}>
      <dt>{label}</dt>
      <dd>
        {r ? children : <span className="missing">{missing}</span>}
        {r && mode !== "forecast" && !sameOrigin(r.origin, primary) && <Src r={r} now={now} mode={mode} />}
      </dd>
    </div>
  );
}

/** Trycktendens 3 h, som i synoptiska observationer. */
function fmtTrend(d: number): string {
  const v = Math.abs(d).toFixed(1).replace(".", ",");
  if (Math.abs(d) < 0.5) return "oförändrat senaste 3 h";
  return `${d > 0 ? "stigande" : "fallande"} ${v} hPa / 3 h`;
}

function sameOrigin(a: Origin, b?: Origin) {
  return !!b && a.kind === b.kind && a.stationId === b.stationId && Math.abs(a.timestamp - b.timestamp) < 15 * 60 * 1000;
}

function PrimarySrc({ o, now, mode }: { o: Origin; now: number; mode: Snapshot["mode"] }) {
  const age = now - o.timestamp;
  const stale = mode === "now" && age > STALE_MS;
  return (
    <span className={`src src-primary${stale ? " stale" : ""}`}>
      <span className={`src-id src-${o.kind.toLowerCase()}`}>{o.kind === "METAR" ? o.stationId : "SMHI"}</span>
      <span>{o.stationName}</span>
      {o.distanceKm !== undefined && <span>{fmtDistance(o.distanceKm)} bort</span>}
      <span>
        {o.kind === "METAR" ? "flygplatsobservation" : "stationsmätning"}{" "}
        {mode === "now" ? fmtAge(age) : fmtTime(o.timestamp)}
      </span>
      {stale && <span className="stale-flag">äldre observation</span>}
    </span>
  );
}

function Src({ r, now, mode }: { r: { origin: Origin }; now: number; mode: Snapshot["mode"] }) {
  const o = r.origin;
  if (o.kind === "PROGNOS") return null;
  const age = now - o.timestamp;
  const stale = mode === "now" && age > STALE_MS;
  const id = o.kind === "METAR" ? o.stationId : "SMHI";
  const title = `${o.stationName ?? o.stationId} (${o.kind}), ${o.distanceKm !== undefined ? fmtDistance(o.distanceKm) + " bort, " : ""}observerat ${fmtTime(o.timestamp)}`;
  return (
    <span className={`src${stale ? " stale" : ""}`} title={title}>
      <span className={`src-id src-${o.kind.toLowerCase()}`}>{id}</span>
      {o.distanceKm !== undefined && <span>{fmtDistance(o.distanceKm)}</span>}
      <span>{mode === "now" ? fmtAge(age) : fmtTime(o.timestamp)}</span>
      {stale && <span className="stale-flag">äldre</span>}
    </span>
  );
}
