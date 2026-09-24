"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Place, WeatherBundle } from "@/lib/types";
import { buildChart, HOUR, snapshotAt } from "@/lib/client/timeline";
import { aviationAlerts } from "@/lib/client/alerts";
import { Timeline } from "./Timeline";
import { Readout } from "./Readout";
import { PlacePicker } from "./PlacePicker";
import { DataInfo, SourceNote, Warnings } from "./DataInfo";
import { Logo } from "./Logo";

const PLACE_KEY = "wxgeek:place";
/** Previous app name – read once so existing users keep their place. */
const LEGACY_PLACE_KEYS = ["geekwx:place", "vaderlek:place"];
const REFRESH_MS = 5 * 60 * 1000;
/** Sidan räknas som öppnad igen när den varit dold minst så här länge (mobilen låst, annan app). */
const REOPEN_MS = 60 * 1000;

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
    /* private mode etc. */
  }
}

export function WxgeekApp() {
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
  const [recenter, setRecenter] = useState(0);

  // ---------------------------------------------------------------------------
  // Location
  // ---------------------------------------------------------------------------
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeoError("Location is not supported by this browser. Search for a place instead.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let name = "My location";
        let detail: string | undefined;
        try {
          const r = await fetch(`/api/reverse?lat=${latitude}&lon=${longitude}`);
          const j = await r.json();
          if (j.place) {
            name = j.place.name;
            detail = j.place.detail;
          }
        } catch {
          /* the name is not critical */
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
            ? "Location access was denied. Search for a place instead."
            : "Could not determine your location. Search for a place instead.",
        );
        setPickerOpen(true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  // First start: stored place → otherwise try geolocation.
  useEffect(() => {
    const stored =
      readStored<StoredPlace>(PLACE_KEY) ?? LEGACY_PLACE_KEYS.map((k) => readStored<StoredPlace>(k)).find(Boolean) ?? null;
    // Read from localStorage after hydration to avoid an SSR mismatch.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (stored) {
      setPlace(stored);
      writeStored(PLACE_KEY, stored);
    } else locate();
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
  const lastLoad = useRef(0);
  const load = useCallback(async (p: Place, silent = false) => {
    const id = ++reqId.current;
    lastLoad.current = Date.now();
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Aldrig från webbläsarens cache – varje laddning hämtar från servern.
      const res = await fetch(`/api/weather?lat=${p.latitude.toFixed(3)}&lon=${p.longitude.toFixed(3)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load weather data");
      if (id === reqId.current) {
        setBundle(json);
        setNow(Date.now());
      }
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message || "Could not load weather data");
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

  /** Loggan, och varje gång sidan öppnas: ladda om platsen och gå till NU. */
  const reopen = useCallback(() => {
    if (!place) return;
    setPickerOpen(false);
    setNow(Date.now());
    setCursor(null);
    setRecenter((n) => n + 1);
    load(place);
  }, [place, load]);

  // Clock + automatic refresh while the tab is visible. When the page is opened again – after
  // at least REOPEN_MS hidden, or restored from the back/forward cache – it reloads and goes to
  // now, just like a fresh page load.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible" && place && Date.now() - lastLoad.current >= REFRESH_MS) load(place, true);
    }, 60_000);
    let hiddenAt: number | null = null;
    let lastReopen = 0;
    const open = () => {
      // visibilitychange och pageshow kan båda komma vid samma återkomst
      if (Date.now() - lastReopen < 2000) return;
      lastReopen = Date.now();
      reopen();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= REOPEN_MS) {
        open();
        return;
      }
      setNow(Date.now());
      if (place && Date.now() - lastLoad.current >= REFRESH_MS) load(place, true);
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) open();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onShow);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onShow);
    };
  }, [place, load, reopen]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  // Temperature scale is kept between refreshes and time selection; recomputed on a new place.
  const [tempDomain, setTempDomain] = useState<{ key: string; domain: [number, number] } | null>(null);
  const placeKey = place ? `${place.latitude},${place.longitude}` : "";
  const prevDomain = tempDomain?.key === placeKey ? tempDomain.domain : undefined;
  const chart = useMemo(() => (bundle ? buildChart(bundle, now, prevDomain) : null), [bundle, now, prevDomain]);
  // Remember the scale (adjusting state during render – React's pattern for derived state).
  if (chart && (tempDomain?.key !== placeKey || tempDomain.domain[0] !== chart.temp.domain[0] || tempDomain.domain[1] !== chart.temp.domain[1])) {
    setTempDomain({ key: placeKey, domain: chart.temp.domain });
  }
  const alerts = useMemo(
    () => (bundle ? aviationAlerts(bundle, now, Date.parse(bundle.forecastUntil)) : []),
    [bundle, now],
  );
  const t = cursor ?? now;
  const snap = useMemo(() => (bundle ? snapshotAt(bundle, t, now) : null), [bundle, t, now]);
  const onCursor = useCallback((tt: number) => setCursor(tt), []);
  const awayFromNow = cursor !== null && Math.abs(cursor - now) > 10 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="app">
      <header className="top">
        <h1 className="wordmark">
          {place ? (
            // Loggan laddar om platsen och går till NU
            <button type="button" className="wordmark-btn" onClick={reopen} aria-label="WXGEEK – reload and go to now">
              <Logo className="logo" />
            </button>
          ) : (
            <Logo className="logo" />
          )}
        </h1>
        {place && (
          <>
            {/* Platsen som text – ändras med en egen knapp, inte genom att klicka på namnet */}
            <p className="place" title={place.name}>
              <svg className="place-pin" width={12} height={14} viewBox="0 0 12 14" aria-hidden>
                <path d="M6 13.2s4.4-4.1 4.4-7.3a4.4 4.4 0 0 0-8.8 0c0 3.2 4.4 7.3 4.4 7.3z" />
                <circle cx={6} cy={5.9} r={1.5} />
              </svg>
              <span className="place-name">{place.name}</span>
            </p>
            <button
              type="button"
              className="btn place-change"
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
              aria-label="Change location"
            >
              Change
            </button>
          </>
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
                Try again
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
            </div>
          )}

          {bundle && snap && chart && (
            <>
              <Readout snap={snap} now={now}>
                <section className="timeline-wrap" aria-label="Timeline">
                  <div className="tl-controls">
                    <div className="tl-buttons">
                      {/* "Now" always keeps its place, even when now is selected */}
                      <button
                        type="button"
                        className="btn btn-now"
                        onClick={() => setRecenter((n) => n + 1)}
                        disabled={!awayFromNow}
                        aria-label="Select current time"
                      >
                        Now
                      </button>
                    </div>
                  </div>
                  <Timeline
                    now={now}
                    until={Date.parse(bundle.forecastUntil)}
                    data={chart}
                    onCursor={onCursor}
                    recenterSignal={recenter}
                  />
                </section>
              </Readout>

              {error && <p className="inline-error">Update failed: {error}</p>}
              {loading && <p className="muted small">Updating…</p>}

              <DataInfo bundle={bundle} snap={snap} />

              {/* Varningar längst ner, diskret */}
              <Warnings warnings={bundle.warnings ?? []} alerts={alerts} />
            </>
          )}
        </main>
      )}

      <footer className="foot">
        {bundle && <SourceNote bundle={bundle} now={now} />}
        <span>
          Data: SMHI (CC BY 4.0) · NOAA Aviation Weather Center · © OpenStreetMap contributors
        </span>
        <span>
          © {new Date(now).getFullYear()} Per Björkman · Teknikpraktik
          {bundle && Math.abs(now - Date.parse(bundle.generatedAt)) > 2 * HOUR && (
            <span className="stale-note"> · Data may be out of date</span>
          )}
        </span>
      </footer>
    </div>
  );
}
