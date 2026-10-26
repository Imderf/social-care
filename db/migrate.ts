import { readdirSync, readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";

// Aplica en orden los .sql de db/migrations que no estén en schema_migrations.
// Ojo: en MySQL el DDL no es transaccional; si un archivo falla a la mitad, se corrige a mano.
export async function migrate(uri: string) {
  const conn = await mysql.createConnection({ uri, multipleStatements: true });
  try {
    await conn.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))",
    );
    const [done] = await conn.query<RowDataPacket[]>("SELECT name FROM schema_migrations");
    const applied = new Set(done.map((r) => r.name));
    const dir = new URL("./migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      await conn.query(readFileSync(new URL(file, dir), "utf8"));
      await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
      console.log(`migración aplicada: ${file}`);
    }
  } finally {
    await conn.end();
  }
}

if (import.meta.main) await migrate(process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/social_care");
