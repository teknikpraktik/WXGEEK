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
  fmtPrecip,
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

      {/* Nuväder: fyra likvärdiga värden på en rad */}
      <dl className="readout-grid">
        <Cell label="Temperatur" r={snap.temperature} {...cellProps} missing={isFc ? "–" : "Ingen aktuell mätning"}>
          {snap.temperature && (
            <>
              <Val v={fmtTemp(snap.temperature.value)} unit="°C" />
              {phen && <span className="sub">{phen}</span>}
            </>
          )}
        </Cell>
        <Cell label="Vind" r={snap.wind} {...cellProps} missing={isFc ? "–" : "Ingen aktuell mätning"}>
          {w && (
            <>
              <Val
                v={fmtWindSpeed(w.speed)}
                unit="m/s"
                icon={w.deg !== undefined && !w.variable ? <WindArrow deg={w.deg} size={18} /> : undefined}
              />
              <span className="sub">
                {w.variable ? "Varierande" : w.deg !== undefined ? `från ${fmtWindDir(w.deg)}` : ""}
                {gust !== undefined && gust >= (w.speed ?? 0) + 1 ? ` · byar ${fmtWindSpeed(gust)}` : ""}
              </span>
            </>
          )}
        </Cell>
        <Cell label="Sikt" r={snap.visibility} {...cellProps} missing={isFc ? "–" : "Ingen aktuell observation"}>
          {snap.visibility && <Val {...splitUnit(fmtVisibility(snap.visibility.value.m, snap.visibility.value.atLeast))} />}
        </Cell>
        <Cell label="Molnbas" r={snap.cloud} {...cellProps} missing={isFc ? "–" : "Ingen observation"}>
          {cloud &&
            (lowest ? (
              <>
                <Val {...splitUnit(fmtCloudBase(lowest.baseM))} />
                <span className="sub">
                  {COVER_LABEL[lowest.cover]}
                  {lowest.type === "CB" ? " · CB" : lowest.type === "TCU" ? " · TCU" : ""}
                </span>
              </>
            ) : cloud.baseM !== undefined ? (
              <>
                <Val {...splitUnit(fmtCloudBase(cloud.baseM))} />
                {cloud.oktas !== undefined && <span className="sub">{fmtOktas(cloud.oktas)}</span>}
              </>
            ) : cloud.nsc || cloud.oktas === 0 ? (
              <>
                <Val v="–" unit="" />
                <span className="sub">Inga betydande moln</span>
              </>
            ) : cloud.oktas !== undefined ? (
              <>
                <Val v="–" unit="" />
                <span className="sub">{fmtOktas(cloud.oktas)}</span>
              </>
            ) : null)}
        </Cell>
        {snap.precipitation && snap.precipitation.value.mm > 0 && (
          <Cell label={isFc ? "Nederbörd" : "Nederbörd 1 h"} r={snap.precipitation} {...cellProps} missing="–">
            <Val {...splitUnit(fmtPrecip(snap.precipitation.value.mm))} />
            {isFc && snap.precipitation.value.probability !== undefined && snap.precipitation.value.probability > 0 && (
              <span className="sub">{Math.round(snap.precipitation.value.probability)} % risk</span>
            )}
          </Cell>
        )}
      </dl>

      {children}

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

/** Värde + enhet, samma typografi för alla mått. */
function Val({ v, unit, icon }: { v: string; unit: string; icon?: ReactNode }) {
  return (
    <span className="val">
      {icon}
      <b>{v}</b>
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

/** "≥ 10 km" → { v: "≥ 10", unit: "km" } */
function splitUnit(s: string): { v: string; unit: string } {
  const i = s.lastIndexOf(" ");
  const v = (i < 0 ? s : s.slice(0, i)).replace("≥ ", "≥");
  return { v, unit: i < 0 ? "" : s.slice(i + 1) };
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

function sameOrigin(a: Origin, b?: Origin) {
  return !!b && a.kind === b.kind && a.stationId === b.stationId && Math.abs(a.timestamp - b.timestamp) < 15 * 60 * 1000;
}

/** Källa för huvudvärdet: "ESOK · 11 km · 26 min sedan". Visas under rådata. */
export function PrimarySrc({ o, now, mode }: { o: Origin; now: number; mode: Snapshot["mode"] }) {
  const age = now - o.timestamp;
  const stale = mode === "now" && age > STALE_MS;
  return (
    <span className={`src src-primary${stale ? " stale" : ""}`}>
      <span className={`src-id src-${o.kind.toLowerCase()}`} title={o.stationName}>
        {o.kind === "METAR" ? o.stationId : "SMHI"}
      </span>
      {o.distanceKm !== undefined && <span>{fmtDistance(o.distanceKm)}</span>}
      <span>{mode === "now" ? fmtAge(age) : fmtTime(o.timestamp)}</span>
      {stale && <span className="stale-flag">äldre</span>}
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
