"use client";

import type { ParamKey, StationRef, WeatherBundle } from "@/lib/types";
import type { Snapshot } from "@/lib/client/timeline";
import { fmtDistance, fmtTime } from "@/lib/format";

const PARAM_LABEL: Record<ParamKey, string> = {
  temperature: "temperatur",
  wind: "vind",
  gust: "byar",
  visibility: "sikt",
  cloudBase: "moln",
  precipitation: "nederbörd",
  phenomena: "väder",
};

/**
 * Rå METAR/TAF och vilka källor som använts – överst, med liten stil.
 * Väderlek interpolerar inte: varje värde kommer från en namngiven station.
 */
export function DataInfo({ bundle, snap }: { bundle: WeatherBundle; snap: Snapshot }) {
  // Gruppera parametrar per station: "ESOK 11 km: temperatur, vind, sikt …"
  const byStation = new Map<string, { station: StationRef; params: string[] }>();
  for (const [k, sel] of Object.entries(bundle.selections) as Array<[ParamKey, WeatherBundle["selections"][ParamKey]]>) {
    if (!sel.station || !sel.stationKey) continue;
    const e = byStation.get(sel.stationKey) ?? { station: sel.station, params: [] };
    e.params.push(PARAM_LABEL[k]);
    byStation.set(sel.stationKey, e);
  }
  const down = bundle.sources.filter((s) => !s.ok && s.message);

  return (
    <section className="datainfo" aria-label="Rådata och källor">
      {snap.metar && (
        <p className="raw-line">
          <span className="raw-tag">METAR</span>
          <span className="raw-text">{snap.metar.raw}</span>
        </p>
      )}
      {bundle.taf && (
        <p className="raw-line">
          <span className="raw-tag">TAF</span>
          <span className="raw-text">{bundle.taf.raw}</span>
        </p>
      )}
      <p className="used">
        {[...byStation.values()].map(({ station, params }) => (
          <span key={`${station.source}:${station.stationId}`}>
            <b>{station.source === "METAR" ? station.stationId : `SMHI ${station.stationName}`}</b>{" "}
            {fmtDistance(station.distanceKm)}: {params.join(", ")}
          </span>
        ))}
        {bundle.forecast && (
          <span>
            <b>SMHI prognos</b> beräknad {fmtTime(bundle.forecast.createdTime)}, visas t.o.m.{" "}
            {fmtTime(bundle.forecastUntil)}
            {bundle.taf ? ` (TAF ${bundle.taf.stationId} ${fmtDistance(bundle.taf.distanceKm)})` : ""}
          </span>
        )}
        {down.map((s) => (
          <span key={s.id} className="down">
            {s.label}: {s.message}
          </span>
        ))}
      </p>
    </section>
  );
}
