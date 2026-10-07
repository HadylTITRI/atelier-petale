/**
 * Mode démo : toutes les données sont dans le localStorage du navigateur.
 * Ouvrez la boutique et l'admin dans deux onglets du même navigateur
 * pour voir les commandes arriver en direct.
 */
import { CONFIG, STATUSES } from "../config.js";
import { local, uid, makeOrderCode } from "../utils.js";
import { normalizeSelection, optionsTotalCents, optionsForProduct, sortOptions } from "../options.js";

/** Identifiants du mode démo uniquement (aucune sécurité réelle). Le vrai site utilise le serveur. */
const DEMO_ADMIN = { email: "admin@demo.fr", password: "admin123" };

const KEYS = {
  products: "ap_demo_products",
  options: "ap_demo_options",
  orders: "ap_demo_orders",
  session: "ap_demo_admin",
};

const SAMPLE_PRODUCTS = [
  { name: "Bouquet de pivoines", category: "bouquets", priceCents: 450000, description: "Pivoines roses de saison et feuillage d'eucalyptus, environ 40 cm." },
  { name: "Bouquet champêtre", category: "bouquets", priceCents: 350000, description: "Fleurs des champs du moment, emballage kraft." },
  { name: "12 roses rouges", category: "bouquets", priceCents: 520000, description: "Douze roses rouges longues tiges, ruban satin." },
  { name: "Bouquet de tulipes", category: "bouquets", priceCents: 320000, description: "Quinze tulipes assorties, papier kraft et ruban." },
  { name: "Bouquet pastel", category: "bouquets", priceCents: 400000, description: "Roses, lisianthus et gypsophile dans des tons poudrés." },
];

/** Mêmes options d'exemple que la base (database/schema.sql). Identifiants numériques, comme en base. */
const SAMPLE_OPTIONS = [
  { name: "Initiales sur le bouquet", type: "text", maxValue: 3, priceCents: 30000, sortOrder: 10 },
  { name: "Prénom sur un ruban", type: "text", maxValue: 20, priceCents: 50000, sortOrder: 20 },
  { name: "Papillons artificiels", type: "quantity", maxValue: 12, priceCents: 10000, sortOrder: 30 },
  { name: "Ruban satin", type: "choice", choices: ["Rose poudré", "Blanc", "Doré", "Rouge", "Noir"], priceCents: 15000, sortOrder: 40 },
  { name: "Emballage cadeau premium", type: "toggle", priceCents: 40000, sortOrder: 50 },
];

/** Options enregistrées par une version précédente : complétées avec les champs ajoutés depuis. */
const withOptionDefaults = (o) => ({ type: "toggle", choices: [], maxValue: 0, ...o });

function readOptions() {
  let options = local.get(KEYS.options, null);
  if (!options) {
    options = SAMPLE_OPTIONS.map((o, i) => ({ id: String(i + 1), active: true, ...o }));
    local.set(KEYS.options, options);
  }
  return options.map(withOptionDefaults);
}

const nextOptionId = (options) => String(options.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1);

function readProducts() {
  let products = local.get(KEYS.products, null);
  if (!products) {
    // Premier lancement : on installe des produits d'exemple.
    const now = new Date().toISOString();
    const optionIds = readOptions().map((o) => o.id);
    products = SAMPLE_PRODUCTS.map((p) => ({ id: uid(), imageUrl: "", active: true, createdAt: now, optionIds, ...p }));
    local.set(KEYS.products, products);
  }
  // Produits d'une version précédente, où toutes les options valaient pour tous les bouquets.
  return products.map((p) => (p.optionIds ? p : { ...p, optionIds: readOptions().map((o) => o.id) }));
}

/** La boutique ne vend que les catégories de config.js (les anciens produits démo sont masqués). */
const sellable = (p) => Object.hasOwn(CONFIG.categories, p.category);

const readOrders = () => local.get(KEYS.orders, []);
const writeOrders = (orders) => local.set(KEYS.orders, orders);

const byCategoryThenName = (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "fr");

export function createLocalStore() {
  return {
    demoAdmin: DEMO_ADMIN,

    async listProducts({ includeHidden = false } = {}) {
      return readProducts()
        .filter((p) => sellable(p) && (includeHidden || p.active))
        .sort(byCategoryThenName);
    },

    async saveProduct(product) {
      const products = readProducts();
      const index = products.findIndex((p) => p.id === product.id);
      if (index >= 0) {
        products[index] = { ...products[index], ...product };
      } else {
        products.push({ ...product, id: uid(), createdAt: new Date().toISOString() });
      }
      local.set(KEYS.products, products);
      return index >= 0 ? products[index] : products.at(-1);
    },

    async deleteProduct(id) {
      local.set(KEYS.products, readProducts().filter((p) => p.id !== id));
    },

    /** Mode démo : la photo reste dans le navigateur, sous forme de « data URL ». */
    async uploadImage(blob) {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("La photo n'a pas pu être lue."));
        reader.readAsDataURL(blob);
      });
      return { url };
    },

    async listOptions({ includeHidden = false } = {}) {
      return sortOptions(readOptions().filter((o) => includeHidden || o.active));
    },

    async saveOption({ addToAllProducts, ...option }) {
      const options = readOptions();
      const index = options.findIndex((o) => o.id === option.id);
      if (index >= 0) options[index] = { ...options[index], ...option };
      else options.push({ ...option, id: nextOptionId(options) });
      local.set(KEYS.options, options);
      const saved = index >= 0 ? options[index] : options.at(-1);
      if (addToAllProducts) {
        local.set(KEYS.products, readProducts().map((p) => ({ ...p, optionIds: [...p.optionIds, saved.id] })));
      }
      return saved;
    },

    async setOptionActive(id, active) {
      const options = readOptions().map((o) => (o.id === id ? { ...o, active } : o));
      local.set(KEYS.options, options);
      return options.find((o) => o.id === id);
    },

    async deleteOption(id) {
      local.set(KEYS.options, readOptions().filter((o) => o.id !== id));
      local.set(KEYS.products, readProducts().map((p) => ({ ...p, optionIds: p.optionIds.filter((o) => o !== id) })));
    },

    async placeOrder({ items, customer, address, delivery, cardMessage = "", notes = "" }) {
      // Prix du bouquet et prix des options sont recalculés ici : on ne fait pas confiance au panier.
      const catalog = new Map(readProducts().filter((p) => sellable(p) && p.active).map((p) => [p.id, p]));
      const availableOptions = readOptions();
      const lines = items.map(({ productId, qty, options = [] }) => {
        const product = catalog.get(productId);
        if (!product) throw new Error("Un article de votre panier n'est plus disponible.");
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error("Quantité invalide dans votre panier.");
        const chosen = normalizeSelection(options, optionsForProduct(product, availableOptions));
        return {
          productId, name: product.name, priceCents: product.priceCents, qty,
          options: chosen, optionsCents: optionsTotalCents(chosen),
        };
      });
      if (!lines.length) throw new Error("Votre panier est vide.");

      const subtotalCents = lines.reduce((sum, l) => sum + (l.priceCents + l.optionsCents) * l.qty, 0);
      const order = {
        id: uid(),
        code: makeOrderCode(),
        status: STATUSES[0].id,
        createdAt: new Date().toISOString(),
        items: lines,
        subtotalCents,
        deliveryCents: CONFIG.deliveryFeeCents,
        totalCents: subtotalCents + CONFIG.deliveryFeeCents,
        customer,
        address,
        delivery,
        cardMessage,
        notes,
      };
      writeOrders([...readOrders(), order]);
      return { code: order.code };
    },

    async getOrdersByCodes(codes) {
      const wanted = new Set(codes);
      return readOrders().filter((o) => wanted.has(o.code));
    },

    async listOrders() {
      return readOrders().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async updateOrderStatus(id, status) {
      writeOrders(readOrders().map((o) => (o.id === id ? { ...o, status } : o)));
    },

    /** Prévient quand les commandes changent dans un autre onglet. */
    subscribeToOrders(callback) {
      const onStorage = (event) => {
        if (event.key === KEYS.orders) callback();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },

    auth: {
      async signIn(email, password) {
        if (email.trim().toLowerCase() !== DEMO_ADMIN.email || password !== DEMO_ADMIN.password) {
          throw new Error("E-mail ou mot de passe incorrect.");
        }
        sessionStorage.setItem(KEYS.session, email);
        return { email };
      },
      async signOut() {
        sessionStorage.removeItem(KEYS.session);
      },
      async getUser() {
        const email = sessionStorage.getItem(KEYS.session);
        return email ? { email } : null;
      },
    },
  };
}
