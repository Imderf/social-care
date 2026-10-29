"use server";

import { refresh } from "next/cache";
import { db } from "@/lib/db";
import { connectLocations, disconnectGbp } from "@/lib/gbp";
import { currentClient } from "../current";

// Conectar las sedes que la persona marcó. Cada valor es «cuenta/locations/sede|nombre»: el servidor vuelve a leer qué
// sedes ve esa cuenta de Google antes de guardar, así que un valor armado a mano no conecta una sede ajena.
export async function connectSelected(formData: FormData) {
  const client = await currentClient("config");
  if (!client) return;
  const chosen = formData.getAll("sede").map(String).slice(0, 500);
  const { getGbpConnection, listLocations } = await import("@/lib/gbp");
  const conn = await getGbpConnection(db, client.id);
  if (!conn || !chosen.length) return;
  const visible = new Map((await listLocations(conn.refreshToken)).map((l) => [`${l.account}/${l.location}`, l.title]));
  const locations = chosen.map((c) => c.split("|")[0]).filter((k) => visible.has(k)).map((k) => ({ accountLocation: k, title: visible.get(k)! }));
  await connectLocations(db, client.id, locations);
  refresh();
}

export async function disconnectGoogle() {
  const client = await currentClient("config");
  if (!client) return;
  await disconnectGbp(db, client.id);
  refresh();
}

// Pide una lectura de reseñas ahora, sin esperar los 5 minutos.
export async function syncNow() {
  const client = await currentClient("config");
  if (!client) return;
  await db.query(
    `INSERT INTO jobs (type, payload) SELECT 'gbp_sync', JSON_OBJECT('client_id', ?) FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE type = 'gbp_sync' AND status IN ('pending', 'running') AND JSON_EXTRACT(payload, '$.client_id') = ?)`,
    [client.id, client.id],
  );
  refresh();
}
