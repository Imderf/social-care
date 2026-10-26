import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CircleAlert } from "lucide-react";
import { SESSION_COOKIE, sessionUser } from "@/lib/auth";
import logo from "../ogilvy-logo.png";
import logoWhite from "../ogilvy-logo-blanco.png";
import { signIn } from "./actions";
import { FIELD, PasswordField, SubmitButton } from "./fields";
import { LiveComments } from "./live-comments";

const ERRORS: Record<string, string> = {
  datos: "El usuario o la contraseña no coinciden. Revísalos y vuelve a intentarlo.",
  bloqueado: "Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentarlo.",
};

async function LoginForm({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (sessionUser((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/panel");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  return (
    <form action={signIn} className="space-y-5" aria-describedby={error ? "error-ingreso" : undefined}>
      <input type="hidden" name="volver" value={typeof sp.volver === "string" ? sp.volver : "/panel"} />
      {error && (
        <p id="error-ingreso" role="alert" className="flex items-start gap-2.5 rounded-lg border border-brand-ink/20 bg-brand-soft px-3.5 py-3 text-[14px] text-brand-ink">
          <CircleAlert size={18} aria-hidden className="mt-px shrink-0" /> {error}
        </p>
      )}
      <div>
        <label htmlFor="usuario" className="text-[14px] font-bold text-ink-2">Usuario</label>
        <input id="usuario" name="usuario" required autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus aria-invalid={!!error || undefined} className={FIELD} />
      </div>
      <div>
        <label htmlFor="contrasena" className="text-[14px] font-bold text-ink-2">Contraseña</label>
        <PasswordField invalid={!!error} />
      </div>
      <SubmitButton />
    </form>
  );
}

export default function Ingresar({ searchParams }: PageProps<"/ingresar">) {
  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Marca: solo en pantallas grandes. */}
      <section aria-hidden className="relative hidden overflow-hidden bg-brand-ink p-12 text-white lg:flex lg:flex-col xl:p-16">
        <span className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-white/[0.06]" />
        <span className="pointer-events-none absolute -bottom-56 -left-32 size-[440px] rounded-full bg-black/[0.08]" />

        <div className="relative flex items-end gap-3">
          <Image src={logoWhite} alt="" priority className="h-9 w-auto" />
          <span className="pb-0.5 text-[15px] leading-none font-bold">Social Care</span>
        </div>

        <div className="relative my-auto max-w-xl pt-10">
          <h2 className="font-serif text-[44px] leading-[1.08] xl:text-[52px]">Cada comentario, con la respuesta correcta.</h2>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-white/85">
            La IA propone, tu equipo decide y la plataforma aprende de cada corrección.
          </p>
          <LiveComments />
        </div>

      </section>

      {/* Formulario */}
      <section className="flex min-h-screen flex-col px-4 py-8 sm:px-8">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[400px]">
            <div className="mb-10 flex items-end gap-2.5 lg:hidden">
              <Image src={logo} alt="Ogilvy" priority className="h-8 w-auto" />
              <span className="pb-0.5 text-[14px] leading-none font-bold text-brand-ink">Social Care</span>
            </div>
            <h1 className="font-serif text-[36px] leading-tight text-ink">Ingresar</h1>
            <p className="mt-1.5 mb-8 text-[15px] text-ink-3">Panel de atención de comentarios y mensajes de Facebook e Instagram.</p>
            <Suspense fallback={<div className="h-[290px]" />}>
              <LoginForm searchParams={searchParams} />
            </Suspense>
            <p className="mt-6 text-[14px] text-ink-3">¿No tienes usuario? Pídelo a quien administra el panel.</p>
          </div>
        </div>
        <nav aria-label="Legal" className="mx-auto flex w-full max-w-[400px] gap-4 pt-8 text-[13px] text-ink-3">
          <Link href="/privacidad" className="hover:text-ink hover:underline">Privacidad</Link>
          <Link href="/terminos" className="hover:text-ink hover:underline">Términos</Link>
          <span className="ml-auto">Ogilvy Colombia</span>
        </nav>
      </section>
    </main>
  );
}
