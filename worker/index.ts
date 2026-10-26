import { db } from "../src/lib/db.ts";
import { claimJobs, finishJob } from "../src/lib/queue.ts";
import { processMetaEvent } from "../src/lib/meta-events.ts";
import { classifyInteraction } from "../src/lib/classify.ts";
import { publishAction } from "../src/lib/publish.ts";
import { backfillAccount } from "../src/lib/backfill.ts";
import { completePost } from "../src/lib/posts.ts";

// Un handler por tipo de trabajo. Un tipo sin handler se queda en la cola hasta que exista uno:
// "classify" solo se toma cuando hay llave y modelo de OpenAI en el .env.
const handlers: Record<string, (payload: any) => Promise<void>> = {
  meta_event: async ({ event_id }) => {
    const r = await processMetaEvent(db, Number(event_id));
    console.log(`evento ${event_id}: ${r.created} nuevas, ${r.replies} respuestas del equipo, ${r.duplicates} repetidas, ${r.unknownAccount} de cuentas no conectadas`);
  },
};
// Historial de una cuenta y datos de las publicaciones (tipo de pieza, enlace), para el Resumen.
handlers.backfill = async ({ account_id, days }) => {
  const r = await backfillAccount(db, Number(account_id), Number(days) || undefined);
  console.log(r ? `historial cuenta ${account_id}: ${r.created} mensajes, ${r.replies} respuestas del equipo, ${r.duplicates} ya estaban` : `historial cuenta ${account_id}: sin token`);
};
handlers.post_info = async ({ account_id, meta_id }) => {
  await completePost(db, Number(account_id), String(meta_id));
};
// Publica en Meta lo que una persona aprobó o lo que ya responde solo (src/lib/publish.ts).
handlers.publish = async ({ action_id }) => {
  const r = await publishAction(db, Number(action_id));
  console.log(r ? `acción ${action_id}: ${r.type} publicada en Meta` : `acción ${action_id}: ya estaba hecha`);
};
if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
  handlers.classify = async ({ interaction_id }) => {
    const r = await classifyInteraction(db, Number(interaction_id));
    console.log(r ? `interacción ${interaction_id}: ${r.tipo} (${Math.round(r.confidence * 100)} %) → ${r.decision}` : `interacción ${interaction_id}: ya clasificada`);
  };
}

const POLL_MS = 2000;
let running = true;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (running = false));

console.log(`worker listo; tipos: ${Object.keys(handlers).join(", ") || "ninguno"}`);

while (running) {
  const jobs = await claimJobs(db, Object.keys(handlers));

  for (const job of jobs) {
    try {
      await handlers[job.type](job.payload);
      await finishJob(db, job.id, null);
    } catch (e) {
      // Sin el objeto completo: el error de mysql2 trae el SQL con los valores (texto de la persona).
      const msg = e instanceof Error ? `${(e as { code?: string }).code ?? e.name}: ${e.message}` : String(e);
      console.error(`job ${job.id} (${job.type}) falló: ${msg}`);
      await finishJob(db, job.id, msg);
    }
  }

  if (!jobs.length) await new Promise((r) => setTimeout(r, POLL_MS));
}

await db.end();
