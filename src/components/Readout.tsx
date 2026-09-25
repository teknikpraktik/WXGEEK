"use client";

import type { ReactNode } from "react";
import { fogOf, tafLowVisibility, type Reading, type Snapshot } from "@/lib/client/timeline";
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
  // Nederbördsrutan bara när det faktiskt faller något (mer än 0 mm) vid vald tid.
  const pr = snap.precipitation && snap.precipitation.value.mm > 0 ? snap.precipitation.value : undefined;
  const stale = (r: Reading<unknown>) =>
    snap.mode === "now" && !!r && (r.origin.kind === "METAR" || r.origin.kind === "SMHI") && now - r.origin.timestamp > STALE_MS;
  // Dimma/dis ersätter molnen, som symbolen i diagrammet; höjden står kvar på rad 3.
  const fog = fogOf(snap);
  const skyR: Reading<unknown> = fog ? (snap.phenomena ?? snap.visibility) : snap.sky.kind === "MISSING" ? null : snap.cloud;
  // Molnrutans rader 2–3: mängden (vid dimma TAF-gruppen) och höjden; tomma rader hoppas över.
  const cloudSecond = fog ? fog.group : cloudAmount(snap);
  const height = cloudHeight(snap);
  const cloudIcon = fog ? (
    <FogIcon severe={fog.severe} />
  ) : (
    // Symboler som bara är text (CAVOK, NSC, ?) upprepar koden – visas inte.
    !TEXT_SKY.has(snap.sky.kind) && <SkyIcon sky={snap.sky} day={snap.day} />
  );

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
        {/* Tre rader inom samma höjd som övriga rutor: [symbol] kod / åttondelar / höjd */}
        <Cell label="Clouds" className="cell-clouds" r={skyR} old={stale(skyR)} sub={null}>
          <span className="cloud-main">
            {cloudIcon && (
              <svg className="cloud-icon" viewBox="-13 -11 26 22" aria-hidden>
                {cloudIcon}
              </svg>
            )}
            <b>{fog ? fog.code : skyCode(snap.sky.kind)}</b>
          </span>
          {cloudSecond && <span className="cloud-line">{cloudSecond}</span>}
          {height && (
            // Ensam rad (t.ex. CAVOK: "None below 1500 m") får bryta över två rader.
            <span className={cloudSecond ? "cloud-line" : "cloud-line wrap"}>
              <HeightText h={height} />
            </span>
          )}
        </Cell>
        {/* Precipitation only when something falls (> 0 mm); on desktop its column is always reserved so the other cells never move */}
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
  const dir = w.variable ? "Variable" : w.deg !== undefined ? fmtWindDeg(w.deg) : "";
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

// Molnrutan i tre rader: koden (största kategorin, som symbolen), mängden i åttondelar och
// höjden. Ingen rad upprepar en annan i ord.

/** Rad 2: mängden i åttondelar, t.ex. "5–7/8", och CB/TCU om något lager har det. */
function cloudAmount(snap: Snapshot): string {
  const k = snap.sky.kind;
  const oktas = k === "SKC" ? "0/8" : TEXT_SKY.has(k) || k === "VV" ? "" : COVER_OKTAS[k];
  const layers = snap.cloud?.value.layers ?? [];
  const cb = layers.some((l) => l.type === "CB") ? "CB" : layers.some((l) => l.type === "TCU") ? "TCU" : "";
  return [oktas, cb].filter(Boolean).join(" · ");
}

type CloudHeight = { word: "Ceiling" | "Base" | "None below"; value: string };

/**
 * Rad 3: hur lågt – ceiling (lägsta BKN/OVC/VV) eller lägsta bas, t.ex. "Ceiling 340 m" eller
 * "Base 900 m". CAVOK/NSC: inga moln under 1 500 m. Klart eller okänd höjd: ingen rad.
 */
function cloudHeight(snap: Snapshot): CloudHeight | null {
  const k = snap.sky;
  if (k.kind === "CAVOK" || k.kind === "NSC") return { word: "None below", value: fmtCloudBase(1500) };
  if (k.kind === "SKC" || k.kind === "MISSING") return null;
  const main = mainLayer(snap);
  if (!main) {
    const word = k.kind === "BKN" || k.kind === "OVC" ? "Ceiling" : "Base";
    // CAVOK kompletterad med SMHI:s molnmängd: molnen ligger över 1 500 m, oavsett modellens bas.
    // "≥1500 m" utan mellanslag, som "≥10 km" i siktrutan – ryms då i smal kolumn på 320 px.
    if (k.cavok) return { word, value: `≥${fmtCloudBase(1500)}` };
    const b = snap.cloud?.value.baseM;
    return b === undefined ? null : { word, value: fmtCloudBase(b) };
  }
  return { word: main.cover === "FEW" || main.cover === "SCT" ? "Base" : "Ceiling", value: fmtCloudBase(main.baseM) };
}

/** "Ceiling 850 m" – "Ceil." när nederbördsrutan gör molnkolumnen smal på mobil; siffran kapas aldrig. */
function HeightText({ h }: { h: CloudHeight }) {
  return (
    <>
      {h.word === "Ceiling" ? (
        <>
          <span className="w-long">Ceiling</span>
          <span className="w-short">Ceil.</span>
        </>
      ) : (
        h.word
      )}{" "}
      {h.value}
    </>
  );
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
  className,
  r,
  sub,
  old,
  children,
}: {
  label: string;
  /** Kortare rubrik på smala skärmar, där rutorna är smala */
  short?: string;
  /** Extra klass, t.ex. för molnrutans tre rader */
  className?: string;
  r: Reading<T>;
  /** Undertext; null = ingen undertextrad (rutan lägger själv ut sina rader inom samma höjd) */
  sub?: string | null;
  old?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`cell${className ? ` ${className}` : ""}${r ? "" : " cell-missing"}${old ? " cell-old" : ""}`}>
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
        {sub !== null && (
          <span className="sub" title={sub || undefined}>
            {sub || " "}
          </span>
        )}
      </dd>
    </div>
  );
}
