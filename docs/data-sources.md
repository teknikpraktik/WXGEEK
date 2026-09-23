# Datakällor

Verifierat med riktiga anrop **2026-09-23**. Anta inte att äldre dokumentation
stämmer – SMHI:s tidigare prognos-API `pmp3g` svarar t.ex. nu med `404`.

| Källa | Används till | Autentisering | Licens |
|---|---|---|---|
| NOAA Aviation Weather Center (AWC) Data API | METAR (nu + historik), TAF, SIGMET, stationslista för flygplatser | Ingen | Amerikansk federal data, fri att använda |
| SMHI Meteorologiska observationer (metobs) | Stationsobservationer, senaste dygnet | Ingen | CC BY 4.0 – ange SMHI som källa |
| SMHI Meteorologiska prognoser, kategori `snow1g` | Punktprognos (timvis ~2,5 dygn, sedan 6/12 h) | Ingen | CC BY 4.0 – ange SMHI som källa |
| SMHI Impact-based weather warnings (IBWW) | Varningar och meddelanden för platsen | Ingen | CC BY 4.0 |
| OpenStreetMap Nominatim | Ortsökning och omvänd geokodning | Ingen (User-Agent krävs) | ODbL – ange © OpenStreetMap-bidragsgivare |

Alla anrop görs från serverns API-routes (se `docs/architecture.md`). AWC tillåter
inte CORS, så METAR/TAF *måste* gå via servern.

---

## 1. METAR – NOAA Aviation Weather Center

Bas-URL: `https://aviationweather.gov/api/data/`
Dokumentation: <https://aviationweather.gov/data/api/>

### Endpoints som används

| Endpoint | Exempel | Används till |
|---|---|---|
| `metar` med `bbox` | `metar?bbox=58.4,11.5,60.4,15.5&format=json` | Senaste METAR för alla stationer i området → kandidater för stationsval (avstånd + ålder) |
| `metar` med `ids` + `hours` | `metar?ids=ESOK&format=json&hours=13` | Historik för vald station (~26 rapporter/13 h för svenska flygplatser med halvtimmesrapporter) |
| `taf` | `taf?ids=ESOK&format=json` | Aktuell TAF |
| `isigmet` | `isigmet?format=json` | Internationella SIGMET; filtreras på polygon som innehåller platsen eller FIR ESAA |
| `stationinfo` med `bbox` | `stationinfo?bbox=...&format=json` | Vilka stationer som har TAF (`siteType` innehåller `"TAF"`) |

`bbox` anges som `latMin,lonMin,latMax,lonMax`.

### Format (JSON)

Varje METAR är ett objekt, t.ex.:

```json
{"icaoId":"ESOK","obsTime":1790146200,"reportTime":"2026-09-23T07:00:00.000Z",
 "temp":9,"dewp":9,"wdir":40,"wspd":2,"visib":"6+","altim":1022,
 "wxString":"-RA","rawOb":"METAR ESOK 230650Z 04002KT 9999 BKN006 09/09 Q1022",
 "lat":59.442,"lon":13.342,"elev":101,"name":"Karlstad Arpt, S, SE",
 "clouds":[{"cover":"BKN","base":600}],"fltCat":"IFR"}
```

Viktiga enhetsdetaljer:

- `obsTime` – Unix-sekunder (UTC).
- `temp`, `dewp` – °C (heltal i europeiska METAR).
- `wdir` – grader eller strängen `"VRB"`.
- `wspd`, `wgst` – **knop** → omräknas till m/s.
- `visib` – **engelska statute miles**, t.ex. `"6+"`. För europeiska METAR tolkar
  vi i stället sikten ur rå-METAR (fyra siffror i meter, `9999` = 10 km eller mer,
  `CAVOK`), vilket är exaktare.
- `altim` – QNH i hPa.
- `clouds[].base` – **fot över mark** → omräknas till meter. `VV` (vertikal sikt) tolkas från rå-METAR.
- `wxString` – väderfenomen i METAR-kod (`-RA`, `BR`, `+SHSN`, `TSRA` …).

### Historik

API:t ger upp till **30 dagar** bakåt. Vi använder `hours=13` (≈ 12 h + marginal).

### Rate limits och villkor

- Max **100 anrop/minut** (överskridande → blockering, HTTP 429).
- De flesta endpoints returnerar max 400 poster.
- Sätt egen `User-Agent` (vi skickar `WXGEEK/0.1 (+https://github.com/teknikpraktik/vaderlek)`).
- `204 No Content` = giltig fråga men ingen data (t.ex. station utan aktuell METAR).
- CORS tillåts inte → endast serveranrop.
- Svaren har `Cache-Control: max-age=60`.

### Kända begränsningar

- En METAR beskriver förhållandena **vid flygplatsen** och uppdateras normalt var
  30:e (större flygplatser) eller var 60:e minut. Mindre flygplatser rapporterar
  bara under öppettider – nattetid kan METAR saknas helt.
- Byar rapporteras bara när de är markant högre än medelvinden (≥ 10 kt över). Att
  byar saknas i METAR betyder alltså inte att det är byfritt.

---

## 2. TAF – NOAA Aviation Weather Center

Endpoint: `https://aviationweather.gov/api/data/taf?ids=ESOK&format=json`

AWC returnerar både rå TAF (`rawTAF`) och avkodade perioder i `fcsts[]`:

| Fält | Betydelse |
|---|---|
| `timeFrom`, `timeTo` | Periodens giltighet (Unix-sekunder) |
| `fcstChange` | `null` (grundprognos), `FM`, `BECMG`, `TEMPO`, `PROB` |
| `timeBec` | Tidpunkt då en `BECMG`-övergång är klar |
| `probability` | 30/40 vid `PROB` |
| `wdir`, `wspd`, `wgst` | Vind (knop) |
| `visib` | Sikt i statute miles (`"6+"` = ≥ 10 km) |
| `wxString`, `clouds[]` | Väderfenomen, molnlager (fot) |

Vi visar perioderna som **intervall** i avläsningen (den period som gäller vid vald tidpunkt) – aldrig som timvärden. Prognosfönstret är alltid NU + 12 h.
TAF finns bara för flygplatser med TAF-tjänst och gäller i princip flygplatsens
närområde (≈ 8 km radie). Vi visar endast TAF för flygplats inom 50 km.

---

## 3. SMHI – meteorologiska observationer (metobs)

Bas-URL: `https://opendata-download-metobs.smhi.se/api/version/1.0/`
Dokumentation: <https://opendata.smhi.se/metobs/introduction>

### Endpoints

| Endpoint | Används till |
|---|---|
| `parameter/{p}.json` | Stationslista för parametern (≈ 800 kB, ~1000 stationer varav ~200–250 aktiva). Innehåller `latitude`, `longitude`, `active` och `updated` (tid för senaste värde, ms). |
| `parameter/{p}/station/{id}/period/latest-day/data.json` | Senaste dygnets värden (≈ 25 timvärden). |

Svar: `value: [{ "date": <ms>, "value": "8.5", "quality": "G" | "Y" }]`.
Värden är **strängar**. Kvalitet `G` = kontrollerat, `Y` = misstänkt/preliminärt.

### Parametrar vi använder

| p | Parameter | Enhet | Kommentar |
|---|---|---|---|
| 1 | Lufttemperatur, momentan 1 gång/tim | °C | |
| 3 | Vindriktning, 10-min medel | grader | |
| 4 | Vindhastighet, 10-min medel | m/s | |
| 21 | Byvind, max 1 gång/tim | m/s | Finns inte på alla stationer (t.ex. inte Karlstad Flygplats) |
| 7 | Nederbördsmängd, summa 1 timme | mm | Glesare stationsnät |
| 12 | Sikt | m | Kan ge mycket höga värden (t.ex. 75 000 m) |
| 36 | Molnbas, lägsta molnbas | m | |
| 13 | Rådande väder | kod | 0–99 = manuell (WMO 4677), 100–199 = automatstation (WMO 4680 + 100) |

### Historik

`latest-day` ger ca 24 h, vilket räcker för WXGEEK:s −12 h. (`latest-hour` och
`latest-months` finns också.)

### Rate limits och villkor

- Ingen publicerad hård gräns. SMHI:s riktlinjer: använd endast dokumenterade
  API:er, undvik massnedladdning och onödiga upprepade hämtningar, respektera
  cache-direktiven. Missbruk kan leda till IP-blockering.
- Stationslistor: `Cache-Control: max-age=60`; data: `max-age=600`.
- CORS: `Access-Control-Allow-Origin: *` (men vi går ändå via servern för cache och stationsval).
- Licens **CC BY 4.0**: ange SMHI som källa och om materialet bearbetats (vi
  omräknar och väljer stationer – det anges i appens källruta).

### Kända begränsningar

- Observationerna publiceras med ca **en timmes fördröjning** (värdet för 06:00 UTC fanns kl. ~06:55).
- Alla stationer mäter inte alla parametrar → olika parametrar kan komma från olika stationer.
- Stationslistornas storlek gör att vi cachar en komprimerad variant i serverns minne (6 h).

---

## 4. SMHI – punktprognos (`snow1g`)

Endpoint:
`https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json`

Parameterbeskrivning: `.../snow1g/version/1/parameter.json`
Senaste körning: `.../snow1g/version/1/createdtime.json`

**OBS:** Det tidigare API:t `pmp3g/version/2` svarar nu `404`. Äldre exempel på nätet gäller inte längre.

### Format

```json
{"createdTime":"2026-09-23T06:46:26Z","referenceTime":"2026-09-23T06:30:00Z",
 "timeSeries":[{"time":"2026-09-23T07:00:00Z","intervalParametersStartTime":"2026-09-23T06:00:00Z",
   "data":{"air_temperature":11.8,"wind_from_direction":85,"wind_speed":1.4, ...}}]}
```

- ~81 tidssteg: **timvis ca 57 h**, därefter 6 h och 12 h upp till ~10 dygn.
- Saknat värde = `9999` (för `cloud_base_altitude` betyder 9999 i praktiken "inga moln"). `precipitation_frozen_part` = `-9` när ingen nederbörd.
- Nederbördsparametrar avser intervallet `intervalParametersStartTime` → `time`.
- Punkter utanför modellområdet ger `404`.

### Parametrar vi använder

| Parameter | Enhet |
|---|---|
| `air_temperature` | °C |
| `wind_from_direction`, `wind_speed`, `wind_speed_of_gust` | °, m/s |
| `visibility_in_air` | **km** |
| `cloud_area_fraction`, `low_type_cloud_area_fraction` | **oktas** (0–8) |
| `cloud_base_altitude` | m – referensnivå (mark/hav) anges inte i metadata; tolkas som ungefärlig höjd |
| `precipitation_amount_mean`, `_min`, `_max` | mm under intervallet |
| `probability_of_precipitation` | % |
| `thunderstorm_probability` | % |
| `symbol_code` | 1–27 (SMHI Wsymb2) |

### Cache och villkor

- `Cache-Control: max-age=3600`. Modellen körs ungefär varje timme.
- Licens CC BY 4.0.

---

## 5. SMHI – varningar (IBWW)

Endpoint: `https://opendata-download-warnings.smhi.se/ibww/api/version/1/warning.json`

- Lista med varningar; varje `warningAreas[]` har `warningLevel` (`MESSAGE`, `YELLOW`,
  `ORANGE`, `RED`), `approximateStart`/`approximateEnd`, beskrivningar på `sv`/`en` och
  ett GeoJSON-område (Polygon/MultiPolygon).
- Vi visar varningar vars område innehåller platsen (point-in-polygon) och som överlappar
  fönstret −12 h … +12 h. Rubrik = `eventDescription.en`.
- Hämtas med `revalidate: 300`. Licens CC BY 4.0.

---

## 6. Geokodning – OpenStreetMap Nominatim

- Sök: `https://nominatim.openstreetmap.org/search?q=Karlstad&countrycodes=se&format=jsonv2&limit=6&accept-language=en`
- Omvänd: `https://nominatim.openstreetmap.org/reverse?lat=..&lon=..&format=jsonv2&zoom=10&accept-language=en`

Användningspolicy (<https://operations.osmfoundation.org/policies/nominatim/>):
max 1 anrop/sekund, identifierande `User-Agent`, ingen autocomplete-sökning vid
varje tangenttryckning, cacha resultat, visa ODbL-attribution. WXGEEK söker
därför bara när användaren skickar sökningen och cachar svaren i 24 h.

Alternativ som testades: Open-Meteo geocoding (fungerar, men icke-kommersiella villkor).

---

## Beslut

- **pmp3g är borttaget** → `snow1g` används.
- **METAR-sikt tolkas ur rå-METAR** eftersom AWC:s JSON anger statute miles.
- **Ingen databas**: all historik (≤ 13 h) hämtas direkt från AWC och SMHI.
- **Radar** ingår inte i MVP.
