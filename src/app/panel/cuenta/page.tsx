import { Suspense } from "react";
import { CircleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { listClients, listClientsOf } from "@/lib/data";
import { ROLE_HELP, ROLE_LABELS } from "@/lib/permissions";
import { currentUser } from "../current";
import { Badge, PageHeader, Panel, Skeleton } from "../ui";
import { PasswordForm } from "./form";

async function CuentaContent() {
  const me = await currentUser(undefined, true);
  const clients = me.role === "admin" ? await listClients(db) : await listClientsOf(db, me.id);
  return (
    <>
      <PageHeader title="Mi cuenta" description="Tus datos y tu contraseña." />
      {me.mustChange && (
        <p role="status" className="mb-6 flex items-start gap-2.5 rounded-lg border border-brand-ink/20 bg-brand-soft px-4 py-3 text-[14px] text-brand-ink">
          <CircleAlert size={18} aria-hidden className="mt-px shrink-0" />
          Estás usando una contraseña temporal. Crea la tuya para entrar al panel.
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Tus datos">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
            <dt className="text-ink-3">Nombre</dt>
            <dd className="font-bold">{me.name}</dd>
            <dt className="text-ink-3">Usuario</dt>
            <dd className="font-bold">{me.username}</dd>
            <dt className="text-ink-3">Rol</dt>
            <dd>
              <Badge tone={me.role === "admin" ? "solid" : "neutral"}>{ROLE_LABELS[me.role]}</Badge>
              <span className="mt-1 block text-[13px] text-ink-3">{ROLE_HELP[me.role]}</span>
            </dd>
            <dt className="text-ink-3">Clientes</dt>
            <dd>{me.role === "admin" ? "Todos" : clients.length ? clients.map((c) => c.name).join(", ") : "Ninguno asignado todavía"}</dd>
          </dl>
        </Panel>
        <Panel title="Cambiar mi contraseña">
          <PasswordForm />
        </Panel>
      </div>
    </>
  );
}

export default function Cuenta() {
  return (
    <Suspense fallback={<Skeleton />}>
      <CuentaContent />
    </Suspense>
  );
}
