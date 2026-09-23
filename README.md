# GeekWX

**Observed ← NOW → Forecast**

GeekWX is a mobile-first weather app for Sweden that shows the weather as one
continuous timeline: what was actually **observed** over the past 12 hours, the
situation **now**, and the **forecast** for the next 12 hours, all on the same axis.

```
−12 h ←──────── NOW ────────→ +12 h
     observed            forecast
```

- The header shows temperature, wind (m/s, direction in whole tens of degrees),
  visibility and cloud base with cover type and oktas. Precipitation appears only
  when data exists for the selected time.
- One chart: temperature (°C, left axis, fixed −20 … +35, red above zero and blue below)
  and cloud base (m, right axis, linear 0–3,000 m). Cloud icons are
  filled from the bottom by the eighths of the sky covered. Precipitation falls as drops
  from the cloud base, and forecast drops are shaded by SMHI's probability of
  precipitation. The ground layer shows accumulated rain (mm) and estimated snow depth
  (cm). Directly under the ground line, each hour shows its precipitation in mm: measured,
  or for the forecast the likely amount (dark, SMHI ensemble median) and the possible
  amount (light, upper end of the spread). Wind arrows run below the chart.
- Drag the chart, or use −1 h / Now / +1 h, to select a time within the fixed ±12 h window.
- The forecast uses **TAF first** for wind, visibility, cloud and weather at the airport
  while the TAF is valid. **SMHI** covers temperature, precipitation, missing values and
  the rest of the window.
- Warnings appear under the chart: SMHI impact-based weather warnings, SIGMETs and
  significant weather in METAR/TAF. Significant weather covers thunderstorms, CB/TCU,
  freezing precipitation, fog, visibility below 1,500 m, wind or gusts of 13 m/s or more,
  and ceilings below 150 m.
- A plain-language explanation of the current weather follows the warnings. It covers cloud
  type and height, dew point and humidity, wind on the Beaufort scale, precipitation and the
  12-hour temperature trend. The text is generated from rules, not by AI.
- Raw METAR and TAF are printed at the bottom of the page.

GeekWX never implies more precision than the sources support: it interpolates no values,
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
- **METAR temperature is reported in whole degrees.** GeekWX shows it without a decimal.
- **METAR gusts** are reported only when strong, so SMHI gusts are preferred when available.
- **SMHI forecast cloud base** has no documented reference level (ground or sea), so it is treated as approximate.
- **Precipitation gauges** are sparse.
- **Snow depth** is estimated as new snow (1 mm water ≈ 1 cm snow), without melting or settling.
- **TAF** applies to the airport (within 50 km), while SMHI applies to the location's coordinates.
- **Sweden only.**

---

Data: SMHI (CC BY 4.0), NOAA Aviation Weather Center, © OpenStreetMap contributors.
© Per Björkman · Teknikpraktik
