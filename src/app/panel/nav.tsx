"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ban, BookOpen, Building2, UserRoundSearch, ClipboardCheck, FileSpreadsheet, FileText, Inbox, LayoutDashboard, MessagesSquare, Network, Plug, Users } from "lucide-react";
import { can, type Permission, type Role } from "@/lib/permissions";

const GROUPS = [
  {
    label: "Operación",
    items: [
      { href: "/panel", label: "Resumen", icon: LayoutDashboard },
      { href: "/panel/bandeja", label: "Bandeja", icon: Inbox, count: "bandeja", perm: "bandeja" },
      { href: "/panel/pruebas", label: "Pruebas", icon: ClipboardCheck, count: "pruebas", perm: "pruebas" },
      { href: "/panel/interacciones", label: "Interacciones", icon: MessagesSquare, perm: "bandeja" },
    ],
  },
  {
    label: "Configuración",
    items: [
      { href: "/panel/matriz", label: "Matriz de respuesta", icon: Network, perm: "config" },
      { href: "/panel/plantillas", label: "Plantillas", icon: FileText, perm: "config" },
      { href: "/panel/palabras", label: "Palabras prohibidas", icon: Ban, perm: "config" },
      { href: "/panel/perfiles", label: "Perfiles e influenciadores", icon: UserRoundSearch, perm: "config" },
      { href: "/panel/conocimiento", label: "Base de conocimiento", icon: BookOpen, perm: "config" },
      { href: "/panel/hoja", label: "Hoja de casos", icon: FileSpreadsheet, perm: "config" },
      { href: "/panel/cuentas", label: "Cuentas conectadas", icon: Plug, perm: "config" },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/panel/clientes", label: "Clientes", icon: Building2, perm: "config" },
      { href: "/panel/usuarios", label: "Usuarios", icon: Users, perm: "usuarios" },
    ],
  },
] as const;

export type NavCounts = { bandeja?: number; pruebas?: number; critical?: number };

export function Nav({ counts = {}, role }: { counts?: NavCounts; role?: Role }) {
  return <NavList counts={counts} path={usePathname()} role={role} />;
}

// Solo dibuja; el layout la usa sin ruta mientras carga, porque en rutas con parámetros
// (/panel/matriz/[id]) la URL no se conoce al prerenderizar.
export function NavList({ counts = {}, path, role }: { counts?: NavCounts; path: string; role?: Role }) {
  return (
    <nav aria-label="Panel" className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-col md:gap-5 md:overflow-visible md:pb-0">
      {GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !("perm" in i) || !role || can(role, i.perm as Permission)) }))
        .filter((g) => g.items.length)
        .map((g) => (
        <div key={g.label} className="flex shrink-0 gap-1 md:flex-col">
          <p className="hidden px-3 pb-1 text-[12px] font-bold text-ink-3 md:block">{g.label}</p>
          {g.items.map((item) => {
            const { href, label, icon: Icon } = item;
            const active = href === "/panel" ? path === href : path.startsWith(href);
            const count = "count" in item ? counts[item.count] : undefined;
            const urgent = "count" in item && item.count === "bandeja" && (counts.critical ?? 0) > 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[14px] transition-colors ${
                  active ? "bg-canvas font-bold text-ink ring-1 ring-line ring-inset" : "text-ink-2 hover:bg-canvas hover:text-ink"
                }`}
              >
                <Icon size={18} aria-hidden className={active ? "text-ink" : "text-ink-3"} />
                {label}
                {!!count && (
                  <span
                    className={`ml-auto min-w-6 rounded-full px-1.5 text-center text-[12px] font-bold ${urgent ? "bg-brand-ink text-white" : "bg-canvas text-ink-2 ring-1 ring-line ring-inset"}`}
                    aria-label={urgent ? `${count} pendientes, ${counts.critical} críticos` : `${count} pendientes`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
