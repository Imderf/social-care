"use server";

import { cookies } from "next/headers";
import { currentUser } from "./current";

// Al cambiar la cookie en una acción, Next vuelve a renderizar la página con el cliente nuevo.
export async function selectClient(id: number) {
  await currentUser();
  if (!Number.isInteger(id) || id <= 0) return;
  (await cookies()).set("cliente", String(id), { httpOnly: true, sameSite: "lax", path: "/" });
}
