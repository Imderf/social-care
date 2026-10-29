"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { redraftInteraction } from "@/lib/classify";
import { reviewProposal, undoReview } from "@/lib/learning";
import { currentClient } from "../current";

const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim().slice(0, 2000) || null : null);

// Aceptar (con o sin cambios) o descartar. En asistido, aceptar publica y descartar lo deja en la bandeja.
export async function review(formData: FormData) {
  const client = await currentClient("pruebas");
  const id = Number(formData.get("id"));
  const action = String(formData.get("action"));
  if (!client || !Number.isInteger(id) || !["publicar", "descartar", "ocultar"].includes(action)) return;
  const r = await reviewProposal(db, client.id, id, {
    text: clean(formData.get("text")),
    discard: action === "descartar",
    hide: action === "ocultar",
    note: clean(formData.get("note")),
  });
  // Bloqueado (palabra prohibida): vuelve a la misma propuesta con el motivo.
  if (r && "error" in r && r.error) {
    const q = new URLSearchParams({ caso: String(id), error: r.error });
    const ver = String(formData.get("ver") ?? "");
    if (ver) q.set("ver", ver);
    redirect(`/panel/pruebas?${q}#p${id}`);
  }
  refresh();
}

// Deshace una revisión hecha por error, si todavía no se publicó.
export async function undo(formData: FormData) {
  const client = await currentClient("pruebas");
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await undoReview(db, client.id, id);
  refresh();
}

// Pide a la IA otra propuesta; la nota del formulario es la indicación para la IA.
export async function regenerate(formData: FormData) {
  const client = await currentClient("pruebas");
  const id = Number(formData.get("id"));
  if (!client || !Number.isInteger(id)) return;
  await redraftInteraction(db, client.id, id, { current: clean(formData.get("text")), hint: clean(formData.get("note")) });
  refresh();
}
