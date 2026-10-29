"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createClient, setClientArchived } from "@/lib/data";
import { currentUser } from "../current";

const enter = async (id: number) => (await cookies()).set("cliente", String(id), { httpOnly: true, sameSite: "lax", path: "/" });

// Crea el cliente, entra en él y lleva a Cuentas conectadas para conectar Facebook e Instagram.
export async function create(formData: FormData) {
  await currentUser("config");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const from = Number(formData.get("copy_from"));
  if (!name) return;
  const id = await createClient(db, name, Number.isInteger(from) && from > 0 ? from : null);
  await enter(id);
  redirect("/panel/cuentas");
}

export async function open(formData: FormData) {
  await currentUser("config");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  await enter(id);
  redirect("/panel");
}

export async function archive(formData: FormData) {
  await currentUser("config");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  await setClientArchived(db, id, formData.get("archived") === "1");
  refresh();
}
