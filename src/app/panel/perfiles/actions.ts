"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { TIERS, addWatch, removeWatch, setInfluence, type Influence } from "@/lib/influence";
import { currentClient } from "../current";

const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/\D/g, ""));

export async function saveLevels(formData: FormData) {
  const client = await currentClient("config");
  if (!client) return;
  const from = String(formData.get("escalate_from"));
  const error = await setInfluence(db, client.id, {
    nano: num(formData.get("nano")),
    micro: num(formData.get("micro")),
    macro: num(formData.get("macro")),
    mega: num(formData.get("mega")),
    escalateFrom: (TIERS.includes(from as any) ? from : "micro") as Influence["escalateFrom"],
  });
  if (error) redirect(`/panel/perfiles?${new URLSearchParams({ vista: "influenciadores", error })}`);
  redirect("/panel/perfiles?vista=influenciadores&guardado=1");
}

export async function addWatched(formData: FormData) {
  const client = await currentClient("config");
  const values = String(formData.get("values") ?? "").slice(0, 4000);
  if (!client || !values.trim()) return;
  await addWatch(db, client.id, values, String(formData.get("note") ?? ""));
  refresh();
}

export async function removeWatched(formData: FormData) {
  const client = await currentClient("config");
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await removeWatch(db, client.id, id);
  refresh();
}
