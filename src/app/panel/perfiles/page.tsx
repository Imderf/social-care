import { Suspense } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Plus, Star, X } from "lucide-react";
import { db } from "@/lib/db";
import { TIERS, TIER_LABELS, getInfluence, listImportant } from "@/lib/influence";
import { currentClient } from "../current";
import { BUTTON, Badge, Empty, NoClient, PageHeader, Panel, Segmented, Skeleton, plural } from "../ui";
import { addWatched, removeWatched, saveLevels } from "./actions";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const n = (v: number) => v.toLocaleString("es-CO");

// Qué deja saber Meta de quien escribe, por canal (documentación revisada el 2026-10-26).
const CHANNELS = [
  ["Instagram, mensaje privado", "Seguidores y si la cuenta está verificada, de cualquier cuenta."],
  ["Instagram, comentarios", "Seguidores de las cuentas de empresa o creador (casi todos los influenciadores las usan). Necesita el permiso instagram_manage_insights en la app de Meta. De las cuentas personales no se sabe nada."],
  ["Facebook, comentarios", "Si quien comenta es una página, sus seguidores. De una persona no se sabe nada."],
  ["Facebook, Messenger", "Nada: Meta no da seguidores ni verificación."],
] as const;

async function PerfilesContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient();
  if (!client) return <NoClient />;
  const sp = await searchParams;
  const view = sp.vista === "influenciadores" ? "influenciadores" : "importantes";
  const tabs = (
    <Segmented
      label="Ver"
      value={view}
      options={[
        { href: "/panel/perfiles", label: "Personas importantes", value: "importantes" },
        { href: "/panel/perfiles?vista=influenciadores", label: "Influenciadores", value: "influenciadores" },
      ]}
    />
  );
  return view === "importantes" ? <Importantes clientId={client.id} tabs={tabs} /> : <Influenciadores clientId={client.id} tabs={tabs} sp={sp} />;
}

// Personas importantes: cuando escriben, el mensaje va directo a la Bandeja y lo atiende una persona.
async function Importantes({ clientId, tabs }: { clientId: number; tabs: React.ReactNode }) {
  const people = await listImportant(db, clientId);
  return (
    <>
      <PageHeader
        title="Perfiles e influenciadores"
        description="Personas importantes para la marca: periodistas, medios, influenciadores, directivos o aliados. Cuando una de ellas comenta o escribe por DM, el mensaje va directo a la Bandeja con prioridad alta y la IA no responde sola: lo atiende una persona."
      />
      <div className="mb-5">{tabs}</div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {people.length === 0 ? (
            <Empty title="Todavía no hay personas importantes" icon={Star}>
              Agrega el usuario de Instagram (con o sin @) o el nombre de la persona o página en Facebook.
            </Empty>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                  <Star size={16} aria-hidden className="shrink-0 text-brand-ink" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold">{p.value}</p>
                    <p className="text-[13px] text-ink-3">
                      {p.note ?? "Sin descripción"} ·{" "}
                      {p.contact_id ? (
                        <Link href={`/panel/interacciones/persona/${p.contact_id}`} className="font-bold text-ink-2 hover:text-ink hover:underline">
                          {plural(Number(p.messages), "mensaje", "mensajes")}
                        </Link>
                      ) : (
                        "todavía no ha escrito"
                      )}
                    </p>
                  </div>
                  <form action={removeWatched}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" aria-label={`Quitar ${p.value}`} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-canvas hover:text-ink">
                      <X size={16} aria-hidden />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-ink-3">
            En Instagram se reconoce por el usuario, que es único. En Facebook se reconoce por el nombre que muestra Meta, que puede repetirse entre personas.
          </p>
        </div>
        <Panel title="Agregar persona importante">
          <form action={addWatched} className="space-y-3">
            <label className="block text-[14px] text-ink-2">
              Usuario o nombre
              <textarea name="values" required rows={3} placeholder="@usuario, uno por línea o separados por coma" className={`${FIELD} mt-1`} />
            </label>
            <label className="block text-[14px] text-ink-2">
              Quién es (opcional)
              <input name="note" maxLength={255} placeholder="Por ejemplo: periodista de Noticias Caracol" className={`${FIELD} mt-1`} />
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

async function Influenciadores({ clientId, tabs, sp }: { clientId: number; tabs: React.ReactNode; sp: Record<string, string | string[] | undefined> }) {
  const inf = await getInfluence(db, clientId);
  const error = typeof sp.error === "string" ? sp.error : null;
  const levels = [
    { key: "comun", range: `menos de ${n(inf.nano)}` },
    { key: "nano", range: `${n(inf.nano)} a ${n(inf.micro - 1)}` },
    { key: "micro", range: `${n(inf.micro)} a ${n(inf.macro - 1)}` },
    { key: "macro", range: `${n(inf.macro)} a ${n(inf.mega - 1)}` },
    { key: "mega", range: `${n(inf.mega)} o más` },
  ] as const;
  const escalates = (k: string) => TIERS.indexOf(k as any) >= TIERS.indexOf(inf.escalateFrom);

  return (
    <>
      <PageHeader
        title="Perfiles e influenciadores"
        description="La plataforma mira el perfil de quien comenta o escribe y lo clasifica por seguidores. Desde el nivel que elijas, el caso pasa a una persona para darle una respuesta especial, y la IA no responde sola. Una cuenta verificada también pasa a una persona."
      />
      <div className="mb-5">{tabs}</div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Niveles por seguidores" className="lg:col-span-2">
          {error && (
            <p role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
              <CircleAlert size={15} aria-hidden className="shrink-0" /> {error}
            </p>
          )}
          {sp.guardado && !error && (
            <p role="status" className="mb-3 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
              <CircleCheck size={15} aria-hidden className="shrink-0" /> Niveles guardados. Aplican desde el siguiente mensaje.
            </p>
          )}
          <ul className="mb-5 divide-y divide-line rounded-lg border border-line">
            {levels.map((l) => (
              <li key={l.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[14px]">
                <span className="font-bold">{TIER_LABELS[l.key]}</span>
                <span className="flex items-center gap-2 text-ink-2">
                  {l.range} seguidores
                  {escalates(l.key) ? <Badge tone="warn">Pasa a una persona</Badge> : <Badge>Flujo normal</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <form action={saveLevels} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              {(["nano", "micro", "macro", "mega"] as const).map((k) => (
                <label key={k} className="block text-[14px] text-ink-2">
                  {TIER_LABELS[k].replace("influenciador", "")} desde
                  <input name={k} inputMode="numeric" required defaultValue={inf[k]} className={`${FIELD} mt-1 tabular-nums`} />
                </label>
              ))}
            </div>
            <label className="block text-[14px] text-ink-2 sm:w-1/2">
              Pasa a una persona desde
              <select name="escalate_from" defaultValue={inf.escalateFrom} className={`${FIELD} mt-1`}>
                {(["nano", "micro", "macro", "mega"] as const).map((k) => (
                  <option key={k} value={k}>{TIER_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>Guardar niveles</button>
          </form>
          <p className="mt-4 text-[13px] text-ink-3">
            Cortes de referencia: Influencer Marketing Hub (micro desde 10.000, macro desde 100.000). HypeAuditor usa micro de 10.000 a 50.000 y macro desde 500.000.
          </p>
        </Panel>
        <Panel title="Qué se puede saber en cada canal">
          <dl className="space-y-3 text-[14px]">
            {CHANNELS.map(([c, what]) => (
              <div key={c}>
                <dt className="font-bold">{c}</dt>
                <dd className="text-ink-2">{what}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[13px] text-ink-3">Para quien no tiene datos, agrégalo en Personas importantes. El perfil se consulta la primera vez que alguien escribe y se renueva cada 7 días.</p>
        </Panel>
      </div>
    </>
  );
}

export default function Perfiles({ searchParams }: PageProps<"/panel/perfiles">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <PerfilesContent searchParams={searchParams} />
    </Suspense>
  );
}
