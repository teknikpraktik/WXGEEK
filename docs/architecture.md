# Arkitektur

## Utgångsläge

Repot var tomt när arbetet började (2026-09-23). Projektet skapades med
`create-next-app` (Next.js 16, App Router, TypeScript, ESLint, utan Tailwind).

## Översikt

```
Webbläsare                              Server (Vercel Functions, Node.js)            Externa källor
───────────                             ─────────────────────────────────             ──────────────
WxgeekApp ─── /api/weather?lat&lon ──▶ route.ts ─▶ buildWeatherBundle() ──┬──▶ AWC  metar (bbox, historik)
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
| `src/lib/client/alerts.ts` | Varningar ur senaste METAR och TAF, bara väder med samhällspåverkan (åska, CB, medelvind ≥ 14 m/s eller byar ≥ 20 m/s, kraftig eller underkyld nederbörd, hagel, iskorn, yrsnö) – inte dimma, sikt eller låga moln |
| `src/lib/client/timeline.ts` | Klientlogik: diagramdata, avläsning vid en tidpunkt |
| `src/lib/client/sourceLine.ts` | Källraden under rutorna: plats, källa och tid, t.ex. "Karlstad flygplats · METAR 10:50 · SMHI obs 11:00 (temp, wind)" |
| `src/lib/client/sunBand.ts` | Ljuspanelens geometriska skala (horisont 0°), skymningszoner, kurva med händelsepunkter, markörer och etiketter (maxhöjd, upp- och nedgång, gryning och skymning) |
| `src/lib/client/fogBand.ts` | Dimrisk: tidsmatchade par av temperatur och daggpunkt, ytan där spridningen är under 1 °C, förklaringen |
| `src/lib/client/tempLabel.ts` | Placering av temperaturetiketten vid senaste observationen |
| `src/lib/sun.ts` | Solens höjd (NOAA:s solkalkylator), solbanan var 10:e minut, soluppgång, solnedgång, borgerlig gryning och skymning |
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
   **Prognosfönster** (`forecastUntil`): alltid NU + 24 h (fast fönster).
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
WxgeekApp              – plats, datahämtning, auto-uppdatering (5 min när fliken syns), klocka,
                         ny laddning + NU när loggan trycks eller sidan öppnas igen (≥ 1 min dold)
├─ PlacePicker         – "Use my location" + ortsökning (sök vid submit, inte per tangent)
├─ Readout             – temperatur/daggpunkt, vind, sikt, moln (+ nederbörd när data finns) vid markörens tid
│  └─ Timeline         – diagrammet −12 h … +24 h
├─ Warnings            – SMHI-varningar, SIGMET, betydande väder ur METAR/TAF
├─ DataInfo            – rå METAR och TAF under flygplatsens namn; källfel bara när en tjänst inte svarar
└─ sidfot              – källor, © år Per Björkman · Teknikpraktik
```

### Prognosens källor (src/lib/client/forecast.ts)

- **TAF först** för vind, sikt, moln och väder – bara under TAF:s giltighetstid och
  bara för element TAF anger. Sista TAF-läget dras aldrig ut efter giltighetstiden.
- **SMHI** (punktprognos för platsens koordinater) för temperatur, nederbördsmängd,
  variabler TAF saknar och efter TAF:s slut. Utan TAF används SMHI för allt.
- **Huvudprognos** = BASE/FM. **BECMG** ändrar bara de element gruppen anger (läses ur
  rå-TAF); under övergångsintervallet gäller tidigare läge och övergången redovisas
  som "någon gång under 16–18" – aldrig som ett exakt ögonblick. Undantag: dimma och dis
  som den nya sikten utesluter följer inte med när gruppen saknar väder (och NSW) – FG vid
  1 km eller mer (MIFG/BCFG/PRFG står kvar), BR/HZ/FU över 5 km. "0200 FG BECMG 2506/2508
  9999" betyder alltså att dimman har lättat 08Z. Nederbörd står kvar tills NSW. Vertikal
  sikt (VV) läses bara ur gruppens egen råtext – AWC:s avkodning för vidare VV från tidigare
  grupp ("BECMG 9999 SCT020" efter "VV002" fick VV kvar). BECMG gäller från intervallets
  sista klockslag – saknar AWC den tiden (`timeBec`) läses den ur råtexten ("BECMG 2607/2609"
  → 09Z), så att en ändring aldrig räknas från intervallets början.
- **TEMPO/PROB** används bara som komplement (varningar under diagrammet).
  PROB40 blir aldrig en generell regnsannolikhet.
- **CAVOK** = sikt ≥ 10 km, inga moln under 1 500 m, ingen CB/TCU, inget väder. Ingen
  molnbas härleds. AWC:s avkodning tappar CAVOK och VV – de läses ur råtexten.
- Källa och giltighet bevaras per variabel och tidpunkt. TAF gäller flygplatsen och SMHI
  platsens koordinater; båda anges i koden per variabel. Motsägelser (t.ex. TAF
  utan nederbörd men SMHI med mängd) förklaras i stället för att jämnas ut.

### Sidhuvud

- Logga, platsen som text med en kartnål och en egen knapp **Change** – platsen är ingen
  knapp och byts inte genom att klicka på namnet.
- **Loggan** är en knapp: laddar om platsen (förbi webbläsarens cache) och går till NU. Samma
  sak händer varje gång sidan öppnas – ny laddning, efter minst 1 min dold (mobilen låst,
  annan app) eller återställd ur webbläsarens bakåtcache. Kortare flikbyten behåller vald tid.
- Låst överst på alla bredder (`position: sticky`), så att man alltid ser vilken plats vädret
  gäller; bakgrunden täcker diagrammets fulla bredd, linjen innehållets. Säker yta på iPhone
  ligger i huvudet, så att den följer med när huvudet låses. Under 560 px två rader (logga +
  Change, platsen på hela bredden under).

### Tidslinjen

- **Fast fönster**: 12 h bakåt och 24 h framåt. NU står en femtedel in i ritytan (efter
  vänsteraxeln) vid start och efter Now, så att vyn visar 20 % observerat och 80 % prognos.
  Samma pixlar per timme på båda sidor (linjär axel, `CURSOR_AT`), så att den synliga
  historiken är en fjärdedel av den synliga prognosen – t.ex. ~4 h bakåt och ~17 h framåt på
  en dator, ~1,5 h och ~6,5 h på mobil. Manuell navigering bevaras. I den smala historiken
  på mobil står "← OBS." i stället för "← OBSERVED", och temperaturetiketten hålls till
  höger om vänsteraxeln (`minX` i `placeTempLabel`).
- Tid väljs genom att dra grafen under en **fast markör en femtedel in** (native scroll på
  touch, musdrag på desktop). Klick flyttar inte grafen. Knappen **Now** återgår till NU och
  sitter i tidsaxelns vänsterkant – inte över markören, där den skulle se ut att höra till
  vald tid. Tangentbord: pilar (±1 h, Shift ±6 h) och `N`.
- **Vald tid** och **NU** har olika markörer som fungerar utan färgseende: NU är en tunn
  heldragen linje i mörk blågrå genom alla fem paneler med en liten pill "NOW 17:12" som en
  flagga i tidsaxelns egen pillrad; vald tid är en streckad linje i dämpad blå med en fylld
  etikett "18:00" (vit text) i samma rad. Timtalen har en egen rad under och döljs aldrig av
  pillerna; timtalet närmast NU flyttas några pixlar åt sidan av linjen.
  Egen färg för vald tid – med samma blågrå som NU och Now-knappen såg Now ut att höra till
  vald tid.
  Står vald tid på NU visas bara NU-linjen och dess etikett. Etiketterna krockar aldrig:
  NOW-pillen byter sida av linjen bort från vald tid, och döljs när även det skulle krocka.
  Vald tid avrundas till 5 min.
- Följer klockan när användaren står på NU, men flyttar aldrig grafen under en pågående
  interaktion.
- **Färger** (samlade som variabler överst i `src/app/globals.css`): varm neutral bakgrund
  (#F3F1EB) och text (#20252B, sekundärt #5E6772), NU och vald tid i mörk blågrå (#334155),
  fokusmarkering i dämpad blå (#365F83), temperatur i tegelrött (#C64B40) och nederbörd i
  mellanblått (#397CAF, staplarna mättade #1F6EC4; små siffror i mörkare #2C6594).
  Observerat och prognos skiljs med NU-linjen, "← OBSERVED | FORECAST →" i tidsaxeln,
  linjestilen (heldraget vs streckat) och en mycket svag ton över observationsdelen. Gula solar, grå moln och mörka vindpilar. Text och kontroller klarar WCAG AA
  mot sina bakgrunder, även i mörkt läge. Linjer dras aldrig över luckor i data.
- **Ljuspanelen** (femte gruppen, rubrik "Light", `SUN_H` 92 px): platsens geometriska
  solhöjd var 10:e minut (`sunPath`) i fast skala året runt – ingen autoskalning,
  säsongsskillnaden är poängen (Karlstad: ~7° vid vintersolståndet, ~29° i slutet av september,
  ~54° vid sommarsolståndet). Skalan är tvådelad (`sunY` i `src/lib/client/sunBand.ts`): 0°…60°
  tar 65 % av höjden och −18°…0° 35 %, så att borgerlig (0/−6), nautisk (−6/−12) och
  astronomisk (−12/−18) skymning blir tre lika höga, allt mörkare blågrå band. Horisontlinjen
  ligger vid 0° och kurvan förskjuts inte: soluppgång och solnedgång markeras med fyllda
  punkter på kurvan där solen står på −0,833° (ljusbrytningen och solens radie – strax under
  linjen, som kurvan korsar några minuter senare respektive tidigare), borgerlig gryning och
  skymning med ihåliga punkter på −6°-linjen. Händelsernas exakta punkter och horisont-
  passagerna ligger med i kurvan (`sunCurveSegments`), så att markörerna ligger exakt på den
  ritade kurvan och skalans knäck vid 0° inte ger fel korsning. Gult mellan kurvan och
  horisonten där solen är över den; kurvan döljs under −18°. Etiketter (`sunBandLabels`, 12 px),
  alla ovanför horisonten och inom bandet: "Sunrise 06:59" och "Sunset 18:54" på dagsidan av
  sin markör ovanför kurvan, "Civil dawn 06:18" och "Civil dusk 19:34" på nattsidan ovanför sin,
  "Sun alt. max 29°" över toppen. En etikett provar en rad högre och sedan markörens andra
  sida innan den utelämnas, och ingen korsar NU-linjen (`avoid`) – maxhöjden flyttas då åt den
  sida som syns i standardvyn. Händelser utanför vyn står vid närmaste kant med pil
  ("← Sunrise 06:59", "Sunrise 07:01 →"), liksom händelser nära kanten vars etikett klipps.
  Förklaring: "Twilight: civil / nautical / astronomical". Färger som variabler (`--sun-*`).
- **Solen** beräknas med NOAA:s solkalkylator (Jean Meeus), som redan fanns i projektet i stället
  för ett nytt beroende (SunCalc) – soluppgång och solnedgång inom någon minut upp till 72° latitud. Den förenklade varianten (Spencers serier) felade 3–5 min
  kring dagjämningarna.
- **Ett diagram med två y-axlar**:
  - **Höger axel – molnbas (m)**, linjär 0–3 000 m. Molnlager ritas som molnformer med platt underkant vid molnbasen;
    angränsande block på samma höjd slås ihop. Molnikonen fylls nerifrån med andelen åttondelar som täcks
    (FEW 2/8, SCT 4/8, BKN 6/8, OVC 8/8; SMHI-oktas direkt) via SVG-gradienter `cov0`…`cov8`.
  - **Vänster axel – temperatur (°C)**: adaptiv skala (`TEMP_AXIS` i
    `src/lib/client/timeline.ts`); siffror och axellinje i neutral skiffergrå. Rubriken
    "Temperature °C" står i gruppens rubrikrad som de andra gruppernas rubriker – genomskinlig,
    så att NU-linjen går obruten genom raden.
  - **Senaste temperaturobservationen**: en punkt på kurvan vid mätningens egen tid (aldrig
    flyttad till NU) och mätvärdet bredvid, t.ex. "11 °C". Etiketten (`placeTempLabel` i
    `src/lib/client/tempLabel.ts`) står ovanför eller under punkten, vänster om NU-linjen, och
    hamnar aldrig på temperatur- eller daggpunktskurvan: nära ritytans kant flyttas texten åt
    vänster tills kurvorna går fri, och är vänster sida full står den till höger om NU-linjen.
  - **Observerat och prognos sitter ihop**: prognoskurvan (streckad) börjar i senaste
    observerade punkten. Skillnaden mellan observation och prognos där läggs på prognosen
    och klingar av linjärt under 3 h, så att kurvan blir sammanhängande. Samma justering
    används för prognostemperaturen i avläsningen. Observationer äldre än 2 h används inte.
  - **Klar himmel**: CAVOK, SKC eller CLR i METAR (och 0 oktas i prognosen) ritas som
    en sol på dagen och en måne på natten, i stället för moln. Dag/natt avgörs med solens
    höjd för platsen (`src/lib/sun.ts`, NOAA:s solkalkylator).
  - Nederbörd vid minusgrader (enligt kurvan vid samma tid) visas som snö.
  - Temperaturkurvan: tegelröd, heldragen (observerat) / streckad (prognos).
  - **Regn under molnen**: tre korta streck (snö: prickar) direkt under varje symbol med
    nederbörd i symbolraden, korta nog att rymmas i raden. De signalerar bara nederbörd –
    mängden visas av timstaplarna.
  - **Snö som snödjup**: nederbörd som faller som snö räknas som uppskattat nysnödjup
    (1 mm vatten ≈ 1 cm nysnö, utan smältning/sättning) och ritas som ett vitt lager
    underst; regn läggs som vatten ovanpå. Etiketten visar t.ex. "4,0 mm · ≈ 6,0 cm snö".
  - **Vattenansamling vid marken**: en vattenyta som växer med ackumulerad nederbörd –
    uppmätt (SMHI, heldragen) fram till NU och därefter prognosens mängder (ljusare,
    streckad kant). Summan i mm står vid ytans slut. 1 mm = 5 px upp till 4 mm, därefter
    komprimerad skala (max 20 px). Saknas nederbördsmätare börjar summan på noll vid NU. Antal streck efter mängd; regn streckat, snö prickat. Saknas
    molnbas börjar strecken uppifrån och tonas ned.
  - **Nederbörd per timme** i ett eget fält direkt under marklinjen: stapel + mm. Uppmätt
    (SMHI-mätare) heldraget; prognos som trolig mängd (mörk, SMHI-ensemblens median) och
    möjlig mängd (ljus, max av medel och max). SMHI:s min används inte.
  - Dimma/dis: dimsymbol (tre streck) resp. dis (två streck) ersätter molnsymbolen i symbolraden. Åska markeras med ϟ.
- Förklaringar högerställda i varje grupps rubrikrad – långt från NU-linjen och markören:
  molntäckets toner ("Cloud cover: few … overcast · blank = no data"), Temp / Dew point / Fog
  risk, "arrow = direction of flow" och skymningszonerna. Kortare varianter på smala skärmar,
  så att de aldrig når NU-linjen. Under diagrammet, när dimrisk finns i fönstret: "Small
  temperature–dew point spread indicates possible fog; it is not a fog forecast."
- **Tidsaxel överst** (första gruppen, `AXIS_H` 40 px): en tunn pillrad med NOW-pillen,
  "← OBSERVED" och "FORECAST →" på var sida om den ("← OBS." när det är trångt), vald tid och
  dygnsnamnet vid dygnsbytet; under den timtal för varje timme (varannan under 520 px). En
  mycket svag ton (`--obs-tint`) täcker observationsdelen i alla grupper. **Gridlinjer** för
  varje hel timme genom alla grupper (`--vgrid`, något tydligare `--vgrid-major` vid 00, 06,
  12 och 18); **dygnsbytet** som en linje genom alla grupper (`--dayline`), tydligt kraftigare
  än timlinjerna och svagare än NU. Vänsteraxeln har solid bakgrund med en kort toning; det som
  den eller vyns högerkant skulle klippa döljs i stället.
- **Now-knappen**: liten och kompakt i tidsaxelns vänsterkant, före första timtalet – ingen egen
  rad. Samma utseende som Change (ljus yta, ljus kant, mörk text), aldrig NU-linjens mörka
  blågrå. Vid NU är den inaktiv men ser likadan ut; hovring ger mörkare kant.
- **Vind** (fjärde gruppen, "Wind m/s (gusts)"): pilen visar åt vilket håll vinden blåser
  (förklaringen "arrow = direction of flow"; texten i avläsningen säger varifrån), medelvinden
  och byarna i samma rad, "6 (9)", byarna i ljusare ton. Byar visas när källan har ett byvärde
  över medelvinden; saknas det står bara medelvinden, och "(gusts)" står i rubriken bara när
  minst ett byvärde syns. Varannan timme när texterna annars skulle krocka.
- Lufttryck och luftfuktighet visas inte. SMHI:s relativa fuktighet hämtas bara för daggpunkten.
- TAF ritas inte som egna lager i diagrammet: den styr prognosens huvudläge, visas i
  avläsningen och i rått format under diagrammet.

### Avläsning

- En rad rutor: temperatur/daggpunkt, vind, sikt, moln – och nederbörd när det faller
  något under timmen som vald tid ligger i (samma stapel som under markören; vid NU senaste
  mätningen). I prognosen även när det bara kan falla: "max 0.3 mm" som staplarna (troligen
  uppehåll; SMHI-ensemblens största mängd, ingen övre gräns), med intervall och SMHI:s
  sannolikhet under –
  trolig och möjlig mängd räknas med samma regel som staplarna (`precipRange`). Torrt: ingen
  ruta. Dator: alltid 5 kolumner.
  Under 560 px: 4 kolumner, 5 med nederbörd, och mindre typografi. Fasta höjder (`--val-h`
  och `--sub-h` per ruta), så att diagrammet under aldrig hoppar.
- Temp / Dew pt: "12/11 °C" i hela grader med nedtonad daggpunkt; undertext "Fog risk" när
  spridningen är under 1 °C (`FOG_SPREAD`, samma villkor som diagrammets dimrisk) och båda
  värdena är tidsmatchade (`matchedSpread`: samma mätning eller samma prognossteg), annars tom;
  verktygstipset förklarar att det inte är en dimprognos. Observerat: daggpunkt från samma
  station och tid som temperaturen, annars närmaste METAR. Prognos: ur SMHI:s relativa fuktighet (Magnus); spreaden räknas på
  SMHI:s egen temperatur och dras av från den visade, justerade. Aldrig över temperaturen.
- Vind: pil + m/s, "From SW 240° · gusts 7 m/s" – pilen åt vilket håll vinden blåser, texten
  varifrån (väderstreck och hela tiotal grader, `fmtWindFrom`), "Calm" under 0,5 m/s.
- Clouds i tre korta rader (`.cell-clouds`) inom samma höjd som övriga rutors värde och
  undertext, så att raden aldrig växer; ingen rad upprepar en annan i ord:
  - Rad 1: symbol (som i diagrammet) och kod – största kategorin, t.ex. "BKN". Kod 22 px och
    symbol 20 px (mobil högst 18/16 px), vertikalt centrerade. CAVOK, NSC och okänt ("?")
    utan symbol.
  - Rad 2: åttondelar, t.ex. "5–7/8", "0/8" vid SKC, plus CB/TCU om något lager har det
    ("5–7/8 · CB"). VV, CAVOK och NSC: ingen rad.
  - Rad 3: höjden – ceiling (lägsta BKN/OVC/VV), annars lägsta molnbasen, t.ex.
    "Ceiling 340 m" eller "Base 900 m"; övriga lager visas inte. SMHI-prognos utan lager:
    molnbasen. CAVOK/NSC: "None below 1500 m" (får bryta över två rader, där rad 2 saknas);
    CAVOK kompletterad med SMHI:s molnmängd: t.ex. "BKN" / "5–7/8" / "Ceiling ≥1500 m".
    Klart eller okänd höjd: ingen rad. Under 560 px med nederbördsruta: "Ceil." – siffran
    kapas aldrig.
  - Rad 2–3 i 11 px med radavstånd 1,1, vänsterställda under symbolen. Saknade moln: "–"
    som i övriga rutor.
- Dimma/dis (`fogOf`, samma regel som diagrammets dimsymbol – men aldrig när nederbörden är det
  som skymmer): molnrutan visar dimsymbolen och koden (FG, BR, BCFG …; FZFG för dimma vid
  minusgrader), TAF-gruppen på rad 2 (t.ex. "PROB40") och höjden på rad 3. Ordet ("Fog")
  står på väderraden. Dimma i TAF:ens TEMPO/PROB räknas bara i prognosläget – vid NU
  gäller observationen.
- Sikt: lägre sikt i TAF:ens TEMPO/PROB i undertexten, t.ex. "PROB40 2.5 km" (prognosläget,
  `tafLowVisibility`).
- Korta rubriker under 560 px: "Temp/Dew", "Vis", "Precip". Där blir "old" en liten klocka
  i varningsfärg efter rubriken (texten finns kvar för skärmläsare), så att rubriken inte klipps.
- Observationer äldre än 90 min markeras "old"; äldre än maxåldern visas som saknade.
- **Källrad** direkt under rutorna (`sourceLine`, 11,5 px, dämpad), kort: plats, källa och
  tid – "Karlstad flygplats · METAR 10:50 · SMHI obs 11:00 (temp, wind)", med datum när
  observationen inte är från samma lokala dag som nu. Huvudkällan (flest värden) står först
  utan att räkna upp sina värden; övriga med vad de ger och sin station när den är en annan
  ("SMHI obs Kilsbergen-Suttarboda A 08–09 (precip)"), daggpunkt och byar bara när de har en
  egen källa. I prognosläget: "Forecast 14:00 · TAF Karlstad flygplats · SMHI (temp, precip)".
  Samma plats stavas likadant överallt – SMHI:s "Karlstad Flygplats" blir "Karlstad flygplats"
  redan när stationslistan läses (`smhiStationName`). Saknas station står bara tiden,
  saknas värden är raden tom. Fast höjd – en rad, två på mobil där texten får bryta – så att
  diagrammet inte hoppar när man drar mellan observation och prognos.
- Väderläget på en egen rad utan etikett – bara väder (nederbörd, dimma, åska); molnen står
  redan i rutan och upprepas inte. Ingen detaljvy. Alla tider lokala (Europe/Stockholm).

## Molnighet, temperaturskala och nederbörd (senaste versionen)

- **Molnighetsrad** (`ChartData.sky`, `skyOf` i `src/lib/client/timeline.ts`, ikoner i
  `src/components/SkyIcon.tsx`): en post per hel timme; observerat = närmaste observation inom
  rapporttoleransen (METAR 35 min, SMHI 40 min), prognos = huvudläget (TAF BASE/FM/BECMG eller
  SMHI – aldrig TEMPO/PROB). Regel: största kategorin bland samtidiga lager. CAVOK → SMHI:s
  totala molnmängd om den finns (märkt "SMHI model"), annars neutral CAVOK-markering. NSC →
  NSC-markering, saknas → "–". Dag/natt med solhöjd för platsen och tiden (`src/lib/sun.ts`).
  Försiktig tolkning: BKN (5–7/8) ritas som moln utan sol – med sol såg ett mulet BKN-läge ut
  som halvklart. Sol eller måne syns bara vid SKC, FEW och SCT.
  Symbolerna ligger överst i molngruppen (32 px, `SKY_H`), alla på samma höjd och i samma
  tidsskala som diagrammet – symboler som följde kurvan fick den att se ut som molnens
  undersida. Var 2:a timme plus timmar med nederbörd och minst en per dimperiod; under 520 px
  vybredd bara var 3:e timme, så att raden inte blir trång. En symbol som vyns kanter skulle
  klippa döljs.
- Molnbasens höjdaxel och höjdplacerade moln är borttagna. Molnbas och alla lager visas i
  detaljraden under sammanfattningen, med källa och giltighet.
- SMHI-prognosens lager för text: lägsta molnbas + mängd *låga* moln (`modelLayer`); den
  totala molnmängden kombineras aldrig med basen.
- **Temperaturskala** (`tempScale`, `TEMP_AXIS`): autoskalad över temperatur och daggpunkt
  i fönstret, minst 10 °C spann och 1 °C marginal, avrundad utåt till jämna steg (2 °C, 5 °C
  över 14 °C spann, 10 °C över 35 °C). 0 °C tas med när lägsta värdet ligger inom 5 °C från
  noll (eller värdena korsar den) – då med en streckad 0°-linje, annars ingen. Behålls så
  länge alla värden ligger minst 0,5 °C innanför, krymps aldrig under användning; sparas per
  plats.
- **Nederbörd per timme**: en serie mättade staplar från nollinje (bara under trolig/uppmätt
  mängd), linjär skala 0–max (minst 2 mm/h) i ett 40 px band underst i molngruppen
  (`PRECIP_H`); radnamnet "Precip mm/h" i vänsterkolumnen. Mängd per timme (SMHI param 7 =
  summa 1 h; prognosens timsteg = mängd). Prognos: SMHI-ensemblens median (mörk) och största
  mängd (ljus – `precipitation_amount_max`, "Maximum total precipitation amount"). Värdet
  ovanför stapeln: medianen, och när den är under 0,1 mm ensemblens största mängd som
  "max 0.4" – aldrig "≤", det är ingen övre gräns. Etiketten flyttas åt sidan av NU-linjen.
- **Tidsaxel** (överst): pillrad och timrad; dygnsbytet som en linje genom alla grupper med
  dygnsnamnet i pillraden.

## Fem paneler (senaste versionen)

Diagrammet är fem grupper på samma tidsaxel (`src/components/Timeline.tsx`), uppifrån:

1. **Tidsaxel** (`AXIS_H` 40 px): pillraden (NOW, vald tid, ← OBSERVED | FORECAST →, datum),
   timtalen och axellinjen; Now-knappen i vänsterkanten.
2. **Moln & nederbörd** ("Clouds & precipitation"): vädersymbolerna, molntäcke i tre rader
   (High, Mid, Low – 10 px vardera med 4 px luft) och nederbörden ("Precip mm/h").
3. **Temperatur & daggpunkt** ("Temperature °C", `TEMP_H` 148 px).
4. **Vind** ("Wind m/s (gusts)", 44 px).
5. **Ljus** ("Light", 92 px).

- **Gemensamt**: samma `x(t)` för alla grupper; timgridlinjerna, dygnsbytet och NU-linjen går
  obrutna genom alla, och ingen text korsas av NU-linjen – etiketter flyttas åt sidan eller
  utelämnas. Rubrikerna (12 px) står i den fasta vänsterkolumnen med samma plats, typografi och
  radhöjd (18 px, `RUBRIC_H`) och är genomskinliga. Varje rubrik visas i den längsta variant som
  slutar före NU-linjen i standardvyn, uppmätt i rubrikens egen typografi (`RUBRIC_TEXT`:
  "Clouds & precipitation" → "Clouds & precip." → "Clouds/precip." → "Clouds"). Värden och
  radnamn i 12 px, förklaringar i 11 px. Lika mycket luft (`GAP` 6 px) på var sida om en tunn
  avgränsare (`--rule`) mellan grupperna.
- **Kantdöljning** (`placeMarkers`): symboler, vindpilar, etiketter och datum som vänster-
  kolumnen eller vyns högerkant skulle klippa döljs i stället för att visas halva – elementen
  bär sin utsträckning som `data-l`/`data-r` (SVG-x). Timtal döljs bara vid kanterna.
- **Molntäcke per timme** (`cloudCoverHours`): prognos = SMHI:s låga, medelhöga och höga
  molnmängd (`low/medium/high_type_cloud_area_fraction`, oktas) vid den hela timmen.
  Observerat = METAR inom 35 min: varje lagers kategori (FEW 1,5, SCT 3,5, BKN 6, OVC/VV 8
  åttondelar) i raden för dess bas (under 2 000 m låga, 2 000–6 000 m medelhöga, över höga),
  största per rad. Rader under det högsta rapporterade lagret är klara (0), rader ovanför
  okända. Samma skala i alla rader: en känd timme får en svag botten (`--cloud-track`, klart)
  och molnets ton ovanpå efter åttondelarna; okänt lämnas helt tomt – så att saknade data
  aldrig ser ut som klar himmel. SMHI:s stationer rapporterar bara molnbas och används inte här.
- **Taket ur TAF** är borttaget ur diagrammet (avläsningen visar ceiling som förut).
- **Daggpunkt**: observerad ur samma station som temperaturen när den har daggpunkt, annars
  närmaste METAR (heldragen). Prognosen (streckad) ur SMHI:s relativa fuktighet (Magnus) –
  `snow1g` saknar daggpunkt – som en spridning under temperaturen: SMHI:s egen spridning,
  med skillnaden mot senaste observerade spridningen utklingande över 3 h (`dewAdjuster`).
- **Dimrisk** (`matchedRuns`, `fogBands` i `src/lib/client/fogBand.ts`): spridningen räknas
  bara där temperatur och daggpunkt har tidsmatchade värden – en punkt i båda kurvorna vid
  samma tid (samma rapport eller samma prognossteg) – och följden bryts vid varje lucka eller
  punkt som bara den ena kurvan har. Observerat och prognos var för sig; de möts i senaste
  observationen. Ytan ritas där spridningen är under 1 °C (`FOG_SPREAD`), med exakta gräns-
  punkter, minst 6 px hög så att den syns där kurvorna sammanfaller, och en diskret etikett
  "Fog risk" under ytan vid sammanhängande perioder som är breda nog. Samma villkor i
  avläsningen (`matchedSpread`). Förklaringen (`FOG_NOTE`) står under diagrammet.
- **Verifierat** (Karlstad 26 sep 2026): uppgången 06:59:18 och nedgången 18:54:04 som
  markörer på kurvan vid −0,833° (1,5 px under horisontlinjen), gryningen 06:18 och skymningen
  19:34 exakt på −6°-linjen, "Sun alt. max 29°"; kurvan korsar 0° 07:07 och 18:47. Inga timtal
  dolda, ingen text på NU-linjen, inga överlapp eller klippta etiketter – på dator (780 px
  diagram), mobil (375 och 320 px) och i mörkt tema.
