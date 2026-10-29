"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2, LockOpen, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import { ROLES, ROLE_HELP, ROLE_LABELS, type Role } from "@/lib/permissions";
import { create, reset, toggleActive, unlock, update } from "./actions";
import type { FormState } from "./types";

// Formularios y botones de Usuarios. Las contraseñas temporales salen de la acción una sola vez y solo
// viven en esta pantalla: no se guardan en ninguna parte.

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const SMALL = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-2 transition-colors hover:bg-canvas disabled:opacity-50";
const PRIMARY = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-[13px] font-bold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50";

type ClientOption = { id: number; name: string };

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p role="alert" className="rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">{state.error}</p>;
  if (state?.ok && !state.credentials) return <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">{state.ok}</p>;
  return null;
}

// Datos listos para mandar a la persona. La contraseña es temporal y pide cambio en el primer ingreso.
export function Credentials({ credentials, panelUrl, title }: { credentials: { username: string; password: string }; panelUrl: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Panel: ${panelUrl}\nUsuario: ${credentials.username}\nContraseña temporal: ${credentials.password}\nAl ingresar, la plataforma te pedirá crear tu propia contraseña.`;
  return (
    <div role="status" className="space-y-3 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3.5 text-[14px]">
      <p className="font-bold text-ok">{title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
        <dt className="text-ink-3">Usuario</dt>
        <dd className="font-bold">{credentials.username}</dd>
        <dt className="text-ink-3">Contraseña temporal</dt>
        <dd className="font-mono text-[15px] font-bold tracking-wide whitespace-nowrap select-all">{credentials.password}</dd>
      </dl>
      <p className="text-[13px] text-ink-2">Se muestra una sola vez y no queda guardada: cópiala ahora. La persona tendrá que cambiarla al ingresar.</p>
      <button
        type="button"
        className={SMALL}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            /* sin permiso del navegador: la contraseña queda seleccionable arriba */
          }
        }}
      >
        {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Copiado" : "Copiar datos para enviar"}
      </button>
    </div>
  );
}

function RoleAndClients({ role, setRole, clients, selected }: { role: Role; setRole: (r: Role) => void; clients: ClientOption[]; selected: number[] }) {
  return (
    <>
      <label className="block text-[14px] text-ink-2">
        Rol
        <select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={`${FIELD} mt-1`}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <span className="mt-1 block text-[13px] text-ink-3">{ROLE_HELP[role]}</span>
      </label>
      {role === "admin" ? (
        <p className="text-[13px] text-ink-3">Los administradores ven todos los clientes.</p>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="text-[14px] text-ink-2">Clientes que puede ver</legend>
          {clients.length === 0 && <p className="text-[13px] text-ink-3">Todavía no hay clientes.</p>}
          {clients.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[14px] text-ink-2">
              <input type="checkbox" name="clients" value={c.id} defaultChecked={selected.includes(c.id)} className="size-4 accent-[var(--color-brand-ink)]" />
              {c.name}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}

export function CreateUser({ clients, panelUrl }: { clients: ClientOption[]; panelUrl: string }) {
  const [state, action, pending] = useActionState(create, null);
  const [role, setRole] = useState<Role>("operador");
  const v = state?.values;
  return (
    <div className="space-y-3">
      {state?.credentials && <Credentials credentials={state.credentials} panelUrl={panelUrl} title={state.ok ?? "Usuario creado"} />}
      <form action={action} className="space-y-3">
        <Message state={state} />
        <label className="block text-[14px] text-ink-2">
          Nombre
          <input name="name" required maxLength={200} autoComplete="off" defaultValue={v?.name} className={`${FIELD} mt-1`} />
        </label>
        <label className="block text-[14px] text-ink-2">
          Usuario
          <input name="username" required minLength={3} maxLength={60} autoComplete="off" autoCapitalize="none" spellCheck={false} defaultValue={v?.username} placeholder="por ejemplo: maria.perez" className={`${FIELD} mt-1`} />
        </label>
        <label className="block text-[14px] text-ink-2">
          Correo (opcional)
          <input name="email" type="email" maxLength={255} autoComplete="off" defaultValue={v?.email} className={`${FIELD} mt-1`} />
        </label>
        <RoleAndClients role={role} setRole={setRole} clients={clients} selected={[]} />
        <p className="text-[13px] text-ink-3">La plataforma genera una contraseña temporal. La persona la cambia en su primer ingreso.</p>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Plus size={15} aria-hidden />} Crear usuario
        </button>
      </form>
    </div>
  );
}

type UserLite = { id: number; username: string; name: string; email: string | null; role: Role; active: boolean; clientIds: number[] };

// Botones de una fila: restablecer, desactivar y desbloquear, y el formulario para editar.
export function UserActions({ user, self, clients, panelUrl }: { user: UserLite; self: boolean; clients: ClientOption[]; panelUrl: string }) {
  const [result, setResult] = useState<FormState>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) => start(async () => setResult(await fn()));
  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap gap-2">
        {!self && (
          <button type="button" disabled={pending || !user.active} className={SMALL} onClick={() => confirm(`¿Restablecer la contraseña de ${user.name}? Se cierran sus sesiones y recibe una temporal.`) && run(() => reset(user.id))}>
            <KeyRound size={15} aria-hidden /> Restablecer contraseña
          </button>
        )}
        {!self && (
          <button type="button" disabled={pending} className={SMALL} onClick={() => run(() => toggleActive(user.id, !user.active))}>
            {user.active ? <><UserX size={15} aria-hidden /> Desactivar</> : <><UserCheck size={15} aria-hidden /> Reactivar</>}
          </button>
        )}
        <button type="button" disabled={pending} className={SMALL} onClick={() => run(() => unlock(user.id))}>
          <LockOpen size={15} aria-hidden /> Quitar bloqueo
        </button>
      </div>
      {result?.credentials && <Credentials credentials={result.credentials} panelUrl={panelUrl} title={result.ok ?? "Contraseña restablecida"} />}
      <Message state={result} />
      <EditUser user={user} clients={clients} />
    </div>
  );
}

function EditUser({ user, clients }: { user: UserLite; clients: ClientOption[] }) {
  const [state, action, pending] = useActionState(update.bind(null, user.id), null);
  const [role, setRole] = useState<Role>(user.role);
  return (
    <details className="rounded-lg border border-line bg-canvas">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[13px] font-bold text-ink-2">
        <Pencil size={14} aria-hidden /> Editar datos, rol y clientes
      </summary>
      <form action={action} className="space-y-3 border-t border-line px-3 py-3">
        <Message state={state} />
        <label className="block text-[14px] text-ink-2">
          Nombre
          <input name="name" required maxLength={200} defaultValue={user.name} className={`${FIELD} mt-1`} />
        </label>
        <label className="block text-[14px] text-ink-2">
          Correo (opcional)
          <input name="email" type="email" maxLength={255} defaultValue={user.email ?? ""} className={`${FIELD} mt-1`} />
        </label>
        <RoleAndClients role={role} setRole={setRole} clients={clients} selected={user.clientIds} />
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden />} Guardar cambios
        </button>
      </form>
    </details>
  );
}
