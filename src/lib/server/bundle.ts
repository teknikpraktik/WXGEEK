import "server-only";
import { bboxAround, distanceKm } from "../geo";
import { normalizeMetar, type AwcMetar } from "../adapters/metar";
import { normalizeTaf } from "../adapters/taf";
import { mergeSmhiStation, SMHI_PARAMS, type SmhiParamName, type SmhiStation, type SmhiValue } from "../adapters/smhi-obs";
import { normalizeSmhiForecast } from "../adapters/smhi-forecast";
import {
  fetchMetarHistory,
  fetchMetarsInBbox,
  fetchSmhiForecast,
  fetchSmhiLatestDay,
  fetchTafsInBbox,
  getSmhiStations,
} from "./sources";
import { sigmetsAt, smhiWarningsAt } from "./warnings";
import { MAX_AGE_MS, rankCandidates, selectionReason, type Candidate } from "../weather/stations";
import type {
  Forecast,
  ParamKey,
  ParamSelection,
  SourceStatus,
  StationSeries,
  Taf,
  WeatherBundle,
} from "../types";

const HISTORY_MS = 13 * 60 * 60 * 1000;
/** Fast tidsfönster: 12 h bakåt (observationer) och 12 h framåt (prognos). */
const FORECAST_WINDOW_MS = 12 * 60 * 60 * 1000;
const METAR_RADIUS_KM = 110;
const TAF_MAX_KM = 50;

/** Vilka SMHI-parametrar som behövs för respektive GeekWX-parameter. */
const SMHI_FOR: Record<ParamKey, SmhiParamName[]> = {
  temperature: ["temperature"],
  wind: ["windSpeed", "windDirection"],
  gust: ["gust"],
  precipitation: ["precipitation"],
  visibility: ["visibility"],
  cloudBase: ["cloudBase"],
  phenomena: ["presentWeather"],
};

/** Om en METAR alls innehåller parametern. */
const METAR_HAS: Record<ParamKey, (m: AwcMetar) => boolean> = {
  temperature: (m) => m.temp != null,
  wind: (m) => m.wspd != null,
  gust: (m) => m.wspd != null,
  precipitation: () => false,
  visibility: () => true,
  cloudBase: () => true,
  phenomena: () => true,
};

const PARAMS = Object.keys(SMHI_FOR) as ParamKey[];

const key = (c: { source: string; stationId: string }) => `${c.source}:${c.stationId}`;

export async function buildWeatherBundle(lat: number, lon: number): Promise<WeatherBundle> {
  const now = Date.now();
  const sources: SourceStatus[] = [];

  const metarBox = bboxAround(lat, lon, METAR_RADIUS_KM);
  const tafBox = bboxAround(lat, lon, TAF_MAX_KM + 10);
  const smhiParamNames = Object.keys(SMHI_PARAMS) as SmhiParamName[];

  // Varningar hämtas parallellt; ett fel här stoppar inget annat.
  const warningsP = Promise.allSettled([
    smhiWarningsAt(lat, lon, now - HISTORY_MS, now + FORECAST_WINDOW_MS),
    sigmetsAt(lat, lon, now - HISTORY_MS, now + FORECAST_WINDOW_MS),
  ]);

  const [metarLatestRes, tafRes, forecastRes, ...smhiListRes] = await Promise.allSettled([
    fetchMetarsInBbox(metarBox),
    fetchTafsInBbox(tafBox),
    fetchSmhiForecast(lat, lon),
    ...smhiParamNames.map((p) => getSmhiStations(SMHI_PARAMS[p])),
  ]);

  // -------------------------------------------------------------------------
  // METAR-kandidater (senaste rapport per flygplats i området)
  // -------------------------------------------------------------------------
  const latestMetar = new Map<string, AwcMetar>();
  if (metarLatestRes.status === "fulfilled") {
    for (const m of metarLatestRes.value) {
      const prev = latestMetar.get(m.icaoId);
      if (!prev || prev.obsTime < m.obsTime) latestMetar.set(m.icaoId, m);
    }
  }
  const metarCandidates = [...latestMetar.values()].map((m) => ({
    metar: m,
    cand: {
      source: "METAR" as const,
      stationId: m.icaoId,
      stationName: normalizeMetar(m).stationName ?? m.icaoId,
      latitude: m.lat,
      longitude: m.lon,
      distanceKm: distanceKm(lat, lon, m.lat, m.lon),
      latestMs: m.obsTime * 1000,
    } satisfies Candidate,
  }));

  // -------------------------------------------------------------------------
  // SMHI-kandidater per parameter
  // -------------------------------------------------------------------------
  const smhiLists = {} as Record<SmhiParamName, SmhiStation[] | null>;
  smhiParamNames.forEach((p, i) => {
    const r = smhiListRes[i];
    smhiLists[p] = r.status === "fulfilled" ? r.value : null;
  });
  const smhiListsOk = Object.values(smhiLists).some((l) => l && l.length > 0);

  function smhiCandidates(param: ParamKey): Candidate[] {
    const needed = SMHI_FOR[param];
    const lists = needed.map((n) => smhiLists[n]);
    if (lists.some((l) => !l)) return [];
    const [first, ...rest] = lists as SmhiStation[][];
    const restIds = rest.map((l) => new Set(l.map((s) => s.id)));
    return first
      .filter((s) => restIds.every((ids) => ids.has(s.id)))
      .map((s) => ({
        source: "SMHI" as const,
        stationId: s.id,
        stationName: s.name,
        latitude: s.lat,
        longitude: s.lon,
        distanceKm: distanceKm(lat, lon, s.lat, s.lon),
        latestMs: s.updated,
      }));
  }

  // -------------------------------------------------------------------------
  // Stationsval per parameter, med reserv om vald SMHI-station saknar färsk data
  // -------------------------------------------------------------------------
  const smhiData = new Map<string, Partial<Record<SmhiParamName, SmhiValue[]>>>();
  const smhiStationInfo = new Map<string, Candidate>();
  let smhiDataErrors = 0;

  async function loadSmhi(c: Candidate, names: SmhiParamName[]): Promise<boolean> {
    const results = await Promise.all(
      names.map((n) =>
        fetchSmhiLatestDay(SMHI_PARAMS[n], c.stationId).catch(() => {
          smhiDataErrors++;
          return [] as SmhiValue[];
        }),
      ),
    );
    const primary = results[0];
    const latest = primary.at(-1);
    if (!latest || now - latest.t > MAX_AGE_MS.SMHI) return false;
    const entry = smhiData.get(c.stationId) ?? {};
    names.forEach((n, i) => (entry[n] = results[i]));
    smhiData.set(c.stationId, entry);
    smhiStationInfo.set(c.stationId, c);
    return true;
  }

  const selections = {} as Record<ParamKey, ParamSelection>;
  const chosenMetar = new Set<string>();

  await Promise.all(
    PARAMS.map(async (param) => {
      const candidates: Candidate[] = [
        ...metarCandidates.filter((m) => METAR_HAS[param](m.metar)).map((m) => m.cand),
        ...smhiCandidates(param),
      ];
      const ranked = rankCandidates(candidates, param, now);
      let winner: Candidate | undefined;
      // Pröva högst tre kandidater.
      for (const c of ranked.slice(0, 3)) {
        if (c.source === "METAR") {
          winner = c;
          break;
        }
        if (await loadSmhi(c, SMHI_FOR[param])) {
          winner = c;
          break;
        }
      }
      if (winner?.source === "METAR") chosenMetar.add(winner.stationId);
      const { latestMs: _l, ...stationRef } = winner ?? ({} as Candidate);
      void _l;
      selections[param] = {
        param,
        stationKey: winner ? key(winner) : null,
        station: winner ? stationRef : null,
        reason: selectionReason(param, winner, ranked),
        latestTimestamp: winner ? new Date(winner.latestMs).toISOString() : undefined,
      };
    }),
  );

  // Närmaste METAR inom 60 km tas alltid med, så att rå METAR kan visas.
  const nearestMetar = metarCandidates
    .map((m) => m.cand)
    .filter((c) => c.distanceKm <= 60 && now - c.latestMs <= MAX_AGE_MS.METAR)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (nearestMetar) chosenMetar.add(nearestMetar.stationId);

  // -------------------------------------------------------------------------
  // Historik
  // -------------------------------------------------------------------------
  const stations: StationSeries[] = [];
  let metarHistoryError = false;

  await Promise.all(
    [...chosenMetar].slice(0, 2).map(async (icao) => {
      const cand = metarCandidates.find((m) => m.cand.stationId === icao)!;
      let history: AwcMetar[] = [];
      try {
        history = await fetchMetarHistory(icao);
      } catch {
        metarHistoryError = true;
      }
      // Senaste rapporten (kort cache) läggs alltid till – historiken har längre cache
      // och kan sakna den nyaste rapporten, eller saknas helt vid fel.
      history = [...history, cand.metar];
      const seen = new Set<number>();
      const observations = history
        .filter((m) => now - m.obsTime * 1000 <= HISTORY_MS && !seen.has(m.obsTime) && seen.add(m.obsTime))
        .map((m) => normalizeMetar(m, cand.cand.distanceKm))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const { latestMs: _l, ...ref } = cand.cand;
      void _l;
      stations.push({ key: key(ref), station: ref, observations });
    }),
  );

  for (const [id, series] of smhiData) {
    const c = smhiStationInfo.get(id)!;
    const { latestMs: _l, ...ref } = c;
    void _l;
    const observations = mergeSmhiStation(
      { id, name: c.stationName, lat: c.latitude, lon: c.longitude, distanceKm: c.distanceKm },
      series,
    ).filter((o) => now - Date.parse(o.timestamp) <= HISTORY_MS);
    stations.push({ key: key(ref), station: ref, observations });
  }

  // Uppdatera "senaste" i urvalet med faktiska data (SMHI-listans tid kan vara cachad).
  for (const sel of Object.values(selections)) {
    if (!sel.stationKey) continue;
    const s = stations.find((x) => x.key === sel.stationKey);
    const last = s?.observations.at(-1);
    if (last) sel.latestTimestamp = last.timestamp;
  }

  // -------------------------------------------------------------------------
  // TAF
  // -------------------------------------------------------------------------
  let taf: Taf | null = null;
  if (tafRes.status === "fulfilled") {
    const nearest = tafRes.value
      .filter((t) => t.validTimeTo * 1000 > now)
      .map((t) => ({ t, d: distanceKm(lat, lon, t.lat, t.lon) }))
      .filter((x) => x.d <= TAF_MAX_KM)
      .sort((a, b) => a.d - b.d)[0];
    if (nearest) {
      try {
        taf = normalizeTaf(nearest.t, nearest.d);
      } catch {
        taf = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Prognos
  // -------------------------------------------------------------------------

  // Prognosen visas alltid 12 h framåt. TAF används där den gäller, SMHI kompletterar
  // och tar över efter TAF:s giltighetstid (se src/lib/client/forecast.ts).
  const forecastUntil = now + FORECAST_WINDOW_MS;
  let forecast: Forecast | null = null;
  let forecastMessage: string | undefined;
  if (forecastRes.status === "fulfilled" && forecastRes.value) {
    forecast = normalizeSmhiForecast(forecastRes.value);
    forecast.points = forecast.points.filter((p) => {
      const t = Date.parse(p.timestamp);
      return t >= now - 60 * 60 * 1000 && t <= forecastUntil + 60 * 60 * 1000;
    });
  } else if (forecastRes.status === "fulfilled") {
    forecastMessage = "The location is outside SMHI's forecast area";
  } else {
    forecastMessage = "SMHI forecast service is not responding";
  }

  // -------------------------------------------------------------------------
  // Källstatus
  // -------------------------------------------------------------------------
  const metarStation = stations.find((s) => s.station.source === "METAR");
  sources.push({
    id: "metar",
    label: "METAR",
    ok: metarLatestRes.status === "fulfilled" && !!metarStation,
    failed: metarLatestRes.status === "rejected" || metarHistoryError,
    message:
      metarLatestRes.status === "rejected"
        ? "Aviation weather service (NOAA AWC) is not responding"
        : !metarStation
          ? "No airport with a current METAR nearby"
          : metarHistoryError
            ? "History unavailable – showing latest report"
            : undefined,
  });
  sources.push({
    id: "smhi-obs",
    label: "SMHI observations",
    // Att ingen SMHI-station valts är inget fel – en närmare flygplats kan ha vunnit alla parametrar.
    ok: smhiListsOk && smhiDataErrors === 0,
    failed: !smhiListsOk || smhiDataErrors > 0,
    message: !smhiListsOk
      ? "SMHI observation service is not responding"
      : smhiDataErrors > 0
        ? "Some SMHI observations could not be loaded"
        : undefined,
  });
  sources.push({
    id: "smhi-forecast",
    label: "SMHI forecast",
    ok: !!forecast,
    failed: forecastRes.status === "rejected",
    message: forecastMessage,
  });
  sources.push({
    id: "taf",
    label: "TAF",
    ok: !!taf,
    failed: tafRes.status === "rejected",
    message:
      tafRes.status === "rejected"
        ? "TAF could not be loaded"
        : !taf
          ? `No airport with a TAF within ${TAF_MAX_KM} km`
          : undefined,
  });

  return {
    generatedAt: new Date(now).toISOString(),
    location: { latitude: lat, longitude: lon },
    stations,
    selections,
    forecast,
    forecastUntil: new Date(forecastUntil).toISOString(),
    taf,
    warnings: (await warningsP).flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    sources,
  };
}
