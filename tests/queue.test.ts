import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { claimJobs, finishJob, recordMetaEvent } from "../src/lib/queue.ts";
import { freshTestDb } from "./test-db.ts";

let db: Pool;
const rows = async (q: string, p: unknown[] = []) => (await db.query<RowDataPacket[]>(q, p))[0];

before(async () => (db = await freshTestDb()));
after(() => db.end());

test("un reintento de Meta con el mismo cuerpo no duplica el evento ni el trabajo", async () => {
  await recordMetaEvent(db, "a".repeat(64), "page", { object: "page" });
  await recordMetaEvent(db, "a".repeat(64), "page", { object: "page" });
  const events = await rows("SELECT id FROM webhook_events");
  const jobs = await rows("SELECT payload FROM jobs WHERE type = 'meta_event'");
  assert.equal(events.length, 1);
  assert.deepEqual(jobs.map((j) => j.payload), [{ event_id: events[0].id }]);
});

test("cola: toma, bloquea, reintenta con espera y manda a dead al quinto fallo", async () => {
  await db.query("INSERT INTO jobs (type) VALUES ('x'), ('y')");
  const [job] = await claimJobs(db, ["x"]);
  assert.equal(job.attempts, 1);
  assert.equal((await claimJobs(db, ["x"])).length, 0, "un trabajo tomado no se vuelve a tomar");

  await finishJob(db, job.id, "falló");
  const [retry] = await rows("SELECT status, run_at > NOW(3) AS later FROM jobs WHERE id = ?", [job.id]);
  assert.deepEqual({ ...retry }, { status: "pending", later: 1 });

  await db.query("UPDATE jobs SET attempts = 5, status = 'running' WHERE id = ?", [job.id]);
  await finishJob(db, job.id, "falló otra vez");
  assert.equal((await rows("SELECT status FROM jobs WHERE id = ?", [job.id]))[0].status, "dead");

  await db.query("UPDATE jobs SET status = 'running', locked_at = NOW(3) - INTERVAL 11 MINUTE WHERE type = 'y'");
  const [stuck] = await claimJobs(db, ["y"]);
  assert.ok(stuck, "recupera trabajos colgados");
  await finishJob(db, stuck.id, null);
  assert.equal((await rows("SELECT status FROM jobs WHERE id = ?", [stuck.id]))[0].status, "done");
});

test("dos workers a la vez no toman el mismo trabajo (SKIP LOCKED)", async () => {
  await db.query("INSERT INTO jobs (type) VALUES ('z'), ('z')");
  const [a, b] = await Promise.all([claimJobs(db, ["z"], 1), claimJobs(db, ["z"], 1)]);
  assert.equal(a.length + b.length, 2);
  assert.notEqual(a[0].id, b[0].id);
});
