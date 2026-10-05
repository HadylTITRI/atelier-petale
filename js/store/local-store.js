/**
 * Mode démo : toutes les données sont dans le localStorage du navigateur.
 * Ouvrez la boutique et l'admin dans deux onglets du même navigateur
 * pour voir les commandes arriver en direct.
 */
import { CONFIG, STATUSES } from "../config.js";
import { local, uid, makeOrderCode } from "../utils.js";
import { normalizeSelection, optionsTotalCents } from "../options.js";

const KEYS = {
  products: "ap_demo_products",
  orders: "ap_demo_orders",
  session: "ap_demo_admin",
};

const SAMPLE_PRODUCTS = [
  { name: "Bouquet de pivoines", category: "bouquets", priceCents: 4590, description: "Pivoines roses de saison et feuillage d'eucalyptus, environ 40 cm." },
  { name: "Bouquet champêtre", category: "bouquets", priceCents: 3490, description: "Fleurs des champs du moment, emballage kraft." },
  { name: "12 roses rouges", category: "bouquets", priceCents: 5290, description: "Douze roses rouges longues tiges, ruban satin." },
  { name: "Bouquet de tulipes", category: "bouquets", priceCents: 3190, description: "Quinze tulipes assorties, papier kraft et ruban." },
  { name: "Bouquet pastel", category: "bouquets", priceCents: 3990, description: "Roses, lisianthus et gypsophile dans des tons poudrés." },
];

function readProducts() {
  let products = local.get(KEYS.products, null);
  if (!products) {
    // Premier lancement : on installe des produits d'exemple.
    const now = new Date().toISOString();
    products = SAMPLE_PRODUCTS.map((p) => ({ id: uid(), imageUrl: "", active: true, createdAt: now, ...p }));
    local.set(KEYS.products, products);
  }
  return products;
}

/** La boutique ne vend que les catégories de config.js (les anciens produits démo sont masqués). */
const sellable = (p) => p.category in CONFIG.categories;

const readOrders = () => local.get(KEYS.orders, []);
const writeOrders = (orders) => local.set(KEYS.orders, orders);

const byCategoryThenName = (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "fr");

export function createLocalStore() {
  return {
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

    async placeOrder({ items, customer, address, delivery, cardMessage = "", notes = "" }) {
      // Prix du bouquet et prix des options sont recalculés ici : on ne fait pas confiance au panier.
      const catalog = new Map(readProducts().filter((p) => sellable(p) && p.active).map((p) => [p.id, p]));
      const lines = items.map(({ productId, qty, options = [] }) => {
        const product = catalog.get(productId);
        if (!product) throw new Error("Un article de votre panier n'est plus disponible.");
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error("Quantité invalide dans votre panier.");
        const chosen = normalizeSelection(options);
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
        const { demoAdmin } = CONFIG;
        if (email.trim().toLowerCase() !== demoAdmin.email || password !== demoAdmin.password) {
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
