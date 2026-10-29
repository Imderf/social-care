import { Suspense } from "react";
import { BookOpen, ExternalLink, GraduationCap, Lightbulb, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { listKnowledge } from "@/lib/data";
import { TOPICS } from "@/lib/flow";
import { knowledgeSuggestions, learnedExamples } from "@/lib/learning";
import { currentClient } from "../current";
import { BUTTON, Badge, Empty, NoClient, PageHeader, Panel, Skeleton, TemplateText, formatDate } from "../ui";
import { addItem, dismiss, forgetExample, removeItem } from "./actions";

const ORIGIN = {
  corregir: { label: "Corrección del equipo", tone: "warn" },
  equipo: { label: "Respuesta del equipo en Meta", tone: "s1" },
  correcta: { label: "Aceptada sin cambios", tone: "ok" },
} as const;
const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const SMALL = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-2 transition-colors hover:bg-canvas";

async function ConocimientoContent() {
  const client = await currentClient("config");
  if (!client) return <NoClient />;
  const [items, learned, suggestions] = await Promise.all([listKnowledge(db, client.id), learnedExamples(db, client.id), knowledgeSuggestions(db, client.id)]);
  const missing = (Object.keys(TOPICS) as (keyof typeof TOPICS)[]).filter((t) => !items.some((i) => i.topic === t));
  const byType = [...new Set(learned.map((e) => e.name))];

  return (
    <>
      <PageHeader
        title="Base de conocimiento"
        description="De aquí saca la IA los datos puntuales (direcciones, horarios, festivos, enlaces y requisitos) y aquí se ve lo que aprendió de las revisiones del equipo. Si una respuesta necesita un dato que no está, el caso pasa a una persona."
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {items.length === 0 && (
            <Empty title="La base de conocimiento está vacía" icon={BookOpen}>
              Mientras no haya datos, toda pregunta de sedes, horarios o requisitos pasa a una persona.
            </Empty>
          )}
          {Object.entries(TOPICS)
            .filter(([t]) => items.some((i) => i.topic === t))
            .map(([topic, label]) => (
              <Panel key={topic} title={label} action={<Badge>{items.filter((i) => i.topic === topic).length}</Badge>} bodyClass="divide-y divide-line">
                {items
                  .filter((i) => i.topic === topic)
                  .map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="font-bold">{i.title}</p>
                        <p className="truncate text-[13px] text-ink-3">
                          {i.content}
                          {i.valid_until && ` · vigente hasta el ${formatDate(i.valid_until)}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {/^https?:\/\//.test(i.content) && (
                          <a href={i.content} target="_blank" rel="noreferrer" aria-label={`Abrir ${i.title}`} className="rounded-lg p-2 text-ink-3 hover:bg-canvas hover:text-ink">
                            <ExternalLink size={16} aria-hidden />
                          </a>
                        )}
                        <form action={removeItem}>
                          <input type="hidden" name="id" value={i.id} />
                          <button type="submit" aria-label={`Quitar ${i.title}`} title="Quitar de la base" className="rounded-lg p-2 text-ink-3 hover:bg-canvas hover:text-brand-ink">
                            <Trash2 size={16} aria-hidden />
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
              </Panel>
            ))}

          <Panel title="Lo que aprendió la IA" action={<Badge icon={GraduationCap}>{learned.length}</Badge>} bodyClass={learned.length ? "divide-y divide-line" : "p-5"}>
            {learned.length === 0 ? (
              <p className="text-[14px] text-ink-3">
                Todavía no hay ejemplos. Cada borrador que el equipo acepta o corrige en Pruebas y cada respuesta del equipo en Meta quedan aquí, y la IA los
                recibe como ejemplo de cómo responde este cliente (hasta 3 por tipo de caso, las correcciones primero).
              </p>
            ) : (
              byType.map((name) => (
                <div key={name} className="px-5 py-4">
                  <p className="mb-2 text-[13px] font-bold text-ink-3">{name}</p>
                  <ul className="space-y-3">
                    {learned
                      .filter((e) => e.name === name)
                      .map((e) => (
                        <li key={e.id} className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="text-[14px] text-ink-2">
                              <span className="font-bold text-ink-3">Mensaje: </span>
                              {e.text}
                            </p>
                            <div className="rounded-lg border border-line px-3 py-2">
                              <TemplateText body={e.reply} />
                            </div>
                            <p className="flex items-center gap-2 text-[13px] text-ink-3">
                              <Badge tone={ORIGIN[e.origin].tone}>{ORIGIN[e.origin].label}</Badge>
                              {formatDate(e.at)}
                            </p>
                          </div>
                          <form action={forgetExample}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className={SMALL} title="La IA deja de imitar este ejemplo; el acierto medido no cambia">
                              <Trash2 size={15} aria-hidden /> Quitar
                            </button>
                          </form>
                        </li>
                      ))}
                  </ul>
                </div>
              ))
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          {suggestions.length > 0 && (
            <Panel title="Sugerencias desde las respuestas del equipo" action={<Badge tone="warn" icon={Lightbulb}>{suggestions.length}</Badge>} bodyClass="divide-y divide-line">
              {suggestions.map((sg) => (
                <div key={`${sg.id}-${sg.value}`} className="space-y-2.5 px-5 py-4">
                  <p className="text-[13px] text-ink-3">
                    El equipo escribió este dato en una respuesta{sg.caseType ? ` de "${sg.caseType}"` : ""} y no está en la base:
                  </p>
                  <form action={addItem} className="space-y-2">
                    <select name="topic" defaultValue={sg.topic} aria-label="Tema" className={FIELD}>
                      {Object.entries(TOPICS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <input name="title" required placeholder="Título, por ejemplo: Sede Centenario" aria-label="Título" className={FIELD} />
                    <textarea name="content" required rows={3} defaultValue={sg.topic === "enlace" ? sg.value : sg.sentence} aria-label="Contenido" className={FIELD} />
                    <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>
                      <Plus size={15} aria-hidden /> Guardar en la base
                    </button>
                  </form>
                  <form action={dismiss}>
                    <input type="hidden" name="id" value={sg.id} />
                    <button type="submit" className="text-[13px] font-bold text-ink-3 underline-offset-2 hover:text-ink hover:underline">Descartar sugerencia</button>
                  </form>
                </div>
              ))}
            </Panel>
          )}

          <Panel title="Agregar un dato">
            <form action={addItem} className="space-y-2">
              <select name="topic" defaultValue="sede" aria-label="Tema" className={FIELD}>
                {Object.entries(TOPICS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <input name="title" required placeholder="Título, por ejemplo: Sede Centenario" aria-label="Título" className={FIELD} />
              <textarea name="content" required rows={3} placeholder="El dato tal como lo puede usar la IA: dirección, horario, enlace o requisito" aria-label="Contenido" className={FIELD} />
              <label className="block text-[13px] text-ink-3">
                Vigente hasta (opcional)
                <input type="date" name="valid_until" className={`${FIELD} mt-1`} />
              </label>
              <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>
                <Plus size={15} aria-hidden /> Agregar
              </button>
            </form>
          </Panel>

          {missing.length > 0 && (
            <Panel title="Falta cargar">
              <p className="text-[14px] text-ink-2">Para que la IA responda preguntas de horarios y sedes sin escalar, el equipo social debe cargar:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {missing.map((t) => (
                  <Badge key={t} tone="warn">{TOPICS[t]}</Badge>
                ))}
              </div>
              <p className="mt-4 text-[13px] text-ink-3">Empieza por las ciudades que concentran las quejas.</p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

export default function Conocimiento() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ConocimientoContent />
    </Suspense>
  );
}
