"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createClientBy, setClientArchived } from "@/lib/data";
import { memberClientIds } from "@/lib/users";
import { currentUser } from "../current";

const enter = async (id: number) => (await cookies()).set("cliente", String(id), { httpOnly: true, sameSite: "lax", path: "/" });

// Crea el cliente, entra en él y lleva a Cuentas conectadas para conectar Facebook e Instagram.
export async function create(formData: FormData) {
  const me = await currentUser("clientes");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const from = Number(formData.get("copy_from"));
  if (!name) return;
  const id = await createClientBy(db, me, name, Number.isInteger(from) && from > 0 ? from : null);
  await enter(id);
  redirect("/panel/cuentas");
}

// El administrador actúa sobre cualquier cliente; las demás personas, solo sobre los suyos.
const mayAct = async (me: { id: number; role: string }, id: number) => me.role === "admin" || (await memberClientIds(db, me.id)).includes(id);

export async function open(formData: FormData) {
  const me = await currentUser("clientes");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0 || !(await mayAct(me, id))) return;
  await enter(id);
  redirect("/panel");
}

export async function archive(formData: FormData) {
  const me = await currentUser("clientes");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0 || !(await mayAct(me, id))) return;
  await setClientArchived(db, id, formData.get("archived") === "1");
  refresh();
}
