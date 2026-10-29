import { CircleAlert, CircleCheck, Link2, RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { getGbpConnection, gbpErrorText, listLocations, missingGbpConfig, type GbpLocation } from "@/lib/gbp";
import { BUTTON, Badge, Panel, ago, plural } from "../ui";
import { connectSelected, disconnectGoogle, syncNow } from "./gbp-actions";

// Google Business Profile: «Conectar con Google» y la plataforma detecta sola las cuentas y sedes de quien se conecta.
// Quien conecta elige qué sedes lee la plataforma; todas entran en modo prueba (leen y proponen, no responden).
export async function GoogleBusinessPanel({ clientId }: { clientId: number }) {
  const missing = missingGbpConfig();
  const conn = await getGbpConnection(db, clientId);
  if (!conn) {
    return (
      <Panel title="Google Business Profile">
        <p className="text-[14px] text-ink-2">
          Conecta con Google la cuenta que administra las fichas de las sedes. La plataforma detecta sola tus cuentas y sedes, lee sus reseñas y propone la respuesta con las plantillas del cliente. En modo prueba no publica nada.
        </p>
        {missing.length ? (
          <p className="mt-3 text-[13px] text-ink-3">Para habilitarlo falta configurar en el servidor: {missing.join(", ")}.</p>
        ) : (
          <a href="/api/gbp/connect" className={`${BUTTON.primary} mt-4`}>
            <Link2 size={16} aria-hidden /> Conectar con Google
          </a>
        )}
      </Panel>
    );
  }

  let locations: GbpLocation[] = [];
  let problem: string | null = null;
  try {
    locations = await listLocations(conn.refreshToken);
  } catch (e) {
    problem = gbpErrorText(e);
  }
  const [rows] = await db.query<any[]>("SELECT meta_id, status FROM accounts WHERE client_id = ? AND platform = 'gbp'", [clientId]);
  const connected = new Set(rows.filter((r) => r.status === "conectada").map((r) => String(r.meta_id)));
  const free = locations.filter((l) => !connected.has(`${l.account}/${l.location}`));

  return (
    <Panel
      title="Google Business Profile"
      action={
        <form action={disconnectGoogle}>
          <button type="submit" className="text-[13px] font-bold text-ink-3 hover:text-brand-ink" title="Quita el permiso de Google y deja de leer las reseñas; lo que ya llegó se queda">
            Desconectar Google
          </button>
        </form>
      }
    >
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
          <CircleCheck size={16} aria-hidden className="text-ok" /> Conectado con <strong className="text-ink">{conn.email}</strong>
          <Badge>{plural(connected.size, "sede conectada", "sedes conectadas")}</Badge>
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-3">
          <span>{conn.lastSyncAt ? `Última lectura ${ago(conn.lastSyncAt)}: ${conn.summary ?? ""}` : "Todavía no se leyeron reseñas."}</span>
          {connected.size > 0 && (
            <form action={syncNow}>
              <button type="submit" className={`${BUTTON.secondary} px-3 py-1 text-[13px]`}>
                <RefreshCw size={14} aria-hidden /> Leer ahora
              </button>
            </form>
          )}
        </div>
        {problem && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-brand-soft px-3.5 py-3 text-[14px] text-brand-ink">
            <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0" /> {problem}
          </p>
        )}
        {!problem && locations.length === 0 && <p className="text-[14px] text-ink-3">Esta cuenta de Google no administra ninguna ficha. Conecta otra cuenta, o pídele a quien administra las fichas que te agregue.</p>}
        {free.length > 0 && (
          <form action={connectSelected} className="space-y-3">
            <fieldset className="max-h-72 space-y-1.5 overflow-auto rounded-lg border border-line p-3">
              <legend className="px-1 text-[13px] font-bold text-ink-3">Sedes que encontré ({free.length})</legend>
              {free.map((l) => (
                <label key={`${l.account}/${l.location}`} className="flex items-start gap-2 text-[14px] text-ink-2">
                  <input type="checkbox" name="sede" value={`${l.account}/${l.location}|${l.title}`} defaultChecked={free.length <= 10} className="mt-1 size-4 accent-[var(--color-brand-ink)]" />
                  <span>
                    <span className="font-bold text-ink">{l.title}</span>
                    {l.address && <span className="block text-[13px] text-ink-3">{l.address}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className={`${BUTTON.primary} px-3 py-1.5 text-[13px]`}>
              Conectar las sedes marcadas en modo prueba
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}
