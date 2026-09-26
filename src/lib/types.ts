// Normaliserade interna typer. UI:t känner bara till dessa – aldrig AWC:s eller SMHI:s råformat.

export type ObservationSource = "METAR" | "SMHI";

export type CloudCover = "FEW" | "SCT" | "BKN" | "OVC" | "VV";

export type CloudLayer = {
  cover: CloudCover;
  baseM: number;
  /** CB / TCU om angivet i METAR */
  type?: "CB" | "TCU";
};

/** Grovkategorier för väderfenomen, används för händelser längs tidslinjen. */
export type PhenomenonKind =
  | "regn"
  | "duggregn"
  | "snö"
  | "snöblandat"
  | "hagel"
  | "skurar"
  | "dimma"
  | "dis"
  | "åska"
  | "underkylt";

export type Phenomenon = {
  kind: PhenomenonKind;
  /** Svensk beskrivning, t.ex. "Lätt regn" */
  label: string;
  intensity?: "lätt" | "måttlig" | "kraftig";
  /** Originalkod, t.ex. "-RA" eller SMHI-kod "161" */
  code?: string;
};

export type WeatherObservation = {
  timestamp: string;
  source: ObservationSource;
  stationId: string;
  stationName?: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;

  temperatureC?: number;
  /** Daggpunkt (METAR) */
  dewPointC?: number;

  windDirectionDeg?: number;
  windVariable?: boolean;
  windSpeedMs?: number;
  windGustMs?: number;

  visibilityM?: number;
  /** true när sikten rapporteras som "minst" värdet (9999/CAVOK) */
  visibilityAtLeast?: boolean;

  cloudBaseM?: number;
  cloudLayers?: CloudLayer[];
  /** CAVOK / NSC / inga moln rapporterade */
  noSignificantCloud?: boolean;
  /** Klar himmel enligt METAR: CAVOK, SKC eller CLR */
  clearSky?: boolean;

  precipitationMm?: number;

  weatherPhenomena?: Phenomenon[];

  raw?: string;
};

export type ForecastPoint = {
  timestamp: string;
  /** Start på intervallet för nederbörd etc. */
  intervalStart?: string;
  temperatureC?: number;
  /** Relativ fuktighet i % – ger daggpunkt */
  relativeHumidity?: number;
  windDirectionDeg?: number;
  windSpeedMs?: number;
  windGustMs?: number;
  visibilityM?: number;
  cloudBaseM?: number;
  /** oktas 0–8 */
  cloudCoverOktas?: number;
  /** Molntäcke per skikt (oktas 0–8): låga, medelhöga och höga moln */
  lowCloudCoverOktas?: number;
  midCloudCoverOktas?: number;
  highCloudCoverOktas?: number;
  precipitationMm?: number;
  precipitationMaxMm?: number;
  precipitationMedianMm?: number;
  precipitationProbability?: number;
  thunderProbability?: number;
  symbolCode?: number;
  phenomenon?: Phenomenon;
};

export type Forecast = {
  source: "SMHI";
  model: "snow1g";
  createdTime: string;
  referenceTime: string;
  latitude: number;
  longitude: number;
  points: ForecastPoint[];
};

export type TafChange = "BASE" | "FM" | "BECMG" | "TEMPO" | "PROB";
/** Element som en TAF-grupp kan ange. */
export type TafElement = "wind" | "visibility" | "weather" | "clouds";

export type TafPeriod = {
  change: TafChange;
  probability?: number;
  from: string;
  to: string;
  /** För BECMG: när övergången är klar */
  becomingBy?: string;
  windDirectionDeg?: number;
  windVariable?: boolean;
  windSpeedMs?: number;
  windGustMs?: number;
  visibilityM?: number;
  visibilityAtLeast?: boolean;
  cloudLayers?: CloudLayer[];
  noSignificantCloud?: boolean;
  phenomena?: Phenomenon[];
  /** CAVOK: sikt ≥ 10 km, inga moln under 1 500 m (eller högsta sektorhöjd), ingen CB/TCU, inget väder */
  cavok?: boolean;
  /** NSW: inget väder av betydelse (avslutar tidigare väderfenomen) */
  nsw?: boolean;
  /** Element som gruppen faktiskt anger (ur råtexten). BECMG ändrar bara dessa. */
  changes?: TafElement[];
  /** Gruppens råtext, t.ex. "BECMG 2318/2320 0300 FG VV002" */
  group?: string;
  /** Svensk sammanfattning av perioden */
  summary: string;
};

export type Taf = {
  stationId: string;
  stationName?: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
  issueTime: string;
  validFrom: string;
  validTo: string;
  raw: string;
  periods: TafPeriod[];
};

/** Parametrar som kan visas och som har egen stationsvalslogik. */
export type ParamKey =
  | "temperature"
  | "wind"
  | "gust"
  | "visibility"
  | "cloudBase"
  | "precipitation"
  | "phenomena";

export type StationRef = {
  source: ObservationSource;
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
};

export type StationSeries = {
  key: string;
  station: StationRef;
  /** Sorterade stigande i tid */
  observations: WeatherObservation[];
};

/** Vilken station som valts för en parameter, och varför. */
export type ParamSelection = {
  param: ParamKey;
  /** Nyckel till `WeatherBundle.stations`, null om ingen lämplig station finns */
  stationKey: string | null;
  station: StationRef | null;
  /** Kort svensk motivering, t.ex. "Närmaste station med aktuell mätning" */
  reason: string;
  latestTimestamp?: string;
};

export type SourceStatus = {
  id: "metar" | "taf" | "smhi-obs" | "smhi-forecast";
  label: string;
  ok: boolean;
  /** Tjänsten svarade inte (till skillnad från "ingen station i närheten") */
  failed?: boolean;
  message?: string;
};

/** Official warnings: SMHI impact-based weather warnings and aviation SIGMETs. */
export type WeatherWarning = {
  id: string;
  source: "SMHI" | "SIGMET";
  level: "MESSAGE" | "YELLOW" | "ORANGE" | "RED" | "SIGMET";
  title: string;
  area?: string;
  from?: string;
  to?: string;
  text?: string;
};

export type Place = {
  name: string;
  detail?: string;
  latitude: number;
  longitude: number;
};

export type WeatherBundle = {
  generatedAt: string;
  location: { latitude: number; longitude: number };
  /** En tidsserie per station. Nyckel = `${source}:${stationId}`. */
  stations: StationSeries[];
  /** Vilken station som används för respektive parameter. */
  selections: Record<ParamKey, ParamSelection>;
  forecast: Forecast | null;
  /** Slutet på det fasta prognosfönstret (NU + 24 h). */
  forecastUntil: string;
  taf: Taf | null;
  /** SMHI warnings and SIGMETs for the location within the window */
  warnings: WeatherWarning[];
  sources: SourceStatus[];
};
