import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { CircleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { invitationInfo } from "@/lib/users";
import logo from "../ogilvy-logo.png";
import { CreatePasswordForm } from "./form";

// Lo que ve la persona que llega con el enlace de la administración (/c/<código>, o /crear-clave?t=<código> en los enlaces de antes).
// Sin sesión: el enlace es la llave, sirve una vez y vence a los 7 días. Con un enlace malo, usado o vencido solo se dice que no sirve.
async function Content({ token }: { token: string }) {
  await connection();
  const who = await invitationInfo(db, token);
  if (!who) {
    return (
      <>
        <h1 className="font-serif text-[32px] leading-tight text-ink">Este enlace no sirve</h1>
        <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-lg border border-brand-ink/20 bg-brand-soft px-3.5 py-3 text-[14px] text-brand-ink">
          <CircleAlert size={18} aria-hidden className="mt-px shrink-0" />
          Ya se usó o venció. Pídele uno nuevo a quien administra el panel.
        </p>
        <Link href="/ingresar" className="mt-6 inline-block text-[14px] font-bold text-brand-ink underline underline-offset-2">
          Ir a Ingresar
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="font-serif text-[36px] leading-tight text-ink">Crea tu contraseña</h1>
      <p className="mt-1.5 mb-8 text-[15px] text-ink-3">
        Hola {who.name}. Tu usuario es <strong className="text-ink">{who.username}</strong>. Elige la contraseña con la que vas a entrar.
      </p>
      <CreatePasswordForm token={token} />
    </>
  );
}

export function InvitationPage({ token }: { token: string }) {
  return (
    <main className="flex min-h-screen flex-col bg-surface px-4 py-8 sm:px-8">
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-end gap-2.5">
            <Image src={logo} alt="Ogilvy" priority className="h-8 w-auto" />
            <span className="pb-0.5 text-[14px] leading-none font-bold text-brand-ink">Social Care</span>
          </div>
          <Suspense fallback={<div className="h-[320px]" />}>
            <Content token={token} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
