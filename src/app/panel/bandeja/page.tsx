import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Bot, CircleAlert, CircleCheck, Clock, CornerDownRight, ExternalLink, Inbox, Send, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { getInfluence, isWatched, listWatch, tierFor } from "@/lib/influence";
import { findForbidden, listForbidden, quoteList } from "@/lib/forbidden";
import { listContactHistory, listOpenEscalations } from "@/lib/data";
import { currentClient } from "../current";
import { Avatar, BUTTON, Badge, Channel, DECISION, Empty, NoClient, PageHeader, Segmented, Skeleton, VERDICT, ago, pct, PRIORITY, decisionLabel, personName, OriginBadge, ProfileBadges } from "../ui";
import { cannotSend } from "@/lib/inbox";
import { UndoButton } from "../pruebas/verify-buttons";
import { redraftReply, resolveCase, sendReply, undoSend } from "./actions";
import { CaseKeys, CaseLink, CopyButton, ReplyButtons } from "./case-nav";

type Priority = keyof typeof PRIORITY;
const FILTERS = ["todas", "critica", "alta", "normal"] as const;

// Lo que queda de la ventana de 24 h de Meta para responder por DM.
function windowLeft(expires: Date | null) {
  if (!expires) return null;
  const h = (new Date(expires).getTime() - Date.now()) / 36e5;
  if (h <= 0) return { short: "Ventana vencida", text: "Pasaron las 24 h: solo una persona puede responder por DM, hasta 7 días.", urgent: true };
  const left = `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`;
  return { short: h < 4 ? `Urgente: quedan ${left}` : `Quedan ${left}`, text: `Quedan ${left} para responder por DM.`, urgent: h < 4 };
}

type Params = Promise<Record<string, string | string[] | undefined>>;
type Escalation = Awaited<ReturnType<typeof listOpenEscalations>>[number];

async function BandejaContent({ searchParams }: { searchParams: Params }) {
  const client = await currentClient("bandeja");
  if (!client) return <NoClient />;
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f === sp.prioridad) ?? "todas";
  const all = await listOpenEscalations(db, client.id);
  const items = filter === "todas" ? all : all.filter((e) => e.priority === filter);
  const selectedIndex = Math.max(0, items.findIndex((e) => String(e.id) === sp.caso));
  const selected = items[selectedIndex];
  const chosen = typeof sp.caso === "string"; // en celular, con un caso elegido se muestra solo el caso
  const href = (q: Record<string, string>) => `/panel/bandeja?${new URLSearchParams(q)}`;
  const caseHref = (id: number) => href({ ...(filter !== "todas" && { prioridad: filter }), caso: String(id) });
  const count = (p: string) => (p === "todas" ? all.length : all.filter((e) => e.priority === p).length);

  return (
    <>
      <PageHeader
        title="Bandeja"
        description="Lo que necesita a una persona: crisis, alto alcance, tipos de atención humana y lo que la IA no clasifica con seguridad. Primero lo crítico. La IA sugiere la respuesta; tú la corriges y la envías desde aquí."
      />

      {all.length === 0 ? (
        <Empty title="Nada esperando a una persona" icon={Inbox}>
          Cuando llegue un caso que deba atender el equipo, aparece aquí con el motivo, la prioridad y un borrador sugerido.
        </Empty>
      ) : (
        <div className="grid overflow-hidden rounded-xl border border-line bg-surface lg:h-[calc(100vh-190px)] lg:min-h-[560px] lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <div className={`min-h-0 min-w-0 flex-col border-line lg:flex lg:border-r ${chosen ? "hidden" : "flex"}`}>
            <div className="flex items-center justify-between gap-2 border-b border-line p-2">
              <Segmented
                label="Prioridad"
                value={filter}
                options={FILTERS.map((f) => ({ value: f, label: f === "todas" ? "Todas" : PRIORITY[f].label, count: count(f), href: href(f === "todas" ? {} : { prioridad: f }) }))}
              />
              <span className="hidden shrink-0 pr-2 text-[12px] text-ink-3 xl:inline" title="Atajos de teclado">
                <kbd className="rounded border border-line px-1">j</kbd> <kbd className="rounded border border-line px-1">k</kbd> para moverte
              </span>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {items.map((e) => {
                const w = windowLeft(e.window_expires_at);
                return (
                  <li key={e.id}>
                    <CaseLink href={caseHref(e.id)} active={e.id === selected?.id}>
                      <div className="flex items-center gap-2 pr-5">
                        <Badge tone={PRIORITY[e.priority as Priority].tone}>{PRIORITY[e.priority as Priority].label}</Badge>
                        <span className="truncate text-[14px] font-bold">{personName(e as any)}</span>
                        <span className="ml-auto shrink-0 text-[12px] text-ink-3">{ago(e.created_at)}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[14px] text-ink-2">{e.text_masked}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Channel platform={e.platform} kind={e.kind} />
                        {w && (
                          <span className={`inline-flex items-center gap-1 text-[12px] ${w.urgent ? "font-bold text-brand-ink" : "text-ink-3"}`}>
                            {w.urgent ? <TriangleAlert size={13} aria-hidden /> : <Clock size={13} aria-hidden />} {w.short}
                          </span>
                        )}
                      </div>
                    </CaseLink>
                  </li>
                );
              })}
              {items.length === 0 && <li className="px-4 py-8 text-center text-[14px] text-ink-3">Ningún caso con esta prioridad.</li>}
            </ul>
          </div>

          {selected && (
            <div className={`min-h-0 min-w-0 lg:flex ${chosen ? "flex" : "hidden"}`}>
              <CaseDetail e={selected} clientId={client.id} backHref={href(filter === "todas" ? {} : { prioridad: filter })} error={typeof sp.error === "string" ? sp.error : null} />
            </div>
          )}
          <CaseKeys hrefs={items.map((e) => caseHref(e.id))} current={selectedIndex} />
        </div>
      )}
    </>
  );
}

async function CaseDetail({ e, clientId, backHref, error }: { e: Escalation; clientId: number; backHref: string; error: string | null }) {
  const w = windowLeft(e.window_expires_at);
  const history = e.contact_id ? await listContactHistory(db, clientId, e.contact_id, e.interaction_id) : [];
  const banned = findForbidden(e.suggested_draft ?? e.proposed_reply, await listForbidden(db, clientId));
  const [inf, watch] = await Promise.all([getInfluence(db, clientId), listWatch(db, clientId)]);
  const network = e.platform === "ig" ? "Instagram" : "Facebook";
  return (
    <article className="flex min-h-0 w-full min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5 md:px-6">
        <Link href={backHref} className="mr-1 inline-flex items-center gap-1 text-[13px] font-bold text-ink-2 lg:hidden">
          <ArrowLeft size={15} aria-hidden /> Lista
        </Link>
        <Badge tone={PRIORITY[e.priority as Priority].tone}>{PRIORITY[e.priority as Priority].label}</Badge>
        <Channel platform={e.platform} kind={e.kind} />
        <OriginBadge origin={e.post_origin} />
        {e.case_type && <span className="text-[14px] text-ink-2">· {e.case_type}</span>}
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-6">
        <div className="flex items-center gap-3">
          <Avatar name={e.username} size="size-10" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 font-bold">
              {personName(e as any)}
              {e.verified ? <BadgeCheck size={16} className="text-s1" aria-label="Cuenta verificada" /> : null}
            </p>
            <p className="text-[13px] text-ink-3">
              {e.followers != null ? `${e.followers.toLocaleString("es-CO")} seguidores · ` : ""}
              {ago(e.created_at)} en {e.account}
            </p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              <ProfileBadges tier={tierFor(e.followers, inf)} accountType={e.account_type} important={isWatched(e.username, watch)} />
            </p>
            {e.bio && <p className="mt-1 line-clamp-2 text-[13px] text-ink-3">{e.bio}</p>}
          </div>
        </div>

        <blockquote className="rounded-xl rounded-tl-sm bg-canvas px-4 py-3 text-[15px] leading-relaxed">{e.text_masked}</blockquote>

        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="text-[13px] font-bold text-ink-3">Por qué está aquí</dt>
            <dd className="mt-1 text-[14px]">{e.reason}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-bold text-ink-3">Confianza de la clasificación</dt>
            <dd className="mt-1 text-[14px]">{e.confidence != null ? `${pct(Number(e.confidence), 1)} %` : "—"}</dd>
          </div>
          {w && (
            <div className="sm:col-span-2">
              <dt className="text-[13px] font-bold text-ink-3">Ventana para responder por DM</dt>
              <dd className={`mt-1 inline-flex items-center gap-1.5 text-[14px] ${w.urgent ? "font-bold text-brand-ink" : ""}`}>
                {w.urgent ? <TriangleAlert size={15} aria-hidden /> : <Clock size={15} aria-hidden />} {w.text}
              </dd>
            </div>
          )}
        </dl>

        <section>
          <h3 className="flex items-center justify-between gap-2 text-[13px] font-bold text-ink-3">
            Historial con este usuario
            {e.contact_id && (
              <Link href={`/panel/interacciones/persona/${e.contact_id}`} className="text-brand-ink hover:underline">
                Ver todo
              </Link>
            )}
          </h3>
          {history.length === 0 ? (
            <p className="mt-1.5 text-[14px] text-ink-2">Es la primera vez que escribe.</p>
          ) : (
            <ol className="mt-2 space-y-3 border-l-2 border-line pl-4">
              {history.map((h) => {
                const d = h.decision ? DECISION[h.decision] : null;
                return (
                  <li key={h.id} className="text-[14px]">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                      {ago(h.received_at)} · {h.case_type ?? "Sin clasificar"}
                      {d && (
                        <Badge tone={d.tone} icon={d.icon}>
                          {decisionLabel(h as any)}
                        </Badge>
                      )}
                      {h.verdict && <Badge tone={VERDICT[h.verdict].tone}>{VERDICT[h.verdict].label}</Badge>}
                    </p>
                    <p className="mt-1 text-ink">{h.text_masked}</p>
                    {(h.human_reply || h.proposed_reply) && (
                      <p className="mt-1 flex gap-1.5 text-ink-3">
                        <CornerDownRight size={14} aria-hidden className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{h.human_reply ? `Equipo: ${h.human_reply}` : `IA, sin publicar: ${h.proposed_reply}`}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <ReplyFooter e={e} network={network} error={error} banned={banned} />
    </article>
  );
}

// Responder el caso: la IA sugiere, la persona corrige y envía. Si la cuenta no publica (modo
// prueba, historial o ventana de DM vencida), se responde desde Meta y el caso se cierra solo.
function ReplyFooter({ e, network, error, banned }: { e: Escalation; network: string; error: string | null; banned: string[] }) {
  const draft = e.suggested_draft ?? e.proposed_reply ?? "";
  const blocked = cannotSend({ mode: e.account_mode, analysis_only: e.analysis_only, kind: e.kind, window_expires_at: e.window_expires_at, post_origin: e.post_origin, notice_id: e.notice_id });
  const dm = e.kind === "dm";
  return (
    <footer className="space-y-3 border-t border-line bg-canvas/60 px-5 py-4 md:px-6">
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
          <CircleAlert size={15} aria-hidden className="shrink-0" /> {error}
        </p>
      )}
      {!error && banned.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
          <CircleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
          El borrador lleva {banned.length === 1 ? "una palabra prohibida" : "palabras prohibidas"}: {quoteList(banned)}. Cámbialo antes de enviarlo.
        </p>
      )}
      {e.action_status === "pendiente" ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-[14px] font-bold">
            <Send size={15} aria-hidden /> {e.action_type === "ocultar" ? "Se oculta en unos segundos" : "Se envía en unos segundos"}
          </p>
          <form action={undoSend}>
            <input type="hidden" name="id" value={e.id} />
            <UndoButton />
          </form>
        </div>
      ) : blocked ? (
        <>
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-3">
            <Bot size={15} aria-hidden /> Borrador sugerido
          </p>
          {draft ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[14px] text-ink-2">{draft}</p>
          ) : (
            <p className="text-[14px] text-ink-2">No hay borrador: este caso necesita una respuesta escrita por el equipo.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {draft && <CopyButton text={draft} />}
            {e.permalink && (
              <a href={e.permalink} target="_blank" rel="noreferrer" className={BUTTON.secondary}>
                Responder en {network} <ExternalLink size={14} aria-hidden />
              </a>
            )}
          </div>
          <p className="text-[13px] text-ink-3">{blocked} El caso se cierra solo cuando la plataforma detecta la respuesta.</p>
        </>
      ) : (
        <form action={sendReply} className="space-y-2">
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="interaction_id" value={e.interaction_id} />
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-ink-3">
              <Bot size={15} aria-hidden /> {draft ? "La IA sugiere esta respuesta: corrígela si hace falta y envíala" : "Escribe la respuesta"}
            </span>
            <textarea name="text" defaultValue={draft} rows={4} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed hover:border-line-strong" />
          </label>
          <input name="hint" placeholder="Opcional: indicación para la IA si pides otra propuesta (más corta, menciona la sede…)" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] placeholder:text-ink-3 hover:border-line-strong" />
          <ReplyButtons dm={dm} redraft={redraftReply} />
          <p className="text-[12px] text-ink-3">
            {dm ? "Se envía por DM desde la cuenta de la marca." : `Se publica como respuesta al comentario en ${network}.`} Tienes unos segundos para deshacer.
          </p>
        </form>
      )}
      <form action={resolveCase} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input type="hidden" name="id" value={e.id} />
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-2 hover:bg-canvas">
          <CircleCheck size={15} aria-hidden /> Resolver sin responder
        </button>
        <span className="text-[12px] text-ink-3">Para lo que se atendió por fuera: una llamada, otra área o Meta.</span>
      </form>
    </footer>
  );
}

export default function Bandeja({ searchParams }: PageProps<"/panel/bandeja">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <BandejaContent searchParams={searchParams} />
    </Suspense>
  );
}
