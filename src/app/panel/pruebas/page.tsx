import { Suspense } from "react";
import Link from "next/link";
import { Ban, ClipboardCheck, EyeOff, FlaskConical, Send } from "lucide-react";
import { db } from "@/lib/db";
import { findForbidden, listForbidden, quoteList } from "@/lib/forbidden";
import { ACCURACY_TARGET, MIN_VERIFIED, PROPOSAL_FILTERS, getAccuracyByType, listProposals } from "@/lib/data";
import { getLearning } from "@/lib/learning";
import { listTemplates } from "@/lib/data";
import { currentClient, overviewFor } from "../current";
import { Avatar, Badge, type BadgeTone, Channel, DECISION, Empty, PageHeader, Panel, Segmented, Skeleton, VERDICT, ago, pct, personName } from "../ui";
import { NoClient } from "../no-client";
import { review, undo } from "./actions";
import { ReviewButtons, UndoButton } from "./verify-buttons";

const STATUS: Record<string, { label: (n: number) => string; tone: BadgeTone }> = {
  activo: { label: () => "Responde solo", tone: "s1" },
  listo: { label: () => "Cumple el acierto: faltan días", tone: "ok" },
  bajo: { label: () => `Por debajo de ${ACCURACY_TARGET * 100} %`, tone: "critical" },
  faltan: { label: (n) => `Faltan ${MIN_VERIFIED - n} verificaciones`, tone: "neutral" },
};
const FILTER_LABELS: Record<keyof typeof PROPOSAL_FILTERS, string> = { pendientes: "Por revisar", historial: "Para medir", verificadas: "Revisadas", todas: "Todas" };
const ACTION: Record<string, { label: string; tone: BadgeTone }> = {
  pendiente: { label: "Se publica en unos segundos", tone: "neutral" },
  enviando: { label: "Enviada a Meta sin confirmar: revísala en Meta antes de repetirla", tone: "warn" },
  hecha: { label: "Publicada en Meta", tone: "ok" },
  fallida: { label: "No se pudo publicar; se reintenta", tone: "critical" },
};

async function PruebasContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient("pruebas");
  if (!client) return <NoClient />;
  const sp = await searchParams;
  const filter = (Object.keys(PROPOSAL_FILTERS) as (keyof typeof PROPOSAL_FILTERS)[]).find((f) => f === sp.ver) ?? "pendientes";
  const [types, proposals, o, learning, templates] = await Promise.all([
    getAccuracyByType(db, client.id),
    listProposals(db, client.id, filter),
    overviewFor(client.id),
    getLearning(db, client.id),
    listTemplates(db, client.id),
  ]);
  const forbidden = await listForbidden(db, client.id);
  const error = typeof sp.error === "string" ? sp.error : null;
  const templateNames = new Map(templates.map((t) => [`${t.code}|${t.channel}`, t.name as string]));
  const withData = types.filter((t) => t.proposals > 0);

  return (
    <>
      <PageHeader
        title="Pruebas"
        description="Los borradores de la IA para los comentarios y mensajes reales. En modo prueba el equipo los califica sin publicar nada; en asistido, aceptarlos los publica. Con cada revisión la IA aprende y se mide qué tipos de caso ya responden solos."
      />

      <Panel title="Precisión por tipo de caso" className="mb-6" bodyClass="">
        {withData.length === 0 ? (
          <p className="px-5 py-8 text-center text-[15px] text-ink-3">Todavía no hay propuestas. Aparecen cuando una cuenta conectada reciba comentarios.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="border-b border-line text-[13px] text-ink-3">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-bold">Tipo de caso</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">Propuestas</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-bold">Verificadas</th>
                  <th scope="col" className="w-64 px-3 py-2.5 font-bold">Correctas sin cambios</th>
                  <th scope="col" className="px-5 py-2.5 font-bold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {withData.map((t) => {
                  const st = STATUS[t.status];
                  const acc = t.accuracy != null ? Math.round(t.accuracy * 100) : null;
                  return (
                    <tr key={t.id}>
                      <td className="px-5 py-3 font-bold">{t.name}</td>
                      <td className="px-3 py-3 text-right">{t.proposals}</td>
                      <td className="px-3 py-3 text-right">{t.verified}</td>
                      <td className="px-3 py-3">
                        {acc != null ? (
                          <div className="flex items-center gap-3" title={`${t.correct} correctas, ${t.fix} para corregir, ${t.wrong} incorrectas`}>
                            <span className="relative h-2 flex-1 rounded-full bg-canvas ring-1 ring-line ring-inset">
                              <span className={`absolute inset-y-0 left-0 rounded-full ${acc >= ACCURACY_TARGET * 100 ? "bg-ok" : "bg-brand-ink"}`} style={{ width: `${acc}%` }} />
                              <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${ACCURACY_TARGET * 100}%` }} />
                            </span>
                            <span className="w-11 text-right font-bold">{acc} %</span>
                          </div>
                        ) : (
                          <span className="text-ink-3">Sin verificar</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={st.tone}>{st.label(t.verified)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-line px-5 py-3 text-[13px] text-ink-3">
              La línea negra marca la meta de {ACCURACY_TARGET * 100} %. Un tipo de caso pasa a responder solo cuando la cuenta lleva {learning.days} días en
              asistido y el tipo llega a la meta con al menos {MIN_VERIFIED} revisiones. Si el acierto baja, vuelve a pedir aprobación.
            </p>
          </div>
        )}
      </Panel>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Propuestas</h2>
        <Segmented
          label="Filtro de propuestas"
          value={filter}
          options={(Object.keys(FILTER_LABELS) as (keyof typeof FILTER_LABELS)[]).map((f) => ({
            value: f,
            label: FILTER_LABELS[f],
            count: f === "pendientes" ? o.toVerify : undefined,
            href: f === "pendientes" ? "/panel/pruebas" : `/panel/pruebas?ver=${f}`,
          }))}
        />
      </div>

      {proposals.length === 0 ? (
        <Empty title={filter === "pendientes" ? "Nada por verificar" : "Sin propuestas en este filtro"} icon={ClipboardCheck}>
          {filter === "pendientes" ? "Todas las propuestas de la IA ya tienen veredicto." : "Prueba con otro filtro."}
        </Empty>
      ) : (
        <ul className="space-y-4">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              templateNames={templateNames}
              filter={filter}
              banned={findForbidden(p.proposed_reply, forbidden)}
              error={String(p.id) === sp.caso ? error : null}
            />
          ))}
        </ul>
      )}
    </>
  );
}

type CardProps = { p: Record<string, any>; templateNames: Map<string, string>; filter: string; banned: string[]; error: string | null };

function ProposalCard({ p, templateNames, filter, banned, error }: CardProps) {
  const d = DECISION[p.decision];
  const v = p.verdict ? VERDICT[p.verdict] : null;
  return (
    <li id={`p${p.id}`} className="scroll-mt-6 rounded-xl border border-line bg-surface">
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Avatar name={p.username} />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold">{personName(p as any)}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
                <Channel platform={p.platform} kind={p.kind} rating={p.rating} /> · {ago(p.received_at)}
              </p>
            </div>
          </div>
          <p className="mt-3 rounded-xl rounded-tl-sm bg-canvas px-4 py-3 text-[15px] leading-relaxed">{p.text_masked}</p>
          {p.human_reply && (
            <div className="mt-3 text-[14px]">
              <p className="font-bold text-ink-3">El equipo respondió en Meta</p>
              <p className="mt-1 line-clamp-3 text-ink-2">{p.human_reply}</p>
            </div>
          )}
        </div>

        <div className="min-w-0 lg:border-l lg:border-line lg:pl-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.tone} icon={d.icon}>
              {d.label}
            </Badge>
            <span className="text-[14px] text-ink-2">{p.case_type}</span>
            <span className="text-[13px] text-ink-3">· confianza {pct(Number(p.confidence), 1)} %</span>
          </div>
          {p.decision === "ocultar" ? (
            <p className="mt-3 flex items-center gap-2 text-[15px] text-ink-2">
              <EyeOff size={16} aria-hidden /> Ocultaría el comentario (se puede volver a mostrar).
            </p>
          ) : !p.verdict ? null : (
            <div className="mt-3 rounded-lg border border-line px-4 py-3">
              <p className="mb-1 flex items-center gap-2 text-[13px] font-bold text-ink-3">
                Respuesta propuesta
                {p.proposed_template && <span className="rounded bg-canvas px-1.5 text-ink-2 ring-1 ring-line ring-inset">{p.proposed_template}</span>}
              </p>
              <p className="line-clamp-6 whitespace-pre-line text-[14px] text-ink-2">{p.proposed_reply ?? "Sin texto propuesto."}</p>
            </div>
          )}

          <ReviewForm p={p} templateNames={templateNames} filter={filter} banned={banned} error={error} />
        </div>
      </div>
    </li>
  );
}

// La persona acepta (con o sin cambios) o descarta el borrador. En asistido, aceptar publica; en
// modo prueba solo califica. Si cambia el texto, cuenta como corrección y la IA aprende de ella.
// Ya revisado, muestra qué pasó y permite deshacer mientras no se haya publicado.
function ReviewForm({ p, templateNames, filter, banned, error }: CardProps) {
  // Publica solo si la cuenta está en asistido y el mensaje aún no tiene respuesta ni es solo de análisis.
  const live = !!Number(p.can_publish);
  const answered = !!p.human_reply;
  const v = p.verdict ? VERDICT[p.verdict] : null;
  const a = p.action_status ? ACTION[p.action_status] : null;
  if (v) {
    return (
      <div className="mt-4 space-y-2.5 text-[14px]">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={v.tone} icon={v.icon}>{v.label}</Badge>
          {a && <Badge tone={a.tone} icon={Send}>{a.label}</Badge>}
        </p>
        {p.corrected_reply && (
          <p className="whitespace-pre-line text-ink-2">
            <span className="font-bold text-ink-3">{a ? "Se publica corregida: " : "Corrección: "}</span>
            {p.corrected_reply}
          </p>
        )}
        {p.action_status === "hecha" ? (
          <p className="text-[13px] text-ink-3">Ya está en Meta. Si hay que retirarla, se hace desde Meta.</p>
        ) : (
          <form action={undo}>
            <input type="hidden" name="id" value={p.id} />
            <UndoButton />
          </form>
        )}
      </div>
    );
  }
  const hide = p.decision === "ocultar";
  return (
    <form action={review} className="mt-4 space-y-2.5">
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="ver" value={filter} />
      {(error || (!hide && banned.length > 0)) && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
          <Ban size={15} aria-hidden className="mt-0.5 shrink-0" />
          {error ?? `El borrador lleva ${banned.length === 1 ? "una palabra prohibida" : "palabras prohibidas"}: ${quoteList(banned)}. Cámbialo antes de aceptar.`}
        </p>
      )}
      {!hide && (
        <label className="block">
          <span className="mb-1 block text-[13px] font-bold text-ink-3">
            {live ? "Corrige el texto si hace falta; lo que quede es lo que se publica" : "Corrige el texto si hace falta; así aprende la IA (en modo prueba no se publica)"}
            {p.ai_redrafts > 0 && <span className="ml-2 font-normal">· propuesta nueva de la IA</span>}
          </span>
          <textarea
            name="text"
            defaultValue={p.proposed_reply ?? ""}
            rows={4}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed hover:border-line-strong"
          />
        </label>
      )}
      <label className="block">
        <span className="sr-only">Nota para el equipo</span>
        <input name="note" placeholder={hide ? "Nota opcional" : "Opcional: qué cambiar. Si pides una nueva propuesta, la IA lo usa como indicación"} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] placeholder:text-ink-3 hover:border-line-strong" />
      </label>
      {!live && (
        <p className="flex items-start gap-2 rounded-lg bg-canvas px-3 py-2 text-[13px] text-ink-2">
          <FlaskConical size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
          {answered ? (
            <span>El equipo ya respondió este mensaje en Meta: aceptar o corregir solo sirve para medir y enseñarle a la IA. No se publica nada.</span>
          ) : (
            <span>
              Esta cuenta está en modo prueba: aceptar no publica nada en Meta. Para publicar, pásala a asistido en{" "}
              <Link href="/panel/cuentas" className="font-bold text-ink underline underline-offset-2">Cuentas conectadas</Link>.
            </span>
          )}
        </p>
      )}
      <TemplateUsed p={p} templateNames={templateNames} />
      <ReviewButtons hide={hide} live={live} comment={p.kind !== "dm"} />
      <p className="text-[12px] text-ink-3">
        {live ? "Descartar: no se publica nada y el caso pasa a la Bandeja para que lo atienda una persona." : "Descartar: marca el borrador como incorrecto; cuenta para el acierto del tipo de caso."}
      </p>
    </form>
  );
}

// Qué plantilla usa el borrador, o de dónde sale si no usa ninguna, para saberlo antes de aprobar.
function TemplateUsed({ p, templateNames }: { p: Record<string, any>; templateNames: Map<string, string> }) {
  if (p.decision === "ocultar") return null;
  const channel = p.kind === "dm" ? "dm" : "publico";
  const name = p.proposed_template ? templateNames.get(`${p.proposed_template}|${channel}`) : null;
  const action = p.kind === "dm" ? p.private_action : p.public_action;
  return (
    <p className="text-[12px] text-ink-3">
      {p.proposed_template ? (
        <>
          Usa la plantilla <span className="font-bold text-ink-2">{p.proposed_template}</span>
          {name ? ` · ${name}` : " (ya no está vigente)"}
        </>
      ) : (
        <>Sin plantilla{action ? ` · la matriz dice: ${action}` : ""}</>
      )}
    </p>
  );
}

export default function Pruebas({ searchParams }: PageProps<"/panel/pruebas">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <PruebasContent searchParams={searchParams} />
    </Suspense>
  );
}
