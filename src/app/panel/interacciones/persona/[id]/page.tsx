import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CornerDownRight, ExternalLink, MessageCircle, Send } from "lucide-react";
import { db } from "@/lib/db";
import { getInfluence, isWatched, listWatch, tierFor } from "@/lib/influence";
import { getContact, listContactTimeline } from "@/lib/data";
import { SentimentBar } from "../../../charts";
import { currentClient } from "../../../current";
import { Avatar, Badge, Channel, DECISION, decisionLabel, PRIORITY, Skeleton, VERDICT, formatDate, personName, plural, OriginBadge, ProfileBadges } from "../../../ui";
import { NoClient } from "../../../no-client";

const dayFmt = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hourFmt = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
const PIECE: Record<string, string> = { reel: "el reel", foto: "la foto", video: "el video", carrusel: "el carrusel", historia: "la historia", estado: "la publicación", compartido: "la publicación compartida" };

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[13px] font-bold text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-[13px] text-ink-3">{note}</p>}
    </div>
  );
}

async function PersonaContent({ params }: { params: Promise<{ id: string }> }) {
  const client = await currentClient("bandeja");
  if (!client) return <NoClient />;
  const person = await getContact(db, client.id, Number((await params).id));
  if (!person) notFound();
  const [items, inf, watch] = await Promise.all([listContactTimeline(db, client.id, person.id), getInfluence(db, client.id), listWatch(db, client.id)]);
  const count = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).length;
  const open = items.filter((i) => Number(i.open_case));
  const sentiment = { positivo: count((i) => i.sentiment === "positivo"), neutral: count((i) => i.sentiment === "neutral"), negativo: count((i) => i.sentiment === "negativo") };

  // Agrupado por día (hora de Colombia), lo más reciente primero.
  const days = new Map<string, typeof items>();
  for (const i of items) {
    const d = dayFmt.format(new Date(i.received_at));
    days.set(d, [...(days.get(d) ?? []), i]);
  }

  return (
    <>
      <Link href="/panel/interacciones?vista=personas" className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-bold text-ink-3 hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Personas
      </Link>

      <header className="mb-6 flex items-center gap-4">
        <Avatar name={person.username} size="size-14 ring-1 ring-line" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">{personName(person as any)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-3">
            <Channel platform={person.platform} />
            {person.followers != null && <span>{plural(Number(person.followers), "seguidor", "seguidores")}</span>}
            {items.length > 0 && <span>Escribe desde {formatDate(items[items.length - 1].received_at)}</span>}
          </p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ProfileBadges tier={tierFor(person.followers, inf)} accountType={person.account_type} important={isWatched(person.username, watch)} />
            {person.verified ? <Badge tone="s1">Cuenta verificada</Badge> : null}
          </p>
          {person.bio && <p className="mt-1.5 max-w-2xl text-[14px] text-ink-2">{person.bio}</p>}
        </div>
      </header>

      <section aria-label="Resumen de la persona" className="mb-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Comentarios" value={count((i) => i.kind === "comentario")} note={`${plural(count((i) => i.kind === "dm"), "mensaje privado", "mensajes privados")}`} />
        <Stat label="Respondidos" value={`${count((i) => !!i.answered_by)} de ${items.length}`} note={`${count((i) => i.answered_by === "ia")} la IA · ${count((i) => i.answered_by === "persona")} el equipo`} />
        <Stat
          label="En la Bandeja"
          value={open.length}
          note={
            open.length ? (
              <Link href={`/panel/bandeja?caso=${open[0].escalation_id}`} className="font-bold text-brand-ink hover:underline">
                Abrir su caso
              </Link>
            ) : (
              "Sin casos abiertos"
            )
          }
        />
        <div className="bg-surface px-5 py-4">
          <p className="mb-2.5 text-[13px] font-bold text-ink-3">Sentimiento</p>
          <SentimentBar counts={sentiment} />
          <p className="mt-2 text-[13px] text-ink-3">
            {sentiment.positivo} positivos · {sentiment.neutral} neutrales · {sentiment.negativo} negativos
          </p>
        </div>
      </section>

      <h2 className="mb-3 text-lg font-bold">Todo lo que ha escrito</h2>
      <div className="space-y-6">
        {[...days].map(([day, list]) => (
          <section key={day} aria-label={day}>
            <h3 className="mb-2 text-[13px] font-bold text-ink-3 first-letter:uppercase">{day}</h3>
            <ol className="space-y-3">
              {list.map((i) => {
                const d = i.decision ? DECISION[i.decision] : null;
                const v = i.verdict ? VERDICT[i.verdict] : null;
                const p = i.priority ? PRIORITY[i.priority as keyof typeof PRIORITY] : null;
                const Icon = i.kind === "dm" ? Send : MessageCircle;
                const link = i.permalink || i.post_permalink;
                return (
                  <li key={i.id} className="flex gap-3">
                    <span aria-hidden className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-canvas text-ink-3 ring-1 ring-line">
                      <Icon size={15} />
                    </span>
                    <article className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                        <span className="font-bold text-ink-2">{hourFmt.format(new Date(i.received_at))}</span>
                        <Channel platform={i.platform} kind={i.kind} />
                        <span>· {i.case_type ?? "Sin clasificar"}</span>
                        {d && (
                          <Badge tone={d.tone} icon={d.icon}>
                            {decisionLabel(i as any)}
                          </Badge>
                        )}
                        {v && (
                          <Badge tone={v.tone} icon={v.icon}>
                            {v.label}
                          </Badge>
                        )}
                        <OriginBadge origin={i.post_origin} />
                        {Number(i.analysis_only) === 1 && !i.post_origin && <Badge>Solo para análisis</Badge>}
                        {p && Number(i.open_case) === 1 && (
                          <Link href={`/panel/bandeja?caso=${i.escalation_id}`} className="hover:opacity-80">
                            <Badge tone={p.tone}>En la Bandeja · {p.label}</Badge>
                          </Link>
                        )}
                      </p>
                      {i.kind === "comentario" && (i.post_caption || link) && (
                        <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-ink-3">
                          <span className="truncate">
                            En {PIECE[i.post_type] ?? "la publicación"}
                            {i.post_caption ? ` «${i.post_caption}»` : ""}
                          </span>
                          {link && (
                            <a href={link} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-bold text-ink-2 hover:text-ink">
                              Ver <ExternalLink size={13} aria-hidden />
                            </a>
                          )}
                        </p>
                      )}
                      <p className="mt-2 text-[15px] whitespace-pre-line text-ink">{i.text_masked}</p>
                      {(i.human_reply || i.proposed_reply || i.decision === "ocultar") && (
                        <p className="mt-2 flex gap-1.5 text-[14px] text-ink-2">
                          <CornerDownRight size={15} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                          <span>
                            {i.human_reply ? (
                              <>
                                <strong className="text-ink">Respondió el equipo:</strong> {i.human_reply}
                              </>
                            ) : i.answered_by === "ia" && i.proposed_reply ? (
                              <>
                                <strong className="text-ink">Publicó la plataforma:</strong> {i.proposed_reply}
                              </>
                            ) : i.proposed_reply ? (
                              <>
                                <span className="text-ink-3">La IA propuso, sin publicar:</span> {i.proposed_reply}
                              </>
                            ) : (
                              <span className="text-ink-3">La IA propone ocultarlo.</span>
                            )}
                          </span>
                        </p>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}

export default function Persona({ params }: PageProps<"/panel/interacciones/persona/[id]">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <PersonaContent params={params} />
    </Suspense>
  );
}
