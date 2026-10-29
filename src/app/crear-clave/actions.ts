"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { openSession } from "@/lib/session-cookie";
import { UserError, acceptInvitation } from "@/lib/users";

export type CreatePasswordState = { error?: string } | null;

// La persona elige su contraseña con el enlace que le mandó la administración. El enlace sirve una vez: al guardar
// la contraseña queda gastado y la sesión se abre aquí mismo.
export async function createPassword(token: string, _: CreatePasswordState, fd: FormData): Promise<CreatePasswordState> {
  let id: number;
  try {
    id = await acceptInvitation(db, token, String(fd.get("nueva") ?? ""), String(fd.get("repetir") ?? ""));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await openSession(id);
  redirect("/panel");
}
