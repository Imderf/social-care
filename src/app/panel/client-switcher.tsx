"use client";

import { useTransition } from "react";
import { Building2, ChevronsUpDown } from "lucide-react";
import { selectClient } from "./actions";

export function ClientSwitcher({ clients, current }: { clients: { id: number; name: string }[]; current?: number }) {
  const [pending, start] = useTransition();
  return (
    <label className="relative block">
      <span className="sr-only">Cliente</span>
      <Building2 size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
      <select
        value={current}
        disabled={pending}
        onChange={(e) => start(() => selectClient(Number(e.target.value)))}
        className="w-full cursor-pointer appearance-none truncate rounded-lg border border-line bg-surface py-2 pr-8 pl-9 text-sm font-bold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown size={15} aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-3" />
    </label>
  );
}
