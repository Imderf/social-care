"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { AUTONOMIES, listTemplates, saveCaseType } from "@/lib/data";
import { flowColumns, flowFromForm, validateFlow } from "@/lib/flow";
import { refreshGraduation } from "@/lib/learning";
import { currentClient } from "../current";

const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Crea o edita un tipo de caso armado por selecciones. Las plantillas elegidas tienen que existir y
// estar vigentes; si no, vuelve al editor con el problema. La IA recibe la matriz actualizada en la
// siguiente clasificación.
export async function saveType(formData: FormData) {
  const client = await currentClient("config");
  const id = Number(formData.get("id")) || null;
  const back = `/panel/matriz/${id ?? "nuevo"}`;
  const name = text(formData.get("name"), 200);
  const autonomy = String(formData.get("autonomy")) as (typeof AUTONOMIES)[number];
  const threshold = Number(formData.get("threshold")) / 100;
  if (!client) return;
  if (!name) redirect(`${back}?error=${encodeURIComponent("Ponle un nombre al tipo de caso.")}`);
  if (!AUTONOMIES.includes(autonomy) || !(threshold >= 0.5 && threshold <= 0.99)) redirect(`${back}?error=${encodeURIComponent("Revisa la autonomía y el umbral (50 a 99 %).")}`);

  const flow = flowFromForm(formData);
  const problem = validateFlow(flow, (await listTemplates(db, client.id)) as any);
  if (problem) redirect(`${back}?error=${encodeURIComponent(problem)}`);

  const saved = await saveCaseType(db, client.id, id, {
    name,
    description: text(formData.get("description"), 2000) || null,
    examples: text(formData.get("examples"), 4000).split("\n").map((e) => e.trim()).filter(Boolean).slice(0, 20),
    autonomy,
    threshold,
    ...flowColumns(flow),
    flow,
    active: formData.get("active") === "on",
  });
  await refreshGraduation(db, client.id);
  redirect(`/panel/matriz?guardado=${saved}#tipo-${saved}`);
}
