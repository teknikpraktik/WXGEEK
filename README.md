# WXGEEK

**Observed ← NOW → Forecast**

WXGEEK is a mobile-first weather app for Sweden that shows the weather as one
continuous timeline: what was actually **observed** over the past 12 hours, the
situation **now**, and the **forecast** for the next 24 hours, all on the same axis.

```
−12 h ←──────── NOW ────────────────→ +24 h
     observed             forecast
```

- The header shows **temperature / dew point** in whole degrees ("12/11 °C", red above 0 and
  blue below, the dew point lighter – never shown when the data puts it above the temperature),
  **wind** in m/s with the gusts in parentheses ("6 (9) m/s"), the arrow pointing where the wind
  blows and the text saying where it comes from ("From 240°"), visibility and
  **clouds** in three short rows: the symbol and code for how much of the sky is covered
  ("BKN"), the amount in oktas ("5–7/8", plus CB/TCU if reported) and how low: the ceiling
  (the lowest BKN/OVC/VV) or else the lowest base, e.g. "Ceiling 850 m" ("Ceil." on a narrow
  phone when the precipitation cell is shown); CAVOK/NSC give "None below 1500 m". With fog or
  mist – the same rule as the chart's fog symbol, including fog in a TAF TEMPO group or an
  applied PROB group (see the TAF rules below) – the clouds cell shows the fog symbol and FG, BR
  or FZFG (fog below 0 °C) instead, with the TAF group (e.g. "PROB40") and the height below. A
  visibility from an applied PROB group is marked with the group ("PROB40"); lower visibility
  in a TEMPO group or a PROB group that is not applied is shown under the visibility, e.g.
  "PROB40 2.5 km". Precipitation appears when something falls in the hour of the selected
  time – the same bar as under the cursor – and in the forecast also when it only might:
  "max 0.3 mm" as in the chart, with SMHI's probability below. All cells stay on one row, also on mobile, and keep the same height.
- A discreet **source line** under the cells says where and when the values were measured,
  in local time: "Karlstad flygplats · METAR 10:50 · SMHI obs 11:00 (temp, wind)" – the main
  source first, others with what they give, and their station when it is another one (with
  the date when it is not today). In the forecast: "Forecast 14:00 · TAF Karlstad flygplats ·
  SMHI (temp, precip)". A place is spelled the same everywhere (SMHI's "Karlstad Flygplats"
  is shown as "Karlstad flygplats"). Nothing is made up when a time or station is missing.
- The chart is **five panels on one time axis**, top to bottom: time, clouds and
  precipitation, temperature and dew point, wind, and light. All panels share the same
  x-scale; faint vertical gridlines for every hour – a little stronger at 00, 06, 12 and 18 –
  and the NOW line (thin, dashed) run through all of them without a break – the day change is
  marked in the time axis only – and a very faint tone covers the observed part. Each group
  has a rubric in a fixed left column with the same typography and placement, with its unit
  where it has one ("TEMPERATURE °C", "WIND m/s
  (gusts)") – the longest wording that ends before the NOW line on the screen – no legends,
  and the same air on either side of a thin separator. Rubrics
  and values are 12 px. Anything the left column or the edge of the view would cut – a symbol,
  an arrow, a label – is hidden rather than shown in half, and no text is crossed by the NOW
  line: labels move aside instead.
- **Time axis** at the top. A thin row of its own holds NOW as a small pill ("NOW 10:29") with
  "← OBSERVED" and "FORECAST →" on either side, the selected time and the day's name at the
  day-change line – so no hour label is ever hidden by them. Below it every hour (every other
  hour on narrow screens). The axis stays fixed under the header on a solid background while
  the page scrolls, until the chart has scrolled past, and follows the panels' horizontal scroll
  exactly. A **Now** button appears at its right end, in the row of hour labels, only when the
  NOW line is out of view or the selected time is more than an hour from now. It fades in and
  out, hides the hour labels under it, has a touch target of at least 44 × 44 px and scrolls
  back to now.
- **Clouds & precipitation**:
  - **Weather symbols** in a row of their own, all at the same height at their hour: one per
    hour where the data is hourly and one per data step where it is sparser (3 h/6 h) – never
    interpolated – sized to fit an hour's column also on a phone. In the TAF period they follow
    the TAF interpretation, e.g. fog under an applied PROB40 FG. Sun, sun with a small cloud
    (FEW), sun partly behind cloud (SCT), clouds without sun (BKN – 5–7/8 often looks overcast
    from the ground), dark full cloud (OVC); moon instead of sun at night. The symbol is a
    simplification: the largest category among simultaneous layers (oktas are never summed).
    CAVOK, NSC and missing data are never shown as clear sky. **Fog** (three lines, below 1 km)
    and **mist** (two lines) replace the cloud symbol when fog or mist is reported or forecast
    (including fog in a TAF TEMPO group, e.g. BCFG, or an applied PROB group), when visibility
    is below 1 km, or when it is below 5 km without precipitation. A symbol at an hour with
    precipitation gets a few short rain strokes (snow: dots) – they only signal precipitation,
    the bars show the amount.
  - **Precipitation**, with "mm/h" in the row label: saturated bars from a zero line on a
    linear scale of at least 0–2 mm/h (larger when needed); dark = measured or SMHI's median,
    light = the SMHI ensemble's largest amount. The value stands above each bar from 0.1 mm/h:
    the median, or – when the median is under 0.1 mm – the ensemble maximum marked "max 0.3",
    never "≤" (it is no upper bound). Dry hours and hours without data show nothing.
- **Temperature and dew point**: an adaptive scale over all temperatures and dew points in the
  window – at least a 10 °C span with 1 °C margin, on even steps (2, 5 or 10 °C by span), and
  including 0 °C with a dashed 0° line when the lowest value is within 5 °C of zero or the
  values cross it (otherwise no 0° line). The scale stays put across small data updates, never
  shrinks while in use and is recomputed for a new place (`TEMP_AXIS`). **Red above 0 °C, blue
  below** – for the temperature and the dew point, observed and forecast, split exactly at the
  0° line, and likewise the axis numbers and line, the latest value at now and the header
  (a value shown as 0 stays neutral). The dew point is a second, thinner and lighter line in
  the same two colours – solid observed (METAR), dashed forecast from SMHI's relative
  humidity, joined to the last observation over 3 hours. The dew point is never above the
  temperature: where the data puts it higher, it is not drawn and the line breaks there
  (the two lines never cross). A faint shading between the lines
  marks where the spread is under 1 °C – computed only where temperature and dew point have
  time-matched values (the same report, or the same forecast step), never across gaps – at
  least a few pixels high so it shows where the lines coincide, without label or legend (the
  viewer reads it from the curves). A dot marks the latest temperature observation at
  its actual time (never moved to now) with the measured value beside it, e.g. "11 °C".
- **Wind m/s (gusts)**: the arrow shows where the wind blows (the header text says where it
  comes from), with the mean wind and the
  gusts in the same row, "6 (9)". Without a gust value only the mean is shown – missing gusts
  never look like zero – and "(gusts)" is in the rubric only while a gust value is in view.
  Every other hour when the texts would otherwise collide.
- **Light**: the sun's geometric altitude on a fixed scale all year (no autoscaling – the
  seasons are the point), split in two: 0° to 60° takes 65 % of the height and −18° to 0°
  35 %, so civil (0/−6), nautical (−6/−12) and astronomical (−12/−18) twilight show as three
  equal tones. The horizon line is at 0° and the curve is not shifted: sunrise and sunset are
  marked with discreet dots on the curve where the sun is at −0.833° (refraction and the sun's radius – just below the line, which
  the curve crosses a few minutes later/earlier), civil dawn and dusk with open dots on the
  −6° line. Labels: "Sunrise 06:59" and "Sunset 18:54" next to their dots, "Civil dawn 06:18"
  and "Civil dusk 19:34" above theirs, and "Sun alt. max 29°" at the top; an event outside the
  view is shown at the nearest edge with an arrow ("← Sunrise 06:59"). Yellow fills the area
  between the curve and the horizon while the sun is above it, and the curve is hidden below
  −18° instead of running flat along the bottom. Midnight sun and polar night draw the curve
  without rise/set labels. The sun is computed with NOAA's solar calculator (Meeus) for the
  place, every 10 minutes.
- Drag the chart (or use the arrow keys) to select a time within the fixed −12 h … +24 h
  window; **Now** returns to the current time. The selected time – NOW at start and after
  Now – sits a fifth into the plot, so 20 % of the view is observed and 80 % forecast, with
  the same pixels per hour on both sides (about 4 h back and 17 h ahead on a desktop).
- Tapping the **logo** reloads the place and returns to now. The same happens every time the
  page is opened – a fresh load, or coming back after at least a minute in the background
  (phone locked, another app) – and the data is never taken from the browser cache.
- The forecast uses **TAF first** for wind, visibility, cloud and weather at the airport
  while the TAF is valid – METAR and TAF govern now and during the TAF's validity. TAF also
  decides whether there is precipitation: without it in the TAF no precipitation is shown,
  with it only in a TEMPO or PROB group only SMHI's possible amount ("max 0.4"), and with it in
  the TAF's state SMHI's amounts. **SMHI** covers temperature, the amounts, missing values and
  the rest of the window after the TAF. FM applies from its exact time; a BECMG change applies from the
  middle of its interval ("BECMG 2708/2710" from 09Z, the end read from the raw text if AWC
  lacks it) – before that the previous state holds. A BECMG group that raises the visibility
  ends fog (at 1 km or more) and mist or haze (above 5 km) even without NSW, e.g. "0200 FG
  BECMG 2506/2508 9999", and a vertical visibility (VV) is only taken from the group's own
  text. **PROB30/PROB40** (also PROB TEMPO) are not applied, except when the group starts
  within 3 hours of the airport's latest METAR (or has begun) and that METAR – at most 2 hours
  old – supports it: fog or mist in the group needs FG or BR, visibility at most 1 000 m or VV
  in the METAR; precipitation or thunder needs the same phenomenon or its precursor (VCSH for
  showers, VCTS for thunder); otherwise a METAR visibility of at most twice the group's, or
  BKN/OVC/VV at most twice the group's height. An applied group then holds for its whole
  period and ends when a new METAR no longer supports it. TEMPO is additional information only,
  over its whole period.
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
- **SMHI forecast cloud base** has no documented reference level (ground or sea), so it is treated as approximate. The model gives only the lowest base (no layers).
- **Observed cloud cover** comes from the METAR's layer categories (FEW/SCT/BKN/OVC), not measured oktas, and says nothing about layers above the highest one reported. SMHI stations report only the cloud base.
- **Gusts while a TAF is valid** come from the TAF, which only reports gusts when they are strong (a G group). Without one only the mean wind is shown; SMHI's gusts are not mixed with the TAF's mean wind.
- **Precipitation "max"** is the largest amount among SMHI's ensemble members for the hour – not an upper bound.
- **The shading between temperature and dew point** marks a spread under 1 °C between time-matched values. It indicates possible fog; it is not a fog forecast. If the temperature and the dew point come from different stations or times, no spread is computed.
- **The forecast dew point** is derived from SMHI's temperature and relative humidity (Magnus formula) – `snow1g` has no dew point parameter.
- **Precipitation gauges** are sparse.
- **TAF** applies to the airport (within 50 km), while SMHI applies to the location's coordinates.
- **Sweden only.**

---

Data: SMHI (CC BY 4.0), NOAA Aviation Weather Center, © OpenStreetMap contributors.
© Per Björkman · Teknikpraktik
