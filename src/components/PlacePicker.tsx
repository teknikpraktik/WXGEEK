"use client";

import { useState } from "react";
import type { Place } from "@/lib/types";

type Props = {
  onPick: (p: Place) => void;
  onUseLocation: () => void;
  locating: boolean;
  geoError?: string | null;
  onClose?: () => void;
  intro?: boolean;
};

export function PlacePicker({ onPick, onUseLocation, locating, geoError, onClose, intro }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.places);
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      {intro && (
        <div className="picker-intro">
          <p className="picker-lead">
            <b>Observed</b> weather for the past 12 hours, <b>now</b> and the <b>forecast</b> – on one timeline.
          </p>
          <p className="muted">Choose a location.</p>
        </div>
      )}
      <div className="picker-head">
        <button type="button" className="btn btn-primary" onClick={onUseLocation} disabled={locating}>
          {locating ? "Locating…" : "Use my location"}
        </button>
        {onClose && (
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        )}
      </div>
      {geoError && <p className="picker-error">{geoError}</p>}

      <form onSubmit={search} className="picker-form" role="search">
        <label htmlFor="place-q" className="picker-label">
          Search for a place in Sweden
        </label>
        <div className="picker-row">
          <input
            id="place-q"
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="e.g. Karlstad, Kiruna, Visby"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || q.trim().length < 2}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {error && <p className="picker-error">{error}</p>}
      {results && results.length === 0 && <p className="muted">No place in Sweden with that name.</p>}
      {results && results.length > 0 && (
        <ul className="picker-results">
          {results.map((p) => (
            <li key={`${p.latitude},${p.longitude}`}>
              <button type="button" onClick={() => onPick(p)}>
                <span className="picker-name">{p.name}</span>
                {p.detail && <span className="picker-detail">{p.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="picker-attrib">Place search: © OpenStreetMap contributors</p>
    </div>
  );
}
