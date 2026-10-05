/**
 * Connexion à MySQL.
 *
 * Configuration par variables d'environnement (voir .env.example) :
 *   DATABASE_URL  mysql://utilisateur:motdepasse@hote:port/base   (le plus simple)
 *   ou DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   DB_SSL=true   connexion chiffrée, obligatoire chez la plupart des hébergeurs MySQL gratuits
 *   DB_SSL_CA     certificat de l'hébergeur (facultatif ; sans lui le chiffrement est actif mais le serveur n'est pas authentifié)
 */
import mysql from "mysql2/promise";

export function connectionOptions(env = process.env) {
  let options;
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    options = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    };
    if (url.searchParams.get("ssl-mode")?.toUpperCase().startsWith("REQUIRED")) env = { ...env, DB_SSL: "true" };
  } else {
    options = {
      host: env.DB_HOST ?? "localhost",
      port: Number(env.DB_PORT ?? 3306),
      user: env.DB_USER ?? "root",
      password: env.DB_PASSWORD ?? "",
      database: env.DB_NAME ?? "atelier_petale",
    };
  }

  if (env.DB_SSL === "true") {
    options.ssl = env.DB_SSL_CA
      ? { ca: env.DB_SSL_CA.replace(/\\n/g, "\n") }
      : { rejectUnauthorized: false };
  }
  return { ...options, charset: "utf8mb4", dateStrings: true };
}

export function createPool(env = process.env) {
  return mysql.createPool({ ...connectionOptions(env), waitForConnections: true, connectionLimit: 5, connectTimeout: 20_000 });
}

export async function createConnection(env = process.env, extra = {}) {
  return mysql.createConnection({ ...connectionOptions(env), ...extra });
}
