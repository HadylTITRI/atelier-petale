/**
 * Démarrage du serveur : `npm start`.
 * Configuration par variables d'environnement (voir .env.example).
 */
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { createMysqlRepo } from "./repo-mysql.js";

const production = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  console.error("SESSION_SECRET manquant ou trop court (32 caractères minimum). Voir .env.example.");
  process.exit(1);
}

const pool = createPool();
const app = createApp({
  repo: createMysqlRepo(pool),
  secret,
  production,
  trustProxy: process.env.TRUST_PROXY === "true",
  rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
});

const port = Number(process.env.PORT ?? 3000);
const server = createServer(app);
server.requestTimeout = 30_000;
server.listen(port, () => console.log(`Atelier Pétale : http://localhost:${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
