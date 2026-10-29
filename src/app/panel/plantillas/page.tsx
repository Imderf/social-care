import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, History, MessageCircle, Pencil, Plus, Send } from "lucide-react";
import { db } from "@/lib/db";
import { listTemplateVersions, listUncovered } from "@/lib/data";
import { currentClient } from "../current";
import { BUTTON, Badge, Empty, NoClient, PageHeader, Panel, Skeleton, TemplateText, formatDate } from "../ui";
import { save, toggle } from "./actions";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const SMALL = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-2 transition-colors hover:bg-canvas";
const VARIABLES = "Variables: {usuario} es la cuenta de la persona y {nombre}, su nombre (en DM). Otras, como {ciudad} o {puntos}, las llena la IA con el dato de esa ciudad en la Base de conocimiento; si el dato no está, no usa la plantilla.";
const WHEN_HELP = "Si un tipo de caso tiene varias plantillas, la IA elige la que corresponde según esto. Ejemplo: «Pregunta por el domicilio de los medicamentos que le entrega su EPS».";
const byCode = (a: string, b: string) => (Number(a.slice(1)) || 0) - (Number(b.slice(1)) || 0) || a.localeCompare(b);

async function PlantillasContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient("config");
  if (!client) return <NoClient />;
  const [versions, uncovered, sp] = await Promise.all([listTemplateVersions(db, client.id), listUncovered(db, client.id), searchParams]);
  // Desde el editor de la matriz: crear la plantilla que falta y volver al tipo de caso.
  const channel = sp.nueva === "dm" ? "dm" : "publico";
  const back = typeof sp.volver === "string" && /^\/panel\/matriz\/(\d+|nuevo)$/.test(sp.volver) ? sp.volver : null;

  // Por código y canal: la versión vigente (o la última, si está desactivada) y las anteriores.
  const slots = new Map<string, typeof versions>();
  for (const v of versions) slots.set(`${v.code}|${v.channel}`, [...(slots.get(`${v.code}|${v.channel}`) ?? []), v]);
  const codes = [...new Set(versions.map((v) => v.code as string))].sort(byCode);
  const nextCode = `P${Math.max(0, ...codes.map((c) => Number(c.slice(1)) || 0)) + 1}`;
  const activeCount = versions.filter((v) => v.active).length;

  return (
    <>
      <PageHeader
        title="Plantillas"
        description="Las respuestas aprobadas por el equipo de social media. La IA parte siempre de una plantilla y solo completa las variables resaltadas. Editar crea una versión nueva y la anterior queda en el historial."
        actions={<Badge>{activeCount} textos vigentes</Badge>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {codes.length === 0 && (
            <Empty title="Sin plantillas" icon={FileText}>
              Crea la primera con el formulario de la derecha.
            </Empty>
          )}
          {codes.map((code) => {
            const channels = (["publico", "dm"] as const).filter((ch) => slots.has(`${code}|${ch}`));
            const name = slots.get(`${code}|${channels[0]}`)![0].name;
            return (
              <article key={code} id={code} className="scroll-mt-6 rounded-xl border border-line bg-surface target:ring-2 target:ring-ink-3">
                <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
                  <span className="grid h-7 min-w-9 place-items-center rounded-md bg-ink px-1.5 text-[13px] font-bold text-white">{code}</span>
                  <h2 className="text-[15px] font-bold">{name}</h2>
                </header>
                <div className={`grid divide-line ${channels.length > 1 ? "md:grid-cols-2 md:divide-x" : ""}`}>
                  {channels.map((ch) => {
                    const all = slots.get(`${code}|${ch}`)!;
                    const current = all.find((v) => v.active) ?? all[0];
                    const older = all.filter((v) => v.id !== current.id);
                    return (
                      <div key={ch} className={`space-y-3 p-5 ${current.active ? "" : "opacity-70"}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          {ch === "dm" ? <Badge tone="solid" icon={Send}>Mensaje privado</Badge> : <Badge icon={MessageCircle}>Respuesta pública</Badge>}
                          <span className="text-[13px] text-ink-3">
                            Versión {current.version} · {formatDate(current.updated_at)}
                          </span>
                          {!current.active && <Badge tone="warn">Desactivada: la IA no la usa</Badge>}
                        </div>
                        <TemplateText body={current.body} />
                        {current.when_to_use && (
                          <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-ink-2">
                            <span className="font-bold text-ink-3">Úsala cuando: </span>
                            {current.when_to_use}
                          </p>
                        )}

                        <details className="group">
                          <summary className={`${SMALL} cursor-pointer list-none`}>
                            <Pencil size={15} aria-hidden /> Editar
                          </summary>
                          <form action={save} className="mt-3 space-y-2">
                            <input type="hidden" name="code" value={code} />
                            <input type="hidden" name="channel" value={ch} />
                            <input name="name" defaultValue={current.name} required aria-label="Nombre" className={FIELD} />
                            <textarea name="body" defaultValue={current.body} required rows={6} aria-label="Texto" className={FIELD} />
                            <p className="text-[13px] text-ink-3">{VARIABLES}</p>
                            <input name="when_to_use" defaultValue={current.when_to_use ?? ""} maxLength={500} placeholder="Úsala cuando… (opcional)" aria-label="Úsala cuando" className={FIELD} />
                            <p className="text-[13px] text-ink-3">{WHEN_HELP}</p>
                            <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>Guardar como versión {Number(all[0].version) + 1}</button>
                          </form>
                        </details>

                        <div className="flex flex-wrap items-center gap-2">
                          <form action={toggle}>
                            <input type="hidden" name="code" value={code} />
                            <input type="hidden" name="channel" value={ch} />
                            <input type="hidden" name="active" value={current.active ? "0" : "1"} />
                            <button type="submit" className={SMALL}>{current.active ? "Desactivar" : "Volver a activar"}</button>
                          </form>
                          {older.length > 0 && (
                            <details>
                              <summary className={`${SMALL} cursor-pointer list-none`}>
                                <History size={15} aria-hidden /> {older.length} {older.length === 1 ? "versión anterior" : "versiones anteriores"}
                              </summary>
                              <ul className="mt-3 space-y-3">
                                {older.map((v) => (
                                  <li key={v.id} className="rounded-lg bg-canvas px-3 py-2">
                                    <p className="mb-1 text-[13px] font-bold text-ink-3">Versión {v.version} · {formatDate(v.updated_at)}</p>
                                    <TemplateText body={v.body} />
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>

        <div id="nueva" className="scroll-mt-6 space-y-3">
        {back && (
          <Link href={back} className="flex items-center gap-1.5 rounded-lg bg-canvas px-4 py-3 text-[14px] font-bold text-ink-2 hover:text-ink">
            <ArrowLeft size={16} aria-hidden /> Cuando la crees, vuelve al tipo de caso para elegirla
          </Link>
        )}
        <Panel title="Nueva plantilla">
          <form action={save} className="space-y-2">
            <div className="flex gap-2">
              <input name="code" defaultValue={nextCode} required pattern="[A-Za-z0-9_]{1,20}" aria-label="Código" className={`${FIELD} w-24`} />
              <select name="channel" defaultValue={channel} aria-label="Canal" className={FIELD}>
                <option value="publico">Respuesta pública</option>
                <option value="dm">Mensaje privado</option>
              </select>
            </div>
            <input name="name" required placeholder="Nombre, por ejemplo: Horarios en festivo" aria-label="Nombre" className={FIELD} />
            <textarea name="body" required rows={6} placeholder="¡Hola {usuario}! …" aria-label="Texto" className={FIELD} />
            <p className="text-[13px] text-ink-3">{VARIABLES}</p>
            <input name="when_to_use" maxLength={500} placeholder="Úsala cuando… (opcional)" aria-label="Úsala cuando" className={FIELD} />
            <p className="text-[13px] text-ink-3">{WHEN_HELP}</p>
            <p className="text-[13px] text-ink-3">
              Para que la IA la use, elígela en el paso "Responde en público" o "Manda por DM" del tipo de caso, en la Matriz de respuesta. Con el mismo código y otro canal se crea su versión de DM.
            </p>
            <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>
              <Plus size={15} aria-hidden /> Crear plantilla
            </button>
          </form>
        </Panel>
        <Panel title="Preguntas sin plantilla · 30 días">
          {uncovered.length === 0 ? (
            <p className="text-[14px] text-ink-3">Todo lo que llegó en los últimos 30 días salió de una plantilla o de la base de conocimiento.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-ink-3">Llegaron y no se pudieron responder con una plantilla o un dato de la base: los atendió una persona. Crear la plantilla (y elegirla en el tipo de caso) los cubre la próxima vez.</p>
              <ul className="space-y-3">
                {uncovered.map((g) => (
                  <li key={g.caseType} className="rounded-lg bg-canvas px-3 py-2.5">
                    <p className="flex items-center justify-between gap-2 text-[14px] font-bold">
                      <span className="min-w-0 truncate">{g.caseType}</span>
                      <Badge>{g.count}</Badge>
                    </p>
                    {g.examples.map((x, i) => (
                      <p key={i} className="mt-1 line-clamp-2 text-[13px] text-ink-2">«{x}»</p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
        </div>
      </div>
    </>
  );
}

export default function Plantillas({ searchParams }: PageProps<"/panel/plantillas">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <PlantillasContent searchParams={searchParams} />
    </Suspense>
  );
}
