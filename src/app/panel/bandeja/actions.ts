"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { redraftInteraction } from "@/lib/classify";
import { resolveWithoutReply, sendFromInbox, undoInboxSend } from "@/lib/inbox";
import { currentClient } from "../current";

const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim().slice(0, 2000) || null : null);
const back = (formData: FormData, error?: string) => {
  const q = new URLSearchParams({ caso: String(formData.get("id")) });
  if (error) q.set("error", error);
  redirect(`/panel/bandeja?${q}`);
};

// Una persona envía (o corrige y envía) la respuesta del caso; sale a los pocos segundos.
export async function sendReply(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  const r = await sendFromInbox(db, client.id, id, { text: clean(formData.get("text")), hide: formData.get("action") === "ocultar" });
  if (r.error) back(formData, r.error);
  refresh();
}

export async function resolveCase(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await resolveWithoutReply(db, client.id, id);
  redirect("/panel/bandeja");
}

export async function undoSend(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  if ((await undoInboxSend(db, client.id, id)) === "publicada") back(formData, "Ya salió en Meta: si hay que retirarla, se hace desde Meta.");
  refresh();
}

// Otra sugerencia de la IA para el caso, con la indicación que escriba la persona.
export async function redraftReply(formData: FormData) {
  const client = await currentClient();
  const interaction = Number(formData.get("interaction_id"));
  if (!client || !Number.isInteger(interaction)) return;
  await redraftInteraction(db, client.id, interaction, { current: clean(formData.get("text")), hint: clean(formData.get("hint")) });
  refresh();
}
