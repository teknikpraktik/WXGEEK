# Väderlek

**DÅ ← NU → SEN**

Väderlek är en svensk, mobile-first väderapp som visar vädret som ett
sammanhängande förlopp genom tiden. Vanliga väderappar är prognosappar –
Väderlek behandlar **observerat väder som en förstklassig datatyp**.

```
−12 h ←──────── NU ────────→ +36 h
  observerat          prognos
```

- Öppna appen och se direkt det **observerade** vädret nu – med station, avstånd och ålder.
- Dra tidslinjen bakåt ~12 timmar och se hur vädret faktiskt utvecklats.
- Dra framåt och se prognosen på **samma** tidsaxel.
- Välj huvudparameter: temperatur, vind, lufttryck, sikt, molnbas eller nederbörd.
- Observation (heldraget, bläck) och prognos (streckat, blått) skiljs tydligt åt.

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
