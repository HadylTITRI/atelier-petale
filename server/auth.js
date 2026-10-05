/**
 * Mots de passe et sessions admin, sans dépendance externe (module `crypto` de Node).
 *
 *  - Mot de passe : haché avec scrypt (lent et résistant aux attaques par GPU),
 *    avec un sel aléatoire par mot de passe. Jamais stocké en clair.
 *  - Session : jeton signé en HMAC-SHA256 posé dans un cookie HttpOnly.
 */
import { scrypt, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, salt, hash] = String(stored ?? "").split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hache servant à garder le même temps de réponse quand l'e-mail n'existe pas. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

const sign = (body, secret) => createHmac("sha256", secret).update(body).digest("base64url");

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Renvoie le contenu du jeton s'il est authentique et non expiré, sinon null. */
export function verifyToken(token, secret) {
  const [body, signature] = String(token ?? "").split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
