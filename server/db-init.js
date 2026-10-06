/**
 * Crée les tables : `node --env-file=.env server/db-init.js`.
 * Exécute database/schema.sql sur la base indiquée dans .env (qui doit déjà exister :
 * chez les hébergeurs MySQL, elle est créée avec le service), avec les mises à niveau
 * ci-dessous pour une base créée avec une version précédente.
 * Sans danger à relancer : rien n'est recréé ni effacé si c'est déjà en place.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Colonnes de la table `options` ajoutées après sa création, dans l'ordre, avec la colonne
 * qui les précède. Mêmes définitions que dans database/schema.sql : un test le vérifie.
 */
export const OPTION_COLUMNS = [
  ["type", "ENUM('toggle', 'text', 'choice', 'quantity') NOT NULL DEFAULT 'toggle'", "price_cents"],
  ["choices", "JSON NULL", "type"],
  ["max_value", "SMALLINT UNSIGNED NOT NULL DEFAULT 0", "choices"],
];

/**
 * Options d'exemple de la version précédente (toutes des cases à cocher) qui deviennent des
 * champs à remplir, au même prix. Appliqué une seule fois, quand la colonne `type` est ajoutée.
 */
const TYPED_SAMPLES = [
  ["Initiales sur le bouquet", "text", null, 3],
  ["Prénom sur un ruban", "text", null, 20],
  ["Ruban satin", "choice", JSON.stringify(["Rose poudré", "Blanc", "Doré", "Rouge", "Noir"]), 0],
];

async function existingTables(connection) {
  const [rows] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  );
  return new Set(rows.map((row) => row.name.toLowerCase()));
}

/** Ajoute à `options` les colonnes qui lui manquent. Renvoie true si `type` vient d'être ajoutée. */
async function addOptionColumns(connection) {
  const [rows] = await connection.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'options'",
  );
  const present = new Set(rows.map((row) => row.name.toLowerCase()));
  for (const [name, definition, after] of OPTION_COLUMNS) {
    if (!present.has(name)) await connection.query(`ALTER TABLE \`options\` ADD COLUMN ${name} ${definition} AFTER ${after}`);
  }
  if (present.has("type")) return false;
  for (const [name, type, choices, maxValue] of TYPED_SAMPLES) {
    await connection.query(
      "UPDATE `options` SET type = ?, choices = ?, max_value = ? WHERE name = ? AND type = 'toggle'",
      [type, choices, maxValue, name],
    );
  }
  return true;
}

async function main() {
  const { createConnection } = await import("./db.js");
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../database/schema.sql");
  let sql = await readFile(file, "utf8");

  // La base existe déjà et est choisie par la configuration : on retire CREATE DATABASE et USE.
  sql = sql.replace(/CREATE DATABASE[^;]*;/i, "").replace(/^USE\s+[^;]*;/im, "");

  const connection = await createConnection(process.env, { multipleStatements: true });
  try {
    const before = await existingTables(connection);
    // Avant schema.sql : ses options d'exemple utilisent les nouvelles colonnes.
    if (before.has("options")) await addOptionColumns(connection);
    await connection.query(sql);

    // Première fois que chaque bouquet a ses propres options : on garde le fonctionnement
    // d'avant, où toutes les options étaient proposées pour tous les bouquets.
    if (!before.has("product_options")) {
      await connection.query(
        "INSERT IGNORE INTO product_options (product_id, option_id) SELECT p.id, o.id FROM products p CROSS JOIN `options` o",
      );
    }
    console.log("Tables créées (ou déjà présentes).");
  } finally {
    await connection.end();
  }
}

// Lancé directement : on exécute. Importé (tests) : on ne fait rien.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
