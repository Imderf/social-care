import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { FlaskConical, LogOut, Radio, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { listClients, listClientsOf } from "@/lib/data";
import { ROLE_LABELS } from "@/lib/permissions";
import { ClientSwitcher } from "./client-switcher";
import { currentClient, currentUser, overviewFor } from "./current";
import { Nav, NavList } from "./nav";
import { signOut } from "../ingresar/actions";
import logo from "../ogilvy-logo.png";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 md:block md:px-5 md:pt-6">
          <Link href="/panel" className="flex shrink-0 items-end gap-2">
            <Image src={logo} alt="Ogilvy" priority className="h-6 w-auto" />
            <span className="text-[13px] leading-none font-bold text-brand-ink">Social Care</span>
          </Link>
          <div className="min-w-0 flex-1 md:mt-5">
            <Suspense fallback={<div className="h-[38px] rounded-lg border border-line" />}>
              <Switcher />
            </Suspense>
          </div>
          <Link href="/panel/cuenta" aria-label="Mi cuenta" className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-canvas hover:text-ink md:hidden">
            <UserRound size={18} aria-hidden />
          </Link>
          <form action={signOut} className="md:hidden">
            <button type="submit" aria-label="Cerrar sesión" className="grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-canvas hover:text-ink">
              <LogOut size={18} aria-hidden />
            </button>
          </form>
        </div>
        <div className="md:mt-2 md:flex-1 md:overflow-y-auto md:px-2">
          <Suspense fallback={<NavList path="" />}>
            <NavWithCounts />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <ModeStatus />
        </Suspense>
        <Suspense fallback={null}>
          <AccountLink />
        </Suspense>
        <form action={signOut} className="hidden px-5 pb-4 md:block">
          <button type="submit" className="inline-flex items-center gap-2 text-[13px] font-bold text-ink-3 hover:text-ink">
            <LogOut size={15} aria-hidden /> Cerrar sesión
          </button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1280px]">
          <Suspense fallback={null}>
            <DemoNotice />
          </Suspense>
          {children}
        </div>
      </main>
    </div>
  );
}

// Quien debe cambiar su contraseña temporal solo ve Mi cuenta: sin menú, selector ni estado (pending).
async function Switcher() {
  const me = await currentUser(undefined, true);
  if (me.mustChange) return null;
  const [clients, current] = await Promise.all([me.role === "admin" ? listClients(db) : listClientsOf(db, me.id), currentClient(undefined, true)]);
  return <ClientSwitcher clients={clients} current={current?.id} />;
}

async function NavWithCounts() {
  const me = await currentUser(undefined, true);
  if (me.mustChange) return null;
  const client = await currentClient(undefined, true);
  if (!client) return <Nav role={me.role} />;
  const o = await overviewFor(client.id);
  return <Nav role={me.role} counts={{ bandeja: o.openEscalations, pruebas: o.toVerify, critical: o.criticalEscalations }} />;
}

async function AccountLink() {
  const me = await currentUser(undefined, true);
  return (
    <Link href="/panel/cuenta" className="mx-4 mb-2 hidden items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink-2 hover:bg-canvas hover:text-ink md:flex">
      <UserRound size={16} aria-hidden className="shrink-0 text-ink-3" />
      <span className="min-w-0">
        <strong className="block truncate">{me.name}</strong>
        <span className="text-ink-3">{ROLE_LABELS[me.role]} · Mi cuenta</span>
      </span>
    </Link>
  );
}

// Estado del sistema siempre visible: en prueba nada se publica en Meta.
async function ModeStatus() {
  const me = await currentUser(undefined, true);
  const client = me.mustChange ? undefined : await currentClient(undefined, true);
  if (!client) return null;
  const o = await overviewFor(client.id);
  const live = o.liveAccounts > 0;
  return (
    <p className={`mx-4 mb-4 hidden items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] md:flex ${live ? "bg-ok-soft text-ok" : "bg-canvas text-ink-2"}`}>
      {live ? <Radio size={15} aria-hidden className="mt-0.5 shrink-0" /> : <FlaskConical size={15} aria-hidden className="mt-0.5 shrink-0" />}
      <span>
        <strong className="block">{live ? "Asistido" : "Modo prueba"}</strong>
        {live
          ? `${o.liveAccounts === 1 ? "1 cuenta publica" : `${o.liveAccounts} cuentas publican`} lo que apruebes en Pruebas.`
          : "La IA analiza y propone. No publica nada en Meta."}
      </span>
    </p>
  );
}

async function DemoNotice() {
  const me = await currentUser(undefined, true);
  const client = me.mustChange ? undefined : await currentClient(undefined, true);
  if (!client?.is_demo) return null;
  return (
    <p className="mb-6 flex items-center gap-2 rounded-lg bg-warn-soft px-4 py-2.5 text-[14px] text-warn">
      <FlaskConical size={16} aria-hidden className="shrink-0" />
      Cliente demo: datos de ejemplo generados, no son de Cafam.
    </p>
  );
}
