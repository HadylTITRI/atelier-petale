/**
 * Panier du client, gardé dans le navigateur.
 * On n'y stocke que l'identifiant du produit, la quantité et les identifiants des options :
 * noms et prix viennent toujours du catalogue et des options chargés depuis le serveur.
 *
 * Un même bouquet avec des options différentes forme des lignes distinctes
 * (ex. « bouquet + emballage cadeau » et « bouquet nu »).
 */
import { local } from "./utils.js";
import { normalizeSelection, optionsTotalCents, configKey } from "./options.js";

const STORAGE_KEY = "ap_cart";

class Cart {
  #lines = local.get(STORAGE_KEY, []);   // [{ productId, qty, options: [{ id }] }]
  #products = new Map();                 // productId → produit du catalogue
  #options = [];                         // options actives proposées par la boutique
  #listeners = new Set();

  /**
   * Met à jour le catalogue et les options connus, et retire les articles qui ne sont plus
   * en vente ou dont une option a été désactivée ou supprimée par l'atelier.
   */
  setCatalog(products, options = []) {
    this.#products = new Map(products.map((p) => [p.id, p]));
    this.#options = options;
    this.#lines = this.#lines.filter((line) => this.#products.has(line.productId) && this.#resolve(line));
    this.#commit();
  }

  /** Options validées d'une ligne, ou null si elles ne sont plus proposées. */
  #resolve(line) {
    try {
      return normalizeSelection(line.options ?? [], this.#options);
    } catch {
      return null;
    }
  }

  /** Lignes enrichies avec les infos produit et options, prêtes à afficher. */
  get lines() {
    const lines = [];
    for (const line of this.#lines) {
      const product = this.#products.get(line.productId);
      const options = this.#resolve(line);
      if (!product || !options) continue;
      const unitCents = product.priceCents + optionsTotalCents(options);
      lines.push({
        key: configKey(line.productId, options),
        productId: line.productId,
        qty: line.qty,
        product,
        options,
        unitCents,
        totalCents: unitCents * line.qty,
      });
    }
    return lines;
  }

  get count() {
    return this.#lines.reduce((sum, line) => sum + line.qty, 0);
  }

  get subtotalCents() {
    return this.lines.reduce((sum, line) => sum + line.totalCents, 0);
  }

  get isEmpty() {
    return this.#lines.length === 0;
  }

  /** Ajoute un bouquet avec ses options ([{ id }]). Lève une erreur si une option n'est pas proposée. */
  add(productId, options = [], qty = 1) {
    const clean = normalizeSelection(options, this.#options).map(({ id }) => ({ id }));
    const key = configKey(productId, clean);
    const line = this.#lines.find((l) => configKey(l.productId, this.#resolve(l) ?? []) === key);
    if (line) line.qty = Math.min(line.qty + qty, 99);
    else this.#lines.push({ productId, qty, options: clean });
    this.#commit();
  }

  setQty(key, qty) {
    const keyOf = (l) => configKey(l.productId, this.#resolve(l) ?? []);
    this.#lines = qty > 0
      ? this.#lines.map((l) => (keyOf(l) === key ? { ...l, qty: Math.min(qty, 99) } : l))
      : this.#lines.filter((l) => keyOf(l) !== key);
    this.#commit();
  }

  clear() {
    this.#lines = [];
    this.#commit();
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #commit() {
    local.set(STORAGE_KEY, this.#lines);
    this.#listeners.forEach((fn) => fn(this));
  }
}

export const cart = new Cart();
