import { Suspense } from "react";
import { History, Users } from "lucide-react";
import { db } from "@/lib/db";
import { listAllClients } from "@/lib/data";
import { ROLE_LABELS } from "@/lib/permissions";
import { listUserEvents, listUsers } from "@/lib/users";
import { panelUrl } from "@/lib/meta";
import { currentUser } from "../current";
import { Avatar, Badge, Empty, PageHeader, Panel, Skeleton, ago, formatDate, plural } from "../ui";
import { CreateUser, UserActions } from "./controls";

// Cómo se cuenta cada acción en el registro de administración.
const EVENT_TEXT: Record<string, string> = {
  crear: "creó a",
  editar: "editó a",
  restablecer: "restableció la contraseña de",
  invitar: "generó un enlace para crear la contraseña de",
  crear_clave: "creó su contraseña con el enlace",
  desactivar: "desactivó a",
  reactivar: "reactivó a",
  desbloquear: "quitó el bloqueo a",
  cambiar_clave: "cambió su propia contraseña",
};

async function UsuariosContent() {
  const me = await currentUser("usuarios");
  const [users, allClients, events] = await Promise.all([listUsers(db), listAllClients(db), listUserEvents(db)]);
  const clients = allClients.filter((c) => !c.archived_at).map((c) => ({ id: Number(c.id), name: String(c.name) }));
  const active = users.filter((u) => u.active);
  const url = `${panelUrl()}/panel`;

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Quién entra al panel, con qué rol y a qué clientes. Aquí se crean, se les envía un enlace para que cada persona cree su contraseña, se restablece y se desactivan. Los enlaces se muestran una sola vez."
        actions={<Badge>{plural(active.length, "usuario activo", "usuarios activos")}</Badge>}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {users.length === 0 && (
            <Empty title="Sin usuarios" icon={Users}>
              Crea el primero con el formulario de la derecha.
            </Empty>
          )}
          {users.map((u) => {
            const self = u.id === me.id;
            return (
              <article key={u.id} className={`rounded-xl border border-line bg-surface px-5 py-4 ${u.active ? "" : "opacity-75"}`}>
                <div className="flex flex-wrap items-start gap-4">
                  <Avatar name={u.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-bold">{u.name}</h2>
                      <Badge tone={u.role === "admin" ? "solid" : "neutral"}>{ROLE_LABELS[u.role]}</Badge>
                      {self && <Badge>Tú</Badge>}
                      {!u.active && <Badge tone="warn">Desactivado</Badge>}
                      {u.active && u.pending && <Badge tone="warn">Invitación pendiente</Badge>}
                      {u.active && !u.pending && u.mustChange && <Badge tone="warn">Debe cambiar su contraseña</Badge>}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-3">
                      {u.username ? `@${u.username}` : "Sin usuario"}
                      {u.email ? ` · ${u.email}` : ""} · {u.lastLogin ? `Último ingreso ${ago(u.lastLogin)}` : "Todavía no ha ingresado"}
                    </p>
                    <p className="mt-1 text-[13px] text-ink-2">
                      {u.role === "admin" ? "Ve todos los clientes" : u.clients.length ? u.clients.map((c) => c.name).join(", ") : <span className="text-warn">Sin clientes asignados: no verá nada hasta que le asignes uno.</span>}
                    </p>
                  </div>
                  <UserActions
                    user={{ id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, active: u.active, pending: u.pending, clientIds: u.clients.map((c) => c.id) }}
                    self={self}
                    clients={clients}
                    panelUrl={url}
                  />
                </div>
              </article>
            );
          })}
          <p className="text-[13px] text-ink-3">
            Desactivar cierra la sesión al instante y no borra nada: lo que la persona hizo sigue a su nombre. Restablecer deja sin efecto la contraseña actual y cierra sus sesiones: la persona entra con un enlace nuevo (o con una contraseña temporal) y crea la suya.
            Tras 5 intentos fallidos una cuenta se bloquea 15 minutos; «Quitar bloqueo» la libera antes. Siempre queda al menos un administrador activo.
          </p>
        </div>

        <div className="space-y-4">
          <Panel title="Nuevo usuario">
            <CreateUser clients={clients} panelUrl={url} />
          </Panel>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold">
          <History size={16} aria-hidden /> Actividad de administración
        </h2>
        {events.length === 0 ? (
          <p className="text-[13px] text-ink-3">Todavía no hay movimientos.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 px-5 py-2.5 text-[14px] text-ink-2">
                <span>
                  <strong className="text-ink">{e.actor ?? "Alguien"}</strong> {EVENT_TEXT[e.action] ?? e.action}
                  {e.action !== "cambiar_clave" && e.action !== "crear_clave" && <> <strong className="text-ink">{e.target ?? "una persona eliminada"}</strong></>}
                  {e.detail && <span className="text-ink-3"> ({e.detail})</span>}
                </span>
                <span className="text-[13px] text-ink-3">{formatDate(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function Usuarios() {
  return (
    <Suspense fallback={<Skeleton />}>
      <UsuariosContent />
    </Suspense>
  );
}
