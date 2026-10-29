import { Suspense } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { missingGoogleConfig } from "@/lib/google";
import { ORIGINS, ORIGIN_TEXT, getCases, getConnection, lastSlot, listSheetCases } from "@/lib/cases";
import { currentClient } from "../current";
import { BUTTON, Badge, Empty, NoClient, PageHeader, Panel, Skeleton, formatDate, personName, type BadgeTone } from "../ui";
import { disconnectGoogle, saveCasesConfig, syncNow } from "./actions";
import { PickSheet } from "./picker";

const FIELD = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-line-strong";
const LABEL = "block text-[13px] font-bold text-ink-3";

const ERRORS: Record<string, string> = {
  config: "Falta configurar el acceso de Google en el servidor (ver los pasos abajo).",
  cliente: "Elige primero el cliente.",
  estado: "El permiso para conectar venció. Vuelve a intentarlo.",
  cancelado: "Se canceló el ingreso con Google.",
  google: "Google no dejó conectar la cuenta. Vuelve a intentarlo.",
};

const DELIVERY: Record<string, { label: string; tone: BadgeTone }> = {
  enviar: { label: "Enviándose", tone: "neutral" },
  enviando: { label: "Enviado a Meta sin confirmar", tone: "warn" },
  enviado: { label: "Aviso enviado", tone: "ok" },
  fallido: { label: "No se pudo enviar", tone: "critical" },
  bandeja: { label: "En la Bandeja: lo envía una persona", tone: "warn" },
  esperando: { label: "Espera a que vuelva a escribir", tone: "neutral" },
  sin_dm: { label: "Nunca escribió por DM: espera", tone: "neutral" },
};

function Step({ n, title, children, id }: { n: number; title: string; children: React.ReactNode; id?: string }) {
  return (
    <Panel title={<span id={id} className="scroll-mt-6">{`${n} · ${title}`}</span>}>
      <div className="space-y-3">{children}</div>
    </Panel>
  );
}

async function HojaContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const client = await currentClient();
  if (!client) return <NoClient />;
  const sp = await searchParams;
  const [conn, cfg, cases] = await Promise.all([getConnection(db, client.id), getCases(db, client.id), listSheetCases(db, client.id)]);
  const missing = missingGoogleConfig();
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? sp.error) : null;
  const ok = sp.conectado ? "Cuenta de Google conectada. Ahora elige la Hoja." : sp.guardado ? "Cambios guardados." : sp.leido ? "Hoja leída." : sp.desconectado ? "Cuenta de Google desconectada." : null;
  const slot = lastSlot(cfg.times);
  const states = [...cfg.states, { value: "", notify: false, text: "" }, { value: "", notify: false, text: "" }];

  return (
    <>
      <PageHeader
        title="Hoja de casos"
        description={`La plataforma lee la Hoja de casos del cliente ${cfg.times.length} ${cfg.times.length === 1 ? "vez" : "veces"} al día. Cuando el caso de una persona que escribió por ${ORIGIN_TEXT[cfg.origin]} pasa a un estado que avisa, le manda el resultado por DM. La Hoja la sigue llenando el equipo.`}
      />
      {(error || ok) && (
        <p role={error ? "alert" : "status"} className={`mb-5 flex max-w-3xl items-center gap-2 rounded-lg px-4 py-3 text-[14px] ${error ? "bg-brand-soft text-brand-ink" : "bg-ok-soft text-ok"}`}>
          {error ? <CircleAlert size={16} aria-hidden className="shrink-0" /> : <CircleCheck size={16} aria-hidden className="shrink-0" />} {error ?? ok}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Step n={1} title="Cuenta de Google">
            {missing.length > 0 ? (
              <p className="text-[14px] text-ink-2">
                Falta el acceso de Google en el servidor ({missing.join(", ")} en el <code>.env</code>). Lo crea el administrador en Google Cloud: ver «Cómo se conecta» a la derecha.
              </p>
            ) : conn ? (
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="ok" icon={CircleCheck}>Conectada como {conn.email}</Badge>
                <a href="/api/google/connect" className={BUTTON.secondary}>Cambiar de cuenta</a>
                <form action={disconnectGoogle}>
                  <button type="submit" className={BUTTON.secondary}>
                    <LogOut size={15} aria-hidden /> Desconectar
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p className="text-[14px] text-ink-2">Ingresa con la cuenta de Google que tiene acceso a la Hoja de casos del cliente. La plataforma solo podrá abrir la Hoja que elijas en el paso 2, nada más de ese Drive.</p>
                <a href="/api/google/connect" className={BUTTON.primary}>Conectar con Google</a>
              </>
            )}
          </Step>

          <Step n={2} title="La Hoja">
            {conn?.spreadsheet_id ? (
              <p className="flex flex-wrap items-center gap-2 text-[14px]">
                <strong>{conn.spreadsheet_name}</strong>
                <a href={`https://docs.google.com/spreadsheets/d/${conn.spreadsheet_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-ink-2 hover:text-ink">
                  Abrir <ExternalLink size={13} aria-hidden />
                </a>
              </p>
            ) : (
              <p className="text-[14px] text-ink-2">Elige la Hoja de cálculo de Google donde el equipo registra los casos. Si hoy es un archivo .xlsx en Drive, primero hay que convertirlo a Hoja de cálculo de Google.</p>
            )}
            {conn && <PickSheet label={conn.spreadsheet_id ? "Elegir otra Hoja" : "Elegir la Hoja"} className={conn.spreadsheet_id ? BUTTON.secondary : BUTTON.primary} />}
          </Step>

          <form action={saveCasesConfig} className="space-y-4">
            <Step n={3} title="Qué casos se siguen y cómo se lee" id="configuracion">
              <fieldset>
                <legend className={LABEL}>Casos de personas que escribieron por</legend>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Object.entries(ORIGINS).map(([v, label]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-[14px] has-[:checked]:border-ink has-[:checked]:bg-canvas">
                      <input type="radio" name="origin" value={v} defaultChecked={cfg.origin === v} /> {label}
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 text-[12px] text-ink-3">Las filas de otras personas (llamadas, WhatsApp, sede) no se leen. El aviso siempre va por DM.</p>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={LABEL}>
                  Horarios de lectura (hora de Colombia)
                  <input name="times" defaultValue={cfg.times.join(", ")} placeholder="09:00, 16:00" className={`${FIELD} mt-1 font-normal`} />
                </label>
                <label className={LABEL}>
                  Pestañas (vacío: todas)
                  <input name="tabs" defaultValue={cfg.tabs.join(", ")} placeholder="Octubre 2026, Noviembre 2026" className={`${FIELD} mt-1 font-normal`} />
                </label>
              </div>
              <p className={LABEL}>Nombre de cada columna en la Hoja</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["col_caso", "Número de caso", cfg.columns.caso],
                    ["col_perfil", "Perfil (usuario o nombre)", cfg.columns.perfil],
                    ["col_red", "Red social", cfg.columns.red],
                    ["col_estado", "Estado para el usuario", cfg.columns.estado],
                    ["col_resultado", "Resultado", cfg.columns.resultado],
                  ] as const
                ).map(([name, label, value]) => (
                  <label key={name} className="block text-[12px] text-ink-3">
                    {label}
                    <input name={name} defaultValue={value} required className={`${FIELD} mt-1`} />
                  </label>
                ))}
              </div>
            </Step>

            <Step n={4} title="Estados y avisos">
              <p className="text-[13px] text-ink-3">
                Cuando un caso pasa a un estado que avisa, la persona recibe ese texto por DM. El estado se reconoce por cómo empieza el texto de la celda: «Pendiente de entrega» reconoce «Pendiente de entrega, se solicitó al punto…». Variables: {"{usuario}"}, {"{caso}"} y {"{resultado}"}. Si el texto pide el resultado y la Hoja no lo tiene, el aviso va a la Bandeja. Los textos de ejemplo son un borrador hasta que el cliente los apruebe.
              </p>
              <div className="space-y-2">
                {states.map((s, k) => (
                  <div key={k} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[180px_90px_minmax(0,1fr)]">
                    <input name="state_value" defaultValue={s.value} placeholder={k >= cfg.states.length ? "Estado nuevo" : ""} aria-label="Estado" className={FIELD} />
                    <label className="flex items-center gap-2 text-[14px] text-ink-2">
                      <input type="checkbox" name="state_notify" value={k} defaultChecked={s.notify} /> Avisa
                    </label>
                    <textarea name="state_text" rows={2} defaultValue={s.text} placeholder="Texto del aviso (solo si avisa)" aria-label="Texto del aviso" className={FIELD} />
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-ink-3">Para quitar un estado, borra su nombre y guarda.</p>
            </Step>
            <button type="submit" className={BUTTON.primary}>Guardar cambios</button>
          </form>

          <Panel title={<span id="lectura" className="scroll-mt-6">Casos que sigue la plataforma</span>} bodyClass="p-0">
            {cases.length === 0 ? (
              <div className="p-5">
                <Empty title="Todavía no hay casos">
                  Aparecen aquí cuando la Hoja tiene casos de personas que escribieron por {ORIGIN_TEXT[cfg.origin]}. Lo que ya estaba en la Hoja la primera vez que se lee no se avisa.
                </Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {cases.map((c) => {
                  const d = c.delivery ? DELIVERY[c.delivery] : null;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
                      <span className="w-28 shrink-0 text-[14px] font-bold">Caso {c.case_number}</span>
                      <span className="min-w-0 flex-1 text-[14px]">
                        {c.contact_id ? (
                          <Link href={`/panel/interacciones/persona/${c.contact_id}`} className="font-bold text-ink-2 hover:text-ink hover:underline">
                            {personName(c as any)}
                          </Link>
                        ) : (
                          c.profile
                        )}
                        <span className="text-ink-3"> · {c.tab}</span>
                      </span>
                      <Badge>{c.status ?? "Sin estado"}</Badge>
                      {d &&
                        (c.delivery === "bandeja" && c.escalation_id ? (
                          <Link href={`/panel/bandeja?caso=${c.escalation_id}`} className="hover:opacity-80">
                            <Badge tone={d.tone}>{d.label}</Badge>
                          </Link>
                        ) : (
                          <Badge tone={d.tone}>
                            {d.label}
                            {c.sent_at ? ` · ${formatDate(c.sent_at)}` : ""}
                          </Badge>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Lectura">
            <p className="text-[14px] text-ink-2">
              {conn?.last_sync_at ? <>Última: {formatDate(conn.last_sync_at)}</> : "Todavía no se ha leído."}
            </p>
            {conn?.last_sync_summary && <p className="mt-1 text-[13px] text-ink-3">{conn.last_sync_summary}</p>}
            <p className="mt-1 text-[13px] text-ink-3">
              Turnos: {cfg.times.join(" y ")}. {slot && conn?.last_sync_at && new Date(conn.last_sync_at) >= slot ? "Al día." : conn?.spreadsheet_id ? "La siguiente lectura sale en el próximo minuto." : ""}
            </p>
            {conn?.spreadsheet_id && (
              <form action={syncNow} className="mt-3">
                <button type="submit" className={BUTTON.secondary}>
                  <RefreshCw size={15} aria-hidden /> Revisar la Hoja ahora
                </button>
              </form>
            )}
          </Panel>
          <Panel title="Cómo sale el aviso">
            <ul className="space-y-2 text-[13px] text-ink-2">
              <li>
                <strong>Menos de 24 h</strong> desde su último mensaje: sale solo, con el texto del estado (sin IA).
              </li>
              <li>
                <strong>De 24 h a 7 días:</strong> va a la Bandeja ya redactado y lo envía una persona (Meta lo permite como agente humano; necesita ese permiso en el App Review).
              </li>
              <li>
                <strong>Más de 7 días</strong>, o si nunca escribió por DM: espera; sale apenas la persona vuelva a escribir.
              </li>
              <li>Cuentas en modo prueba: va a la Bandeja para enviarlo desde Meta.</li>
            </ul>
          </Panel>
          <Panel title="Cómo se conecta">
            <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-ink-2">
              <li>El administrador crea en Google Cloud un cliente OAuth (aplicación web) con la URL de regreso <code>/api/google/callback</code> del panel, una clave de API y activa Google Sheets API y Google Picker API.</li>
              <li>Pone GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_API_KEY y GOOGLE_PROJECT_NUMBER en el <code>.env</code> del servidor.</li>
              <li>Aquí: «Conectar con Google» con la cuenta que ve la Hoja y «Elegir la Hoja».</li>
            </ol>
          </Panel>
        </aside>
      </div>
    </>
  );
}

export default function Hoja({ searchParams }: PageProps<"/panel/hoja">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <HojaContent searchParams={searchParams} />
    </Suspense>
  );
}
