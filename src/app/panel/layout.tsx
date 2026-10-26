import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { FlaskConical, LogOut, Radio } from "lucide-react";
import { db } from "@/lib/db";
import { listClients } from "@/lib/data";
import { ClientSwitcher } from "./client-switcher";
import { currentClient, overviewFor } from "./current";
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

async function Switcher() {
  const [clients, current] = await Promise.all([listClients(db), currentClient()]);
  return <ClientSwitcher clients={clients} current={current?.id} />;
}

async function NavWithCounts() {
  const client = await currentClient();
  if (!client) return <Nav />;
  const o = await overviewFor(client.id);
  return <Nav counts={{ bandeja: o.openEscalations, pruebas: o.toVerify, critical: o.criticalEscalations }} />;
}

// Estado del sistema siempre visible: en prueba nada se publica en Meta.
async function ModeStatus() {
  const client = await currentClient();
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
  const client = await currentClient();
  if (!client?.is_demo) return null;
  return (
    <p className="mb-6 flex items-center gap-2 rounded-lg bg-warn-soft px-4 py-2.5 text-[14px] text-warn">
      <FlaskConical size={16} aria-hidden className="shrink-0" />
      Cliente demo: datos de ejemplo generados, no son de Cafam.
    </p>
  );
}
