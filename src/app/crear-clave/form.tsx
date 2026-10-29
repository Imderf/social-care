"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { createPassword } from "./actions";

const FIELD =
  "mt-1.5 block h-12 w-full rounded-lg border border-line-strong bg-surface px-3.5 pr-12 text-[16px] text-ink transition-colors hover:border-ink-3 focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";

export function CreatePasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(createPassword.bind(null, token), null);
  const [visible, setVisible] = useState(false);
  return (
    <form action={action} className="space-y-5">
      {state?.error && (
        <p role="alert" className="rounded-lg border border-brand-ink/20 bg-brand-soft px-3.5 py-3 text-[14px] text-brand-ink">
          {state.error}
        </p>
      )}
      <div className="relative">
        <label htmlFor="nueva" className="text-[14px] font-bold text-ink-2">Contraseña</label>
        <input id="nueva" name="nueva" type={visible ? "text" : "password"} required minLength={8} maxLength={200} autoComplete="new-password" autoFocus className={FIELD} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          className="absolute right-1 bottom-1 grid size-10 place-items-center rounded-md text-ink-3 transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        >
          {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
      <div>
        <label htmlFor="repetir" className="text-[14px] font-bold text-ink-2">Repite la contraseña</label>
        <input id="repetir" name="repetir" type={visible ? "text" : "password"} required minLength={8} maxLength={200} autoComplete="new-password" className={FIELD} />
      </div>
      <p className="text-[13px] text-ink-3">Al menos 8 caracteres. Solo tú la conoces.</p>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-ink text-[15px] font-bold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-80"
      >
        {pending && <Loader2 size={18} aria-hidden className="motion-safe:animate-spin" />}
        {pending ? "Guardando…" : "Guardar contraseña y entrar"}
      </button>
    </form>
  );
}
