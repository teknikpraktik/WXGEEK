# Arkitektur

## Utgångsläge

Repot var tomt när arbetet började (2026-09-23). Projektet skapades med
`create-next-app` (Next.js 16, App Router, TypeScript, ESLint, utan Tailwind).

## Översikt

```
Webbläsare                              Server (Vercel Functions, Node.js)            Externa källor
───────────                             ─────────────────────────────────             ──────────────
GeekwxApp ─── /api/weather?lat&lon ──▶ route.ts ─▶ buildWeatherBundle() ──┬──▶ AWC  metar (bbox, historik)
   │                                                 │                     ├──▶ AWC  taf (bbox)
   │                                                 │  stationsval        ├──▶ SMHI metobs (stationslistor, latest-day)
   │                                                 │  normalisering      ├──▶ SMHI snow1g (punktprognos)
   │                                                 │                     ├──▶ SMHI IBWW (varningar)
   │                                                 │                     └──▶ AWC  isigmet
   │◀──────── WeatherBundle (JSON) ──────────────────┘
   │
   ├─ /api/geocode?q=      ─▶ Nominatim search
   └─ /api/reverse?lat&lon ─▶ Nominatim reverse
```

UI:t känner bara till de normaliserade typerna i `src/lib/types.ts`
(`WeatherObservation`, `ForecastPoint`, `Taf`, `WeatherBundle` …). Byte av
datakälla påverkar bara en adapter och `sources.ts`.

## Kataloger

| Sökväg | Ansvar |
|---|---|
| `src/lib/types.ts` | Interna, normaliserade typer |
| `src/lib/adapters/` | Råformat → interna typer. Rena funktioner utan nätverk. `metar.ts`, `taf.ts`, `smhi-obs.ts`, `smhi-forecast.ts` |
| `src/lib/server/sources.ts` | Alla externa HTTP-anrop, cache-tider (`CACHE`) |
| `src/lib/server/http.ts` | `fetchJson` (timeout, User-Agent, 204/404 → `null`) och minnescache |
| `src/lib/server/bundle.ts` | Orkestrering: hämtar parallellt, väljer stationer, bygger `WeatherBundle` |
| `src/lib/server/warnings.ts` | SMHI-varningar och SIGMET för platsen (point-in-polygon) |
| `src/lib/server/geocode.ts` | Ortsökning och omvänd geokodning |
| `src/lib/weather/stations.ts` | Regler och poängsättning för stationsval |
| `src/lib/weather/phenomena.ts` | METAR-väderkoder, SMHI "rådande väder", SMHI-symboler → svenska fenomen |
| `src/lib/client/forecast.ts` | Prognosens källor: TAF-huvudprognos, BECMG, TEMPO/PROB, SMHI-komplettering, källa per variabel |
| `src/lib/client/alerts.ts` | Betydande väder ur senaste METAR och TAF (åska, CB/TCU, underkylt, dimma, sikt < 1 500 m, vind/byar ≥ 13 m/s, tak < 150 m) |
| `src/lib/client/timeline.ts` | Klientlogik: diagramdata, avläsning vid en tidpunkt |
| `*.test.ts` | Tester för tids-, TAF- och datalogik (`npm test`) |
| `src/lib/format.ts` | Engelsk formatering (en-GB, Europe/Stockholm), avrundning mot falsk precision |
| `src/app/api/*/route.ts` | API-routes |
| `src/components/` | React-komponenter |

## Dataflöde i `buildWeatherBundle`

1. **Parallellt** (`Promise.allSettled` – en källa som fallerar stoppar inget):
   - Senaste METAR för alla flygplatser inom ~110 km (`bbox`).
   - TAF för flygplatser inom ~60 km.
   - SMHI-prognos för punkten.
   - SMHI:s stationslistor för 8 parametrar (cachade i minnet).
2. **Kandidater per parameter**: METAR-stationer vars senaste rapport innehåller
   parametern + SMHI-stationer som mäter den och har rapporterat senaste 3 h.
3. **Stationsval** (se nedan). För SMHI-vinnare hämtas `latest-day`; om den
   senaste mätningen visar sig vara för gammal prövas nästa kandidat (max 3).
4. **Historik**: METAR-historik (13 h) för vald(a) METAR-station(er) samt alltid
   närmaste METAR inom 60 km (för rå-METAR). Senaste rapporten från steg 1 slås
   alltid ihop med historiken, eftersom historiken har längre cache.
5. **Normalisering** till `StationSeries[]`. SMHI-parametrar från samma station
   slås ihop per tidpunkt till `WeatherObservation`.
6. **TAF**: närmaste giltiga TAF inom 50 km.
   **Prognosfönster** (`forecastUntil`): alltid NU + 12 h (fast fönster).
7. **Varningar**: SMHI IBWW och SIGMET hämtas parallellt; fel där stoppar inget.
8. **Källstatus** per källa med felmeddelande (engelska).

## Stationsval

Enkel och transparent regel, en per parameter (`src/lib/weather/stations.ts`):

```
poäng = avstånd_km + 10 × max(0, ålder_h − 1) − källpreferens_km
```

| Parameter | Maxavstånd | Preferens |
|---|---|---|
| Temperatur, vind | 40 km | – |
| Byar | 40 km | SMHI −30 km (METAR rapporterar bara kraftiga byar) |
| Sikt, molnbas | 50 km | METAR −20 km |
| Väderfenomen | 40 km | METAR −15 km |
| Nederbörd | 30 km | endast SMHI |

Maxålder: METAR 2 h, SMHI 3 h (SMHI publicerar med ~1 h fördröjning).
Valet och motiveringen skickas till UI:t och visas under "Stationer och källor".
Ingen interpolation mellan stationer.

## API-routes

| Route | Svar | CDN-cache |
|---|---|---|
| `GET /api/weather?lat&lon` | `WeatherBundle` | `s-maxage=120, stale-while-revalidate=300` |
| `GET /api/geocode?q` | `{ places: Place[] }` | `s-maxage=86400` |
| `GET /api/reverse?lat&lon` | `{ place: Place \| null }` | `s-maxage=86400` |

Koordinater avrundas till två decimaler (~1 km) innan de används – bättre
cacheträffar och ingen exakt position skickas vidare. Koordinater utanför
Sverige ger `422`.

## Cache-strategi

Tre nivåer:

1. **Webbläsare/CDN** – `Cache-Control` på API-svaren (ovan).
2. **Next.js data cache** – `fetch(..., { next: { revalidate } })`:

   | Data | Revalidate | Motivering |
   |---|---|---|
   | METAR senaste (bbox) | 120 s | Nya rapporter var 30:e min; NU ska vara färskt |
   | METAR historik | 300 s | Äldre rapporter ändras inte; senaste läggs till från bbox |
   | TAF | 900 s | Utfärdas var 3–6 h, AMD kan komma |
   | SMHI latest-day | 600 s | SMHI:s egen `max-age` |
   | SMHI prognos | 1800 s | Körs ~varje timme, SMHI anger `max-age=3600` |
   | Nominatim | 86400 s | Ortnamn ändras sällan; krav i användningspolicyn |

3. **Minnescache per serverinstans** – SMHI:s stationslistor (~800 kB st) är
   för stora för data cachen (2 MB-gräns per post och onödig lagring). De hämtas
   med `no-store`, komprimeras (bara aktiva stationer som rapporterat senaste 3 h)
   och hålls i minnet 1 h. Fluid Compute återanvänder instanser, så detta ger
   god träffgrad. Kall start hämtar 8 listor parallellt (~2–4 s).

## UI-struktur

```
GeekwxApp              – plats, datahämtning, auto-uppdatering (5 min när fliken syns), klocka
├─ PlacePicker         – "Use my location" + ortsökning (sök vid submit, inte per tangent)
├─ Readout             – temperatur, vind, sikt, molnbas (+ nederbörd när data finns) vid markörens tid
│  └─ Timeline         – diagrammet −12 h … +12 h
├─ Warnings            – SMHI-varningar, SIGMET, betydande väder ur METAR/TAF
├─ DataInfo            – rå METAR och TAF; källfel bara när en tjänst inte svarar
└─ sidfot              – källor, © år Per Björkman · Teknikpraktik
```

### Prognosens källor (src/lib/client/forecast.ts)

- **TAF först** för vind, sikt, moln och väder – bara under TAF:s giltighetstid och
  bara för element TAF anger. Sista TAF-läget dras aldrig ut efter giltighetstiden.
- **SMHI** (punktprognos för platsens koordinater) för temperatur, nederbördsmängd,
  variabler TAF saknar och efter TAF:s slut. Utan TAF används SMHI för allt.
- **Huvudprognos** = BASE/FM. **BECMG** ändrar bara de element gruppen anger (läses ur
  rå-TAF); under övergångsintervallet gäller tidigare läge och övergången redovisas
  som "någon gång under 16–18" – aldrig som ett exakt ögonblick.
- **TEMPO/PROB** används bara som komplement (varningar under diagrammet).
  PROB40 blir aldrig en generell regnsannolikhet.
- **CAVOK** = sikt ≥ 10 km, inga moln under 1 500 m, ingen CB/TCU, inget väder. Ingen
  molnbas härleds. AWC:s avkodning tappar CAVOK och VV – de läses ur råtexten.
- Källa och giltighet bevaras per variabel och tidpunkt. TAF gäller flygplatsen och SMHI
  platsens koordinater; båda anges i koden per variabel. Motsägelser (t.ex. TAF
  utan nederbörd men SMHI med mängd) förklaras i stället för att jämnas ut.

### Tidslinjen

- **Fast fönster**: 12 h bakåt och 12 h framåt, NU i mitten vid start.
- Tid väljs genom att dra grafen under en **fast markör i mitten** (native scroll på
  touch, musdrag på desktop). Klick flyttar inte grafen. Knapparna **−1 h / Now / +1 h** stegar en
  timme, begränsat till fönstret; "Nu" behåller alltid sin plats. Tangentbord: pilar
  (±1 h, Shift ±6 h) och `N`.
- **Vald tid** och **NU** har olika markörer som fungerar utan färgseende: NU är en
  heldragen linje med etiketten "NOW 17:12"; vald tid är en fetare streckad grön linje med romb och
  etiketten "18:00". Vald tid avrundas till 5 min.
- Följer klockan när användaren står på NU, men flyttar aldrig grafen under en pågående
  interaktion.
- **Färger**: observerat och prognos har samma diskreta grå/svarta toner – skillnaden
  bärs av stil (heldraget vs streckat) och bakgrund (tonad vs skrafferad). **Grön**
  linje markerar NU. Färg används bara för vädret självt: temperatur (blått vid
  minusgrader, rött vid plusgrader, gradient), regn (blått), snö (lila), moln i
  gråskala efter täckningsgrad och dimma som ljusgrått marknära lager.
  Linjer dras aldrig över luckor i data.
- **Ett diagram med två y-axlar**:
  - **Vänster axel – molnbas (m)**, kvadratrotsskala 0–3 km så att låga moln får
    mest utrymme. Molnlager ritas som molnformer med platt underkant vid molnbasen;
    angränsande block på samma höjd slås ihop. Molnikonen fylls nerifrån med andelen åttondelar som täcks
    (FEW 2/8, SCT 4/8, BKN 6/8, OVC 8/8; SMHI-oktas direkt) via SVG-gradienter `cov0`…`cov8`.
  - **Höger axel – temperatur (°C)**, skalan färgad blå/röd. Axeln sitter dikt an mot
    diagrammets högerkant (där datat slutar) och stannar vid vyns kant när man scrollar bakåt.
  - **Observerat och prognos sitter ihop**: prognoskurvan (streckad) börjar i senaste
    observerade punkten. Skillnaden mellan observation och prognos där läggs på prognosen
    och klingar av linjärt under 3 h, så att kurvan blir sammanhängande. Samma justering
    används för prognostemperaturen i avläsningen. Observationer äldre än 2 h används inte.
  - **Klar himmel**: CAVOK, SKC eller CLR i METAR (och 0 oktas i prognosen) ritas som
    en sol på dagen och en måne på natten, i stället för moln. Dag/natt avgörs med solens
    höjd för platsen (`src/lib/sun.ts`, förenklad NOAA-algoritm).
  - Nederbörd vid minusgrader (enligt kurvan vid samma tid) visas som snö.
  - Temperaturkurvan:, heldragen (observerat) / streckad (prognos) kurva, färgad efter temperaturen.
  - **Nederbörd som droppar**: korta droppar (regn) eller prickar (snö) från lägsta
    molnlagret (SCT/BKN/OVC) ned till marken, spridda över hela molnets bredd under
    regnperioden. Tätare ju mer det regnar. Prognosdroppar tonas efter SMHI:s
    sannolikhet för nederbörd (opacitet 0,2 + 0,8 · p).
  - **Snö som snödjup**: nederbörd som faller som snö räknas som uppskattat nysnödjup
    (1 mm vatten ≈ 1 cm nysnö, utan smältning/sättning) och ritas som ett vitt lager
    underst; regn läggs som vatten ovanpå. Etiketten visar t.ex. "4,0 mm · ≈ 6,0 cm snö".
  - **Vattenansamling vid marken**: en vattenyta som växer med ackumulerad nederbörd –
    uppmätt (SMHI, heldragen) fram till NU och därefter prognosens mängder (ljusare,
    streckad kant). Summan i mm står vid ytans slut. 1 mm = 5 px upp till 4 mm, därefter
    komprimerad skala (max 20 px). Saknas nederbördsmätare börjar summan på noll vid NU. Antal streck efter mängd; regn streckat, snö prickat. Saknas
    molnbas börjar strecken uppifrån och tonas ned.
  - Dimma/dis: ljusgrått lager från marken (dimma ~150 m, dis/sikt under 5 km ~60 m). Åska markeras med ϟ.
- Ingen förklaring (legend) och inga instruktionstexter under diagrammet.
- **Tidsaxel direkt under diagrammet** (tim-streck, "09:00" var 3:e timme, veckodag vid midnatt).
  Vänsteraxeln har solid bakgrund så att moln tonar bort innan de når etiketterna.
- **Markören** är mörkgrön; NU-linjen mellangrön. När markören står på NU syns bara romben.
- **Vind under tidsaxeln**: en pil per timme (varifrån det blåser) med m/s under;
  byar visas under när de är minst 3 m/s högre.
- Lufttryck och luftfuktighet visas inte (och hämtas inte).
- TAF ritas inte i diagrammet (för plottrigt). Den styr prognosfönstrets längd,
  visas som aktiva perioder i avläsningen (t.ex. "40 % risk 14–18: molnbas 310 m")
  och i rått format under diagrammet. TAF omvandlas aldrig till timvärden.

### Avläsning

- Rutnät: temperatur, vind, sikt, molnbas – och nederbörd bara när data finns för vald tid
  (uppmätt, eller SMHI-prognos med intervall och sannolikhet).
- Vind: pil + m/s, "From 140° · gusts 7 m/s" (riktning i hela tiotal grader), "Calm" under 0,5 m/s.
- Molnbas: höjd + typ och åttondelar, t.ex. "Broken · 5–7/8 · CB", "Overcast · 8/8".
- Observationer äldre än 90 min markeras "old"; äldre än maxåldern visas som saknade.
- Väderläget på en egen rad utan etikett. Ingen detaljvy. Alla tider lokala (Europe/Stockholm).
