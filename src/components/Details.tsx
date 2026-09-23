"use client";

import type { ParamKey, WeatherBundle } from "@/lib/types";
import type { Snapshot } from "@/lib/client/timeline";
import { fmtAge, fmtDistance, fmtTime } from "@/lib/format";

const PARAM_LABEL: Record<ParamKey, string> = {
  temperature: "Temperatur",
  dewPoint: "Daggpunkt",
  humidity: "Luftfuktighet",
  wind: "Vind",
  gust: "Byar",
  pressure: "Lufttryck",
  visibility: "Sikt",
  cloudBase: "Molnbas",
  precipitation: "Nederbörd",
  phenomena: "Väderfenomen",
};

const ORDER: ParamKey[] = [
  "temperature",
  "wind",
  "gust",
  "visibility",
  "cloudBase",
  "pressure",
  "dewPoint",
  "humidity",
  "precipitation",
  "phenomena",
];

export function Details({ bundle, snap, now }: { bundle: WeatherBundle; snap: Snapshot; now: number }) {
  const metarStation = bundle.stations.find((s) => s.station.source === "METAR");
  return (
    <section className="details">
      {snap.mode !== "forecast" && (
        <details className="panel">
          <summary>
            Rå METAR{snap.metar ? ` · ${snap.metar.stationId} ${fmtTime(snap.metar.timestamp)}` : ""}
          </summary>
          {snap.metar ? (
            <>
              <pre className="raw">{snap.metar.raw}</pre>
              <p className="muted small">
                METAR är flygplatsens väderrapport i originalformat. Värdena ovan är omräknade till svenska enheter
                (knop → m/s, fot → meter).
              </p>
            </>
          ) : (
            <p className="muted">
              {metarStation ? "Ingen METAR vid den här tidpunkten." : "Ingen flygplats med aktuell METAR i närheten."}
            </p>
          )}
        </details>
      )}

      <details className="panel">
        <summary>Flygplatsprognos (TAF){bundle.taf ? ` · ${bundle.taf.stationId}` : ""}</summary>
        {bundle.taf ? (
          <>
            <pre className="raw">{bundle.taf.raw}</pre>
            <p className="muted small">
              {bundle.taf.stationName ?? bundle.taf.stationId}, {fmtDistance(bundle.taf.distanceKm)} bort. Gäller{" "}
              {fmtTime(bundle.taf.validFrom)}–{fmtTime(bundle.taf.validTo)} för flygplatsens närområde. TEMPO =
              tillfälligt, BECMG = gradvis övergång, PROB = sannolikhet i procent.
            </p>
          </>
        ) : (
          <p className="muted">Ingen TAF för en flygplats inom 50 km.</p>
        )}
      </details>

      <details className="panel">
        <summary>Stationer och källor</summary>
        <p className="muted small">
          Väderlek interpolerar inte. Varje värde kommer från en namngiven station. Olika parametrar kan komma från
          olika stationer – vi väljer den närmaste med aktuell mätning, med vissa undantag som anges nedan.
        </p>
        <table className="stations">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Station</th>
              <th>Avst.</th>
              <th>Senast</th>
            </tr>
          </thead>
          <tbody>
            {ORDER.map((k) => {
              const s = bundle.selections[k];
              return (
                <tr key={k}>
                  <th scope="row">{PARAM_LABEL[k]}</th>
                  {s?.station ? (
                    <>
                      <td>
                        <span className={`src-id src-${s.station.source.toLowerCase()}`}>{s.station.source}</span>{" "}
                        {s.station.source === "METAR" ? `${s.station.stationId} ` : ""}
                        {s.station.stationName}
                        <div className="why">{s.reason}</div>
                      </td>
                      <td className="mono">{fmtDistance(s.station.distanceKm)}</td>
                      <td className="mono">{s.latestTimestamp ? fmtAge(now - Date.parse(s.latestTimestamp)) : "–"}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted">
                      {s?.reason ?? "Ingen station"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      <div className="sources">
        {bundle.sources.map((s) => (
          <span key={s.id} className={`source ${s.ok ? "ok" : "down"}`} title={s.message}>
            <i aria-hidden /> {s.label}
            {s.message && <span className="source-msg"> – {s.message}</span>}
          </span>
        ))}
      </div>

      <p className="attrib">
        Data: SMHI (CC BY 4.0, bearbetad: stationsurval och enhetsomräkning) · METAR/TAF: NOAA Aviation Weather
        Center · Ortnamn: © OpenStreetMap-bidragsgivare. Väderlek är inte en flygväderstjänst och ska inte användas
        för flygplanering.
      </p>
    </section>
  );
}
