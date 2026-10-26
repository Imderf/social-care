// Gráficas en SVG renderizadas en el servidor (sin librería). Reglas de la skill dataviz:
// orden fijo de color por serie, marcas delgadas, 2 px de separación entre segmentos apilados,
// extremos redondeados de 4 px, rejilla discreta, leyenda con valores y vista en tabla.

// Mismo orden y color que DECISION en ui.tsx.
export const SERIES = {
  responder: { label: "La IA responde", color: "var(--color-s1)" },
  escalar: { label: "Pasa a una persona", color: "var(--color-s2)" },
  ocultar: { label: "Se oculta", color: "var(--color-s3)" },
} as const;
type Key = keyof typeof SERIES;
type Series<K extends string> = Record<K, { label: string; color: string }>;

// Sentimiento de lo que escribe la gente. Rojo no: queda para la marca.
export const SENTIMENT_SERIES = {
  positivo: { label: "Positivo", color: "var(--color-s3)" },
  neutral: { label: "Neutral", color: "var(--color-ink-3)" },
  negativo: { label: "Negativo", color: "var(--color-s2)" },
} as const;

const dayFmt = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short" });
const dayLabel = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`)).replace(".", "");

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / (v / p > 5 ? 2 : 1)) * p * (v / p > 5 ? 2 : 1);
}

export function StackedBars<K extends string = Key>({
  data,
  series = SERIES as unknown as Series<K>,
  label = "Comentarios y mensajes por día, según lo que hace la IA",
}: {
  data: ({ day: string } & Record<NoInfer<K>, number>)[];
  series?: Series<K>;
  label?: string;
}) {
  const SERIES = series;
  const keys = Object.keys(SERIES) as K[];
  const W = 760;
  const H = 260;
  const pad = { l: 36, r: 8, t: 12, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const totals = data.map((d) => keys.reduce((s, k) => s + d[k], 0));
  const max = niceMax(Math.max(...totals, 1));
  const slot = innerW / data.length;
  const barW = Math.min(28, slot * 0.62);
  const y = (v: number) => (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + innerH - y(t)} y2={pad.t + innerH - y(t)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={pad.l - 8} y={pad.t + innerH - y(t) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + i * slot + (slot - barW) / 2;
        let base = pad.t + innerH;
        const segments = keys.filter((k) => d[k] > 0);
        const tip = `${dayLabel(d.day)} · ${totals[i]} recibidos\n${keys.map((k) => `${SERIES[k].label}: ${d[k]}`).join("\n")}`;
        return (
          <g key={d.day} className="transition-opacity [svg:hover_&]:opacity-55 hover:opacity-100!">
            <title>{tip}</title>
            <rect x={pad.l + i * slot} y={pad.t} width={slot} height={innerH} fill="transparent" />
            {segments.map((k, j) => {
              const h = Math.max(y(d[k]) - (j < segments.length - 1 ? 2 : 0), 1);
              base -= y(d[k]);
              const top = j === segments.length - 1;
              const yTop = base + (j < segments.length - 1 ? 2 : 0);
              return top ? (
                <path key={k} d={roundedTop(x, base, barW, y(d[k]), 4)} fill={SERIES[k].color} />
              ) : (
                <rect key={k} x={x} y={yTop} width={barW} height={h} fill={SERIES[k].color} />
              );
            })}
            {i % labelEvery === 0 && (
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">
                {dayLabel(d.day)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Rectángulo con solo las esquinas de arriba redondeadas (extremo de dato), base recta en el eje.
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function Legend<K extends string = Key>({ totals, series = SERIES as unknown as Series<K> }: { totals: Record<NoInfer<K>, number>; series?: Series<K> }) {
  const SERIES = series;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
      {(Object.keys(SERIES) as K[]).map((k) => (
        <li key={k} className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: SERIES[k].color }} />
          <span className="text-ink-2">{SERIES[k].label}</span>
          <span className="font-bold tabular-nums">{totals[k]}</span>
        </li>
      ))}
    </ul>
  );
}

export function DataTable<K extends string = Key>({ data, series = SERIES as unknown as Series<K> }: { data: ({ day: string } & Record<NoInfer<K>, number>)[]; series?: Series<K> }) {
  const SERIES = series;
  const keys = Object.keys(SERIES) as K[];
  return (
    <details className="group mt-3 text-[13px]">
      <summary className="cursor-pointer text-ink-3 hover:text-ink">Ver como tabla</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
        <table className="w-full text-left tabular-nums">
          <thead className="sticky top-0 bg-canvas text-ink-3">
            <tr>
              <th className="px-3 py-2 font-bold">Día</th>
              {keys.map((k) => (
                <th key={k} className="px-3 py-2 text-right font-bold">
                  {SERIES[k].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="px-3 py-1.5">{dayLabel(d.day)}</td>
                {keys.map((k) => (
                  <td key={k} className="px-3 py-1.5 text-right">
                    {d[k]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// Barra horizontal del sentimiento de un grupo (canal, tipo de pieza o publicación).
export function SentimentBar({ counts }: { counts: { positivo: number; neutral: number; negativo: number } }) {
  const keys = Object.keys(SENTIMENT_SERIES) as (keyof typeof SENTIMENT_SERIES)[];
  const total = keys.reduce((s, k) => s + counts[k], 0);
  if (!total) return <span className="text-[12px] text-ink-3">Sin clasificar</span>;
  return (
    <span className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" title={keys.map((k) => `${SENTIMENT_SERIES[k].label}: ${counts[k]}`).join(" · ")}>
      {keys.filter((k) => counts[k]).map((k) => (
        <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: SENTIMENT_SERIES[k].color }} />
      ))}
    </span>
  );
}
