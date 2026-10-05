/**
 * Options de personnalisation d'un bouquet (initiales, papillons, ruban…).
 * Les options sont définies dans config.js ; ce module les valide et calcule leur prix.
 *
 * Une « sélection » brute est une liste [{ id, value }] telle que remplie par le client.
 * `normalizeSelection` la transforme en lignes sûres, avec libellé et prix recalculés :
 * c'est ce résultat qui est enregistré dans la commande, jamais le prix envoyé par le navigateur.
 */
import { CONFIG } from "./config.js";

const definitions = () => CONFIG.bouquetOptions ?? [];

/** Nettoie un texte libre : espaces normalisés, caractères de contrôle retirés. */
const cleanText = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Valide une sélection et la renvoie dans l'ordre de config.js.
 * Lève une erreur si une option est inconnue ou invalide.
 * Une option vide (texte vide, quantité 0, case décochée) est simplement ignorée.
 */
export function normalizeSelection(raw = []) {
  const byId = new Map(definitions().map((def) => [def.id, def]));
  const seen = new Map();

  for (const entry of Array.isArray(raw) ? raw : []) {
    const def = byId.get(entry?.id);
    if (!def) throw new Error("Une option choisie n'existe plus.");
    seen.set(def.id, entry.value);
  }

  const result = [];
  for (const def of definitions()) {
    if (!seen.has(def.id)) continue;
    const input = seen.get(def.id);
    let value;
    let priceCents;

    if (def.type === "text") {
      value = cleanText(input);
      if (def.uppercase) value = value.toLocaleUpperCase("fr-FR");
      if (!value) continue;
      if (value.length > def.maxLength) throw new Error(`« ${def.label} » : ${def.maxLength} caractères maximum.`);
      priceCents = def.priceCents;
    } else if (def.type === "quantity") {
      const qty = Number(input);
      if (!qty) continue;
      if (!Number.isInteger(qty) || qty < 0 || qty > def.max) throw new Error(`« ${def.label} » : de 1 à ${def.max}.`);
      value = qty;
      priceCents = def.unitPriceCents * qty;
    } else if (def.type === "choice") {
      value = cleanText(input);
      if (!value) continue;
      if (!def.choices.includes(value)) throw new Error(`« ${def.label} » : choix invalide.`);
      priceCents = def.priceCents;
    } else if (def.type === "toggle") {
      if (!input) continue;
      value = true;
      priceCents = def.priceCents;
    } else {
      continue;
    }

    result.push({ id: def.id, label: def.label, value, priceCents });
  }
  return result;
}

/** Texte lisible d'une option choisie : « Initiales : AM », « Papillons artificiels × 3 », « Emballage cadeau premium ». */
export function describeOption(option) {
  if (option.value === true) return option.label;
  if (typeof option.value === "number") return `${option.label} × ${option.value}`;
  return `${option.label} : ${option.value}`;
}

export const optionsTotalCents = (options = []) => options.reduce((sum, o) => sum + o.priceCents, 0);

/** Prix d'une unité (bouquet + options) pour une ligne de commande. */
export const lineUnitCents = (line) => line.priceCents + (line.optionsCents ?? 0);

/** Identifiant stable d'une configuration : mêmes options = même ligne de panier. */
export function configKey(productId, options = []) {
  return [productId, ...options.map((o) => `${o.id}=${o.value}`)].join("|");
}
