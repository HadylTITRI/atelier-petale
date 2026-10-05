/**
 * Crée (ou remplace le mot de passe d') un compte administrateur : `npm run admin:create`.
 *
 *   npm run admin:create -- vous@exemple.dz            (le mot de passe est demandé)
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create
 *
 * Le mot de passe est haché (scrypt) avant d'être enregistré, jamais stocké en clair.
 */
import readline from "node:readline";
import { hashPassword } from "./auth.js";
import { createPool } from "./db.js";
import { createMysqlRepo } from "./repo-mysql.js";

function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (text) => {
    if (text.includes(question)) process.stdout.write(text);
  };
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    process.stdout.write("\n");
    resolve(answer);
  }));
}

const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Indiquez un e-mail valide : npm run admin:create -- vous@exemple.dz");
  process.exit(1);
}

const password = process.env.ADMIN_PASSWORD ?? (await askHidden("Mot de passe (12 caractères minimum) : "));
if (password.length < 12) {
  console.error("Mot de passe trop court : 12 caractères minimum.");
  process.exit(1);
}

const pool = createPool();
try {
  await createMysqlRepo(pool).saveAdmin(email, await hashPassword(password));
  console.log(`Compte administrateur enregistré : ${email}`);
} finally {
  await pool.end();
}
