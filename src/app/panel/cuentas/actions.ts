"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { enqueueBackfill } from "@/lib/backfill";
import { setAccountMode, setLearningDays } from "@/lib/learning";
import { disconnectAccount } from "@/lib/data";
import { currentClient } from "../current";

// Prueba ↔ asistido. setAccountMode solo toca cuentas del cliente elegido.
export async function setMode(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  const mode = String(formData.get("mode"));
  if (!client || !Number.isInteger(id) || (mode !== "prueba" && mode !== "en_vivo")) return;
  await setAccountMode(db, client.id, id, mode);
  refresh();
}

export async function setDays(formData: FormData) {
  const client = await currentClient();
  const days = Number(formData.get("days"));
  if (!client || !Number.isInteger(days) || days < 1 || days > 90) return;
  await setLearningDays(db, client.id, days);
  refresh();
}

// Trae los últimos 30 días de una cuenta ya conectada (el trabajo corre en el worker).
export async function importHistory(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await enqueueBackfill(db, client.id, id);
  refresh();
}

export async function disconnect(formData: FormData) {
  const client = await currentClient();
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await disconnectAccount(db, client.id, id);
  refresh();
}
