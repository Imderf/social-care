import { Suspense } from "react";
import { Archive, ArchiveRestore, Building2, LogIn, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { listAllClients } from "@/lib/data";
import { memberClientIds } from "@/lib/users";
import { currentClient, currentUser } from "../current";
import { BUTTON, Badge, Empty, PageHeader, Panel, Skeleton, formatDate, plural } from "../ui";
import { archive, create, open } from "./actions";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const SMALL = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-2 transition-colors hover:bg-canvas";

async function ClientesContent() {
  const me = await currentUser("clientes");
  // El administrador ve todos los clientes; las demás personas, solo los que tienen asignados.
  const [everyone, current, mine] = await Promise.all([listAllClients(db), currentClient("clientes"), me.role === "admin" ? null : memberClientIds(db, me.id)]);
  const clients = mine ? everyone.filter((c) => mine.includes(Number(c.id))) : everyone;
  const active = clients.filter((c) => !c.archived_at);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cada cliente tiene sus cuentas de Facebook e Instagram, su matriz, sus plantillas y su aprendizaje. Al crear uno entras en él para conectar sus cuentas."
        actions={<Badge>{plural(active.length, "cliente activo", "clientes activos")}</Badge>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {clients.length === 0 && (
            <Empty title="Sin clientes" icon={Building2}>
              Crea el primero con el formulario de la derecha.
            </Empty>
          )}
          {clients.map((c) => (
            <article key={c.id} className={`flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4 ${c.archived_at ? "opacity-70" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-bold">{c.name}</h2>
                  {c.id === current?.id && !c.archived_at && <Badge tone="solid">Estás aquí</Badge>}
                  {c.archived_at && <Badge tone="warn">Archivado el {formatDate(c.archived_at)}</Badge>}
                </div>
                <p className="mt-1 text-[13px] text-ink-3">
                  {plural(Number(c.accounts), "cuenta conectada", "cuentas conectadas")} · {plural(Number(c.case_types), "tipo de caso", "tipos de caso")} ·{" "}
                  {plural(Number(c.templates), "plantilla", "plantillas")} · {plural(Number(c.interactions), "mensaje", "mensajes")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!c.archived_at && (
                  <form action={open}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className={SMALL}><LogIn size={15} aria-hidden /> Entrar</button>
                  </form>
                )}
                <form action={archive}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="archived" value={c.archived_at ? "0" : "1"} />
                  <button type="submit" className={SMALL}>
                    {c.archived_at ? <><ArchiveRestore size={15} aria-hidden /> Restaurar</> : <><Archive size={15} aria-hidden /> Archivar</>}
                  </button>
                </form>
              </div>
            </article>
          ))}
          <p className="text-[13px] text-ink-3">
            Archivar saca al cliente del selector y desconecta sus cuentas: dejan de entrar mensajes. Sus datos se guardan; al restaurarlo, se vuelven a conectar las cuentas desde Cuentas conectadas.
          </p>
        </div>

        <Panel title="Nuevo cliente">
          <form action={create} className="space-y-3">
            <input name="name" required maxLength={120} placeholder="Nombre, por ejemplo: Droguerías Cafam" aria-label="Nombre" className={FIELD} />
            <label className="block text-[14px] text-ink-2">
              Empieza con
              <select name="copy_from" defaultValue={active[0]?.id ?? ""} className={`${FIELD} mt-1`}>
                {active.map((c) => (
                  <option key={c.id} value={c.id}>La configuración de {c.name}</option>
                ))}
                <option value="">En blanco</option>
              </select>
            </label>
            <p className="text-[13px] text-ink-3">
              Se copian la matriz de respuesta, las plantillas vigentes y la base de conocimiento, para ajustarlas al cliente. Las cuentas, los mensajes y el aprendizaje empiezan de cero.
              En blanco, la IA no responde hasta que armes la matriz: todo pasa a una persona.
            </p>
            <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>
              <Plus size={15} aria-hidden /> Crear y conectar cuentas
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}

export default function Clientes() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ClientesContent />
    </Suspense>
  );
}
