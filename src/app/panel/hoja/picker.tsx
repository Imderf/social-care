"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { chooseSpreadsheet, pickerConfig } from "./actions";

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const loadScript = (src: string) =>
  new Promise<void>((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => fail(new Error(src));
    document.head.append(s);
  });

// El selector de archivos de Google: la persona elige la Hoja y la plataforma solo puede abrir esa.
export function PickSheet({ label, className }: { label: string; className: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const cfg = await pickerConfig();
      if ("error" in cfg) return setError(cfg.error);
      await loadScript("https://apis.google.com/js/api.js");
      await new Promise((r) => window.gapi.load("picker", r));
      const g = window.google.picker;
      // Solo Hojas de cálculo de Google: un .xlsx en Drive no se puede leer ni escribir con la API.
      const view = new g.DocsView(g.ViewId.SPREADSHEETS).setMimeTypes("application/vnd.google-apps.spreadsheet").setMode(g.DocsViewMode.LIST);
      new g.PickerBuilder()
        .addView(view)
        .setOAuthToken(cfg.token)
        .setDeveloperKey(cfg.apiKey)
        .setAppId(cfg.appId)
        .setOrigin(window.location.origin)
        .setLocale("es")
        .setTitle("Elige la Hoja de casos")
        .setCallback(async (d: any) => {
          if (d.action !== g.Action.PICKED) return;
          setBusy(true);
          const r = await chooseSpreadsheet(d.docs[0].id, d.docs[0].name);
          setBusy(false);
          if (r.error) setError(r.error);
          else router.refresh();
        })
        .build()
        .setVisible(true);
      // El selector se dibuja arriba de la página: se sube para que se vea.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("No se pudo abrir el selector de Google. Revisa la conexión y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={open} disabled={busy} className={className}>
        <FileSpreadsheet size={16} aria-hidden /> {busy ? "Abriendo…" : label}
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-brand-ink">
          {error}
        </p>
      )}
    </div>
  );
}
