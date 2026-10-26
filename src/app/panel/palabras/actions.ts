"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { addForbidden, removeForbidden } from "@/lib/forbidden";
import { currentClient } from "../current";

export async function add(formData: FormData) {
  const client = await currentClient();
  const values = String(formData.get("values") ?? "").slice(0, 4000);
  if (!client || !values.trim()) return;
  await addForbidden(db, client.id, values, String(formData.get("note") ?? ""));
  refresh();
}

export async function remove(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await removeForbidden(db, client.id, id);
  refresh();
}
