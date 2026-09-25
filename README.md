# WXGEEK

**Observed ← NOW → Forecast**

WXGEEK is a mobile-first weather app for Sweden that shows the weather as one
continuous timeline: what was actually **observed** over the past 12 hours, the
situation **now**, and the **forecast** for the next 24 hours, all on the same axis.

```
−12 h ←──────── NOW ────────────────→ +24 h
     observed             forecast
```

- The header shows **temperature / dew point** in whole degrees ("12/11 °C", with "Fog risk"
  when the dew point is within 1°), wind (m/s, direction in whole tens of degrees), visibility and
  **clouds** in three short rows: the symbol and code for how much of the sky is covered
  ("BKN"), the amount in oktas ("5–7/8", plus CB/TCU if reported) and how low: the ceiling
  (the lowest BKN/OVC/VV) or else the lowest base, e.g. "Ceiling 850 m" ("Ceil." on a narrow
  phone when the precipitation cell is shown); CAVOK/NSC give "None below 1500 m". With fog or
  mist – the same rule as the chart's fog symbol, including fog in a TAF TEMPO/PROB group –
  the clouds cell shows the fog symbol and FG, BR or FZFG (fog below 0 °C) instead, with the
  TAF group (e.g. "PROB40") and the height below. Lower visibility in a TAF TEMPO/PROB group
  is shown under the visibility, e.g. "PROB40 2.5 km". Precipitation appears only when
  something falls (more than 0 mm) at the selected time. All cells stay on one row, also on
  mobile, and keep the same height.
- Temperature chart (left axis): an adaptive scale chosen from all temperatures in the
  window – the smallest range on multiples of 5 °C with margin and at least a 20 °C span,
  preferring one that also shows 0 and −5 °C when that costs at most 5 °C extra. The scale
  stays put while you select times and across small data updates, never shrinks while in
  use, and is recomputed for a new place. The settings are collected in `TEMP_AXIS`. The axis
  is titled "Temperature °C" – below the symbol row, just above the scale – and a dot marks
  the latest temperature observation at its actual time (never moved to now) with the
  measured value beside it, e.g. "11 °C".
- **Weather symbols** sit in their own row above the temperature chart – all at the same
  height and at their hour on the same time axis, so the curve is never read as a cloud base.
  The row lies outside the shaded plot with some air below it (also under rain strokes), so a
  symbol is never read as a value above the top of the scale:
  one every 2 hours plus every hour with precipitation and at least one per fog period; on
  narrow screens only every 3 hours. Sun, sun with a small cloud (FEW), sun partly
  behind cloud (SCT), mostly cloud (BKN), full cloud (OVC); moon instead of sun at night. The
  symbol is a simplification: the largest category among simultaneous layers (oktas are never
  summed). CAVOK, NSC and missing data are never shown as clear sky. **Fog** (three lines,
  below 1 km) and **mist** (two lines) replace the cloud symbol when fog or mist is reported
  (including fog in a TAF TEMPO/PROB group, e.g. BCFG), when visibility is below 1 km, or when
  it is below 5 km without precipitation.
- **Precipitation, mm per hour**: one series of bars from a zero line (dark = measured or
  expected, light = possible; "≤0.3" = most likely dry, but up to 0.3 mm possible). The zero
  line is drawn only under a measured or expected amount, not under "≤"; dry hours show
  nothing, just like hours without data. A symbol at an hour with precipitation gets a few
  short rain strokes (snow: dots) just below it – they only signal precipitation, the bars
  show the amount.
- Wind arrows run below the time axis, which labels every hour. Midnight is marked by a line
  through the time axis with the new day's name.
- Drag the chart (or use the arrow keys) to select a time within the fixed −12 h … +24 h
  window; **Now** returns to the current time. The selected time – NOW at start – sits a
  quarter into the chart, so about 25 % of the view is observed and 75 % forecast.
- Tapping the **logo** reloads the place and returns to now. The same happens every time the
  page is opened – a fresh load, or coming back after at least a minute in the background
  (phone locked, another app) – and the data is never taken from the browser cache.
- The forecast uses **TAF first** for wind, visibility, cloud and weather at the airport
  while the TAF is valid. **SMHI** covers temperature, precipitation, missing values and
  the rest of the window.
- Raw METAR and TAF are printed at the bottom of the page under the name of the airport they
  are from, followed by discreet warnings:
  SMHI weather warnings (meteorological only – not water shortage, high flows, flooding,
  sea level or fire risk), SIGMETs and warnings from METAR/TAF. METAR/TAF warnings cover only
  weather that can affect society: thunderstorms, CB, strong wind (mean ≥ 14 m/s or gusts
  ≥ 20 m/s), heavy or freezing precipitation, hail, ice pellets and blowing snow – not fog,
  low visibility or low cloud.

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
- **METAR temperature is reported in whole degrees**, so WXGEEK shows all temperatures and dew points in whole degrees.
- **METAR gusts** are reported only when strong, so SMHI gusts are preferred when available.
- **SMHI forecast cloud base** has no documented reference level (ground or sea), so it is treated as approximate.
- **Precipitation gauges** are sparse.
- **TAF** applies to the airport (within 50 km), while SMHI applies to the location's coordinates.
- **Sweden only.**

---

Data: SMHI (CC BY 4.0), NOAA Aviation Weather Center, © OpenStreetMap contributors.
© Per Björkman · Teknikpraktik
