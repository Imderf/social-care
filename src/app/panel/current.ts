import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE, sessionValid } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClient, getOverview } from "@/lib/data";

// Cliente elegido en el selector (cookie). Si no hay o ya no existe, el primero real.
// cache(): una sola consulta por solicitud aunque lo pidan el menú, el aviso y la página.
// Usuario con sesión. El proxy ya protege /panel; esto lo repite en cada página y acción.
// connection(): la sesión se lee en cada solicitud, nunca en un prerender (vence con la hora).
export const currentUser = cache(async () => {
  await connection();
  const id = await sessionValid(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) redirect("/ingresar");
  return id;
});

export const currentClient = cache(async () => {
  await currentUser();
  const id = Number((await cookies()).get("cliente")?.value);
  return getClient(db, id);
});

export const overviewFor = cache((clientId: number) => getOverview(db, clientId));
