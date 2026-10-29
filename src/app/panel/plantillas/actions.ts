"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { saveTemplate, setTemplateActive } from "@/lib/data";
import { currentClient } from "../current";

const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const CHANNELS = ["publico", "dm"] as const;

// Crea una plantilla o una versión nueva de una existente. Todo filtra por el cliente elegido.
export async function save(formData: FormData) {
  const client = await currentClient("config");
  const code = text(formData.get("code"), 20).toUpperCase();
  const channel = String(formData.get("channel")) as (typeof CHANNELS)[number];
  const name = text(formData.get("name"), 200);
  const body = text(formData.get("body"), 2000);
  const whenToUse = text(formData.get("when_to_use"), 500);
  if (!client || !/^[A-Z0-9_]{1,20}$/.test(code) || !CHANNELS.includes(channel) || !name || !body) return;
  await saveTemplate(db, client.id, { code, channel, name, body, whenToUse });
  refresh();
}

export async function toggle(formData: FormData) {
  const client = await currentClient("config");
  const code = text(formData.get("code"), 20);
  const channel = String(formData.get("channel"));
  if (!client || !code || !CHANNELS.includes(channel as any)) return;
  await setTemplateActive(db, client.id, code, channel, formData.get("active") === "1");
  refresh();
}
