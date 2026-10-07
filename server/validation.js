/**
 * Vérification de tout ce qui arrive du navigateur.
 * Les prix ne sont JAMAIS lus depuis la requête : ils sont recalculés ici à partir du catalogue
 * et des options enregistrés en base, et de js/config.js (livraison).
 */
import { CONFIG, STATUSES } from "../js/config.js";
import {
  DEFAULT_MAX, MAX_OPTIONS_PER_ITEM, OPTION_TYPES, UNAVAILABLE_OPTION, normalizeSelection, optionsForProduct,
} from "../js/options.js";
import { HttpError, cleanLine, isRealDate, todayIn } from "./util.js";

const bad = (message) => new HttpError(400, message);

/** Adresse d'une photo importée depuis l'appareil (voir /images/ dans app.js). */
export const IMAGE_PATH = /^\/images\/\d{1,10}$/;

/** Texte obligatoire ou facultatif, avec longueur maximale. */
function text(value, label, { max, required = false } = {}) {
  const clean = cleanLine(value);
  if (required && !clean) throw bad(`Il manque ${label}.`);
  if (clean.length > max) throw bad(`${label} : ${max} caractères maximum.`);
  return clean;
}

/** Textes sur plusieurs lignes (message de carte, précisions) : les retours à la ligne sont gardés. */
function paragraph(value, label, max) {
  const clean = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (clean.length > max) throw bad(`${label} : ${max} caractères maximum.`);
  return clean;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Commande reçue du site → commande nettoyée (sans prix). */
export function validateOrder(body, now = new Date()) {
  if (!isObject(body)) throw bad("Commande invalide.");
  const { customer = {}, address = {}, delivery = {} } = body;
  if (![customer, address, delivery].every(isObject)) throw bad("Commande invalide.");

  const clean = {
    customer: {
      name: text(customer.name, "votre nom", { max: 100, required: true }),
      phone: text(customer.phone, "un numéro de téléphone", { max: 30, required: true }),
      email: text(customer.email, "L'e-mail", { max: 120 }),
    },
    address: {
      recipient: text(address.recipient, "Le destinataire", { max: 100 }),
      street: text(address.street, "l'adresse", { max: 200, required: true }),
      zip: text(address.zip, "le code postal", { max: 5, required: true }),
      city: text(address.city, "la ville", { max: 100, required: true }),
      details: text(address.details, "Les précisions d'adresse", { max: 200 }),
    },
    delivery: {
      date: text(delivery.date, "la date de livraison", { max: 10, required: true }),
      slot: text(delivery.slot, "le créneau", { max: 60, required: true }),
    },
    cardMessage: paragraph(body.cardMessage, "Le message de la carte", 200),
    notes: paragraph(body.notes, "Les précisions", 300),
    items: [],
  };

  if (clean.customer.phone.replace(/\D/g, "").length < 9) throw bad("Il manque un numéro de téléphone valide.");
  if (clean.customer.email && !/^\S+@\S+\.\S+$/.test(clean.customer.email)) throw bad("Il manque un e-mail valide.");
  if (!/^\d{5}$/.test(clean.address.zip)) throw bad("Il manque un code postal à 5 chiffres.");
  if (!isRealDate(clean.delivery.date) || clean.delivery.date < todayIn(CONFIG.timezone, now)) {
    throw bad("Il manque une date de livraison à venir.");
  }
  if (!CONFIG.deliverySlots.includes(clean.delivery.slot)) throw bad("Ce créneau de livraison n'existe pas.");

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad("Votre panier est vide.");
  if (items.length > 30) throw bad("Votre panier contient trop d'articles différents.");
  clean.items = items.map((item) => {
    if (!isObject(item)) throw bad("Commande invalide.");
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw bad("Quantité invalide dans votre panier.");
    return { productId: String(item.productId ?? ""), qty, options: optionEntries(item.options) };
  });
  return clean;
}

/**
 * Options remplies pour un article → [{ id, value }]. Seuls l'identifiant et la valeur saisie
 * sont lus, jamais le nom ni le prix ; la valeur est vérifiée ensuite par normalizeSelection.
 */
function optionEntries(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw bad("Commande invalide.");
  if (raw.length > MAX_OPTIONS_PER_ITEM) throw bad("Trop d'options choisies.");
  return raw.map((entry) => {
    const id = String(isObject(entry) ? entry.id ?? "" : entry ?? "");
    if (!/^\d{1,10}$/.test(id)) throw bad(UNAVAILABLE_OPTION);
    const value = isObject(entry) && "value" in entry ? entry.value : true;
    if (!["string", "number", "boolean"].includes(typeof value)) throw bad("Commande invalide.");
    if (typeof value === "string" && value.length > 200) throw bad("Une option contient un texte trop long.");
    return { id, value };
  });
}

/** Tous les identifiants d'options d'une commande nettoyée (pour une seule lecture en base). */
export const orderOptionIds = (clean) => [...new Set(clean.items.flatMap((item) => item.options.map((o) => o.id)))];

/**
 * Applique les vrais prix : bouquet (catalogue) + options (table `options`) + livraison.
 * `products` = bouquets trouvés en base pour les identifiants du panier, avec leurs `optionIds`.
 * `options`  = options trouvées en base pour les identifiants choisis ; une option absente,
 *              désactivée ou non proposée pour ce bouquet fait refuser la commande.
 * Chaque option retenue garde son nom, la valeur saisie et son prix du moment : { id, name, value, priceCents }.
 */
export function priceOrder(clean, products, options = []) {
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const items = clean.items.map(({ productId, qty, options: entries }) => {
    const product = byId.get(productId);
    if (!product || !product.active || !Object.hasOwn(CONFIG.categories, product.category)) {
      throw bad("Un article de votre panier n'est plus disponible.");
    }
    let chosen;
    try {
      chosen = normalizeSelection(entries, optionsForProduct(product, options));
    } catch (error) {
      throw bad(error.message);
    }
    const optionsCents = chosen.reduce((sum, option) => sum + option.priceCents, 0);
    return { productId: product.id, name: product.name, priceCents: product.priceCents, optionsCents, options: chosen, qty };
  });

  const subtotalCents = items.reduce((sum, item) => sum + (item.priceCents + item.optionsCents) * item.qty, 0);
  const deliveryCents = CONFIG.deliveryFeeCents;
  return { ...clean, items, subtotalCents, deliveryCents, totalCents: subtotalCents + deliveryCents };
}

/** Produit reçu de l'admin → produit nettoyé. */
export function validateProduct(body) {
  if (!isObject(body)) throw bad("Produit invalide.");
  const name = text(body.name, "le nom", { max: 80, required: true });
  const category = String(body.category ?? "");
  if (!Object.hasOwn(CONFIG.categories, category)) throw bad("Catégorie inconnue.");
  const priceCents = Number(body.priceCents);
  if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > 100_000_000) {
    throw bad("Indiquez un prix supérieur à 0.");
  }
  const imageUrl = text(body.imageUrl, "Le lien de la photo", { max: 500 });
  if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl) && !IMAGE_PATH.test(imageUrl)) {
    throw bad("Le lien de la photo doit commencer par http:// ou https://.");
  }
  return {
    name,
    category,
    priceCents,
    description: text(body.description, "La description", { max: 300 }),
    imageUrl,
    active: body.active !== false,
    optionIds: idList(body.optionIds, "Options du produit invalides."),
  };
}

/** Liste d'identifiants (texte), sans doublon. */
function idList(raw, message) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 100) throw bad(message);
  const ids = raw.map(String);
  if (!ids.every((id) => /^\d{1,10}$/.test(id))) throw bad(message);
  return [...new Set(ids)];
}

/** Option reçue de l'admin → option nettoyée. */
export function validateOption(body) {
  if (!isObject(body)) throw bad("Option invalide.");
  const name = text(body.name, "le nom", { max: 80, required: true });
  const priceCents = Number(body.priceCents);
  if (body.priceCents === "" || body.priceCents == null || !Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100_000_000) {
    throw bad("Indiquez un prix de 0 DA ou plus.");
  }
  const sortOrder = body.sortOrder === undefined || body.sortOrder === "" ? 0 : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) throw bad("L'ordre d'affichage va de 0 à 9999.");

  const type = body.type ?? "toggle";
  if (!Object.hasOwn(OPTION_TYPES, type)) throw bad("Type d'option inconnu.");

  // Texte : nombre de caractères maximum. Quantité : nombre maximum. Sinon : inutilisé.
  let maxValue = 0;
  if (type === "text" || type === "quantity") {
    const limit = type === "text" ? 200 : 99;
    maxValue = body.maxValue === undefined || body.maxValue === "" || body.maxValue === 0 ? DEFAULT_MAX[type] : Number(body.maxValue);
    if (!Number.isInteger(maxValue) || maxValue < 1 || maxValue > limit) {
      throw bad(type === "text" ? "Le nombre de caractères va de 1 à 200." : "La quantité maximum va de 1 à 99.");
    }
  }

  let choices = [];
  if (type === "choice") {
    if (!Array.isArray(body.choices)) throw bad("Indiquez les choix possibles, un par ligne.");
    choices = [...new Set(body.choices.map((c) => cleanLine(c).replace(/\s+/g, " ")).filter(Boolean))];
    if (!choices.length) throw bad("Indiquez au moins un choix.");
    if (choices.length > 30) throw bad("30 choix maximum.");
    if (choices.some((c) => c.length > 40)) throw bad("Chaque choix : 40 caractères maximum.");
  }

  return {
    name, type, priceCents, choices, maxValue, sortOrder, active: body.active !== false,
    // À la création seulement : proposer tout de suite l'option pour tous les bouquets.
    addToAllProducts: body.addToAllProducts === true,
  };
}

/** Activer / désactiver une option : { active: true | false }. */
export function validateActive(body) {
  if (!isObject(body) || typeof body.active !== "boolean") throw bad("Indiquez active : true ou false.");
  return body.active;
}

export function validateStatus(body) {
  const status = isObject(body) ? body.status : undefined;
  if (!STATUSES.some((s) => s.id === status)) throw bad("Statut inconnu.");
  return status;
}
