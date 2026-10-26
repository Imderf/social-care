"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";

export const FIELD =
  "mt-1.5 block h-12 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-[16px] text-ink transition-colors hover:border-ink-3 focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand aria-[invalid=true]:border-brand-ink";

// Se puede ver lo escrito; pegar y el gestor de contraseñas funcionan (autocomplete).
export function PasswordField({ invalid }: { invalid: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id="contrasena"
        name="contrasena"
        type={visible ? "text" : "password"}
        required
        autoComplete="current-password"
        aria-invalid={invalid || undefined}
        className={`${FIELD} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-md text-ink-3 transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      >
        {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  );
}

export function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-ink text-[15px] font-bold text-white transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? <Loader2 size={18} aria-hidden className="motion-safe:animate-spin" /> : <LogIn size={18} aria-hidden />}
      {pending ? "Ingresando…" : "Ingresar"}
    </button>
  );
}
