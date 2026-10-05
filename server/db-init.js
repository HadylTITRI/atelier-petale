/**
 * Crée les tables : `npm run db:init`.
 * Exécute database/schema.sql sur la base indiquée dans .env (qui doit déjà exister :
 * chez les hébergeurs MySQL, elle est créée avec le service).
 * Sans danger si les tables existent déjà (CREATE TABLE IF NOT EXISTS).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "./db.js";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../database/schema.sql");
let sql = await readFile(file, "utf8");

// La base existe déjà et est choisie par la configuration : on retire CREATE DATABASE et USE.
sql = sql.replace(/CREATE DATABASE[^;]*;/i, "").replace(/^USE\s+[^;]*;/im, "");

const connection = await createConnection(process.env, { multipleStatements: true });
try {
  await connection.query(sql);
  console.log("Tables créées (ou déjà présentes).");
} finally {
  await connection.end();
}
