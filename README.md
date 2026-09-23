# Väderlek

**DÅ ← NU → SEN**

Väderlek är en svensk, mobile-first väderapp som visar vädret som ett
sammanhängande förlopp genom tiden. Vanliga väderappar är prognosappar –
Väderlek behandlar **observerat väder som en förstklassig datatyp**.

```
−12 h ←──────── NU ────────→ +12 h
  observerat          prognos
```

- Öppna appen och se direkt det **observerade** vädret nu – med station, avstånd och ålder.
- Dra tidslinjen bakåt ~12 timmar och se hur vädret faktiskt utvecklats.
- Dra framåt och se prognosen på **samma** tidsaxel.
- Ett diagram: molnbas (meter, vänster axel) och temperatur (°C, höger axel), med nederbörd som faller från molnbasen och vindpilar under.
- Fast fönster: 12 h observationer bakåt och 12 h prognos framåt. Välj tid genom att dra i grafen eller med knapparna ◀ Nu ▶.
- Prognosen använder **TAF först** (vind, sikt, moln, väder vid flygplatsen under TAF:s giltighetstid) och **SMHI** för temperatur, nederbördsmängd, saknade värden och resten av perioden – med källa per värde.
- Nuvädret (temperatur, vind, sikt, molnbas, nederbörd) visas först i ett stabilt rutnät; detaljvyn visar exakta värden, tider och källor för vald tid; rå METAR och TAF finns under "Visa flygväderdata".
- Observation (heldraget, tonad bakgrund) och prognos (streckat, skrafferad bakgrund) skiljs åt med stil, inte färg. Grön linje markerar NU.

Väderlek kombinerar **METAR** (flygplatsobservationer), **SMHI:s observationer**,
**SMHI:s prognos** och **TAF** (flygplatsprognos). Flygmeteorologin syns i
informationsdesignen, men allt presenteras på begriplig svenska. Rå METAR/TAF
finns som detalj för den som vill.

Appen ger aldrig sken av större precision än källorna medger: inga
interpolerade värden, en flygplatsobservation presenteras med avstånd och ålder,
och saknade data visas som saknade.

## Kom igång

Kräver Node.js 20+ (utvecklat med Node 24).

```bash
npm install
npm run dev
```

Öppna <http://localhost:3000>.

Övriga skript:

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # tester för tids-, TAF- och datalogik (node:test via tsx)
npm run build      # produktionsbygge
npm start          # kör produktionsbygget
```

## Miljövariabler

Inga krävs. Alla datakällor är öppna och saknar API-nycklar. Arkitekturen
skickar ändå alla externa anrop via serverns API-routes (cache, CORS, framtida nycklar).

## Deployment på Vercel

1. Importera repot i Vercel (framework: Next.js, inga inställningar behövs).
2. Deploya. API-routes körs som Vercel Functions (Node.js, Fluid Compute).

Eller via CLI:

```bash
npm i -g vercel
vercel        # förhandsversion
vercel --prod # produktion
```

API-svaren har `Cache-Control` med `s-maxage`, så Vercels CDN avlastar både
funktionerna och de externa källorna.

## Datakällor

| Källa | Används till | Licens |
|---|---|---|
| NOAA Aviation Weather Center | METAR (nu + 13 h), TAF | Fri (amerikansk federal data) |
| SMHI Meteorologiska observationer | Stationsmätningar, senaste dygnet | CC BY 4.0 |
| SMHI Meteorologiska prognoser (`snow1g`) | Punktprognos | CC BY 4.0 |
| OpenStreetMap Nominatim | Ortsökning | ODbL |

Detaljer, endpoints, begränsningar och verifiering: [`docs/data-sources.md`](docs/data-sources.md).
Arkitektur, stationsval och cache: [`docs/architecture.md`](docs/architecture.md).

## Kända begränsningar (MVP)

- **Stationsbaserat.** Lokala skurar mellan stationer syns inte i observationerna. Radar är en naturlig nästa version.
- **SMHI:s observationer publiceras med ~1 h fördröjning**; METAR är ofta färskare men finns bara vid flygplatser och ibland bara under öppettider.
- **METAR-temperatur är heltal.** Vi visar dem utan decimal för att inte antyda större precision.
- **Byar i METAR** rapporteras bara när de är kraftiga. SMHI:s byvind föredras när den finns.
- **Molnbas i prognosen** (`cloud_base_altitude`) saknar dokumenterad referensnivå (mark/hav) – den visas som ungefärlig.
- **Nederbörd** mäts timvis på relativt få SMHI-stationer; ofta finns ingen mätare inom 30 km.
- **TAF** visas bara för flygplatser inom 50 km och gäller i praktiken flygplatsens närområde.
- **Endast Sverige** (koordinater utanför ger fel). Prognosen täcker SMHI:s modellområde.
- SMHI:s stationslistor hålls i serverns minne; en kall start tar några sekunder extra.
- Ingen offline-cache/PWA ännu.

## Nästa steg

- Radar (nederbörd mellan stationer).
- Fler parametrar i grafen (daggpunkt/fuktighet, sannolikhet för nederbörd).
- Jämförelse prognos vs utfall bakåt i tiden ("hur bra var prognosen?").
- Enhetstester för adapters (METAR/TAF-parsning) med sparade fixtures.
- PWA / offline-läge.

---

Data: SMHI (CC BY 4.0), NOAA Aviation Weather Center, © OpenStreetMap-bidragsgivare.
Väderlek är inte en flygväderstjänst och ska inte användas för flygplanering.
