import { Suspense } from "react";
import Link from "next/link";
import { Ban, CircleAlert, Plus, X } from "lucide-react";
import { db } from "@/lib/db";
import { listTemplates } from "@/lib/data";
import { findForbidden, listForbidden } from "@/lib/forbidden";
import { currentClient } from "../current";
import { BUTTON, Badge, Empty, NoClient, PageHeader, Panel, Skeleton, plural } from "../ui";
import { add, remove } from "./actions";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";

async function PalabrasContent() {
  const client = await currentClient("config");
  if (!client) return <NoClient />;
  const [words, templates] = await Promise.all([listForbidden(db, client.id), listTemplates(db, client.id)]);
  // Plantillas vigentes que traen una palabra prohibida: con ellas la IA no puede responder tal cual.
  const inTemplates = (w: string) => templates.filter((t) => findForbidden(t.body, [{ value: w, note: null }]).length);

  return (
    <>
      <PageHeader
        title="Palabras prohibidas"
        description="Palabras o frases que ninguna respuesta puede llevar. La IA las lee antes de proponer cualquier respuesta, y la plataforma no deja proponer, aceptar ni enviar una respuesta que las tenga, la escriba la IA o una persona."
        actions={<Badge>{plural(words.length, "palabra", "palabras")}</Badge>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {words.length === 0 ? (
            <Empty title="Todavía no hay palabras prohibidas" icon={Ban}>
              Agrega las palabras o frases que la marca no usa en sus respuestas. Se aplican desde el siguiente mensaje.
            </Empty>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {words.map((w) => {
                const used = inTemplates(w.value);
                return (
                  <li key={w.id} className="flex items-start gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold">«{w.value}»</p>
                      <p className="mt-0.5 text-[13px] text-ink-3">{w.note ? `En su lugar: ${w.note}` : "Sin alternativa: la IA reformula"}</p>
                      {used.length > 0 && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-brand-ink">
                          <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
                          <span>
                            La usa {used.length === 1 ? "la plantilla" : "las plantillas"}{" "}
                            {used.map((t, i) => (
                              <span key={t.id}>
                                {i > 0 && ", "}
                                <Link href={`/panel/plantillas#${t.code}`} className="font-bold underline underline-offset-2">
                                  {t.code}
                                </Link>
                              </span>
                            ))}
                            : cámbiala para que la IA pueda usarla tal cual.
                          </span>
                        </p>
                      )}
                    </div>
                    <form action={remove}>
                      <input type="hidden" name="id" value={w.id} />
                      <button type="submit" aria-label={`Quitar «${w.value}»`} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-canvas hover:text-ink">
                        <X size={16} aria-hidden />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[13px] text-ink-3">
            No distingue mayúsculas ni tildes, y busca la palabra o frase completa: «culpa» no marca «disculpa». Si la IA propone una respuesta con una de ellas, tiene un segundo intento; si insiste, la respuesta no sale sola y la corrige una persona.
          </p>
        </div>

        <Panel title="Agregar">
          <form action={add} className="space-y-3">
            <label className="block text-[14px] text-ink-2">
              Palabra o frase
              <textarea name="values" required rows={3} placeholder="Una por línea o separadas por coma" className={`${FIELD} mt-1`} />
            </label>
            <label className="block text-[14px] text-ink-2">
              Qué usar en su lugar (opcional)
              <input name="note" maxLength={255} placeholder="Por ejemplo: «inconveniente»" className={`${FIELD} mt-1`} />
            </label>
            <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>
              <Plus size={15} aria-hidden /> Agregar
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}

export default function Palabras() {
  return (
    <Suspense fallback={<Skeleton />}>
      <PalabrasContent />
    </Suspense>
  );
}
