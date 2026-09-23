"use client";

import type { WeatherBundle } from "@/lib/types";
import type { Snapshot } from "@/lib/client/timeline";

/**
 * Rå METAR/TAF överst, med liten stil. Källfel visas bara när något inte svarar.
 */
export function DataInfo({ bundle, snap }: { bundle: WeatherBundle; snap: Snapshot }) {
  const down = bundle.sources.filter((s) => s.failed && s.message);

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
      {down.length > 0 && (
        <p className="used">
          {down.map((s) => (
            <span key={s.id} className="down">
              {s.label}: {s.message}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
