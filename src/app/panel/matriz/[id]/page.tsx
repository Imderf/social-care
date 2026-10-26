import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bell, Bot, CircleAlert, CircleHelp, ClipboardList, Database, MessageCircle, Plus, Send, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { getCaseType, listKnowledge, listTemplates } from "@/lib/data";
import { ALERT_LEVELS, ALERT_WHEN, AMBIGUOUS, AMBIGUOUS_HELP, ASK_FIELDS, PRIVATE_HELP, PRIVATE_MODES, PUBLIC_HELP, PUBLIC_MODES, RECORDS, TOPICS, ambiguousOf, inferFlow, templateVars } from "@/lib/flow";
import { currentClient } from "../../current";
import { AUTONOMY, BUTTON, NoClient, PageHeader, Skeleton } from "../../ui";
import { saveType } from "../actions";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const OPTION = "flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-[14px] has-[:checked]:border-ink has-[:checked]:bg-canvas";

// Un paso del flujo. Lo que depende de una opción (data-when) se muestra solo cuando está elegida (globals.css).
function Step({ n, icon: Icon, title, help, children }: { n: number; icon: LucideIcon; title: string; help: string; children: React.ReactNode }) {
  return (
    <li className="flow-step relative min-w-0 pl-12">
      <span className="absolute top-0 left-0 grid h-8 w-8 place-items-center rounded-full bg-ink text-[13px] font-bold text-white">{n}</span>
      <span aria-hidden className="absolute top-9 bottom-[-1.25rem] left-4 w-px bg-line" />
      {/* min-w-0: un fieldset no se encoge por debajo de su contenido y los textos largos lo desbordan. */}
      <fieldset className="min-w-0 rounded-xl border border-line bg-surface p-5">
        <legend className="sr-only">{title}</legend>
        <p className="flex items-center gap-2 text-[15px] font-bold">
          <Icon size={17} aria-hidden className="text-ink-3" /> {title}
        </p>
        <p className="mt-1 mb-3 text-[13px] text-ink-3">{help}</p>
        <div className="space-y-3">{children}</div>
      </fieldset>
    </li>
  );
}

function Choices<T extends Record<string, string>>({ name, options, value, help }: { name: string; options: T; value: string; help?: Partial<Record<keyof T, string>> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.entries(options).map(([v, label]) => (
        <label key={v} className={OPTION}>
          <input type="radio" name={name} value={v} defaultChecked={value === v} className="mt-1" />
          <span className="min-w-0">
            <span className="block">{label}</span>
            {help?.[v as keyof T] && <span className="mt-0.5 block text-[12px] text-ink-3">{help[v as keyof T]}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

// Plantillas que ya existen para el canal. Si no hay o falta la que se necesita, se crea primero.
function TemplatePicker({ name, templates, selected, channel, back }: { name: string; templates: Record<string, any>[]; selected: string[]; channel: "publico" | "dm"; back: string }) {
  const create = `/panel/plantillas?nueva=${channel}&volver=${encodeURIComponent(back)}#nueva`;
  return (
    <div data-when="plantilla" className="space-y-2">
      <p className="text-[13px] font-bold text-ink-3">Plantillas {channel === "dm" ? "del DM" : "públicas"}: ponen el texto y el tono</p>
      {templates.length === 0 && <p className="text-[13px] text-ink-3">Todavía no hay plantillas {channel === "dm" ? "de DM" : "públicas"}.</p>}
      <div className="grid gap-2">
        {templates.map((t) => (
          <label key={t.id} className={OPTION}>
            <input type="checkbox" name={name} value={t.code} defaultChecked={selected.includes(t.code)} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="font-bold">{t.code}</span> · {t.name}
              <span className="line-clamp-2 text-[12px] text-ink-3">{t.body}</span>
              {templateVars(t.body).length > 0 && <span className="block text-[12px] font-bold text-ink-2">Necesita datos de la base: {templateVars(t.body).join(", ")}</span>}
            </span>
          </label>
        ))}
      </div>
      <Link href={create} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-2 hover:text-ink">
        <Plus size={14} aria-hidden /> ¿No está la que necesitas? Créala primero en Plantillas
      </Link>
    </div>
  );
}

// Temas de la Base de conocimiento de los que la respuesta puede sacar datos. Con plantilla, llenan sus
// variables o agregan el dato puntual; sin plantilla, la respuesta es corta y con el dato.
function TopicPicker({ name, selected, counts }: { name: string; selected: string[]; counts: Record<string, number> }) {
  return (
    <div data-when="plantilla" className="space-y-2">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-3">
        <Database size={14} aria-hidden /> Datos de la base de conocimiento: ponen el dato puntual
      </p>
      <p className="text-[12px] text-ink-3">La IA solo saca datos de los temas que marques. Si el dato no está, no lo inventa: pasa a una persona.</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(TOPICS).map(([v, label]) => (
          <label key={v} className={`${OPTION} py-1.5`}>
            <input type="checkbox" name={name} value={v} defaultChecked={selected.includes(v)} className="mt-0.5" />
            <span>
              {label} <span className="text-[12px] text-ink-3">{counts[v] ? `(${counts[v]})` : "(vacío)"}</span>
            </span>
          </label>
        ))}
      </div>
      <Link href="/panel/conocimiento" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-2 hover:text-ink">
        <Plus size={14} aria-hidden /> Cargar datos en la Base de conocimiento
      </Link>
    </div>
  );
}

async function EditorContent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient();
  if (!client) return <NoClient />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const isNew = id === "nuevo";
  const [t, templates, knowledge] = await Promise.all([isNew ? null : getCaseType(db, client.id, Number(id)), listTemplates(db, client.id), listKnowledge(db, client.id)]);
  const counts: Record<string, number> = {};
  for (const k of knowledge) counts[k.topic] = (counts[k.topic] ?? 0) + 1;
  if (!isNew && !t) notFound();
  const flow = inferFlow((t as any) ?? { public_action: null, private_action: null, record_target: null, alert: null }, templates as any);
  const ambiguous = ambiguousOf(flow);
  const back = `/panel/matriz/${isNew ? "nuevo" : t!.id}`;
  const error = typeof sp.error === "string" ? sp.error : null;
  const publicTemplates = templates.filter((x) => x.channel === "publico");
  const dmTemplates = templates.filter((x) => x.channel === "dm");

  return (
    <>
      <Link href="/panel/matriz" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-ink-3 hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Matriz de respuesta
      </Link>
      <PageHeader
        title={isNew ? "Nuevo tipo de caso" : t!.name}
        description="Se arma por selecciones, de arriba abajo: cómo se reconoce el mensaje, cuánto decide la IA y qué hace la plataforma. Las plantillas se eligen de las que existen. Los cambios aplican desde la siguiente clasificación."
      />
      {error && (
        <p role="alert" className="mb-5 flex max-w-3xl items-center gap-2 rounded-lg bg-brand-soft px-4 py-3 text-[14px] text-brand-ink">
          <CircleAlert size={16} aria-hidden className="shrink-0" /> {error}
        </p>
      )}

      <form action={saveType} className="max-w-3xl min-w-0">
        {!isNew && <input type="hidden" name="id" value={t!.id} />}
        <ol className="space-y-5">
          <Step n={1} icon={Tag} title="Cuando el mensaje es…" help="Con esto la IA reconoce el caso. Los ejemplos reales ayudan más que las descripciones largas.">
            <input name="name" required defaultValue={t?.name ?? ""} placeholder="Nombre, por ejemplo: Medicamento pendiente" aria-label="Nombre" className={FIELD} />
            <textarea name="description" rows={2} defaultValue={t?.description ?? ""} placeholder="Descripción corta (opcional)" aria-label="Descripción" className={FIELD} />
            <textarea name="examples" rows={4} defaultValue={(t?.examples ?? []).join("\n")} placeholder="Ejemplos reales, uno por línea" aria-label="Ejemplos" className={FIELD} />
            {!isNew && <p className="text-[12px] text-ink-3">Clave para la IA: {t!.code}</p>}
          </Step>

          <Step n={2} icon={Bot} title="La IA decide" help="Automática: responde sola cuando cumple el umbral y el tipo ya graduó en asistido. Humana: siempre una persona. Escala: va a la bandeja.">
            <div className="grid gap-2 sm:grid-cols-3">
              {(["automatica", "humana", "escala"] as const).map((a) => (
                <label key={a} className={OPTION}>
                  <input type="radio" name="autonomy" value={a} defaultChecked={(t?.autonomy ?? "automatica") === a} className="mt-1" />
                  <span>
                    <span className="block font-bold">{AUTONOMY[a].label}</span>
                    <span className="block text-[12px] text-ink-3">{AUTONOMY[a].help}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="rounded-lg bg-canvas px-3 py-3">
              <label className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
                Umbral de confianza
                <select name="threshold" defaultValue={String(Math.round(Number(t?.threshold ?? 0.85) * 100))} className={`${FIELD} w-24 font-normal`}>
                  {[70, 75, 80, 85, 90, 95].map((v) => (
                    <option key={v} value={v}>{v} %</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-[13px] text-ink-2">
                Con cada mensaje, la IA dice de qué tipo de caso es y qué tan segura está. Si está por debajo de este porcentaje, el mensaje no se trata como este
                tipo: pasa a una persona en la Bandeja.
              </p>
              <p className="mt-1 text-[13px] text-ink-3">
                Ejemplo con 85 %: «es este caso, 92 % segura» → se responde con su plantilla. «Es este caso, 70 % segura» → lo atiende una persona. Más alto: menos
                respuestas automáticas y menos errores.
              </p>
            </div>
          </Step>

          <Step n={3} icon={MessageCircle} title="Responde en público" help="Qué se contesta en el comentario. En DM este paso no aplica.">
            <Choices name="public_mode" options={PUBLIC_MODES} value={flow.public.mode} help={PUBLIC_HELP} />
            <TemplatePicker name="public_templates" templates={publicTemplates} selected={flow.public.templates} channel="publico" back={back} />
            <TopicPicker name="public_base" selected={flow.public.base} counts={counts} />
            <label className="inline-flex items-center gap-2 text-[14px] text-ink-2">
              <input type="checkbox" name="like" defaultChecked={flow.public.like} /> Además, dar me gusta en Facebook
            </label>
          </Step>

          <Step n={4} icon={Send} title="Manda por DM" help="El mensaje privado. Meta permite uno solo por comentario hasta que la persona conteste.">
            <Choices name="private_mode" options={PRIVATE_MODES} value={flow.private.mode} help={PRIVATE_HELP} />
            <TemplatePicker name="private_templates" templates={dmTemplates} selected={flow.private.templates} channel="dm" back={back} />
            <TopicPicker name="private_base" selected={flow.private.base} counts={counts} />
            <div data-when="plantilla pedir" className="space-y-2">
              <p className="text-[13px] font-bold text-ink-3">Qué datos pide</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ASK_FIELDS).map(([v, label]) => (
                  <label key={v} className={`${OPTION} py-1.5`}>
                    <input type="checkbox" name="ask" value={v} defaultChecked={flow.private.ask.includes(v as any)} className="mt-0.5" />
                    <span className="first-letter:uppercase">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </Step>

          <Step
            n={5}
            icon={CircleHelp}
            title="Si falta saber qué caso es"
            help="Para preguntas abiertas cuya respuesta depende de algo que la persona no dijo (¿es por su EPS o una compra?, ¿en qué ciudad?). La IA nunca completa con datos que no estén en las plantillas o en la base."
          >
            <p className="text-[13px] font-bold text-ink-3">En comentarios</p>
            <Choices name="amb_comentario" options={AMBIGUOUS} value={ambiguous.comentario} help={AMBIGUOUS_HELP} />
            <p className="text-[13px] font-bold text-ink-3">Por DM</p>
            <Choices name="amb_dm" options={AMBIGUOUS} value={ambiguous.dm} help={AMBIGUOUS_HELP} />
          </Step>

          <Step n={6} icon={ClipboardList} title="Registra en" help="Dónde queda el caso para el seguimiento del cliente.">
            <Choices name="record" options={RECORDS} value={flow.record} />
          </Step>

          <Step n={7} icon={Bell} title="Avisa" help="Si hay que alertar al equipo y cuándo.">
            <Choices name="alert_level" options={ALERT_LEVELS} value={flow.alert.level} />
            <label data-when="aviso" className="block text-[14px] text-ink-2">
              Cuándo
              <select name="alert_when" defaultValue={flow.alert.when} className={`${FIELD} mt-1`}>
                {Object.entries(ALERT_WHEN).map(([v, label]) => (
                  <option key={v} value={v} className="first-letter:uppercase">{label.charAt(0).toUpperCase() + label.slice(1)}</option>
                ))}
              </select>
            </label>
          </Step>
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-[14px] text-ink-2">
            <input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Activo (la IA lo usa)
          </label>
          <button type="submit" className={BUTTON.primary}>{isNew ? "Crear tipo de caso" : "Guardar cambios"}</button>
          <Link href="/panel/matriz" className={BUTTON.secondary}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}

export default function Editor({ params, searchParams }: PageProps<"/panel/matriz/[id]">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <EditorContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
