"use client";

import type { ReactNode } from "react";
import type { Origin, Reading, Snapshot } from "@/lib/client/timeline";
import type { TafPeriod } from "@/lib/types";
import {
  COVER_LABEL,
  fmtAge,
  fmtCloudBase,
  fmtDateTime,
  fmtDistance,
  fmtInterval,
  fmtOffset,
  fmtOktas,
  fmtPrecip,
  fmtTemp,
  fmtTime,
  fmtVisibility,
  fmtWindSpeed,
  fmtWindText,
} from "@/lib/format";
import { compassWord } from "@/lib/geo";
import { WindArrow } from "./WindArrow";

type Props = {
  snap: Snapshot;
  now: number;
  /** Tidslinjen renderas mellan sammanfattningen och detaljvyn */
  children?: ReactNode;
};

/** Äldre än så här markeras observationen som äldre vid NU. */
const STALE_MS = 90 * 60 * 1000;
const MISSING = "Saknas";

const MODE_LABEL: Record<Snapshot["mode"], string> = {
  now: "Senaste observation",
  observed: "Observerat",
  forecast: "Prognos",
};

export function Readout({ snap, now, children }: Props) {
  const { mode } = snap;
  const isFc = mode === "forecast";
  const w = snap.wind?.value;
  const gust = snap.gust?.value;
  const cloud = snap.cloud?.value;
  const lowest = cloud?.layers?.find((l) => l.cover !== "VV") ?? cloud?.layers?.[0];
  const pr = snap.precipitation?.value;

  // Senaste faktiska observationstid bland de visade värdena (för läget "Senaste observation").
  const obsTimes = [snap.temperature, snap.wind, snap.visibility, snap.cloud]
    .filter((r): r is NonNullable<typeof r> => !!r && (r.origin.kind === "METAR" || r.origin.kind === "SMHI"))
    .map((r) => r.origin.timestamp);
  const latestObs = obsTimes.length ? Math.max(...obsTimes) : undefined;

  return (
    <section className={`readout readout-${mode}`} aria-live="polite">
      {/* Vald tid, läge och relativ tid – läget står i text, inte bara i färg */}
      <div className="readout-status">
        <span className={`tag tag-${mode === "now" ? "now" : mode === "observed" ? "obs" : "fc"}`}>{MODE_LABEL[mode]}</span>
        {mode === "now" ? (
          <span className="status-text">
            {latestObs !== undefined ? (
              <>
                Uppmätt <b className="mono">{fmtTime(latestObs)}</b>{" "}
                <span className={now - latestObs > STALE_MS ? "stale" : "muted"}>
                  ({fmtAge(now - latestObs)}
                  {now - latestObs > STALE_MS ? " – äldre observation" : ""})
                </span>
                <span className="muted"> · klockan är {fmtTime(now)}</span>
              </>
            ) : (
              <span className="muted">Ingen aktuell observation · klockan är {fmtTime(now)}</span>
            )}
          </span>
        ) : (
          <span className="status-text">
            <b>{fmtDateTime(snap.time)}</b> <span className="muted">· {fmtOffset(snap.time - now)}</span>
          </span>
        )}
        <span className="status-tz muted">lokal tid</span>
      </div>

      {/* Sammanfattning: alltid samma fem rutor i samma ordning */}
      <dl className="readout-grid">
        <Cell label="Temperatur" r={snap.temperature}>
          {snap.temperature && <Val v={fmtTemp(snap.temperature.value)} unit="°C" />}
        </Cell>
        <Cell label="Vind" r={snap.wind} sub={w ? windSub(w, gust) : undefined}>
          {w && (
            <Val
              v={w.speed !== undefined && w.speed < 0.5 ? "0" : fmtWindSpeed(w.speed)}
              unit="m/s"
              icon={w.deg !== undefined && !w.variable && (w.speed ?? 0) >= 0.5 ? <WindArrow deg={w.deg} size={18} /> : undefined}
            />
          )}
        </Cell>
        <Cell label="Sikt" r={snap.visibility} sub={cloud?.cavok ? "CAVOK" : undefined}>
          {snap.visibility && <Val {...splitUnit(fmtVisibility(snap.visibility.value.m, snap.visibility.value.atLeast))} />}
        </Cell>
        <Cell label="Molnbas" r={snap.cloud} sub={cloud ? cloudSub(cloud, lowest?.cover) : undefined}>
          {cloud &&
            (lowest ? (
              <Val {...splitUnit(fmtCloudBase(lowest.baseM))} />
            ) : cloud.baseM !== undefined ? (
              <Val {...splitUnit(fmtCloudBase(cloud.baseM))} />
            ) : (
              <Val v="–" unit="" />
            ))}
        </Cell>
        <Cell
          label="Nederbörd"
          r={snap.precipitation}
          sub={pr ? `under ${fmtInterval(pr.from, pr.to)}` : isFc ? undefined : "Ingen mätare i närheten"}
        >
          {pr && <Val {...splitUnit(fmtPrecip(pr.mm))} />}
        </Cell>
      </dl>

      {/* Väderläge på en egen, konsekvent plats */}
      <p className="readout-summary">
        <span className="summary-label">Väderläge</span> {weatherSummary(snap)}
      </p>

      {children}

      <DetailList snap={snap} now={now} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sammanfattningens delar
// ---------------------------------------------------------------------------

function windSub(w: { deg?: number; variable?: boolean; speed?: number }, gust: number | undefined): string {
  if (w.speed !== undefined && w.speed < 0.5) return "Vindstilla";
  const dir = w.variable ? "Varierande" : w.deg !== undefined ? `Från ${compassWord(w.deg)}` : "";
  const g = gust !== undefined && gust >= (w.speed ?? 0) + 1 ? `byar ${fmtWindSpeed(gust)} m/s` : "";
  return [dir, g].filter(Boolean).join(" · ");
}

function cloudSub(c: NonNullable<Snapshot["cloud"]>["value"], cover?: string): string {
  if (c.cavok) return "Inga moln under 1 500 m";
  if (cover) return COVER_LABEL[cover] ?? "";
  if (c.baseM !== undefined && c.oktas !== undefined) return fmtOktas(c.oktas);
  if (c.baseM !== undefined) return "Molnmängd saknas";
  if (c.nsc) return "Inga betydande moln";
  if (c.oktas !== undefined) return `${fmtOktas(c.oktas)}, ingen molnbas`;
  return "";
}

function weatherSummary(snap: Snapshot): string {
  const ph = snap.phenomena;
  const cloud = snap.cloud?.value;
  const parts: string[] = [];
  if (cloud) {
    const lowest = cloud.layers?.find((l) => l.cover !== "VV");
    if (cloud.cavok) parts.push("Inga moln under 1 500 m");
    else if (cloud.layers?.some((l) => l.cover === "VV")) parts.push("Skymd himmel");
    else if (lowest) parts.push(COVER_LABEL[lowest.cover]);
    else if (cloud.oktas !== undefined) parts.push(fmtOktas(cloud.oktas));
    else if (cloud.nsc) parts.push("Inga betydande moln");
  }
  if (ph) {
    if (ph.value.length) parts.push(...ph.value.map((p) => p.label.toLowerCase()));
    else if (ph.origin.kind === "TAF" || ph.origin.kind === "METAR") parts.push("inget väder av betydelse");
  } else if (snap.forecastSummary) parts.push(snap.forecastSummary.toLowerCase());
  if (!parts.length) return "Uppgift saknas";
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Värde + enhet, samma typografi för alla mått. */
function Val({ v, unit, icon }: { v: string; unit: string; icon?: ReactNode }) {
  return (
    <span className="val">
      {icon}
      {/* "≥" som diskret prefix, inte lika stort som siffran */}
      <b>
        {v.startsWith("≥") ? (
          <>
            <span className="val-prefix">≥</span>
            {v.slice(1)}
          </>
        ) : (
          v
        )}
      </b>
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

/** "≥ 10 km" → { v: "≥ 10", unit: "km" } */
function splitUnit(s: string): { v: string; unit: string } {
  const i = s.lastIndexOf(" ");
  const v = (i < 0 ? s : s.slice(0, i)).replace("≥ ", "≥");
  return { v, unit: i < 0 ? "" : s.slice(i + 1) };
}

function Cell<T>({ label, r, sub, children }: { label: string; r: Reading<T>; sub?: string; children: ReactNode }) {
  return (
    <div className={`cell${r ? "" : " cell-missing"}`}>
      <dt>{label}</dt>
      <dd>
        {r ? children : <span className="val missing-val">{MISSING}</span>}
        {/* Undertexten har alltid reserverad höjd så att rutnätet inte hoppar */}
        <span className="sub">{sub ?? " "}</span>
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detaljvy: exakta värden, tider och källor för vald tid (ingen hover krävs)
// ---------------------------------------------------------------------------

const fmtCoord = (v: number | undefined, h: string) => (v === undefined ? "" : `${v.toFixed(2).replace(".", ",")} ${h}`);

function sourceText(o: Origin, now: number): string {
  switch (o.kind) {
    case "METAR":
      return `METAR ${o.stationId}${o.stationName ? ` ${o.stationName}` : ""} · ${fmtDistance(o.distanceKm ?? 0)} · uppmätt ${fmtTime(o.timestamp)} (${fmtAge(now - o.timestamp)})`;
    case "SMHI":
      return `SMHI-station ${o.stationName ?? o.stationId} · ${fmtDistance(o.distanceKm ?? 0)} · uppmätt ${fmtTime(o.timestamp)} (${fmtAge(now - o.timestamp)})`;
    case "TAF":
      return `TAF ${o.stationId}${o.stationName ? ` ${o.stationName}` : ""} · ${fmtDistance(o.distanceKm ?? 0)} · gäller ${fmtInterval(o.validFrom ?? o.timestamp, o.validTo ?? o.timestamp)}`;
    case "SMHI-PROGNOS":
      return `SMHI-prognos för platsen (${fmtCoord(o.latitude, "N")} ${fmtCoord(o.longitude, "E")}) · kl. ${fmtTime(o.timestamp)}`;
  }
}

function tafChangeLabel(p: TafPeriod): string {
  const iv = fmtInterval(Date.parse(p.from), Date.parse(p.to));
  if (p.change === "TEMPO") return `Tillfälligt ${iv}`;
  if (p.change === "PROB") return `Sannolikhet ${p.probability ?? "?"} % ${iv} för`;
  return iv;
}

function DetailList({ snap, now }: { snap: Snapshot; now: number }) {
  const rows: Array<{ k: string; v: string; src?: string; stale?: boolean }> = [];
  const add = <T,>(k: string, r: Reading<T>, text: (v: T) => string) =>
    rows.push(
      r
        ? {
            k,
            v: text(r.value),
            src: sourceText(r.origin, now),
            stale:
              snap.mode === "now" &&
              (r.origin.kind === "METAR" || r.origin.kind === "SMHI") &&
              now - r.origin.timestamp > STALE_MS,
          }
        : { k, v: MISSING },
    );

  const gustSameSource = snap.gust && snap.wind && snap.gust.origin.stationId === snap.wind.origin.stationId && snap.gust.origin.kind === snap.wind.origin.kind;
  add("Vind", snap.wind, (v) => fmtWindText(v, gustSameSource ? (snap.gust?.value ?? undefined) : undefined));
  if (snap.gust && !gustSameSource)
    add("Byvind", snap.gust, (v) => (v === undefined ? "Inga kraftiga byar rapporterade" : `${fmtWindSpeed(v)} m/s`));
  add("Temperatur", snap.temperature, (v) => `${fmtTemp(v)} °C`);
  add("Sikt", snap.visibility, (v) => fmtVisibility(v.m, v.atLeast));
  add("Moln", snap.cloud, (c) => {
    if (c.cavok) return "CAVOK – inga moln under 1 500 m, ingen CB/TCU";
    if (c.layers?.length)
      return c.layers
        .map((l) =>
          l.cover === "VV"
            ? `vertikal sikt ${fmtCloudBase(l.baseM)}`
            : `${COVER_LABEL[l.cover].toLowerCase()} ${fmtCloudBase(l.baseM)}${l.type ? ` (${l.type})` : ""}`,
        )
        .join(", ")
        .replace(/^./, (x) => x.toUpperCase());
    if (c.baseM !== undefined)
      return `Molnbas ${fmtCloudBase(c.baseM)}${c.oktas !== undefined ? `, ${fmtOktas(c.oktas).toLowerCase()} (${c.oktas}/8)` : ", molnmängd saknas"}`;
    if (c.oktas !== undefined) return `${fmtOktas(c.oktas)} (${c.oktas}/8), ingen molnbas angiven`;
    return c.nsc ? "Inga betydande moln" : MISSING;
  });
  add("Nederbörd", snap.precipitation, (v) => `${fmtPrecip(v.mm)} under ${fmtInterval(v.from, v.to)}`);
  if (snap.precipProbability)
    rows.push({
      k: "Sannolikhet för nederbörd",
      v: `${Math.round(snap.precipProbability.value)} %`,
      src: sourceText(snap.precipProbability.origin, now),
    });
  add("Väder", snap.phenomena, (ph) => (ph.length ? ph.map((p) => p.label).join(", ") : "Inget väder av betydelse"));

  return (
    <section className="details-now" aria-label="Detaljer för vald tid">
      <h2 className="details-title">Detaljer för {snap.mode === "now" ? "senaste observation" : fmtDateTime(snap.time)}</h2>
      <dl className="detail-rows">
        {rows.map((r) => (
          <div key={r.k} className="detail-row">
            <dt>{r.k}</dt>
            <dd>
              <span className="detail-val">{r.v}</span>
              {r.src && (
                <span className={`detail-src${r.stale ? " stale" : ""}`}>
                  {r.src}
                  {r.stale ? " · äldre observation" : ""}
                </span>
              )}
            </dd>
          </div>
        ))}
        {snap.transition && (
          <div className="detail-row taf-extra">
            <dt>Övergång (TAF)</dt>
            <dd>
              <span className="detail-val">
                Någon gång under {fmtInterval(snap.transition.from, snap.transition.until)} övergår det till:{" "}
                {snap.transition.to.summary.replace(/^./, (x) => x.toLowerCase())}
              </span>
              <span className="detail-src">BECMG – exakt tidpunkt anges inte</span>
            </dd>
          </div>
        )}
        {snap.supplements.map((p, i) => (
          <div key={i} className="detail-row taf-extra">
            <dt>{p.change === "TEMPO" ? "Tillfälligt (TAF)" : "Sannolikhet (TAF)"}</dt>
            <dd>
              <span className="detail-val">
                {tafChangeLabel(p)}: {p.summary.replace(/^./, (x) => x.toLowerCase())}
              </span>
              <span className="detail-src">
                {p.change === "TEMPO"
                  ? "TEMPO – tillfälliga förhållanden, inte hela perioden"
                  : `PROB${p.probability} – gäller bara förhållandena ovan, inte nederbörd i allmänhet`}
              </span>
            </dd>
          </div>
        ))}
        {snap.note && (
          <div className="detail-row note">
            <dt>Obs</dt>
            <dd>
              <span className="detail-val">{snap.note}</span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
