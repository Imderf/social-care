"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { BUTTON } from "./ui";

// Si falla la base o una consulta, el panel lo dice en su idioma y deja reintentar.
export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
      <TriangleAlert size={28} className="mx-auto text-warn" aria-hidden />
      <p className="mt-3 text-lg font-bold">No se pudo cargar esta pantalla</p>
      <p className="mx-auto mt-1.5 max-w-lg text-[15px] text-ink-3">
        Lo más probable es que la base de datos no esté respondiendo. Si estás en local, revisa que MySQL esté encendido y vuelve a intentar.
      </p>
      {error.digest && <p className="mt-2 text-[12px] text-ink-3">Referencia: {error.digest}</p>}
      <button type="button" onClick={reset} className={`mt-5 ${BUTTON.primary}`}>
        <RotateCw size={15} aria-hidden /> Reintentar
      </button>
    </div>
  );
}
