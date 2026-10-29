import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Bot, CircleCheck, CircleX, EyeOff, Megaphone, Minus, PenLine, Star, TrendingUp, UserRound } from "lucide-react";
import { TIER_LABELS, type Tier } from "@/lib/influence";

// Piezas del panel. Superficies blancas con borde fino y esquinas suaves. El rojo queda para el
// logo, el botón principal y lo crítico; cada decisión de la IA tiene un color fijo (el mismo de
// la gráfica): azul la IA responde, naranja pasa a una persona, aqua se oculta.

const dateFmt = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const timeFmt = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
export const formatDate = (d: Date | string | null) => (d ? dateFmt.format(new Date(d)) : "—");

export function ago(d: Date | string | null, now = Date.now()) {
  if (!d) return "—";
  const min = Math.round((now - new Date(d).getTime()) / 6e4);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return min < 48 * 60 ? `ayer, ${timeFmt.format(new Date(d))}` : formatDate(d);
}

export function duration(sec: number | null) {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const BUTTON = {
  primary: "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-ink px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-bold text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
};

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-[55ch] text-[15px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, action, children, className = "", bodyClass = "p-5" }: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-bold">{title}</h2>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

// Variación contra el periodo anterior. `goodWhenUp` decide si subir es bueno (verde), malo (rojo) o neutro (null).
// mode "points": diferencia en puntos porcentuales (para tasas); "relative": cambio porcentual.
export function Delta({ now, before, goodWhenUp = true, mode = "relative" }: { now: number; before: number | null; goodWhenUp?: boolean | null; mode?: "relative" | "points" }) {
  if (!before) return <span className="text-[13px] text-ink-3">sin datos del periodo anterior</span>;
  const change = Math.round(mode === "points" ? now - before : ((now - before) / before) * 100);
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-ink-3">
        <Minus size={14} aria-hidden /> igual que el periodo anterior
      </span>
    );
  }
  const tone = goodWhenUp === null ? "text-ink-2" : change > 0 === goodWhenUp ? "text-ok" : "text-brand-ink";
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-[13px]">
      <span className={`inline-flex items-center font-bold ${tone}`}>
        <Icon size={14} aria-hidden />
        {Math.abs(change)}
        {mode === "points" ? (Math.abs(change) === 1 ? " punto" : " puntos") : " %"}
      </span>
      <span className="text-ink-3">vs. periodo anterior</span>
    </span>
  );
}

const BADGE = {
  neutral: "bg-canvas text-ink-2 ring-line",
  critical: "bg-brand-soft text-brand-ink ring-brand/25",
  solid: "bg-ink text-white ring-ink",
  ok: "bg-ok-soft text-ok ring-ok/20",
  warn: "bg-warn-soft text-warn ring-warn/25",
  s1: "bg-[#eaf2fc] text-[#1d5aa6] ring-s1/25",
  s2: "bg-[#fdf0ea] text-[#a8441b] ring-s2/25",
  s3: "bg-[#e8f7f1] text-[#0f6e4c] ring-s3/25",
};
export type BadgeTone = keyof typeof BADGE;

export function Badge({ children, tone = "neutral", icon: Icon, wrap = false }: { children: React.ReactNode; tone?: BadgeTone; icon?: LucideIcon; wrap?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ring-1 ring-inset ${wrap ? "" : "whitespace-nowrap"} ${BADGE[tone]}`}>
      {Icon && <Icon size={13} aria-hidden className="shrink-0" />}
      {children}
    </span>
  );
}

// Un solo color por decisión, en todo el panel y en la gráfica.
export const DECISION: Record<string, { label: string; live: string; tone: BadgeTone; icon: LucideIcon }> = {
  responder: { label: "Respondería", live: "Respondió", tone: "s1", icon: Bot },
  escalar: { label: "A una persona", live: "A una persona", tone: "s2", icon: UserRound },
  ocultar: { label: "Ocultaría", live: "Ocultó", tone: "s3", icon: EyeOff },
  ignorar: { label: "Sin contenido", live: "Sin contenido", tone: "neutral", icon: Minus },
};

export const AUTONOMY: Record<string, { label: string; tone: BadgeTone; icon: LucideIcon; help: string }> = {
  automatica: { label: "Automática", tone: "s1", icon: Bot, help: "La IA responde sola si la confianza supera el umbral, la respuesta sale de una plantilla o de la base de conocimiento y no hay señales de riesgo." },
  humana: { label: "Humana", tone: "s2", icon: UserRound, help: "Siempre la atiende una persona; la IA solo avisa y sugiere un borrador." },
  escala: { label: "Escala", tone: "neutral", icon: UserRound, help: "Lo que la IA no logra clasificar con seguridad: pasa a la bandeja." },
};

export const VERDICT: Record<string, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  correcta: { label: "Correcta", tone: "ok", icon: CircleCheck },
  corregir: { label: "Corregir", tone: "warn", icon: PenLine },
  incorrecta: { label: "Incorrecta", tone: "critical", icon: CircleX },
};

export const PRIORITY = {
  critica: { label: "Crítica", tone: "critical" },
  alta: { label: "Alta", tone: "solid" },
  normal: { label: "Normal", tone: "neutral" },
} as const;

// En Instagram es la cuenta (@usuario); en Facebook, el nombre. Meta no siempre lo da.
export const personName = (p: { platform: string; username?: string | null }) =>
  p.username ? (p.platform === "ig" ? `@${p.username}` : p.username) : "Sin nombre de Meta";

// En pasado solo si la plataforma ya lo hizo (publicó o ocultó); si no, lo que haría.
export function decisionLabel(r: { decision: string; answered_by?: string | null; hide_status?: string | null }) {
  const d = DECISION[r.decision];
  const done = r.decision === "responder" ? r.answered_by === "ia" : r.decision === "ocultar" ? r.hide_status === "hecha" : true;
  return done ? d.live : d.label;
}

// Solo lo orgánico se responde: el comentario en un anuncio, o en una publicación mientras está
// pautada, queda para análisis (lib/meta.ts).
export function OriginBadge({ origin }: { origin?: string | null }) {
  if (origin === "anuncio") return <Badge tone="warn" icon={Megaphone}>En un anuncio · no se responde</Badge>;
  if (origin === "pautada") return <Badge tone="warn" icon={Megaphone}>Pautada · no se responde</Badge>;
  return null;
}

// Perfil de quien escribe: persona importante, nivel de influencia y tipo de cuenta (lib/influence.ts).
const ACCOUNT_TYPES: Record<string, string> = { personal: "Cuenta personal", empresa_creador: "Cuenta de empresa o creador", pagina: "Página de Facebook", persona: "Persona" };
export function ProfileBadges({ tier, accountType, important }: { tier?: Tier | null; accountType?: string | null; important?: boolean }) {
  return (
    <>
      {important && <Badge tone="critical" icon={Star}>Persona importante</Badge>}
      {tier && tier !== "comun" && (
        <Badge tone={tier === "macro" || tier === "mega" ? "critical" : "warn"} icon={TrendingUp}>
          {TIER_LABELS[tier]}
        </Badge>
      )}
      {accountType && ACCOUNT_TYPES[accountType] && <Badge>{ACCOUNT_TYPES[accountType]}</Badge>}
    </>
  );
}

export function Channel({ platform, kind, rating }: { platform: string; kind?: string; rating?: number | null }) {
  const ig = platform === "ig";
  const google = platform === "gbp";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-2">
      <span aria-hidden className={`grid size-5 place-items-center rounded-md text-[10px] font-bold text-white ${google ? "bg-[#4285f4]" : ig ? "bg-[#c13584]" : "bg-[#1877f2]"}`}>
        {google ? "G" : ig ? "IG" : "f"}
      </span>
      {google ? "Google" : ig ? "Instagram" : "Facebook"}
      {kind && <span className="text-ink-3">· {kind === "dm" ? "DM" : kind === "resena" ? "reseña" : "comentario"}</span>}
      {rating ? <Stars rating={rating} /> : null}
    </span>
  );
}

// Las estrellas de una reseña de Google.
export function Stars({ rating }: { rating: number | null | undefined }) {
  if (!rating) return null;
  return (
    <span className="inline-flex items-center text-[13px] leading-none text-[#b8860b]" role="img" aria-label={`${rating} de 5 estrellas`}>
      {"★".repeat(rating)}
      <span className="text-line-strong">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

// Iniciales y un tono estable por usuario, para distinguir de un vistazo quién escribe.
const AVATAR_TONES = ["bg-[#eaf2fc] text-[#1d5aa6]", "bg-[#fdf0ea] text-[#a8441b]", "bg-[#e8f7f1] text-[#0f6e4c]", "bg-[#f3eefc] text-[#5b3fb8]", "bg-canvas text-ink-2"];
export function Avatar({ name, size = "size-9" }: { name?: string | null; size?: string }) {
  const clean = (name ?? "?").replace(/[^a-záéíóúñ]/gi, " ").trim();
  const parts = clean.split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  const tone = AVATAR_TONES[[...(name ?? "")].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden className={`grid ${size} shrink-0 place-items-center rounded-full text-[13px] font-bold ${tone}`}>
      {initials}
    </span>
  );
}

export function Segmented({ options, value, label }: { options: { href: string; label: string; value: string; count?: number }[]; value: string; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          aria-current={o.value === value ? "true" : undefined}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-bold transition-colors ${o.value === value ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas"}`}
        >
          {o.label}
          {o.count !== undefined && <span className={o.value === value ? "text-white/75" : "text-ink-3"}>{o.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Empty({ title, children, action, icon: Icon }: { title: string; children: React.ReactNode; action?: { href: string; label: string }; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      {Icon && <Icon size={28} className="mx-auto text-ink-3" aria-hidden />}
      <p className="mt-3 text-lg font-bold">{title}</p>
      <div className="mx-auto mt-1.5 max-w-lg text-[15px] text-ink-3">{children}</div>
      {action && (
        <Link href={action.href} className={`mt-5 ${BUTTON.primary}`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

// Resalta las variables {usuario} y {nombre} dentro del texto de una plantilla.
export function TemplateText({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">
      {body.split(/(\{\w+\})/).map((part, i) =>
        /^\{\w+\}$/.test(part) ? (
          <span key={i} className="mx-0.5 rounded bg-canvas px-1.5 py-0.5 text-[13px] font-bold text-ink ring-1 ring-line ring-inset">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="animate-pulse">
      <div className="mb-6 h-8 w-56 rounded-lg bg-line" />
      <div className="h-24 rounded-xl border border-line bg-surface" />
      <div className="mt-4 h-72 rounded-xl border border-line bg-surface" />
    </div>
  );
}
