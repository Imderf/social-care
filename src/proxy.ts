import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionUser } from "@/lib/auth";

// Lo que llega por el túnel (dominio público) solo puede ver lo que Meta necesita: páginas legales,
// webhook y conectar/callback. Ni el login, ni el panel, ni acciones del servidor: Next reenvía un
// POST con Next-Action desde cualquier página. Aquí la ruta ya viene normalizada (sin «..»).
// En el servidor (PANEL_PUBLICO=1) el panel se sirve en el dominio, detrás de su login.
const PUBLIC_PATH = /^\/(privacidad|terminos|eliminacion-de-datos|api\/webhooks\/meta|api\/meta\/(connect|callback)|favicon\.ico|_next\/static\/.+)$/;
const publicHost = () => {
  try {
    return new URL(process.env.APP_BASE_URL ?? "").host;
  } catch {
    return null;
  }
};

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (process.env.PANEL_PUBLICO !== "1" && (request.headers.has("cf-ray") || (host && host === publicHost()))) {
    return PUBLIC_PATH.test(pathname) && !request.headers.has("next-action") ? NextResponse.next() : new NextResponse(null, { status: 404 });
  }
  // Sin sesión, el panel manda a Ingresar. Las páginas y acciones lo vuelven a revisar (currentUser).
  if (!pathname.startsWith("/panel") || sessionUser(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/ingresar", request.url);
  url.searchParams.set("volver", pathname + search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/:path*"] };
