# WXGEEK

**Observed ← NOW → Forecast**

WXGEEK is a mobile-first weather app for Sweden that shows the weather as one
continuous timeline: what was actually **observed** over the past 12 hours, the
situation **now**, and the **forecast** for the next 24 hours, all on the same axis.

```
−12 h ←──────── NOW ────────────────→ +24 h
     observed             forecast
```

- The header shows temperature, wind (m/s, direction in whole tens of degrees),
  visibility and **cloud cover** (symbol, description and code, e.g. "Broken · BKN · 5–7/8").
  Precipitation appears only when data exists for the selected time.
- Temperature chart (left axis): an adaptive scale chosen from all temperatures in the
  window – the smallest range on multiples of 5 °C with margin and at least a 20 °C span,
  preferring one that also shows 0 and −5 °C when that costs at most 5 °C extra. The scale
  stays put while you select times and across small data updates, never shrinks while in
  use, and is recomputed for a new place. The settings are collected in `TEMP_AXIS`.
- **Cloud cover symbols** sit on the temperature curve: one every 2 hours (every 3 on narrow
  screens) and every hour with precipitation – sun, sun with a small cloud (FEW), sun partly
  behind cloud (SCT), mostly cloud (BKN), full cloud (OVC); moon instead of sun at night. The
  symbol is a simplification: the largest category among simultaneous layers (oktas are never
  summed). CAVOK, NSC and missing data are never shown as clear sky. **Fog** (three lines,
  below 1 km) and **mist** (two lines) replace the cloud symbol when fog or mist is reported
  (including fog in a TAF TEMPO/PROB group, e.g. BCFG), when visibility is below 1 km, or when
  it is below 5 km without precipitation.
- **Precipitation, mm per hour**: one series of bars from a zero line (dark = measured or
  expected, light = possible; "≤0.3" = most likely dry, but up to 0.3 mm possible). Hours
  without data have no zero line, so missing is not 0 mm. Every hour with precipitation gets a
  cloud symbol with a few short rain strokes (snow: dots) just below it – they only signal
  precipitation, the bars show the amount.
- Wind arrows run below the time axis, which labels every hour. Midnight is marked by a line
  through the time axis with the new day's name, and the new day has a subtle background.
- Drag the chart (or use the arrow keys) to select a time within the fixed −12 h … +24 h
  window; **Now** returns to the current time.
- The forecast uses **TAF first** for wind, visibility, cloud and weather at the airport
  while the TAF is valid. **SMHI** covers temperature, precipitation, missing values and
  the rest of the window.
- Warnings appear under the chart: SMHI impact-based weather warnings, SIGMETs and
  significant weather in METAR/TAF. Significant weather covers thunderstorms, CB/TCU,
  freezing precipitation, fog, visibility below 1,500 m, wind or gusts of 13 m/s or more,
  and ceilings below 150 m.
- A one-sentence plain-language description of the current weather follows the warnings
  (clouds, humidity, Beaufort wind and what's coming). The text is generated from rules, not by AI.
- Raw METAR and TAF are printed at the bottom of the page.

WXGEEK never implies more precision than the sources support: it interpolates no values,
and it shows missing data as missing.

## Getting started

Requires Node.js 20+ (developed on Node 24).

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # time, TAF, alert and data logic tests (node:test via tsx)
npm run build      # production build
npm start          # run the production build
```

## Environment variables

None. All data sources are open and need no API keys. External calls still go through
the server's API routes, which handle caching, CORS and any future keys.

## Deployment on Vercel

The repository is connected to Vercel, and every push to `main` is deployed. API routes
run as Vercel Functions (Node.js, Fluid Compute) and send `Cache-Control` with
`s-maxage`, so the CDN takes load off both the functions and the upstream sources.

## Data sources

| Source | Used for | Licence |
|---|---|---|
| NOAA Aviation Weather Center | METAR (now + 13 h), TAF, SIGMET | US federal data, free to use |
| SMHI meteorological observations | Station observations, last 24 h | CC BY 4.0 |
| SMHI meteorological forecast (`snow1g`) | Point forecast | CC BY 4.0 |
| SMHI impact-based weather warnings (IBWW) | Warnings for the location | CC BY 4.0 |
| OpenStreetMap Nominatim | Place search | ODbL |

Details, endpoints and limitations: [`docs/data-sources.md`](docs/data-sources.md).
Architecture, station selection and caching: [`docs/architecture.md`](docs/architecture.md).

## Known limitations

- **Station based.** Local showers between stations are not observed.
- **SMHI observations are published with ~1 h delay.** METAR is often fresher but only exists at airports.
- **METAR temperature is reported in whole degrees.** WXGEEK shows it without a decimal.
- **METAR gusts** are reported only when strong, so SMHI gusts are preferred when available.
- **SMHI forecast cloud base** has no documented reference level (ground or sea), so it is treated as approximate.
- **Precipitation gauges** are sparse.
- **TAF** applies to the airport (within 50 km), while SMHI applies to the location's coordinates.
- **Sweden only.**

---

Data: SMHI (CC BY 4.0), NOAA Aviation Weather Center, © OpenStreetMap contributors.
© Per Björkman · Teknikpraktik
