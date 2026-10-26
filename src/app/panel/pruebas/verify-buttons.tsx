"use client";

import { useFormStatus } from "react-dom";
import { CircleCheck, CircleX, EyeOff, LoaderCircle, Send, Sparkles, Undo2 } from "lucide-react";
import { regenerate } from "./actions";

// Aceptar (con o sin cambios) o descartar. En asistido, aceptar publica.
export function ReviewButtons({ hide, live, comment }: { hide: boolean; live: boolean; comment: boolean }) {
  const { pending, data, action } = useFormStatus();
  const sending = pending ? (action === regenerate ? "nueva" : data?.get("action")) : null;
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors disabled:opacity-60";
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" name="action" value="publicar" disabled={pending} className={`${base} bg-brand-ink text-white hover:bg-brand-strong`}>
        {sending === "publicar" ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : live ? <Send size={15} aria-hidden /> : <CircleCheck size={15} aria-hidden />}
        {!live ? "Aceptar sin publicar" : hide ? "Aceptar y ocultar" : "Aceptar y publicar"}
      </button>
      <button type="submit" name="action" value="descartar" disabled={pending} className={`${base} border border-line bg-surface text-ink-2 hover:bg-canvas`}>
        {sending === "descartar" ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <CircleX size={15} aria-hidden />}
        Descartar
      </button>
      {comment && !hide && (
        <button type="submit" name="action" value="ocultar" disabled={pending} className={`${base} border border-line bg-surface text-ink-2 hover:bg-canvas`}>
          {sending === "ocultar" ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <EyeOff size={15} aria-hidden />}
          {live ? "Ocultar en vez de responder" : "Lo ocultaría"}
        </button>
      )}
      {!hide && (
        <button type="submit" formAction={regenerate} disabled={pending} className={`${base} border border-line bg-surface text-ink-2 hover:bg-canvas`}>
          {sending === "nueva" ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
          {sending === "nueva" ? "La IA está escribiendo…" : "Nueva propuesta con IA"}
        </button>
      )}
    </div>
  );
}

export function UndoButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-2 transition-colors hover:bg-canvas disabled:opacity-60">
      {pending ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Undo2 size={15} aria-hidden />}
      Deshacer
    </button>
  );
}
