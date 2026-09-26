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
  when the spread is under 1 °C – the same condition as in the chart, and only with values from
  the same measurement or forecast step), **wind** in m/s with the arrow pointing where the wind
  blows and the text saying where it comes from ("From SW 240°"), visibility and
  **clouds** in three short rows: the symbol and code for how much of the sky is covered
  ("BKN"), the amount in oktas ("5–7/8", plus CB/TCU if reported) and how low: the ceiling
  (the lowest BKN/OVC/VV) or else the lowest base, e.g. "Ceiling 850 m" ("Ceil." on a narrow
  phone when the precipitation cell is shown); CAVOK/NSC give "None below 1500 m". With fog or
  mist – the same rule as the chart's fog symbol, including fog in a TAF TEMPO/PROB group –
  the clouds cell shows the fog symbol and FG, BR or FZFG (fog below 0 °C) instead, with the
  TAF group (e.g. "PROB40") and the height below. Lower visibility in a TAF TEMPO/PROB group
  is shown under the visibility, e.g. "PROB40 2.5 km". Precipitation appears when something
  falls in the hour of the selected time – the same bar as under the cursor – and in the
  forecast also when it only might: "max 0.3 mm" as in the chart, with SMHI's probability
  below. All cells stay on one row, also on mobile, and keep the same height.
- A discreet **source line** under the cells says where and when the values were measured,
  in local time: "Karlstad flygplats · METAR 10:50 · SMHI obs 11:00 (temp, wind)" – the main
  source first, others with what they give, and their station when it is another one (with
  the date when it is not today). In the forecast: "Forecast 14:00 · TAF Karlstad flygplats ·
  SMHI (temp, precip)". A place is spelled the same everywhere (SMHI's "Karlstad Flygplats"
  is shown as "Karlstad flygplats"). Nothing is made up when a time or station is missing.
- The chart is **five panels on one time axis**, top to bottom: time, clouds and
  precipitation, temperature and dew point, wind, and light. All panels share the same
  x-scale; faint vertical gridlines for every hour – a little stronger at 00, 06, 12 and 18 –
  the day change and the NOW line run through all of them without a break, and a very faint
  tone covers the observed part. Each group has a rubric in a fixed left column with the same
  typography and placement, with its unit where it has one ("TEMPERATURE °C", "WIND m/s
  (gusts)") – the longest wording that ends before the NOW line on the screen – a small legend
  at the right of the rubric row, and the same air on either side of a thin separator. Rubrics
  and values are 12 px. Anything the left column or the edge of the view would cut – a symbol,
  an arrow, a label – is hidden rather than shown in half, and no text is crossed by the NOW
  line: labels move aside instead.
- **Time axis** at the top, with a compact **Now** button at its left edge. A thin row of its
  own holds NOW as a small pill ("NOW 10:29") with "← OBSERVED" and "FORECAST →" on either
  side, the selected time and the day's name at the day-change line – so no hour label is ever
  hidden by them. Below it every hour (every other hour on narrow screens).
- **Clouds & precipitation**:
  - **Weather symbols** in a row of their own, all at the same height at their hour: one every
    2 hours plus every hour with precipitation and at least one per fog period; on narrow
    screens only every 3 hours. Sun, sun with a small cloud (FEW), sun partly behind cloud
    (SCT), clouds without sun (BKN – 5–7/8 often looks overcast from the ground), dark full
    cloud (OVC); moon instead of sun at night. The symbol is a simplification: the largest
    category among simultaneous layers (oktas are never summed). CAVOK, NSC and missing data
    are never shown as clear sky. **Fog** (three lines, below 1 km) and **mist** (two lines)
    replace the cloud symbol when fog or mist is reported (including fog in a TAF TEMPO/PROB
    group, e.g. BCFG), when visibility is below 1 km, or when it is below 5 km without
    precipitation. A symbol at an hour with precipitation gets a few short rain strokes (snow:
    dots) – they only signal precipitation, the bars show the amount.
  - **Cloud cover per hour in three rows** – High, Mid and Low (bases below 2 000 m,
    2 000–6 000 m and above), 10 px each – on one scale for all rows: a known hour gets a faint
    base (clear) and the cloud's tone on top by the oktas, light = few, dark = overcast. No
    data is left blank, so it never looks like clear sky. The forecast uses SMHI's low, medium
    and high cloud cover. An observed hour uses the METAR within 35 minutes: each reported
    layer's category (FEW 1.5/8, SCT 3.5/8, BKN 6/8, OVC/VV 8/8) in the row of its base; rows
    below the highest reported layer are clear, rows above it stay blank (unknown – hidden
    above the cloud or not reported).
  - **Precipitation**, with "mm/h" in the row label: saturated bars from a zero line on a
    linear scale of at least 0–2 mm/h (larger when needed); dark = measured or SMHI's median,
    light = the SMHI ensemble's largest amount. The value stands above each bar from 0.1 mm/h:
    the median, or – when the median is under 0.1 mm – the ensemble maximum marked "max 0.3",
    never "≤" (it is no upper bound). Dry hours and hours without data show nothing.
- **Temperature and dew point**: an adaptive scale over all temperatures and dew points in the
  window – at least a 10 °C span with 1 °C margin, on even steps (2, 5 or 10 °C by span), and
  including 0 °C with a dashed 0° line when the lowest value is within 5 °C of zero or the
  values cross it (otherwise no 0° line). The scale stays put across small data updates, never
  shrinks while in use and is recomputed for a new place (`TEMP_AXIS`). The dew point is a
  second line in a calmer colour – solid observed (METAR), dashed forecast from SMHI's relative
  humidity, joined to the last observation over 3 hours. **Fog risk** is shaded between the
  lines where the spread is under 1 °C – computed only where temperature and dew point have
  time-matched values (the same report, or the same forecast step), never across gaps – at
  least a few pixels high so it shows where the lines coincide, and with a discreet "Fog risk"
  label on longer periods. Under the chart: "Small temperature–dew point spread indicates
  possible fog; it is not a fog forecast." A dot marks the latest temperature observation at
  its actual time (never moved to now) with the measured value beside it, e.g. "11 °C".
- **Wind m/s (gusts)**: the arrow shows where the wind blows (the legend says "arrow =
  direction of flow"; the header text says where it comes from), with the mean wind and the
  gusts in the same row, "6 (9)". Without a gust value only the mean is shown – missing gusts
  never look like zero – and "(gusts)" is in the rubric only while a gust value is in view.
  Every other hour when the texts would otherwise collide.
- **Light**: the sun's geometric altitude on a fixed scale all year (no autoscaling – the
  seasons are the point), split in two: 0° to 60° takes 65 % of the height and −18° to 0°
  35 %, so civil (0/−6), nautical (−6/−12) and astronomical (−12/−18) twilight show as three
  equal tones (legend: "Twilight: civil / nautical / astronomical"). The horizon line is at 0°
  and the curve is not shifted: sunrise and sunset are marked with discreet dots on the curve
  where the sun is at −0.833° (refraction and the sun's radius – just below the line, which
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
  while the TAF is valid. **SMHI** covers temperature, precipitation, missing values and
  the rest of the window. A BECMG group that raises the visibility ends fog (at 1 km or
  more) and mist or haze (above 5 km) even without NSW, e.g. "0200 FG BECMG 2506/2508 9999",
  and a vertical visibility (VV) is only taken from the group's own text. A BECMG change
  applies from the last time of its interval (read from the raw text if AWC lacks it).
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
- **Observed cloud cover** comes from the METAR's layer categories (FEW/SCT/BKN/OVC), not measured oktas, and says nothing about layers above the highest one reported. SMHI stations report only the cloud base.
- **Gusts while a TAF is valid** come from the TAF, which only reports gusts when they are strong (a G group). Without one only the mean wind is shown; SMHI's gusts are not mixed with the TAF's mean wind.
- **Precipitation "max"** is the largest amount among SMHI's ensemble members for the hour – not an upper bound.
- **Fog risk** is a spread under 1 °C between time-matched temperature and dew point. It indicates possible fog; it is not a fog forecast. If the temperature and the dew point come from different stations or times, no spread is computed.
- **The forecast dew point** is derived from SMHI's temperature and relative humidity (Magnus formula) – `snow1g` has no dew point parameter.
- **Precipitation gauges** are sparse.
- **TAF** applies to the airport (within 50 km), while SMHI applies to the location's coordinates.
- **Sweden only.**

---

Data: SMHI (CC BY 4.0), NOAA Aviation Weather Center, © OpenStreetMap contributors.
© Per Björkman · Teknikpraktik
