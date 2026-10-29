"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { openSession } from "@/lib/session-cookie";
import { UserError, changeOwnPassword } from "@/lib/users";
import { currentUser } from "../current";

export type PasswordState = { error?: string } | null;

// La persona cambia su propia contraseña (también la temporal del primer ingreso). Cambiarla cierra las demás
// sesiones, así que aquí mismo se abre la nueva.
export async function changePassword(_: PasswordState, fd: FormData): Promise<PasswordState> {
  const me = await currentUser(undefined, true);
  try {
    await changeOwnPassword(db, me.id, String(fd.get("actual") ?? ""), String(fd.get("nueva") ?? ""), String(fd.get("repetir") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await openSession(me.id);
  redirect("/panel");
}
