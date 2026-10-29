"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { KNOWLEDGE_TOPICS, addKnowledge, removeKnowledge, type KnowledgeTopic } from "@/lib/data";
import { dismissSuggestion, excludeExample } from "@/lib/learning";
import { currentClient } from "../current";

const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Agrega un dato a la base, a mano o desde una sugerencia. Todo filtra por el cliente elegido.
export async function addItem(formData: FormData) {
  const client = await currentClient("config");
  const topic = String(formData.get("topic")) as KnowledgeTopic;
  const title = text(formData.get("title"), 200);
  const content = text(formData.get("content"), 2000);
  const validUntil = text(formData.get("valid_until"), 10);
  if (!client || !KNOWLEDGE_TOPICS.includes(topic) || !title || !content) return;
  await addKnowledge(db, client.id, { topic, title, content, validUntil: /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? validUntil : null });
  refresh();
}

export async function removeItem(formData: FormData) {
  const client = await currentClient("config");
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await removeKnowledge(db, client.id, id);
  refresh();
}

export async function forgetExample(formData: FormData) {
  const client = await currentClient("config");
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await excludeExample(db, client.id, id);
  refresh();
}

export async function dismiss(formData: FormData) {
  const client = await currentClient("config");
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await dismissSuggestion(db, client.id, id);
  refresh();
}
