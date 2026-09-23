"use client";

import { useState } from "react";
import type { WeatherBundle } from "@/lib/types";
import type { Snapshot } from "@/lib/client/timeline";
import { fmtDistance, fmtTime } from "@/lib/format";

/**
 * Kort, begriplig källinformation i anslutning till grafen: vilken flygplats TAF
 * gäller, vilken plats SMHI-prognosen gäller och vilka stationer som mätt.
 */
export function SourceLine({ bundle, now }: { bundle: WeatherBundle; now: number }) {
  const obs = new Map<string, string>();
  for (const sel of Object.values(bundle.selections)) {
    const s = sel.station;
    if (!s) continue;
    const name = s.source === "METAR" ? `METAR ${s.stationId}` : `SMHI-station ${s.stationName}`;
    obs.set(`${s.source}:${s.stationId}`, `${name} (${fmtDistance(s.distanceKm)})`);
  }
  const taf = bundle.taf;
  const tafValid = taf && Date.parse(taf.validTo) > now;
  const fc = bundle.forecast;
  return (
    <p className="source-line">
      <span>
        <b>Observerat:</b> {obs.size ? [...obs.values()].join(", ") : "ingen station i närheten"}
      </span>
      <span>
        <b>Prognos:</b>{" "}
        {tafValid
          ? `TAF ${taf.stationId}${taf.stationName ? ` ${taf.stationName}` : ""} (${fmtDistance(taf.distanceKm)}, gäller för flygplatsen till ${fmtTime(taf.validTo)}) för vind, sikt, moln och väder; `
          : "ingen giltig TAF inom 50 km; "}
        {fc
          ? `SMHI för platsens koordinater (${fc.latitude.toFixed(2).replace(".", ",")} N ${fc.longitude.toFixed(2).replace(".", ",")} E) för temperatur, nederbörd${tafValid ? " och resten av perioden" : " och övriga värden"}.`
          : "SMHI-prognos saknas."}
      </span>
    </p>
  );
}

/** Rå METAR och TAF i en expanderbar sektion med kopiering. Källfel visas alltid. */
export function DataInfo({ bundle, snap }: { bundle: WeatherBundle; snap: Snapshot }) {
  const down = bundle.sources.filter((s) => s.failed && s.message);
  return (
    <section className="datainfo" aria-label="Flygväderdata och källor">
      {down.length > 0 && (
        <p className="used">
          {down.map((s) => (
            <span key={s.id} className="down">
              {s.label}: {s.message}
            </span>
          ))}
        </p>
      )}
      <details className="flightdata">
        <summary>Visa flygväderdata</summary>
        {snap.metar ? <RawLine tag="METAR" text={snap.metar.raw} /> : <p className="muted">Ingen METAR i närheten.</p>}
        {bundle.taf ? <RawLine tag="TAF" text={bundle.taf.raw} /> : <p className="muted">Ingen TAF inom 50 km.</p>}
      </details>
    </section>
  );
}

function RawLine({ tag, text }: { tag: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* urklipp inte tillgängligt */
    }
  };
  return (
    <div className="raw-line">
      <span className="raw-tag">{tag}</span>
      <code className="raw-text">{text}</code>
      <button type="button" className="btn btn-small" onClick={copy} aria-label={`Kopiera ${tag}`}>
        {copied ? "Kopierat" : "Kopiera"}
      </button>
    </div>
  );
}
