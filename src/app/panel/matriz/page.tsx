import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { listCaseTypes, listTemplates } from "@/lib/data";
import { currentClient } from "../current";
import { Pencil, Plus } from "lucide-react";
import { AUTONOMY, BUTTON, Badge, NoClient, PageHeader, Skeleton } from "../ui";

const LABELS: Record<string, [string, string]> = { automatica: ["automático", "automáticos"], humana: ["humano", "humanos"], escala: ["escala", "escalan"] };

async function MatrizContent() {
  const client = await currentClient("config");
  if (!client) return <NoClient />;
  const [types, templates] = await Promise.all([listCaseTypes(db, client.id), listTemplates(db, client.id)]);
  const names = new Map(templates.map((t) => [t.code as string, t.name as string]));
  const count = (a: string) => types.filter((t) => t.autonomy === a).length;

  return (
    <>
      <PageHeader
        title="Matriz de respuesta"
        description="Qué hace la plataforma con cada tipo de comentario o mensaje. Los códigos P son las plantillas del equipo; pasa el cursor para ver su nombre. Cada tipo se edita como un flujo de pasos."
        actions={
          <Link href="/panel/matriz/nuevo" className={BUTTON.primary}>
            <Plus size={16} aria-hidden /> Nuevo tipo de caso
          </Link>
        }
      />

      <section aria-label="Cómo leer la matriz" className="mb-4 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
        {(["automatica", "humana", "escala"] as const).map((a) => {
          const n = count(a);
          return (
            <div key={a} className="bg-surface px-5 py-4">
              <p className="flex items-center gap-2">
                <Badge tone={AUTONOMY[a].tone} icon={AUTONOMY[a].icon}>
                  {AUTONOMY[a].label}
                </Badge>
                <span className="text-[14px] font-bold">
                  {n} {n === 1 ? LABELS[a][0] : LABELS[a][1]}
                </span>
              </p>
              <p className="mt-2 text-[14px] text-ink-2">{AUTONOMY[a].help}</p>
            </div>
          );
        })}
      </section>
      <p className="mb-4 text-[14px] text-ink-3">
        <strong className="text-ink-2">Contención:</strong> respuesta pública corta que avisa que el caso se atiende por mensaje privado, para que ningún comentario quede sin respuesta.
      </p>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[1080px] text-left text-[14px]">
          <thead className="border-b border-line bg-canvas/60 text-[13px] text-ink-3">
            <tr>
              {["#", "Tipo de caso", "Respuesta pública", "Respuesta privada", "Registro", "Alerta", "Autonomía", ""].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {types.map((t) => {
              const a = AUTONOMY[t.autonomy];
              const examples: string[] = t.examples ?? [];
              return (
                <tr key={t.id} id={`tipo-${t.id}`} className={`scroll-mt-6 align-top hover:bg-canvas/50 target:bg-canvas ${t.active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-3.5 text-ink-3">{t.position}</td>
                  <td className="w-72 px-4 py-3.5">
                    <p className="font-bold">
                      {t.name}
                      {!t.active && <span className="ml-2 text-[12px] font-normal text-ink-3">(inactivo)</span>}
                    </p>
                    {t.description && <p className="mt-1 text-[13px] text-ink-2">{t.description}</p>}
                    {examples.map((e) => (
                      <p key={e} className="mt-1 text-[13px] text-ink-3">
                        “{e}”
                      </p>
                    ))}
                  </td>
                  <Cell value={t.public_action} names={names} />
                  <Cell value={t.private_action} names={names} />
                  <Cell value={t.record_target} names={names} />
                  <td className="px-4 py-3.5">
                    {t.alert ? (
                      /inmediata/i.test(t.alert) ? <Badge tone="critical">{t.alert}</Badge> : <span className="text-ink-2">{t.alert}</span>
                    ) : (
                      <span className="text-ink-3">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge tone={a.tone} icon={a.icon}>
                      {a.label}
                    </Badge>
                    {t.autonomy === "automatica" && <p className="mt-1.5 text-[12px] text-ink-3">Umbral {Math.round(Number(t.threshold) * 100)} %</p>}
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/panel/matriz/${t.id}`} aria-label={`Editar ${t.name}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-bold text-ink-2 hover:bg-canvas">
                      <Pencil size={14} aria-hidden /> Editar
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3">Los cambios aplican desde la siguiente clasificación. Un tipo inactivo no lo usa la IA.</p>
      </div>
    </>
  );
}

// Convierte los códigos de plantilla (P6, P5…) en enlaces con su nombre.
function Cell({ value, names }: { value: string | null; names: Map<string, string> }) {
  if (!value) return <td className="px-4 py-3.5 text-ink-3">—</td>;
  return (
    <td className="px-4 py-3.5 text-ink-2">
      {value.split(/\b(P\d+)\b/).map((part, i) =>
        names.has(part) ? (
          <Link key={i} href={`/panel/plantillas#${part}`} title={names.get(part)} className="rounded bg-canvas px-1 font-bold text-ink ring-1 ring-line ring-inset hover:ring-ink-3">
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </td>
  );
}

export default function Matriz() {
  return (
    <Suspense fallback={<Skeleton />}>
      <MatrizContent />
    </Suspense>
  );
}
