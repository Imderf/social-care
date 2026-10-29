"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { panelUrl } from "@/lib/meta";
import { UserError, createUser, inviteUser, resetPassword, setActive, unlockUser, updateUser } from "@/lib/users";
import { currentUser } from "../current";
import type { FormState } from "./types";

// Solo administradores (currentUser("usuarios") los revisa en cada acción). Los errores de reglas
// (último administrador, usuario repetido…) vuelven al formulario; cualquier otro error sube.
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const linkFor = (token: string) => `${panelUrl().replace(/\/$/, "")}/crear-clave?t=${token}`;
const echo = (fd: FormData) => Object.fromEntries(["name", "username", "email", "role"].map((k) => [k, text(fd, k)]));
const clientIds = (fd: FormData) => fd.getAll("clients").map(Number);
function fail(e: unknown, fd?: FormData): FormState {
  if (e instanceof UserError) return { error: e.message, values: fd ? echo(fd) : undefined };
  throw e;
}

export async function create(_: FormState, fd: FormData): Promise<FormState> {
  const me = await currentUser("usuarios");
  try {
    const r = await createUser(db, me.id, { username: fd.get("username"), name: fd.get("name"), email: fd.get("email"), role: fd.get("role"), clientIds: clientIds(fd), mode: fd.get("mode") });
    refresh();
    return { ok: r.token ? `Listo: ${r.username} ya tiene su enlace.` : `Listo: ${r.username} ya puede ingresar.`, credentials: { username: r.username, password: r.password ?? undefined, link: r.token ? linkFor(r.token) : undefined } };
  } catch (e) {
    return fail(e, fd);
  }
}

export async function update(userId: number, _: FormState, fd: FormData): Promise<FormState> {
  const me = await currentUser("usuarios");
  try {
    await updateUser(db, me.id, userId, { name: fd.get("name"), email: fd.get("email"), role: fd.get("role"), clientIds: clientIds(fd) });
    refresh();
    return { ok: "Cambios guardados." };
  } catch (e) {
    return fail(e);
  }
}

export async function reset(userId: number): Promise<FormState> {
  const me = await currentUser("usuarios");
  try {
    const r = await resetPassword(db, me.id, userId);
    refresh();
    return { ok: "Contraseña restablecida. Sus sesiones se cerraron.", credentials: r };
  } catch (e) {
    return fail(e);
  }
}

// Enlace nuevo para que la persona cree su contraseña (sirve también para restablecerla; anula el enlace anterior).
export async function invite(userId: number): Promise<FormState> {
  const me = await currentUser("usuarios");
  try {
    const r = await inviteUser(db, me.id, userId);
    refresh();
    return { ok: "Enlace nuevo. Su contraseña anterior ya no entra y el enlace anterior dejó de servir.", credentials: { username: r.username, link: linkFor(r.token) } };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleActive(userId: number, active: boolean): Promise<FormState> {
  const me = await currentUser("usuarios");
  try {
    await setActive(db, me.id, userId, active);
    refresh();
    return { ok: active ? "Cuenta reactivada." : "Cuenta desactivada. Su sesión se cerró." };
  } catch (e) {
    return fail(e);
  }
}

export async function unlock(userId: number): Promise<FormState> {
  const me = await currentUser("usuarios");
  try {
    await unlockUser(db, me.id, userId);
    refresh();
    return { ok: "Bloqueo quitado: ya puede volver a intentar." };
  } catch (e) {
    return fail(e);
  }
}
