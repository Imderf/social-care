"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { decryptToken } from "@/lib/crypto";
import { accessToken, missingGoogleConfig, readSpreadsheet } from "@/lib/google";
import { getCases, getConnection, setCases, syncSheet, type CasesConfig } from "@/lib/cases";
import { currentClient } from "../current";

const back = (q: Record<string, string>): never => redirect(`/panel/hoja?${new URLSearchParams(q)}#${q.ancla ?? ""}`);
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

export async function saveCasesConfig(formData: FormData) {
  const client = await currentClient();
  if (!client) return;
  const values = formData.getAll("state_value").map((v) => text(v, 100));
  const texts = formData.getAll("state_text").map((v) => text(v, 1000));
  const notify = new Set(formData.getAll("state_notify").map(String));
  const cfg: CasesConfig = {
    origin: formData.get("origin") === "dm" ? "dm" : "dm_comentario",
    tabs: text(formData.get("tabs"), 1000).split(",").map((t) => t.trim()).filter(Boolean),
    columns: {
      caso: text(formData.get("col_caso"), 80),
      perfil: text(formData.get("col_perfil"), 80),
      red: text(formData.get("col_red"), 80),
      estado: text(formData.get("col_estado"), 80),
      resultado: text(formData.get("col_resultado"), 80),
    },
    states: values.map((value, k) => ({ value, notify: notify.has(String(k)), text: texts[k] ?? "" })).filter((s) => s.value),
    times: text(formData.get("times"), 40).split(/[,\s]+/).filter(Boolean),
  };
  const error = await setCases(db, client.id, cfg);
  if (error) back({ error, ancla: "configuracion" });
  back({ guardado: "1", ancla: "configuracion" });
}

// Para el selector de Google en el navegador: un token de acceso corto (permiso drive.file).
export async function pickerConfig(): Promise<{ token: string; apiKey: string; appId: string } | { error: string }> {
  const client = await currentClient();
  const conn = client ? await getConnection(db, client.id) : null;
  if (!conn) return { error: "Conecta primero la cuenta de Google." };
  if (missingGoogleConfig().length) return { error: "Falta configurar el acceso de Google en el servidor." };
  try {
    return { token: await accessToken(decryptToken(conn.refresh_token_encrypted)), apiKey: process.env.GOOGLE_API_KEY!, appId: process.env.GOOGLE_PROJECT_NUMBER! };
  } catch {
    return { error: "Google no dejó usar la cuenta: vuelve a conectarla." };
  }
}

// La Hoja elegida en el selector. Se prueba que se pueda leer antes de guardarla.
export async function chooseSpreadsheet(id: string, name: string): Promise<{ error?: string }> {
  const client = await currentClient();
  const conn = client ? await getConnection(db, client.id) : null;
  if (!client || !conn) return { error: "Conecta primero la cuenta de Google." };
  if (!/^[\w-]{20,100}$/.test(id)) return { error: "Esa no es una Hoja de cálculo de Google." };
  try {
    const sheet = await readSpreadsheet(decryptToken(conn.refresh_token_encrypted), id, (await getCases(db, client.id)).tabs);
    await db.query("UPDATE google_connections SET spreadsheet_id = ?, spreadsheet_name = ?, last_sync_at = NULL, last_sync_summary = NULL WHERE client_id = ?", [
      id, (sheet.name || name).slice(0, 255), client.id,
    ]);
    // La primera lectura toma la foto de cómo está la Hoja: lo que ya estaba no se avisa.
    await syncSheet(db, client.id);
    return {};
  } catch {
    return { error: "No se pudo leer esa Hoja con la cuenta conectada. Si es un archivo .xlsx, conviértelo a Hoja de cálculo de Google." };
  }
}

export async function syncNow() {
  const client = await currentClient();
  if (!client) return;
  const r = await syncSheet(db, client.id);
  if (!r) back({ error: "Elige primero la Hoja.", ancla: "lectura" });
  if (r && "error" in r) back({ error: String(r.error), ancla: "lectura" });
  back({ leido: "1", ancla: "lectura" });
}

export async function disconnectGoogle() {
  const client = await currentClient();
  const conn = client ? await getConnection(db, client.id) : null;
  if (!client || !conn) return;
  // Se revoca en Google (si falla, igual se borra aquí: sin el token la plataforma no entra).
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptToken(conn.refresh_token_encrypted))}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  await db.query("DELETE FROM google_connections WHERE client_id = ?", [client.id]);
  back({ desconectado: "1" });
}
