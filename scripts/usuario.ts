// Crea un usuario del panel o le cambia la contraseña: npm run usuario -- <usuario> [nombre]
// La contraseña se pide en la terminal (o llega por la entrada estándar); nunca va en el comando.
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db.ts";
import { saveUser } from "../src/lib/auth.ts";

const [username, ...name] = process.argv.slice(2);
if (!username) {
  console.error("Uso: npm run usuario -- <usuario> [nombre]");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
// Lo que se escribe no se muestra ni queda en la pantalla.
const rlOut = rl as unknown as { _writeToOutput: (s: string) => void };
const ask = rl.question("Contraseña: ");
rlOut._writeToOutput = () => {};
const password = (await ask).trim();
process.stdout.write("\n");
rl.close();
try {
  await saveUser(db, username, name.join(" ") || username, password);
  console.log(`Usuario ${username.toLowerCase()} listo.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.end();
}
