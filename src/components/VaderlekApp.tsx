"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Place, WeatherBundle } from "@/lib/types";
import { buildEvents, buildPlot, HOUR, PLOT_PARAMS, snapshotAt, type PlotParam } from "@/lib/client/timeline";
import { Timeline } from "./Timeline";
import { Readout } from "./Readout";
import { PlacePicker } from "./PlacePicker";
import { Details } from "./Details";

const PLACE_KEY = "vaderlek:place";
const PARAM_KEY = "vaderlek:param";
const REFRESH_MS = 5 * 60 * 1000;

type StoredPlace = Place & { fromGeolocation?: boolean };

function readStored<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* privat läge m.m. */
  }
}

export function VaderlekApp() {
  const [place, setPlace] = useState<StoredPlace | null>(null);
  const [booted, setBooted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [bundle, setBundle] = useState<WeatherBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [cursor, setCursor] = useState<number | null>(null);
  const [param, setParam] = useState<PlotParam>("temperature");
  const [recenter, setRecenter] = useState(0);

  // ---------------------------------------------------------------------------
  // Plats
  // ---------------------------------------------------------------------------
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeoError("Webbläsaren stöder inte platsbestämning. Sök efter en ort i stället.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let name = "Min position";
        let detail: string | undefined;
        try {
          const r = await fetch(`/api/reverse?lat=${latitude}&lon=${longitude}`);
          const j = await r.json();
          if (j.place) {
            name = j.place.name;
            detail = j.place.detail;
          }
        } catch {
          /* namn är inte kritiskt */
        }
        const p: StoredPlace = { name, detail, latitude, longitude, fromGeolocation: true };
        setPlace(p);
        writeStored(PLACE_KEY, p);
        setLocating(false);
        setPickerOpen(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Platsåtkomst nekades. Sök efter en ort i stället."
            : "Kunde inte bestämma din position. Sök efter en ort i stället.",
        );
        setPickerOpen(true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  // Första start: sparad plats → annars försök med geolocation.
  useEffect(() => {
    const stored = readStored<StoredPlace>(PLACE_KEY);
    const storedParam = readStored<PlotParam>(PARAM_KEY);
    // Läses från localStorage efter hydrering för att undvika SSR-mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (storedParam && PLOT_PARAMS.some((p) => p.key === storedParam)) setParam(storedParam);
    if (stored) setPlace(stored);
    else locate();
    setBooted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [locate]);

  const pick = (p: Place) => {
    setPlace(p);
    writeStored(PLACE_KEY, p);
    setPickerOpen(false);
    setGeoError(null);
  };

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  const reqId = useRef(0);
  const load = useCallback(async (p: Place, silent = false) => {
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/weather?lat=${p.latitude.toFixed(3)}&lon=${p.longitude.toFixed(3)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte hämta väderdata");
      if (id === reqId.current) {
        setBundle(json);
        setNow(Date.now());
      }
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message || "Kunde inte hämta väderdata");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!place) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBundle(null);
    setCursor(null);
    load(place);
  }, [place, load]);

  // Klocka + automatisk uppdatering när fliken är synlig.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    let lastLoad = Date.now();
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && place && Date.now() - lastLoad >= REFRESH_MS) {
        lastLoad = Date.now();
        load(place, true);
      }
    }, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        if (place && Date.now() - lastLoad >= REFRESH_MS) {
          lastLoad = Date.now();
          load(place, true);
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [place, load]);

  // ---------------------------------------------------------------------------
  // Härledd data
  // ---------------------------------------------------------------------------
  const plot = useMemo(() => (bundle ? buildPlot(bundle, param, now) : null), [bundle, param, now]);
  const events = useMemo(() => (bundle ? buildEvents(bundle, now) : []), [bundle, now]);
  const t = cursor ?? now;
  const snap = useMemo(() => (bundle ? snapshotAt(bundle, t, now) : null), [bundle, t, now]);
  const onCursor = useCallback((tt: number) => setCursor(tt), []);
  const awayFromNow = cursor !== null && Math.abs(cursor - now) > 10 * 60 * 1000;

  const chooseParam = (p: PlotParam) => {
    setParam(p);
    writeStored(PARAM_KEY, p);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="app">
      <header className="top">
        <h1 className="wordmark">Väderlek</h1>
        {place && (
          <button type="button" className="placebtn" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
            <span className="placebtn-name">{place.name}</span>
            <span className="placebtn-chev" aria-hidden>
              ▾
            </span>
          </button>
        )}
      </header>

      {booted && (!place || pickerOpen) && (
        <PlacePicker
          onPick={pick}
          onUseLocation={locate}
          locating={locating}
          geoError={geoError}
          onClose={place ? () => setPickerOpen(false) : undefined}
          intro={!place}
        />
      )}

      {place && (
        <main>
          {error && !bundle && (
            <div className="state state-error">
              <p>{error}</p>
              <button type="button" className="btn" onClick={() => load(place)}>
                Försök igen
              </button>
            </div>
          )}

          {!bundle && !error && (
            <div className="state state-loading" aria-busy="true">
              <div className="skeleton skeleton-big" />
              <div className="skeleton-grid">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="skeleton" />
                ))}
              </div>
              <p className="muted">Hämtar observationer och prognos…</p>
            </div>
          )}

          {bundle && snap && plot && (
            <>
              <Readout
                snap={snap}
                now={now}
                forecastCreated={bundle.forecast?.createdTime}>
              <section className="timeline-wrap" aria-label="Tidslinje">
                <div className="params" role="tablist" aria-label="Huvudparameter">
                  {PLOT_PARAMS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      role="tab"
                      aria-selected={param === p.key}
                      className={param === p.key ? "param active" : "param"}
                      onClick={() => chooseParam(p.key)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <Timeline now={now} plot={plot} events={events} taf={bundle.taf} onCursor={onCursor} recenterSignal={recenter} />

                <div className="tl-footer">
                  <div className="legend" aria-hidden>
                    <span className="lg lg-obs">Observerat</span>
                    <span className="lg lg-fc">Prognos</span>
                    {param === "wind" && <span className="lg lg-gust">Byar</span>}
                    {param === "cloudBase" && <span className="lg lg-cloud">Molnlager (tätare = mer moln)</span>}
                  </div>
                  <button
                    type="button"
                    className={`btn btn-now${awayFromNow ? " visible" : ""}`}
                    onClick={() => setRecenter((n) => n + 1)}
                    tabIndex={awayFromNow ? 0 : -1}
                  >
                    Till NU
                  </button>
                </div>
                <div className="evlegend" aria-hidden>
                  <span className="ev ev-regn">Regn</span>
                  <span className="ev ev-sno">Snö</span>
                  <span className="ev ev-dimma">Dimma/dis</span>
                  <span className="ev ev-aska">Åska</span>
                  <span className="hint">Dra i grafen för att gå bakåt eller framåt i tiden</span>
                </div>
              </section>
              </Readout>



              {error && <p className="inline-error">Uppdateringen misslyckades: {error}. Visar data från {new Date(bundle.generatedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}.</p>}
              {loading && <p className="muted small">Uppdaterar…</p>}

              <Details bundle={bundle} snap={snap} now={now} />
            </>
          )}
        </main>
      )}

      <footer className="foot">
        <span>DÅ ← NU → SEN</span>
        <span className="muted">
          {bundle ? `Hämtat ${new Date(bundle.generatedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {bundle && Math.abs(now - Date.parse(bundle.generatedAt)) > 2 * HOUR ? " · data kan vara inaktuell" : ""}
        </span>
      </footer>
    </div>
  );
}
