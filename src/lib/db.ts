import mysql from "mysql2/promise";

// Pool del servidor y el worker (MySQL en el mismo VPS, solo 127.0.0.1). Nunca desde el navegador.
// Todo en UTC: la sesión y la conversión de fechas de mysql2.
// En producción no hay valor por defecto: sin DATABASE_URL no arranca (nada de root sin clave).
if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
export const db = mysql.createPool({
  uri: process.env.DATABASE_URL || "mysql://root@127.0.0.1:3307/social_care",
  timezone: "Z",
  connectionLimit: 5,
});
db.pool.on("connection", (c) => c.query("SET time_zone = '+00:00'"));
