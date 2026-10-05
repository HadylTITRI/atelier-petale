/**
 * Panier du client, gardé dans le navigateur.
 * On n'y stocke que l'identifiant et la quantité : nom et prix viennent toujours du catalogue.
 */
import { local } from "./utils.js";

const STORAGE_KEY = "ap_cart";

class Cart {
  #lines = local.get(STORAGE_KEY, []);   // [{ productId, qty }]
  #products = new Map();                 // productId → produit du catalogue
  #listeners = new Set();

  /** Met à jour le catalogue connu et retire les articles qui ne sont plus en vente. */
  setCatalog(products) {
    this.#products = new Map(products.map((p) => [p.id, p]));
    this.#lines = this.#lines.filter((line) => this.#products.has(line.productId));
    this.#commit();
  }

  /** Lignes enrichies avec les infos produit, prêtes à afficher. */
  get lines() {
    return this.#lines.filter((line) => this.#products.has(line.productId)).map((line) => {
      const product = this.#products.get(line.productId);
      return { ...line, product, totalCents: product.priceCents * line.qty };
    });
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

  add(productId) {
    const line = this.#lines.find((l) => l.productId === productId);
    if (line) line.qty += 1;
    else this.#lines.push({ productId, qty: 1 });
    this.#commit();
  }

  setQty(productId, qty) {
    this.#lines = qty > 0
      ? this.#lines.map((l) => (l.productId === productId ? { ...l, qty: Math.min(qty, 99) } : l))
      : this.#lines.filter((l) => l.productId !== productId);
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
