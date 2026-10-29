import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_SECONDS, startSession } from "./auth.ts";
import { db } from "./db.ts";
import { panelUrl } from "./meta.ts";

// Abre (o renueva) la sesión de una persona: cookie firmada con la versión actual de su usuario.
export async function openSession(userId: number) {
  (await cookies()).set(SESSION_COOKIE, await startSession(db, userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: panelUrl().startsWith("https"),
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}
