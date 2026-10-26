"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_SECONDS, login, startSession } from "@/lib/auth";
import { panelUrl } from "@/lib/meta";

// Solo se vuelve a una página del panel (con sus filtros), nunca a otro sitio.
const safeBack = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\/panel(\/[\w-]+)*(\?[\w=&%+.-]*)?$/.test(v) ? v : "/panel");

export async function signIn(formData: FormData) {
  const username = String(formData.get("usuario") ?? "").slice(0, 255);
  const password = String(formData.get("contrasena") ?? "").slice(0, 200);
  const back = safeBack(formData.get("volver"));
  const h = await headers();
  const id = await login(db, username, password, h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "");
  if (id === "bloqueado") redirect("/ingresar?error=bloqueado");
  if (!id) redirect(`/ingresar?error=datos&volver=${encodeURIComponent(back)}`);
  (await cookies()).set(SESSION_COOKIE, await startSession(db, id), {
    httpOnly: true,
    sameSite: "lax",
    secure: panelUrl().startsWith("https"),
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  redirect(back);
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/ingresar");
}
