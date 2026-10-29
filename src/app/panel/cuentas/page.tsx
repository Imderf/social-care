import { Suspense } from "react";
import { Circle, CircleAlert, CircleCheck, FlaskConical, GraduationCap, Plug, Radio, UserCheck } from "lucide-react";
import { db } from "@/lib/db";
import { sign } from "@/lib/auth";
import { listAccounts } from "@/lib/data";
import { getLearning } from "@/lib/learning";
import { missingMetaConfig } from "@/lib/meta";
import { disconnect, importHistory, setDays, setMode } from "./actions";
import { currentClient } from "../current";
import { BUTTON, Badge, type BadgeTone, Channel, NoClient, PageHeader, Panel, Skeleton, ago, formatDate } from "../ui";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  conectada: { label: "Conectada", tone: "ok" },
  error: { label: "Con error", tone: "critical" },
  desconectada: { label: "Desconectada", tone: "neutral" },
};

const REQUIREMENTS = [
  "La página y el Instagram están en el portafolio comercial del cliente.",
  "El Instagram es profesional, público y está vinculado a la página.",
  "En Instagram está activo “Permitir acceso a los mensajes”.",
  "Quien conecta tiene control total del portafolio.",
];

const steps = (days: number) => [
  { icon: FlaskConical, title: "1. Modo prueba", text: "Al conectar, la plataforma recibe los comentarios y DM reales y la IA propone la respuesta, pero no publica nada. El equipo la califica en Pruebas y sigue respondiendo desde Meta." },
  { icon: UserCheck, title: "2. Asistido", text: "La IA propone y una persona acepta o corrige en Pruebas; al aceptar, la plataforma publica en Meta. Cada corrección le enseña a la IA cómo responde este cliente." },
  { icon: GraduationCap, title: "3. Automático, por tipo", text: `Cuando la cuenta lleva ${days} días en asistido y un tipo de caso llega a 90 % de acierto con al menos 20 revisiones, ese tipo responde solo. Si el acierto baja, vuelve a pedir aprobación.` },
];

const ERRORS: Record<string, string> = {
  config: "Falta configurar la app de Meta en el servidor.",
  cliente: "No hay un cliente elegido.",
  cancelado: "Se canceló la conexión en Meta. No se conectó nada.",
  estado: "La conexión expiró o no venía de este panel. Vuelve a intentarlo.",
  ticket: "El permiso para conectar venció. Recarga esta página y vuelve a intentarlo.",
  meta: "Meta rechazó la conexión. Revisa que la cuenta tenga control total del portafolio y vuelve a intentarlo.",
};

async function CuentasContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient("config");
  if (!client) return <NoClient />;
  const [accounts, sp, learning] = await Promise.all([listAccounts(db, client.id), searchParams, getLearning(db, client.id)]);
  const missing = missingMetaConfig();
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const connected = Number(sp.conectadas ?? NaN);
  const taken = Number(sp.ocupadas ?? 0);

  return (
    <>
      <PageHeader
        title="Cuentas conectadas"
        description="Las páginas de Facebook y las cuentas de Instagram que atiende la plataforma. Se conectan desde el portafolio comercial del cliente, sin perfiles personales compartidos."
        actions={
          missing.length ? (
            <button type="button" disabled aria-describedby="conectar-ayuda" className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-bold text-white opacity-50">
              <Plug size={16} aria-hidden /> Conectar con Facebook
            </button>
          ) : (
            <form action={`${process.env.APP_BASE_URL}/api/meta/connect`} method="get" className="flex flex-col items-start gap-2 md:items-end">
              <input type="hidden" name="cliente" value={client.id} />
              <input type="hidden" name="ticket" value={sign("conectar", [client.id], 600)} />
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
                <legend className="sr-only">Qué traer al conectar</legend>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="historial" value="0" defaultChecked /> Solo lo nuevo
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="historial" value="30" /> Traer los últimos 30 días
                </label>
              </fieldset>
              <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-[#1877f2] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#0f5fc9]">
                <Plug size={16} aria-hidden /> Conectar con Facebook
              </button>
              {accounts.length > 0 && (
                <p className="max-w-xs text-[12px] text-ink-3 md:text-right">
                  ¿Ya está conectada? Usa el mismo botón para volver a conectarla y actualizar permisos: no se pierde nada ni cambia el modo.
                </p>
              )}
            </form>
          )
        }
      />
      {missing.length > 0 && (
        <p id="conectar-ayuda" className="-mt-3 mb-6 text-[13px] text-ink-3">
          Para habilitar la conexión falta configurar en el servidor: {missing.join(", ")}.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-6 flex items-center gap-2 rounded-lg bg-brand-soft px-4 py-3 text-[14px] text-brand-ink">
          <CircleAlert size={16} aria-hidden className="shrink-0" /> {error}
        </p>
      )}
      {!Number.isNaN(connected) && (
        <p role="status" className="mb-6 flex items-center gap-2 rounded-lg bg-ok-soft px-4 py-3 text-[14px] text-ok">
          <CircleCheck size={16} aria-hidden className="shrink-0" />
          {connected ? `Quedaron conectadas ${connected} cuenta(s) en modo prueba: la plataforma ya recibe y analiza, sin publicar nada.` : "Meta no entregó ninguna página nueva."}
          {connected && sp.historial ? ` Se está trayendo el historial de los últimos ${sp.historial} días.` : ""}
          {taken ? ` ${taken} ya estaba(n) conectada(s) a otro cliente y no se tocaron.` : ""}
        </p>
      )}

      <section aria-label="Cómo pasa una cuenta a responder" className="mb-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
        {steps(learning.days).map(({ icon: Icon, title, text }) => (
          <div key={title} className="bg-surface px-5 py-4">
            <p className="flex items-center gap-2 text-[15px] font-bold">
              <Icon size={17} aria-hidden className="text-ink-3" /> {title}
            </p>
            <p className="mt-1.5 text-[14px] text-ink-2">{text}</p>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Cuentas" className="lg:col-span-2" bodyClass={accounts.length ? "divide-y divide-line" : "p-5"}>
          {accounts.length === 0 ? (
            <div className="py-6 text-center">
              <Plug size={28} className="mx-auto text-ink-3" aria-hidden />
              <p className="mt-3 text-lg font-bold">Ninguna cuenta conectada</p>
              <p className="mx-auto mt-1.5 max-w-md text-[15px] text-ink-3">
                Quien administra el portafolio del cliente hace clic en “Conectar con Facebook” y escoge la página y el Instagram. La cuenta entra en modo prueba.
              </p>
            </div>
          ) : (
            accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <Channel platform={a.platform} />
                <span className="font-bold">{a.name}</span>
                <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                {a.mode === "en_vivo" ? (
                  <Badge tone="s1" icon={Radio}>
                    Asistido: publica lo que apruebes
                  </Badge>
                ) : (
                  <Badge icon={FlaskConical}>Modo prueba: no publica</Badge>
                )}
                {a.platform === "ig" && a.status === "conectada" && (
                  Number(a.has_user_token) ? (
                    <Badge tone="ok">Lee los seguidores de quien comenta</Badge>
                  ) : (
                    <Badge tone="warn">Vuelve a conectarla para leer los seguidores de quien comenta</Badge>
                  )
                )}
                <span className="ml-auto text-[13px] text-ink-3">Último aviso de Meta: {ago(a.last_webhook_at)}</span>
                {a.status === "desconectada" ? (
                  <span className="w-full text-[13px] text-ink-3">Desconectada: no recibe ni publica. Se vuelve a conectar con «Conectar con Facebook».</span>
                ) : (
                <>
                <form action={importHistory}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className={`${BUTTON.secondary} px-3 py-1.5 text-[13px]`} title="Trae comentarios y DM de los últimos 30 días: lo respondido sirve para aprender y medir">
                    {a.backfilled_at ? `Historial traído ${ago(a.backfilled_at)} · volver a traer` : "Traer últimos 30 días"}
                  </button>
                </form>
                <form action={setMode}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="mode" value={a.mode === "en_vivo" ? "prueba" : "en_vivo"} />
                  <button type="submit" className={`${BUTTON.secondary} px-3 py-1.5 text-[13px]`}>{a.mode === "en_vivo" ? "Volver a modo prueba" : "Pasar a asistido"}</button>
                </form>
                <form action={disconnect}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="px-2 py-1.5 text-[13px] font-bold text-ink-3 hover:text-brand-ink" title="Deja de recibir y de publicar en esta cuenta; lo que ya llegó se queda">
                    Desconectar
                  </button>
                </form>
                </>
                )}
              </div>
            ))
          )}
        </Panel>

        <div className="space-y-4">
        <Panel title="Aprendizaje">
          <form action={setDays} className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold text-ink-3">Días en asistido antes de responder solo</span>
              <input type="number" name="days" min={1} max={90} defaultValue={learning.days} className="w-24 rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong" />
            </label>
            <button type="submit" className={`${BUTTON.secondary} px-3 text-[13px]`}>Guardar</button>
          </form>
          <p className="mt-3 text-[13px] text-ink-3">
            {learning.since ? `En asistido desde el ${formatDate(learning.since)}.` : "Ninguna cuenta está en asistido: el periodo de aprendizaje no ha empezado."}
          </p>
        </Panel>
        <Panel title="Qué se responde">
          <ul className="space-y-2.5 text-[14px] text-ink-2">
            <li><strong className="text-ink">Publicaciones orgánicas:</strong> sus comentarios se atienden con la matriz.</li>
            <li>
              <strong className="text-ink">Orgánica mientras está pautada:</strong> sus comentarios nuevos no se responden desde la plataforma y quedan para análisis, marcados «Pautada». En Facebook, cuando Meta avisa que la pauta terminó, la publicación vuelve a responderse; en Instagram Meta no avisa el fin de la pauta.
            </li>
            <li>
              <strong className="text-ink">Anuncios que no salen en la página</strong> (y los comentarios sobre el anuncio en Instagram): tampoco se responden. Quedan para análisis, marcados «En un anuncio».
            </li>
            <li>
              <strong className="text-ink">En los dos casos llega una alerta a la Bandeja</strong> con la prioridad que le da la IA, su borrador para copiar y el enlace para responder desde Meta. El caso se cierra solo cuando el equipo responde en Meta.
            </li>
          </ul>
        </Panel>
        <Panel title="Antes de conectar">
          <ul className="space-y-2.5 text-[14px] text-ink-2">
            {REQUIREMENTS.map((r) => (
              <li key={r} className="flex gap-2">
                <Circle size={14} className="mt-1 shrink-0 text-ink-3" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-lg bg-canvas px-3 py-2.5 text-[13px] text-ink-3">App de Meta: Ogilvy Social Care · ID 1664432482008237 · publicada</p>
        </Panel>
        </div>
      </div>
    </>
  );
}

export default function Cuentas({ searchParams }: PageProps<"/panel/cuentas">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <CuentasContent searchParams={searchParams} />
    </Suspense>
  );
}
