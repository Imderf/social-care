import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, ClipboardCheck, ExternalLink, Inbox, Siren } from "lucide-react";
import { db } from "@/lib/db";
import { ACCURACY_TARGET, getAccuracyByType, getDashboard, getInsights, listOpenEscalations } from "@/lib/data";
import { DataTable, Legend, SENTIMENT_SERIES, SentimentBar, StackedBars } from "./charts";
import { currentClient, overviewFor } from "./current";
import { Badge, Channel, Delta, NoClient, PageHeader, Panel, Segmented, Skeleton, ago, duration, formatDate, pct, plural, OriginBadge } from "./ui";

const PERIODS = ["7", "14", "30"];
const PIECES: Record<string, string> = {
  reel: "Reels", video: "Videos", foto: "Fotos", carrusel: "Carruseles", historia: "Historias", estado: "Estados",
  compartido: "Compartidos", anuncio: "Anuncios", evento: "Eventos", sin_dato: "Sin dato de la pieza",
};
const PIECE: Record<string, string> = { reel: "Reel", video: "Video", foto: "Foto", carrusel: "Carrusel", historia: "Historia", estado: "Estado", compartido: "Compartido", anuncio: "Anuncio", evento: "Evento" };
const PRIORITY = { critica: { label: "Crítica", tone: "critical" }, alta: { label: "Alta", tone: "solid" }, normal: { label: "Normal", tone: "neutral" } } as const;

async function ResumenContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient();
  if (!client) return <NoClient />;
  const { dias } = await searchParams;
  const days = Number(PERIODS.find((p) => p === dias) ?? "14");
  const [d, o, open, types, g] = await Promise.all([
    getDashboard(db, client.id, days),
    overviewFor(client.id),
    listOpenEscalations(db, client.id),
    getAccuracyByType(db, client.id),
    getInsights(db, client.id, days),
  ]);
  const negative = g.totals.total - g.unclassified ? pct(g.totals.negativo, g.totals.total - g.unclassified) : null;

  const live = o.liveAccounts > 0;
  const c = d.current;
  const p = d.previous;
  const share = pct(c.responder, c.received);
  const accuracy = c.verified ? pct(c.correct, c.verified) : null;
  const prevAccuracy = p.verified ? pct(p.correct, p.verified) : null;
  const ready = types.filter((t) => t.status === "listo").length;

  return (
    <>
      <PageHeader
        title="Resumen"
        description={`${client.name} en los últimos ${days} días. ${live ? "Hay cuentas en vivo: la IA publica en los tipos de caso activados." : "Modo prueba: la IA analiza y propone, no publica nada."}`}
        actions={<Segmented label="Periodo" value={String(days)} options={PERIODS.map((v) => ({ value: v, label: `${v} días`, href: `/panel?dias=${v}` }))} />}
      />

      {o.accounts === 0 && (
        <p className="mb-6 flex flex-col gap-2 rounded-xl border border-line bg-surface px-5 py-4 text-[15px] sm:flex-row sm:items-center sm:justify-between">
          <span>
            <strong>Aún no hay cuentas conectadas.</strong> Al conectar una página o un Instagram, entra en modo prueba: la IA analiza y propone sin publicar.
          </span>
          <Link href="/panel/cuentas" className="inline-flex shrink-0 items-center gap-1 font-bold text-brand-ink hover:underline">
            Ver cuentas <ArrowRight size={16} aria-hidden />
          </Link>
        </p>
      )}

      <section aria-labelledby="atencion" className="mb-4 rounded-xl border border-line bg-surface">
        <h2 id="atencion" className="border-b border-line px-5 py-3 text-[15px] font-bold">
          Requiere atención
        </h2>
        <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
          <Attention
            href="/panel/bandeja?prioridad=critica"
            icon={Siren}
            urgent={o.criticalEscalations > 0}
            value={o.criticalEscalations}
            label={o.criticalEscalations === 1 ? "caso crítico" : "casos críticos"}
            hint={o.criticalEscalations ? "Crisis o alto alcance: nada se responde solo" : "Ninguna crisis ni caso de alto alcance abierto"}
          />
          <Attention
            href="/panel/bandeja"
            icon={Inbox}
            value={o.openEscalations}
            label="esperan a una persona"
            hint={o.oldestEscalationAt ? `El más antiguo llegó ${ago(o.oldestEscalationAt)}` : "La bandeja está al día"}
          />
          <Attention
            href="/panel/pruebas"
            icon={ClipboardCheck}
            value={o.toVerify}
            label={o.toVerify === 1 ? "propuesta por verificar" : "propuestas por verificar"}
            hint={ready ? `${plural(ready, "tipo de caso ya llega", "tipos de caso ya llegan")} a la meta de ${ACCURACY_TARGET * 100} %` : "Verificarlas mide si la IA está lista"}
          />
        </div>
      </section>

      <section aria-label="Indicadores del periodo" className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Recibidos" value={c.received}>
          <Delta now={c.received} before={p.received} goodWhenUp={null} />
          <p className="mt-1 text-[13px] text-ink-3">
            {d.channels.ig} Instagram y {d.channels.fb} Facebook · {d.channels.dm} fueron DM
          </p>
        </Stat>
        <Stat label={live ? "Respondidos por la IA" : "La IA respondería sola"} value={`${share} %`}>
          <Delta now={share} before={p.received ? pct(p.responder, p.received) : null} mode="points" />
          <p className="mt-1 text-[13px] text-ink-3">
            {c.responder} de {c.received}; el resto pasa a una persona o se oculta
          </p>
        </Stat>
        <Stat label="Propuestas correctas" value={accuracy != null ? `${accuracy} %` : "—"}>
          {accuracy != null ? <Delta now={accuracy} before={prevAccuracy} mode="points" /> : <span className="text-[13px] text-ink-3">Sin verificaciones en el periodo</span>}
          <p className="mt-1 text-[13px] text-ink-3">
            {plural(c.verified, "verificada", "verificadas")} por el equipo · meta {ACCURACY_TARGET * 100} %
          </p>
        </Stat>
        <Stat label="Primera respuesta del equipo" value={duration(d.team.median)}>
          <Delta now={d.team.median ?? 0} before={d.prevTeam.median} goodWhenUp={false} />
          <p className="mt-1 text-[13px] text-ink-3">Mediana · 9 de cada 10 en menos de {duration(d.team.p90)}</p>
        </Stat>
      </section>

      <h2 className="mt-8 mb-3 text-lg font-bold">Lo que dice la gente</h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Sentimiento, por día"
          className="xl:col-span-2"
          action={negative != null && <Badge tone={negative >= 30 ? "warn" : "neutral"}>{negative} % negativo</Badge>}
        >
          <Legend totals={g.totals} series={SENTIMENT_SERIES} />
          <div className="mt-4">
            <StackedBars data={g.daily} series={SENTIMENT_SERIES} label="Comentarios y mensajes por día, según su sentimiento" />
          </div>
          <DataTable data={g.daily} series={SENTIMENT_SERIES} />
          {g.unclassified > 0 && <p className="mt-2 text-[13px] text-ink-3">{plural(g.unclassified, "mensaje está", "mensajes están")} sin clasificar todavía.</p>}
        </Panel>

        <div className="space-y-4">
          <Panel title="Por canal" bodyClass="divide-y divide-line">
            {g.channels.length === 0 ? (
              <p className="px-5 py-4 text-[14px] text-ink-3">Sin mensajes en el periodo.</p>
            ) : (
              g.channels.map((c) => (
                <div key={`${c.platform}-${c.kind}`} className="space-y-1.5 px-5 py-3">
                  <p className="flex items-center justify-between gap-2 text-[14px]">
                    <Channel platform={c.platform} kind={c.kind} />
                    <span className="font-bold tabular-nums">{c.total}</span>
                  </p>
                  <SentimentBar counts={c} />
                </div>
              ))
            )}
          </Panel>
          <Panel title="Comentarios por tipo de pieza" bodyClass="divide-y divide-line">
            {g.pieces.length === 0 ? (
              <p className="px-5 py-4 text-[14px] text-ink-3">Sin comentarios en el periodo.</p>
            ) : (
              g.pieces.map((x) => (
                <div key={x.type} className="space-y-1.5 px-5 py-3">
                  <p className="flex items-center justify-between gap-2 text-[14px]">
                    <span className="text-ink-2">{PIECES[x.type] ?? x.type}</span>
                    <span className="font-bold tabular-nums">{x.total}</span>
                  </p>
                  <SentimentBar counts={x} />
                </div>
              ))
            )}
          </Panel>
        </div>

        <Panel title="Publicaciones con más conversación" className="xl:col-span-3" bodyClass="divide-y divide-line">
          {g.topPosts.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-ink-3">Todavía no hay comentarios en publicaciones en este periodo.</p>
          ) : (
            g.topPosts.map((x, i) => (
              <div key={x.id} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[2rem_minmax(0,1fr)_9rem_12rem_auto]">
                <span className="text-[14px] font-bold text-ink-3 tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Channel platform={x.platform} />
                    <OriginBadge origin={x.origin} />
                    {x.type && <Badge>{PIECE[x.type] ?? x.type}</Badge>}
                  </p>
                  <p className="mt-1 truncate text-[14px] text-ink-2">{x.caption || "Sin texto en la publicación"}</p>
                </div>
                <p className="text-[14px]">
                  <span className="font-bold tabular-nums">{x.counts.total}</span> <span className="text-ink-3">{x.counts.total === 1 ? "comentario" : "comentarios"}</span>
                </p>
                <SentimentBar counts={x.counts} />
                {x.permalink ? (
                  <a href={x.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-bold text-ink-2 hover:text-ink">
                    Ver <ExternalLink size={14} aria-hidden />
                  </a>
                ) : (
                  <span />
                )}
              </div>
            ))
          )}
        </Panel>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-bold">Qué hace la IA</h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title={live ? "Qué hizo la IA, por día" : "Qué haría la IA, por día"} className="xl:col-span-2">
          <Legend totals={c} />
          <div className="mt-4">
            <StackedBars data={d.daily} />
          </div>
          <DataTable data={d.daily} />
        </Panel>

        <Panel
          title="Precisión por tipo de caso"
          action={
            <Link href="/panel/pruebas" className="inline-flex items-center gap-1 text-[13px] font-bold text-brand-ink hover:underline">
              Verificar <ArrowRight size={14} aria-hidden />
            </Link>
          }
          bodyClass="divide-y divide-line"
        >
          {types.filter((t) => t.proposals > 0).slice(0, 7).map((t) => {
            const acc = t.accuracy != null ? Math.round(t.accuracy * 100) : null;
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                <span className="min-w-0 truncate text-ink-2" title={t.name}>
                  {t.name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-bold">{acc != null ? `${acc} %` : "—"}</span>
                  {t.status === "listo" ? (
                    <CircleCheck size={16} className="text-ok" aria-label="Llega a la meta" />
                  ) : t.status === "bajo" ? (
                    <CircleAlert size={16} className="text-brand-ink" aria-label="Por debajo de la meta" />
                  ) : (
                    <span className="size-4" aria-label="Faltan verificaciones" />
                  )}
                </span>
              </div>
            );
          })}
          {types.every((t) => t.proposals === 0) && <p className="px-5 py-6 text-center text-[14px] text-ink-3">Todavía no hay propuestas.</p>}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Bandeja ahora"
          action={
            <Link href="/panel/bandeja" className="inline-flex items-center gap-1 text-[13px] font-bold text-brand-ink hover:underline">
              Abrir <ArrowRight size={14} aria-hidden />
            </Link>
          }
          bodyClass=""
        >
          {open.length === 0 ? (
            <p className="px-5 py-8 text-center text-[15px] text-ink-3">No hay casos esperando a una persona.</p>
          ) : (
            <ul className="divide-y divide-line">
              {open.slice(0, 5).map((e) => {
                const pr = PRIORITY[e.priority as keyof typeof PRIORITY];
                return (
                  <li key={e.id}>
                    <Link href={`/panel/bandeja?caso=${e.id}`} className="block px-5 py-3 hover:bg-canvas/70">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={pr.tone}>{pr.label}</Badge>
                        <Channel platform={e.platform} kind={e.kind} />
                        <span className="ml-auto text-[12px] text-ink-3">{ago(e.created_at)}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[14px] text-ink-2">{e.text_masked}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Salud y configuración" bodyClass="divide-y divide-line px-5">
          <Row label="Cuentas conectadas" value={`${o.connectedAccounts} de ${o.accounts}`} ok={o.connectedAccounts > 0 ? true : o.accounts ? false : undefined} href="/panel/cuentas" />
          <Row label="Último aviso de Meta" value={o.lastWebhookAt ? ago(o.lastWebhookAt) : "Ninguno aún"} ok={o.lastWebhookAt ? true : undefined} title={formatDate(o.lastWebhookAt)} />
          <Row label="Trabajos en cola / con error" value={`${o.queuePending} / ${o.queueDead}`} ok={o.queueDead === 0} />
          <Row label="Tipos de caso automáticos" value={`${o.automaticTypes} de ${o.caseTypes}`} href="/panel/matriz" />
          <Row label="Plantillas" value={o.templates} href="/panel/plantillas" />
          <Row label="Datos en la base de conocimiento" value={o.knowledge} ok={o.knowledge >= 10} href="/panel/conocimiento" />
        </Panel>
      </div>
    </>
  );
}

function Attention({ href, icon: Icon, value, label, hint, urgent = false }: { href: string; icon: typeof Inbox; value: number; label: string; hint: string; urgent?: boolean }) {
  return (
    <Link href={href} className="group flex items-start gap-3 px-5 py-4 hover:bg-canvas/70">
      <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${urgent ? "bg-brand-ink text-white" : "bg-canvas text-ink-2"}`}>
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5">
          <span className={`text-[26px] leading-none font-bold ${urgent ? "text-brand-ink" : ""}`}>{value}</span>
          <span className="text-[14px] font-bold text-ink-2">{label}</span>
        </span>
        <span className="mt-1 block text-[13px] text-ink-3 group-hover:text-ink-2">{hint}</span>
      </span>
    </Link>
  );
}

function Stat({ label, value, children }: { label: string; value: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <h2 className="text-[14px] font-bold text-ink-3">{label}</h2>
      <p className="mt-1.5 text-[30px] leading-none font-bold tracking-tight">{value}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function Row({ label, value, ok, href, title }: { label: string; value: React.ReactNode; ok?: boolean; href?: string; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-[14px]">
      <span className="flex items-center gap-2 text-ink-2">
        <span className="grid size-4 place-items-center">
          {ok === true && <CircleCheck size={16} className="text-ok" aria-label="Bien" />}
          {ok === false && <CircleAlert size={16} className="text-warn" aria-label="Revisar" />}
        </span>
        {href ? (
          <Link href={href} className="hover:text-ink hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </span>
      <span className="text-right font-bold" title={title}>
        {value}
      </span>
    </div>
  );
}

export default function Resumen({ searchParams }: PageProps<"/panel">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <ResumenContent searchParams={searchParams} />
    </Suspense>
  );
}
