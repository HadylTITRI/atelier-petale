/**
 * Vérification de tout ce qui arrive du navigateur.
 * Les prix ne sont JAMAIS lus depuis la requête : ils sont recalculés ici à partir du catalogue
 * et de js/config.js, les mêmes fichiers que ceux utilisés par la boutique.
 */
import { CONFIG, STATUSES } from "../js/config.js";
import { normalizeSelection } from "../js/options.js";
import { HttpError, cleanLine, isRealDate, todayIn } from "./util.js";

const bad = (message) => new HttpError(400, message);

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
    return { productId: String(item.productId ?? ""), qty, options: Array.isArray(item.options) ? item.options : [] };
  });
  return clean;
}

/**
 * Applique les vrais prix : bouquet (catalogue) + options (config.js) + livraison.
 * `products` = bouquets actifs trouvés en base pour les identifiants du panier.
 */
export function priceOrder(clean, products) {
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const items = clean.items.map(({ productId, qty, options }) => {
    const product = byId.get(productId);
    if (!product || !product.active || !Object.hasOwn(CONFIG.categories, product.category)) {
      throw bad("Un article de votre panier n'est plus disponible.");
    }
    let chosen;
    try {
      chosen = normalizeSelection(options);
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
  if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) throw bad("Le lien de la photo doit commencer par http:// ou https://.");
  return {
    name,
    category,
    priceCents,
    description: text(body.description, "La description", { max: 300 }),
    imageUrl,
    active: body.active !== false,
  };
}

export function validateStatus(body) {
  const status = isObject(body) ? body.status : undefined;
  if (!STATUSES.some((s) => s.id === status)) throw bad("Statut inconnu.");
  return status;
}
