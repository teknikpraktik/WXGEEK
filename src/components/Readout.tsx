"use client";

import type { ReactNode } from "react";
import { fogOf, tafLowVisibility, type Fog, type Reading, type Snapshot } from "@/lib/client/timeline";
import type { CloudLayer } from "@/lib/types";
import {
  COVER_OKTAS,
  fmtCloudBase,
  fmtTime,
  fmtPrecip,
  fmtTemp,
  fmtVisibility,
  fmtWindDeg,
  fmtWindSpeed,
} from "@/lib/format";
import { WindArrow } from "./WindArrow";
import { FogIcon, SkyIcon } from "./SkyIcon";

type Props = {
  snap: Snapshot;
  now: number;
  /** The timeline is rendered below the summary */
  children?: ReactNode;
};

/** Observations older than this are marked as old at NOW. */
const STALE_MS = 90 * 60 * 1000;

export function Readout({ snap, now, children }: Props) {
  const w = snap.wind?.value;
  const gust = snap.gust?.value;
  const pr = snap.precipitation?.value;
  const stale = (r: Reading<unknown>) =>
    snap.mode === "now" && !!r && (r.origin.kind === "METAR" || r.origin.kind === "SMHI") && now - r.origin.timestamp > STALE_MS;
  const cloud = cloudMain(snap);
  // Dimma/dis ersätter molnen, som symbolen i diagrammet; molnen står då i undertexten.
  const fog = fogOf(snap);
  const skyR: Reading<unknown> = fog ? (snap.phenomena ?? snap.visibility) : snap.sky.kind === "MISSING" ? null : snap.cloud;

  return (
    <section className={`readout readout-${snap.mode}`} aria-live="polite">
      <dl className={`readout-grid${pr ? " has-precip" : ""}`}>
        <Cell label="Temp / Dew pt" short="Temp/Dew" r={snap.temperature} old={stale(snap.temperature)} sub={dewSub(snap)}>
          {snap.temperature && (
            <Val
              v={fmtTemp(snap.temperature.value)}
              extra={snap.dewPoint ? `/${fmtTemp(snap.dewPoint.value)}` : undefined}
              muted
              unit="°C"
            />
          )}
        </Cell>
        <Cell label="Wind" r={snap.wind} old={stale(snap.wind)} sub={w ? windSub(w, gust) : undefined}>
          {w && (
            <Val
              v={w.speed !== undefined && w.speed < 0.5 ? "0" : fmtWindSpeed(w.speed)}
              unit="m/s"
              icon={w.deg !== undefined && !w.variable && (w.speed ?? 0) >= 0.5 ? <WindArrow deg={w.deg} size={18} /> : undefined}
            />
          )}
        </Cell>
        <Cell label="Visibility" short="Vis" r={snap.visibility} old={stale(snap.visibility)} sub={visSub(snap)}>
          {snap.visibility && <Val {...splitUnit(fmtVisibility(snap.visibility.value.m, snap.visibility.value.atLeast))} />}
        </Cell>
        <Cell label="Clouds" r={skyR} old={stale(skyR)} sub={fog ? fogSub(fog, snap) : skySub(snap)}>
          <Val
            v={fog ? fog.code : cloud.code}
            // Åttondelarna i enhetens stil – "5–7/8" i full storlek ryms inte bredvid ikonen
            unit={fog ? "" : (cloud.oktas ?? "")}
            icon={
              fog ? (
                <svg className="sky-inline" width={26} height={22} viewBox="-13 -11 26 22" aria-hidden>
                  <FogIcon severe={fog.severe} />
                </svg>
              ) : (
                // Symboler som bara är text (CAVOK, NSC, ?) upprepar värdet – visas inte här.
                !TEXT_SKY.has(snap.sky.kind) && (
                  <svg className="sky-inline" width={26} height={22} viewBox="-13 -11 26 22" aria-hidden>
                    <SkyIcon sky={snap.sky} day={snap.day} />
                  </svg>
                )
              )
            }
          />
        </Cell>
        {/* Precipitation only when there is data; its column is always reserved so the other cells never move */}
        {pr && (
          <Cell label="Precipitation" short="Precip" r={snap.precipitation} old={stale(snap.precipitation)} sub={precipSub(snap)}>
            <Val {...splitUnit(fmtPrecip(pr.mm))} />
          </Cell>
        )}
      </dl>

      <p className="readout-summary">{weatherSummary(snap)}</p>

      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

function windSub(w: { deg?: number; variable?: boolean; speed?: number }, gust: number | undefined): string {
  if (w.speed !== undefined && w.speed < 0.5) return "Calm";
  const dir = w.variable ? "Variable" : w.deg !== undefined ? `From ${fmtWindDeg(w.deg)}` : "";
  const g = gust !== undefined && gust >= (w.speed ?? 0) + 1 ? `gusts ${fmtWindSpeed(gust)} m/s` : "";
  return [dir, g].filter(Boolean).join(" · ");
}

const TEXT_SKY = new Set<Snapshot["sky"]["kind"]>(["CAVOK", "NSC", "UNKNOWN", "MISSING"]);

const skyCode = (k: Snapshot["sky"]["kind"]) => (k === "UNKNOWN" ? "?" : k === "MISSING" ? "–" : k);

/** Lager som huvudvärdet bygger på: ceiling (lägsta BKN/OVC/VV), annars lägsta lagret. */
function mainLayer(snap: Snapshot): CloudLayer | undefined {
  const ls = snap.cloud?.value.layers;
  if (!ls?.length) return undefined;
  return ls.find((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV") ?? ls[0];
}

/**
 * Huvudvärdet: täckning i åttondelar, t.ex. "OVC 8/8" – största kategorin, som symbolen. VV
 * (skymd himmel) står utan åttondelar; höjden står i undertexten.
 */
function cloudMain(snap: Snapshot): { code: string; oktas?: string } {
  const k = snap.sky.kind;
  if (TEXT_SKY.has(k) || k === "SKC" || k === "VV") return { code: skyCode(k) };
  return { code: k, oktas: COVER_OKTAS[k] };
}

/**
 * Undertext: ceiling (lägsta BKN/OVC/VV), annars lägsta molnbasen – t.ex. "Ceiling 340 m" eller
 * "Base 900 m" – och CB/TCU om något lager har det. Övriga lager visas inte. Utan lager:
 * SMHI-prognosens molnbas.
 */
function skySub(snap: Snapshot): string {
  const k = snap.sky;
  switch (k.kind) {
    case "SKC":
      return "Clear sky · 0/8";
    case "CAVOK":
      return "No cloud below 1,500 m";
    case "NSC":
      return "No significant cloud";
    case "UNKNOWN":
      return "Amount unknown";
    case "MISSING":
      return "";
  }
  const main = mainLayer(snap);
  if (!main) {
    // CAVOK kompletterad med SMHI:s molnmängd: inga moln under 1 500 m, oavsett modellens bas.
    if (k.cavok) return "No cloud below 1,500 m";
    const b = snap.cloud?.value.baseM;
    return `${k.kind === "BKN" || k.kind === "OVC" ? "Ceiling" : "Base"} ${b === undefined ? "unknown" : fmtCloudBase(b)}`;
  }
  const layers = snap.cloud?.value.layers ?? [];
  const cb = layers.some((l) => l.type === "CB") ? "CB" : layers.some((l) => l.type === "TCU") ? "TCU" : "";
  return `${main.cover === "FEW" || main.cover === "SCT" ? "Base" : "Ceiling"} ${fmtCloudBase(main.baseM)}${cb ? ` · ${cb}` : ""}`;
}

/** Molnen kort, t.ex. "OVC 520 m" – till undertexten vid dimma. */
function cloudShort(snap: Snapshot): string {
  const k = snap.sky.kind;
  if (k === "MISSING" || k === "UNKNOWN") return "";
  if (TEXT_SKY.has(k) || k === "SKC") return k;
  const l = mainLayer(snap);
  const b = l?.baseM ?? snap.cloud?.value.baseM;
  return b === undefined ? k : `${l?.cover ?? k} ${fmtCloudBase(b)}`;
}

/** Undertext vid dimma: vad det är, TAF-gruppen om den bara är möjlig, och molnen – t.ex. "Fog (PROB40) · OVC 520 m". */
function fogSub(fog: Fog, snap: Snapshot): string {
  return [`${fog.label}${fog.group ? ` (${fog.group})` : ""}`, cloudShort(snap)].filter(Boolean).join(" · ");
}

/** Lägre sikt i TAF:ens TEMPO/PROB vid vald tid, t.ex. "PROB40 300 m". */
function visSub(snap: Snapshot): string {
  const low = tafLowVisibility(snap);
  return low ? `${low.group} ${fmtVisibility(low.m, low.atLeast)}` : "";
}

/** Dimrisk när daggpunkten ligger inom 1° från temperaturen, i hela grader som de visas. */
function dewSub(snap: Snapshot): string {
  const t = snap.temperature?.value;
  const d = snap.dewPoint?.value;
  if (t === undefined || d === undefined) return "";
  return Math.round(t) - Math.round(d) <= 1 ? "Fog risk" : "";
}

function precipSub(snap: Snapshot): string {
  const pr = snap.precipitation?.value;
  if (!pr) return "";
  const iv = `${fmtTime(pr.from)}–${fmtTime(pr.to)}`;
  return snap.precipProbability ? `${iv} · ${Math.round(snap.precipProbability.value)} %` : iv;
}

/** Väder på en egen rad: nederbörd, dimma, åska. Molnen står redan i rutan och upprepas inte här. */
function weatherSummary(snap: Snapshot): string {
  const ph = snap.phenomena;
  if (ph?.value.length) return ph.value.map((p) => p.label).join(", ");
  return " ";
}

/** Value + unit, same typography for all quantities. */
function Val({ v, unit, icon, extra, muted }: { v: string; unit: string; icon?: ReactNode; extra?: string; muted?: boolean }) {
  return (
    <span className="val">
      {icon}
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
      {extra && <b className={muted ? "val-extra val-dew" : "val-extra"}>{extra}</b>}
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

/** "≥ 10 km" → { v: "≥10", unit: "km" } */
function splitUnit(s: string): { v: string; unit: string } {
  const i = s.lastIndexOf(" ");
  const v = (i < 0 ? s : s.slice(0, i)).replace("≥ ", "≥");
  return { v, unit: i < 0 ? "" : s.slice(i + 1) };
}

function Cell<T>({
  label,
  short,
  r,
  sub,
  old,
  children,
}: {
  label: string;
  /** Kortare rubrik på smala skärmar, där rutorna är smala */
  short?: string;
  r: Reading<T>;
  sub?: string;
  old?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`cell${r ? "" : " cell-missing"}${old ? " cell-old" : ""}`}>
      <dt>
        {short ? (
          <>
            <span className="dt-long">{label}</span>
            <span className="dt-short">{short}</span>
          </>
        ) : (
          label
        )}
        {old && (
          <span className="old-flag" title="Observation older than 90 minutes">
            <span className="old-text"> · old</span>
            {/* Smala rutor: en liten klocka i stället för texten, som annars klipper rubriken */}
            <svg className="old-icon" width={9} height={9} viewBox="0 0 10 10" aria-hidden>
              <circle cx={5} cy={5} r={4} />
              <path d="M5 2.6V5l1.7 1.1" />
            </svg>
          </span>
        )}
      </dt>
      <dd>
        {r ? children : <span className="val missing-val">–</span>}
        {/* The sub line always reserves its height so the grid never jumps */}
        <span className="sub" title={sub || undefined}>
          {sub || " "}
        </span>
      </dd>
    </div>
  );
}
