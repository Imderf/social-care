"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { changePassword } from "./actions";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="space-y-3">
      {state?.error && <p role="alert" className="rounded-lg bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">{state.error}</p>}
      <label className="block text-[14px] text-ink-2">
        Contraseña actual
        <input name="actual" type="password" required autoComplete="current-password" className={`${FIELD} mt-1`} />
      </label>
      <label className="block text-[14px] text-ink-2">
        Contraseña nueva
        <input name="nueva" type="password" required minLength={8} maxLength={200} autoComplete="new-password" className={`${FIELD} mt-1`} />
      </label>
      <label className="block text-[14px] text-ink-2">
        Repite la contraseña nueva
        <input name="repetir" type="password" required minLength={8} maxLength={200} autoComplete="new-password" className={`${FIELD} mt-1`} />
      </label>
      <p className="text-[13px] text-ink-3">Al menos 8 caracteres y distinta de la actual. Al cambiarla se cierran tus sesiones en otros equipos.</p>
      <button type="submit" disabled={pending} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-[13px] font-bold text-white transition-colors hover:bg-brand-strong disabled:opacity-50">
        {pending && <Loader2 size={15} className="animate-spin" aria-hidden />} Guardar contraseña
      </button>
    </form>
  );
}
