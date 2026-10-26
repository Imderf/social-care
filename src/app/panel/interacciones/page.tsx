import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, CornerDownRight, MessagesSquare, Search, UsersRound } from "lucide-react";
import { db } from "@/lib/db";
import { getInfluence, isWatched, listWatch, tierFor } from "@/lib/influence";
import { INTERACTION_FILTERS, countUnidentified, listContacts, listInteractions } from "@/lib/data";
import { SentimentBar } from "../charts";
import { currentClient } from "../current";
import { Avatar, Badge, Channel, DECISION, decisionLabel, Empty, NoClient, PageHeader, Segmented, Skeleton, VERDICT, ago, duration, formatDate, pct, personName, plural, OriginBadge, ProfileBadges } from "../ui";

const FILTER_LABELS: Record<keyof typeof INTERACTION_FILTERS, string> = {
  todas: "Todas",
  responder: "La IA responde",
  escalar: "A una persona",
  ocultar: "Se ocultan",
  sin_respuesta: "Sin respuesta aún",
  ia: "Respondió la IA",
  equipo: "Respondió el equipo",
};

async function InteraccionesContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient();
  if (!client) return <NoClient />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const view = sp.vista === "personas" ? "personas" : "mensajes";
  const views = (
    <Segmented
      label="Ver por"
      value={view}
      options={[
        { href: "/panel/interacciones", label: "Mensajes", value: "mensajes" },
        { href: "/panel/interacciones?vista=personas", label: "Personas", value: "personas" },
      ]}
    />
  );
  if (view === "personas") return <Personas clientId={client.id} q={q} views={views} />;
  const filter = (Object.keys(INTERACTION_FILTERS) as (keyof typeof INTERACTION_FILTERS)[]).find((f) => f === sp.filtro) ?? "todas";
  const rows = await listInteractions(db, client.id, filter, q);
  const link = (f: string) => `/panel/interacciones?${new URLSearchParams({ ...(f !== "todas" && { filtro: f }), ...(q && { q }) })}`;

  return (
    <>
      <PageHeader
        title="Interacciones"
        description="Cada comentario y mensaje con lo que hizo o haría la IA, lo que respondió el equipo y la verificación. Los datos personales aparecen enmascarados."
        actions={views}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Filtro" className="flex gap-1 overflow-x-auto">
          {(Object.keys(FILTER_LABELS) as (keyof typeof FILTER_LABELS)[]).map((f) => (
            <Link
              key={f}
              href={link(f)}
              aria-current={f === filter ? "true" : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-bold ${f === filter ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>
        <form className="relative w-full lg:w-72" role="search">
          {filter !== "todas" && <input type="hidden" name="filtro" value={filter} />}
          <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar texto o usuario"
            aria-label="Buscar en interacciones"
            className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9 text-[14px] placeholder:text-ink-3 hover:border-line-strong"
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={filter === "todas" && !q ? "Todavía no llega nada" : "Nada con este filtro"} icon={MessagesSquare}>
          {filter === "todas" && !q ? "Las interacciones aparecen apenas una página o un Instagram conectado reciba comentarios o mensajes." : "Prueba con otro filtro u otra búsqueda."}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[1040px] text-left text-[14px]">
            <thead className="border-b border-line bg-canvas/60 text-[13px] text-ink-3">
              <tr>
                {["Recibido", "Comentario", "La IA", "Respuesta", "Verificación", "Equipo"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-bold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const d = r.decision ? DECISION[r.decision] : null;
                const v = r.verdict ? VERDICT[r.verdict] : null;
                const wait = r.first_response_at ? (new Date(r.first_response_at).getTime() - new Date(r.received_at).getTime()) / 1000 : null;
                return (
                  <tr key={r.id} className="align-top hover:bg-canvas/50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-ink-2">{ago(r.received_at)}</p>
                      <p className="text-[12px] text-ink-3">{formatDate(r.received_at)}</p>
                    </td>
                    <td className="max-w-sm min-w-[260px] px-4 py-3">
                      <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
                        {r.contact_id ? (
                          <Link href={`/panel/interacciones/persona/${r.contact_id}`} className="font-bold hover:text-brand-ink hover:underline">
                            {personName(r as any)}
                          </Link>
                        ) : (
                          r.username && <span className="font-bold">{personName(r as any)}</span>
                        )}
                        <Channel platform={r.platform} kind={r.kind} />
                        <OriginBadge origin={r.post_origin} />
                      </p>
                      <p className="mt-1 line-clamp-3 text-ink-2">{r.text_masked}</p>
                    </td>
                    <td className="min-w-[180px] px-4 py-3">
                      {d && (
                        <Badge tone={d.tone} icon={d.icon}>
                          {decisionLabel(r as any)}
                        </Badge>
                      )}
                      <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-2" title={r.case_type ?? undefined}>
                        {r.case_type ?? "Sin clasificar"}
                      </p>
                      {r.confidence != null && <p className="text-[12px] text-ink-3">Confianza {pct(Number(r.confidence), 1)} %</p>}
                    </td>
                    <td className="max-w-sm min-w-[260px] px-4 py-3">
                      {r.proposed_reply ? (
                        <p className="flex gap-1.5 text-[13px] text-ink-2">
                          <CornerDownRight size={14} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
                          <span>
                            {r.proposed_template && <span className="mr-1 rounded bg-canvas px-1 font-bold text-ink ring-1 ring-line ring-inset">{r.proposed_template}</span>}
                            <span className="line-clamp-3">{r.proposed_reply}</span>
                          </span>
                        </p>
                      ) : (
                        <span className="text-[13px] text-ink-3">{r.decision === "ocultar" ? "Ocultar el comentario" : "Sin respuesta automática"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v ? (
                        <Badge tone={v.tone} icon={v.icon}>
                          {v.label}
                        </Badge>
                      ) : r.decision === "responder" || r.decision === "ocultar" ? (
                        <Link href="/panel/pruebas" className="text-[13px] font-bold text-brand-ink hover:underline">
                          Verificar
                        </Link>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[13px]">
                      {r.answered_by === "persona" ? (
                        <span className="text-ink-2" title={r.human_reply ?? undefined}>
                          Respondió en {duration(wait)}
                        </span>
                      ) : r.answered_by === "ia" ? (
                        <span className="text-ink-2">Publicó la IA</span>
                      ) : (
                        <Badge tone="warn">Sin respuesta</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
            Últimas {rows.length} interacciones{q ? ` que contienen “${q}”` : ""}. La IA responde sola solo si la confianza supera el umbral del tipo de caso.
          </p>
        </div>
      )}
    </>
  );
}

// Quienes han escrito, la más reciente primero. Cada una abre su ficha con todo su historial.
async function Personas({ clientId, q, views }: { clientId: number; q: string; views: React.ReactNode }) {
  const [people, unidentified, inf, watch] = await Promise.all([listContacts(db, clientId, q), countUnidentified(db, clientId), getInfluence(db, clientId), listWatch(db, clientId)]);
  return (
    <>
      <PageHeader
        title="Interacciones"
        description="Las personas que han escrito a las cuentas conectadas. Entra a cada una para ver todo lo que ha comentado y escrito por DM, con lo que hizo la IA y lo que respondió el equipo."
        actions={views}
      />
      <form className="relative mb-4 w-full lg:w-80" role="search">
        <input type="hidden" name="vista" value="personas" />
        <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre o usuario"
          aria-label="Buscar persona"
          className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9 text-[14px] placeholder:text-ink-3 hover:border-line-strong"
        />
      </form>

      {people.length === 0 ? (
        <Empty title={q ? "Nadie con ese nombre" : "Todavía nadie ha escrito"} icon={UsersRound}>
          {q ? "Prueba con otra parte del nombre o del usuario." : "Las personas aparecen apenas comentan o escriben por DM a una cuenta conectada."}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_11rem_9rem_10rem_9rem] gap-3 border-b border-line bg-canvas/60 px-5 py-3 text-[13px] font-bold text-ink-3 md:grid">
            <span>Persona</span>
            <span>Actividad</span>
            <span>Último mensaje</span>
            <span>Sentimiento</span>
            <span>Bandeja</span>
          </div>
          <ul className="divide-y divide-line">
            {people.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/panel/interacciones/persona/${p.id}`}
                  className="grid items-center gap-x-3 gap-y-2 px-5 py-3.5 hover:bg-canvas/60 md:grid-cols-[minmax(0,1.6fr)_11rem_9rem_10rem_9rem]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={p.username} />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-bold">{personName(p as any)}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Channel platform={p.platform} />
                        <ProfileBadges tier={tierFor(p.followers, inf)} important={isWatched(p.username, watch)} />
                      </span>
                    </span>
                  </span>
                  <span className="text-[13px] text-ink-2">
                    {plural(Number(p.comments), "comentario", "comentarios")} · {Number(p.dms)} DM
                  </span>
                  <span className="text-[13px] text-ink-2">{ago(p.last_at)}</span>
                  <SentimentBar counts={{ positivo: Number(p.positivo), neutral: Number(p.neutral), negativo: Number(p.negativo) }} />
                  <span className="flex items-center justify-between gap-2">
                    {Number(p.open_cases) > 0 ? <Badge tone="critical">{plural(Number(p.open_cases), "caso abierto", "casos abiertos")}</Badge> : <span className="text-[13px] text-ink-3">Sin casos</span>}
                    <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-3" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-2.5 text-[12px] text-ink-3">
            {plural(people.length, "persona", "personas")}{q ? ` que coinciden con “${q}”` : ""}, la más reciente primero.
            {unidentified > 0 && ` ${plural(unidentified, "comentario del historial no trae", "comentarios del historial no traen")} el autor: Meta no lo entrega al importar, así que no se puede agrupar por persona. Lo que llega en vivo sí lo trae.`}
          </p>
        </div>
      )}
    </>
  );
}

export default function Interacciones({ searchParams }: PageProps<"/panel/interacciones">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <InteraccionesContent searchParams={searchParams} />
    </Suspense>
  );
}
