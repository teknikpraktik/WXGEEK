import type { Sky } from "@/lib/client/timeline";
import { COVER_LABEL, COVER_OKTAS } from "@/lib/format";

// Ett konsekvent ikonsystem (SVG, ca 24 × 20 px, centrerat i origo):
// SKC sol · FEW sol + litet moln · SCT sol delvis bakom större moln ·
// BKN mest moln med liten solkant · OVC heltäckande moln. Natt: måne i stället för sol.
// CAVOK utan komplement, NSC, okänd mängd och saknade uppgifter får neutrala markeringar.

function Sun({ x = 0, y = 0, r = 5 }: { x?: number; y?: number; r?: number }) {
  return (
    <g className="si-sun" transform={`translate(${x},${y})`}>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <line key={i} x1={Math.cos(a) * (r + 1.8)} y1={Math.sin(a) * (r + 1.8)} x2={Math.cos(a) * (r + 3.8)} y2={Math.sin(a) * (r + 3.8)} />;
      })}
      <circle r={r} />
    </g>
  );
}

function Moon({ x = 0, y = 0, r = 5.5 }: { x?: number; y?: number; r?: number }) {
  // Skära: stor cirkel minus förskjuten cirkel
  return (
    <path
      className="si-moon"
      transform={`translate(${x},${y})`}
      d={`M${r * 0.35},${-r} A${r},${r} 0 1 0 ${r},${r * 0.45} A${r * 0.78},${r * 0.78} 0 0 1 ${r * 0.35},${-r} Z`}
    />
  );
}

/** Moln med platt underkant, skala 1 ≈ 18 × 11 px. Kontur ritas under fyllningen. */
function Cloud({ x = 0, y = 0, k = 1, dark = false }: { x?: number; y?: number; k?: number; dark?: boolean }) {
  const shape = (
    <>
      <circle cx={-4.5} cy={0.5} r={3.8} />
      <circle cx={0.5} cy={-2} r={5.2} />
      <circle cx={5.2} cy={1} r={3.4} />
      <rect x={-4.5} y={0.5} width={9.7} height={3.9} />
    </>
  );
  return (
    <g transform={`translate(${x},${y}) scale(${k})`}>
      <g className="si-cloud-edge">{shape}</g>
      <g className={dark ? "si-cloud dark" : "si-cloud"}>{shape}</g>
    </g>
  );
}

function Label({ text }: { text: string }) {
  return (
    <g className="si-label">
      <rect x={-15} y={-7} width={30} height={14} rx={3} />
      <text y={3.5} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

export function SkyIcon({ sky, day }: { sky: Sky; day: boolean }) {
  const Light = day ? Sun : Moon;
  switch (sky.kind) {
    case "SKC":
      return <Light />;
    case "FEW":
      return (
        <>
          <Light x={-2} y={-2} />
          <Cloud x={4.5} y={4} k={0.55} />
        </>
      );
    case "SCT":
      return (
        <>
          <Light x={-4} y={-4} r={4.5} />
          <Cloud x={2} y={2.5} k={0.85} />
        </>
      );
    case "BKN":
      return (
        <>
          <Light x={-6} y={-5.5} r={3.8} />
          <Cloud x={1} y={1.5} k={1.05} />
        </>
      );
    case "OVC":
      return (
        <>
          <Cloud x={-3} y={-2} k={0.8} dark />
          <Cloud x={2} y={2} k={1.05} dark />
        </>
      );
    case "VV":
      return (
        <g className="si-vv">
          <Cloud x={0} y={-3} k={0.9} dark />
          <line x1={-9} x2={9} y1={6} y2={6} />
          <line x1={-7} x2={7} y1={9} y2={9} />
        </g>
      );
    case "CAVOK":
      return <Label text="CAVOK" />;
    case "NSC":
      return <Label text="NSC" />;
    case "UNKNOWN":
      return <Label text="?" />;
    default:
      return <text className="si-missing" y={4} textAnchor="middle">–</text>;
  }
}

/** Dimma: tre streck (≡), dis: två (=) – ersätter molnsymbolen när sikten är nedsatt av dimma. */
export function FogIcon({ severe }: { severe: boolean }) {
  const rows = severe
    ? [
        [-9, 7, -5],
        [-7, 9, 0],
        [-9, 7, 5],
      ]
    : [
        [-9, 7, -2.5],
        [-7, 9, 2.5],
      ];
  return (
    <g className={severe ? "si-fog severe" : "si-fog"}>
      {rows.map(([x1, x2, y], i) => (
        <line key={i} x1={x1} x2={x2} y1={y} y2={y} />
      ))}
    </g>
  );
}

/** Text for tooltips and screen readers. */
export function skyTitle(sky: Sky): string {
  switch (sky.kind) {
    case "SKC":
      return "Clear sky · SKC · 0/8";
    case "CAVOK":
      return "CAVOK – no cloud below 1,500 m (amount above unknown)";
    case "NSC":
      return "No significant cloud · NSC";
    case "UNKNOWN":
      return "Cloud reported, amount unknown";
    case "MISSING":
      return "No cloud data";
    default: {
      const base = `${COVER_LABEL[sky.kind]} · ${sky.kind} · ${COVER_OKTAS[sky.kind]}`;
      return sky.fromSmhi ? `${base} (SMHI model; CAVOK reported)` : base;
    }
  }
}
