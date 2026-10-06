/**
 * Crée les tables : `npm run db:init`.
 * Exécute database/schema.sql sur la base indiquée dans .env (qui doit déjà exister :
 * chez les hébergeurs MySQL, elle est créée avec le service), puis les mises à niveau
 * ci-dessous pour une base créée avec une version précédente.
 * Sans danger à relancer : rien n'est recréé ni effacé si c'est déjà en place.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Table des options (communes à tous les bouquets). Même définition que dans
 * database/schema.sql : test/api.test.js vérifie que les deux restent identiques.
 */
export const OPTIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`options\` (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  name         VARCHAR(80)       NOT NULL,
  price_cents  INT UNSIGNED      NOT NULL DEFAULT 0,
  active       BOOLEAN           NOT NULL DEFAULT TRUE,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_options_display (active, sort_order, name)
) ENGINE = InnoDB`;

/** Options d'exemple, ajoutées seulement si la table est vide (elles reprennent l'ancienne configuration). */
export const SAMPLE_OPTIONS = [
  { name: "Initiales sur le bouquet", priceCents: 30000, sortOrder: 10 },
  { name: "Prénom sur un ruban", priceCents: 50000, sortOrder: 20 },
  { name: "3 papillons artificiels", priceCents: 30000, sortOrder: 30 },
  { name: "Ruban satin", priceCents: 15000, sortOrder: 40 },
  { name: "Emballage cadeau premium", priceCents: 40000, sortOrder: 50 },
];

/** Crée la table des options si elle manque, puis y met les exemples si elle est vide. Idempotent. */
export async function ensureOptionsTable(connection) {
  await connection.query(OPTIONS_TABLE_SQL);
  const [[{ total }]] = await connection.query("SELECT COUNT(*) AS total FROM `options`");
  if (Number(total) === 0) {
    await connection.query(
      "INSERT INTO `options` (name, price_cents, sort_order) VALUES ?",
      [SAMPLE_OPTIONS.map((o) => [o.name, o.priceCents, o.sortOrder])],
    );
  }
}

async function main() {
  const { createConnection } = await import("./db.js");
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../database/schema.sql");
  let sql = await readFile(file, "utf8");

  // La base existe déjà et est choisie par la configuration : on retire CREATE DATABASE et USE.
  sql = sql.replace(/CREATE DATABASE[^;]*;/i, "").replace(/^USE\s+[^;]*;/im, "");

  const connection = await createConnection(process.env, { multipleStatements: true });
  try {
    await connection.query(sql);
    await ensureOptionsTable(connection);
    console.log("Tables créées (ou déjà présentes).");
  } finally {
    await connection.end();
  }
}

// Lancé directement (npm run db:init) : on exécute. Importé (tests) : on ne fait rien.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
