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
| `src/lib/client/sourceLine.ts` | Källraden under rutorna: mättid och station, eller prognoskälla, per värde |
| `src/lib/client/sunBand.ts` | Ljuspanelens fasta skala, horisont (−0,833°), skymningszoner, kurva och etiketter (maxhöjd, upp- och nedgång, gryning och skymning) |
| `src/lib/client/fogBand.ts` | Dimrisk: ytan mellan temperatur och daggpunkt där spridningen är högst 2 °C |
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
  touch, musdrag på desktop). Klick flyttar inte grafen. Knappen **Now** återgår till NU
  och står fast ovanför diagrammet till vänster, i linje med axeletiketterna – inte över
  markören, där den skulle se ut att höra till vald tid. Tangentbord: pilar (±1 h,
  Shift ±6 h) och `N`.
- **Vald tid** och **NU** har olika markörer som fungerar utan färgseende: NU är en tunn
  heldragen linje i mörk blågrå genom alla fem paneler med en liten pill "NOW 17:12" ovanför
  tidsaxeln; vald tid är en streckad linje i dämpad blå med en fylld etikett "18:00" (vit text)
  på samma rad. Timtal och datum som pillerna täcker döljs.
  Egen färg för vald tid – med samma blågrå som NU och Now-knappen såg Now ut att höra till
  vald tid.
  Står vald tid på NU visas bara NU-linjen och dess etikett. Etiketterna krockar aldrig:
  NOW-etiketten flyttas till sidan bort från vald tid, och döljs när även det skulle krocka.
  Vald tid avrundas till 5 min.
- Följer klockan när användaren står på NU, men flyttar aldrig grafen under en pågående
  interaktion.
- **Färger** (samlade som variabler överst i `src/app/globals.css`): varm neutral bakgrund
  (#F3F1EB) och text (#20252B, sekundärt #5E6772), NU och vald tid i mörk blågrå (#334155),
  fokusmarkering i dämpad blå (#365F83), temperatur i tegelrött (#C64B40) och nederbörd i
  mellanblått (#397CAF; små siffror i mörkare #2C6594). Observerat och prognos skiljs med
  NU-linjen, rubrikerna OBSERVED/FORECAST och linjestilen (heldraget vs streckat) – inte med
  bakgrunden. Gula solar, grå moln och mörka vindpilar. Text och kontroller klarar WCAG AA
  mot sina bakgrunder, även i mörkt läge. Linjer dras aldrig över luckor i data.
- **Ljuspanelen** (femte gruppen, rubrik "Light", `SUN_H` 64 px): solhöjden för platsens
  koordinater var 10:e minut (`sunPath`) i fast skala året runt – ingen autoskalning,
  säsongsskillnaden är poängen (Karlstad: ~7° vid vintersolståndet, ~29° i slutet av september,
  ~54° vid sommarsolståndet). Skalan är tvådelad (`sunY` i `src/lib/client/sunBand.ts`):
  horisonten…60° tar 65 % av höjden och −18°…horisonten 35 %, så att borgerlig (horisonten…−6°),
  nautisk (−6…−12°) och astronomisk (−12…−18°) skymning syns som tre tydliga, allt mörkare
  blågrå band. **Horisontlinjen ligger vid −0,833°** (`HORIZON`), standarddefinitionen av
  soluppgång och solnedgång (ljusbrytningen och solens radie): kurvan korsar den just vid ↑- och
  ↓-tiderna – mot geometriska 0° skiljer det ~1 px i höjd men 5–10 minuter i tid, och korsningen
  hamnade på fel sida om timlinjen. Horisontpassagerna läggs in som punkter både i den gula ytan
  och i kurvan (`withHorizonCrossings`), eftersom skalan knäcker vid horisonten och en rak linje
  mellan tiominuterspunkterna annars korsar upp till ett par minuter fel. Gult bara mellan kurvan
  och horisonten där solen är uppe; kurvan döljs under −18° (`sunCurveSegments`) i stället för
  att ritas platt mot nederkanten. Kurvan är heldragen, tunn och bärnstensfärgad. Etiketter
  (`sunBandLabels`), alla ovanför horisonten och helt inom bandet, aldrig på skymningstonerna:
  soluppgång och solnedgång som "↑ 06:59" och "↓ 18:54" på dagsidan av passagen ovanför kurvan,
  maxhöjden "Max 29°" ovanför toppen (under den när toppen når överkanten), och borgerlig
  gryning och skymning (−6°) som diskreta tider vid passagen strax ovanför horisonten. Upp- och
  nedgång går först, sedan maxhöjden, sist gryning och skymning; en etikett som skulle krocka
  visas inte, och etiketter som vyns kanter skulle klippa döljs medan man drar. Polarfall ger
  kurvan utan tider. Färger som variabler (`--sun-*`) för ljust och mörkt tema.
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
    `src/lib/client/tempLabel.ts`) står ovanför eller under kurvan, vänster om NU-linjen; nära
    ritytans topp lånas raden med OBSERVED (som då döljs) eller flyttas texten åt vänster tills
    kurvan går fri.
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
- Inga instruktionstexter under diagrammet. En enda förklaring: temperaturgruppens (Temp, Dew
  point, Spread ≤ 2°), högerställd i rubrikraden – långt från NU-linjen och markören.
- **Tidsaxel överst** (första gruppen): timtal för varje timme (varannan under 520 px),
  dygnsnamn vid midnatt och NOW-pillen/vald tid ovanför axellinjen. **Gridlinjer** för varje
  hel timme genom alla grupper (`--vgrid`, något tydligare `--vgrid-major` vid 00, 06, 12
  och 18) – låg kontrast, så att de inte konkurrerar med data. Vänsteraxeln har solid bakgrund
  med en kort toning; det som den eller vyns högerkant skulle klippa döljs i stället.
- **Now-knappen**: samma utseende som Change (ljus yta, ljus kant, mörk text) – ändras inte
  när tiden scrollas, och aldrig NU-linjens mörka blågrå, så att den inte förväxlas med
  linjerna i diagrammet. Vid NU är den inaktiv men ser likadan ut; hovring ger mörkare kant.
- **Vind** (fjärde gruppen, "Wind (gusts) m/s"): en pil per timme (varifrån det blåser) med
  medelvinden under och byarna under den i samma rad, inom parentes och i ljusare ton, när de
  är minst 3 m/s högre.
- Lufttryck och luftfuktighet visas inte. SMHI:s relativa fuktighet hämtas bara för daggpunkten.
- Ur TAF ritas bara taket i molngruppen (huvudläget, se "Fem paneler" nedan). I övrigt
  styr TAF prognosens huvudläge, visas i avläsningen och i rått format under diagrammet.

### Avläsning

- En rad rutor: temperatur/daggpunkt, vind, sikt, moln – och nederbörd när det faller
  något under timmen som vald tid ligger i (samma stapel som under markören; vid NU senaste
  mätningen). I prognosen även när det bara kan falla: "≤0.3 mm" som staplarna (troligen
  uppehåll, men upp till 0,3 mm möjligt), med intervall och SMHI:s sannolikhet under –
  trolig och möjlig mängd räknas med samma regel som staplarna (`precipRange`). Torrt: ingen
  ruta. Dator: alltid 5 kolumner.
  Under 560 px: 4 kolumner, 5 med nederbörd, och mindre typografi. Fasta höjder (`--val-h`
  och `--sub-h` per ruta), så att diagrammet under aldrig hoppar.
- Temp / Dew pt: "12/11 °C" i hela grader med nedtonad daggpunkt; undertext "Fog risk" när
  daggpunkten ligger inom 1° (som de visas), annars tom. Observerat: daggpunkt från samma
  station och tid som temperaturen, annars närmaste METAR. Prognos: ur SMHI:s relativa fuktighet (Magnus); spreaden räknas på
  SMHI:s egen temperatur och dras av från den visade, justerade. Aldrig över temperaturen.
- Vind: pil + m/s, "140° · gusts 7 m/s" (riktning i hela tiotal grader, utan "From" för att
  spara plats), "Calm" under 0,5 m/s.
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
- **Källrad** direkt under rutorna (`sourceLine`, 11,5 px, dämpad): när och var de visade
  värdena mättes, ur värdenas egna källor – "Observed at 09:20 local time · Karlstad
  flygplats", med datum när observationen inte är från samma lokala dag som nu. Huvudkällan
  är den flest värden kommer från; värden från en annan station eller tid nämns med vad de
  gäller ("; precipitation 08–09 · Kilsbergen-Suttarboda A", "; temperature at 09:00 · …"),
  daggpunkt och byar bara när de har en egen källa. I prognosläget: "Forecast for 14:00 · TAF
  Karlstad flygplats; temperature, precipitation · SMHI". Saknas station står bara tiden,
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
- **Nederbörd per timme**: en serie staplar från nollinje (bara under trolig/uppmätt mängd),
  linjär skala 0–max (minst 2 mm/h) i ett 36 px band underst i molngruppen (`PRECIP_H`);
  värdet ovanför stapeln från 0,1 mm/h, enheten "mm/h" i vänsterkolumnen.
  Mängd per timme (SMHI param 7 = summa 1 h; prognosens timsteg = mängd). Prognos: median
  (mörk) och övre spridning (ljus). Den ackumulerade vattenytan/snödjupet är borttaget.
- **Tidsaxel** (överst): varje timme; midnatt med ett kort streck i datumraden (inte genom
  timtalet "00") och dygnsnamnet.

## Fem paneler (senaste versionen)

Diagrammet är fem grupper på samma tidsaxel (`src/components/Timeline.tsx`), uppifrån:

1. **Tidsaxel** (`AXIS_H` 36 px): NOW-pillen och datum överst, timtal, axellinjen.
2. **Moln & nederbörd** ("Clouds & precipitation", "Clouds & precip." under 520 px):
   vädersymbolerna, molntäcke i tre rader (High, Mid, Low – 8 px vardera), taket ur TAF
   ("Ceiling") och nederbörden ("mm/h").
3. **Temperatur & daggpunkt** ("Temperature °C", `TEMP_H` 148 px – en tredjedel lägre än
   förut) med förklaringen högerställd i rubrikraden.
4. **Vind** ("Wind (gusts) m/s", 50 px).
5. **Ljus** ("Light", 64 px).

- **Gemensamt**: samma `x(t)` för alla grupper; timgridlinjerna och NU-linjen går obrutna
  genom alla. Rubrikerna står i den fasta vänsterkolumnen med samma plats, typografi och
  radhöjd (15 px, `RUBRIC_H`) och är genomskinliga, så att NU-linjen syns genom raden.
  Rubriktexterna är korta nog att sluta före NU-linjen i standardvyn – också på mobil. Lika
  mycket luft (`GAP` 6 px) på var sida om en tunn avgränsare (`--rule`) mellan grupperna.
  Enheten står i rubriken när gruppen har en; nederbördens "mm/h" står vid staplarna.
- **Kantdöljning** (`placeMarkers`): symboler, vindpilar, etiketter, timtal och datum som
  vänsterkolumnen eller vyns högerkant skulle klippa döljs i stället för att visas halva –
  elementen bär sin utsträckning som `data-l`/`data-r` (SVG-x). Takets värde följer med in i
  vyn så länge dess period syns och värdet ryms.
- **Molntäcke per timme** (`cloudCoverHours`): prognos = SMHI:s låga, medelhöga och höga
  molnmängd (`low/medium/high_type_cloud_area_fraction`, oktas) vid den hela timmen.
  Observerat = METAR inom 35 min: varje lagers kategori (FEW 1,5, SCT 3,5, BKN 6, OVC/VV 8
  åttondelar) i raden för dess bas (under 2 000 m låga, 2 000–6 000 m medelhöga, över höga),
  största per rad. Rader under det högsta rapporterade lagret är klara (0), rader ovanför
  okända och lämnas tomma – molnet skymmer dem eller så rapporteras de inte. Klart (SKC/CLR/NCD
  och liknande) ger tre klara rader; CAVOK/NSC utan lager bara en klar låg rad. SMHI:s
  stationer rapporterar bara molnbas och används inte här. Tonen (opaciteten) följer
  åttondelarna; ingen interpolation mellan observationer.
- **Tak ur TAF** (`tafCeilings`): lägsta BKN/OVC/VV i huvudläget (BASE/FM/BECMG, BECMG från
  intervallets slut) per period, från NU (eller TAF:ens start) till giltighetstidens slut –
  ingenting efter. TEMPO/PROB ritas inte som tak. En linje med startstreck, värdet i meter
  (avrundat till 10 m, "VV" vid vertikal sikt) och ett diskret "TAF" på periodens första
  segment; lika perioder i följd slås ihop.
- **Daggpunkt**: observerad ur samma station som temperaturen när den har daggpunkt, annars
  närmaste METAR (heldragen). Prognosen (streckad) ur SMHI:s relativa fuktighet (Magnus) –
  `snow1g` saknar daggpunkt – som en spridning under temperaturen: SMHI:s egen spridning,
  med skillnaden mot senaste observerade spridningen utklingande över 3 h, så att kurvan börjar
  i senaste observationen (`dewAdjuster`). Avläsningen använder samma värde. Aldrig över
  temperaturen.
- **Dimrisk** (`fogBands`): svag yta mellan kurvorna där spridningen är högst 2 °C, med exakta
  gränspunkter där spridningen passerar 2 °C; aldrig över luckor i någon av kurvorna.
- **Vind**: byar inom parentes under medelvinden i samma rad (`.tl-wind-gust`, ljusare), bara
  när de är minst 3 m/s högre.
- **Verifierat** (Karlstad 26 sep 2026): ↑ 06:59:18 och ↓ 18:54:04 med kurvans korsning av
  horisontlinjen på samma x som tiderna (0,4 px före 07-linjen respektive 3 px före 19-linjen),
  "Max 29°", NU-linjen från pillen till nederkanten utan något ogenomskinligt element över sig,
  på dator (780 px diagram), mobil (375 px) och i mörkt tema.
