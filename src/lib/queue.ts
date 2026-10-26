import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type Job = { id: number; type: string; payload: unknown; attempts: number };

// Guarda el evento crudo de Meta y encola su procesamiento en la misma transacción.
// Si el cuerpo ya llegó (reintento de Meta), no hace nada.
export async function recordMetaEvent(db: Pool, dedupeKey: string, metaObject: string | null, payload: unknown) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const eventId = await conn
      .query<ResultSetHeader>("INSERT INTO webhook_events (dedupe_key, meta_object, payload) VALUES (?, ?, ?)", [
        dedupeKey,
        metaObject,
        JSON.stringify(payload),
      ])
      .then(
        ([r]) => r.insertId,
        (e) => {
          if (e.code === "ER_DUP_ENTRY") return null;
          throw e;
        },
      );
    if (eventId) {
      await conn.query("INSERT INTO jobs (type, payload) VALUES ('meta_event', JSON_OBJECT('event_id', ?))", [eventId]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Toma hasta `max` trabajos listos de los tipos dados. Antes devuelve a la cola los que quedaron
// en "running" más de 10 minutos (worker caído).
export async function claimJobs(db: Pool, types: string[], max = 5): Promise<Job[]> {
  if (!types.length) return [];
  await db.query("UPDATE jobs SET status = 'pending' WHERE status = 'running' AND locked_at < NOW(3) - INTERVAL 10 MINUTE");
  const conn = await db.getConnection();
  try {
    // READ COMMITTED: suelta los bloqueos de las filas revisadas que no sirven, para que otro
    // worker pueda tomar el siguiente trabajo. Con REPEATABLE READ quedarían todas bloqueadas.
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM jobs
       WHERE status = 'pending' AND run_at <= NOW(3) AND type IN (?)
       ORDER BY run_at LIMIT ? FOR UPDATE SKIP LOCKED`,
      [types, max],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await conn.query("UPDATE jobs SET status = 'running', locked_at = NOW(3), attempts = attempts + 1 WHERE id IN (?)", [ids]);
    }
    await conn.commit();
    if (!ids.length) return [];
    const [jobs] = await db.query<RowDataPacket[]>("SELECT id, type, payload, attempts FROM jobs WHERE id IN (?)", [ids]);
    return jobs as Job[];
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Cierra un trabajo. Con error reintenta a los 30 s, 1, 2 y 4 min; al quinto intento fallido
// pasa a "dead" (cola de errores).
export async function finishJob(db: Pool, id: number, err: string | null, maxAttempts = 5) {
  await db.query(
    `UPDATE jobs SET
       status = CASE WHEN ? IS NULL THEN 'done' WHEN attempts >= ? THEN 'dead' ELSE 'pending' END,
       run_at = CASE WHEN ? IS NULL THEN run_at ELSE NOW(3) + INTERVAL (30 * POW(2, attempts - 1)) SECOND END,
       locked_at = NULL,
       last_error = ?
     WHERE id = ?`,
    [err, maxAttempts, err, err, id],
  );
}
