"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { memberClientIds } from "@/lib/users";
import { currentUser } from "./current";

// Al cambiar la cookie en una acción, Next vuelve a renderizar la página con el cliente nuevo.
// Quien no es administrador solo puede elegir entre sus clientes (currentClient lo vuelve a revisar al leerla).
export async function selectClient(id: number) {
  const me = await currentUser();
  if (!Number.isInteger(id) || id <= 0) return;
  if (me.role !== "admin" && !(await memberClientIds(db, me.id)).includes(id)) return;
  (await cookies()).set("cliente", String(id), { httpOnly: true, sameSite: "lax", path: "/" });
}
