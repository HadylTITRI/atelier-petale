/**
 * Petits outils partagés par le serveur.
 */

/** Erreur à renvoyer au client avec un code HTTP et un message en français. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Code lisible au téléphone, ex. "AP-K7M2QX" (sans 0/O ni 1/I). Même format que le mode démo. */
export function makeOrderCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `AP-${code}`;
}

export const ORDER_CODE_PATTERN = /^AP-[A-HJKMNP-Z2-9]{6}$/;

/** Date du jour AAAA-MM-JJ dans le fuseau de la boutique (et non celui du serveur). */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Vrai pour une date AAAA-MM-JJ qui existe vraiment (pas le 31 février). */
export function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Texte nettoyé : espaces en trop retirés, caractères de contrôle supprimés. */
export function cleanLine(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").trim();
}
