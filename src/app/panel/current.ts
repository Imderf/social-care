import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE, sessionValid } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOverview, listClients, listClientsOf, type Client } from "@/lib/data";
import { can, type Permission } from "@/lib/permissions";
import { loadAccess } from "@/lib/users";

// Quién es la persona con sesión y qué puede hacer. El proxy ya protege /panel con la firma; aquí se
// repite en cada página y acción contra la base (versión de sesión, cuenta activa y rol).
// connection(): la sesión se lee en cada solicitud, nunca en un prerender (vence con la hora).
// Permisos (ver src/lib/permissions.ts). Sin permiso, la página o acción pasa por Resumen,
// que ven todos los roles. Quien debe cambiar su contraseña temporal solo llega a Mi cuenta.
export { ALLOWED, can, type Permission } from "@/lib/permissions";

const access = cache(async () => {
  await connection();
  const id = await sessionValid(db, (await cookies()).get(SESSION_COOKIE)?.value);
  const a = id ? await loadAccess(db, id) : null;
  if (!a) redirect("/ingresar");
  return a;
});

// `pending`: deja pasar a quien debe cambiar su contraseña (Mi cuenta y el menú); el resto lo manda a Mi cuenta.
export async function currentUser(permission?: Permission, pending = false) {
  const a = await access();
  if (a.mustChange && !pending) redirect("/panel/cuenta");
  if (permission && !can(a.role, permission)) redirect("/panel");
  return a;
}

// Cliente elegido en el selector (cookie), entre los que la persona puede ver. Si no hay o ya no existe,
// el primero. cache(): una sola consulta por solicitud aunque lo pidan el menú, el aviso y la página.
export const currentClient = cache(async (permission?: Permission, pending = false): Promise<Client | undefined> => {
  const a = await currentUser(permission, pending);
  const id = Number((await cookies()).get("cliente")?.value);
  const clients = a.role === "admin" ? await listClients(db) : await listClientsOf(db, a.id);
  return clients.find((c) => c.id === id) ?? clients[0];
});

export const overviewFor = cache((clientId: number) => getOverview(db, clientId));
