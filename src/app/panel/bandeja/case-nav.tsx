"use client";

import { useEffect } from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, EyeOff, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useFormStatus } from "react-dom";
import { useState } from "react";

// Atajos j/k para pasar de caso y refresco cada 30 s para ver casos nuevos.
export function CaseKeys({ hrefs, current }: { hrefs: string[]; current: number }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const next = e.key === "j" ? current + 1 : e.key === "k" ? current - 1 : null;
      if (next !== null && hrefs[next]) router.push(hrefs[next], { scroll: false });
    };
    const timer = setInterval(() => router.refresh(), 30_000);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(timer);
    };
  }, [hrefs, current, router]);
  return null;
}

function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <LoaderCircle size={14} className="animate-spin text-ink-3" aria-label="Cargando caso" /> : null;
}

// Enlace de la lista con indicador mientras carga el caso elegido.
export function CaseLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={`relative block px-4 py-3.5 ${active ? "bg-canvas ring-1 ring-line ring-inset" : "hover:bg-canvas/70"}`}>
      {children}
      <span className="absolute top-3.5 right-3">
        <Pending />
      </span>
    </Link>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-ink px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-strong"
    >
      {done ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      {done ? "Copiado" : "Copiar borrador"}
    </button>
  );
}

// Botones de la respuesta en la bandeja; se deshabilitan mientras se procesa para no enviar dos veces.
export function ReplyButtons({ dm, redraft }: { dm: boolean; redraft: (f: FormData) => Promise<void> }) {
  const { pending, data, action } = useFormStatus();
  const doing = pending ? (action === redraft ? "nueva" : data?.get("action")) : null;
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors disabled:opacity-60";
  const spin = <LoaderCircle size={15} className="animate-spin" aria-hidden />;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="action" value="enviar" disabled={pending} className={`${base} bg-brand-ink text-white hover:bg-brand-strong`}>
        {doing === "enviar" ? spin : <Send size={15} aria-hidden />} {dm ? "Enviar DM" : "Enviar respuesta"}
      </button>
      <button type="submit" formAction={redraft} disabled={pending} className={`${base} border border-line bg-surface text-ink-2 hover:bg-canvas`}>
        {doing === "nueva" ? spin : <Sparkles size={15} aria-hidden />} {doing === "nueva" ? "La IA está escribiendo…" : "Nueva propuesta con IA"}
      </button>
      {!dm && (
        <button type="submit" name="action" value="ocultar" disabled={pending} className={`${base} border border-line bg-surface text-ink-2 hover:bg-canvas`}>
          {doing === "ocultar" ? spin : <EyeOff size={15} aria-hidden />} Ocultar comentario
        </button>
      )}
    </div>
  );
}
