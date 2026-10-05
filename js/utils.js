/**
 * Petites fonctions partagées par la boutique et l'administration.
 */
import { CONFIG, STATUSES } from "./config.js";

/* ---------- DOM ---------- */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Échappe un texte avant de l'insérer dans du HTML (protège contre l'injection). */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* ---------- Formats ---------- */

const priceFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export const formatPrice = (cents) => priceFormatter.format((cents || 0) / 100);

/** "39,90" ou "39.90" → 3990. Renvoie NaN si la saisie est invalide. */
export function parsePrice(text) {
  const value = Number(String(text).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

export function formatDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Date locale au format AAAA-MM-JJ, décalée de `days` jours. */
export function isoDay(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

export const statusLabel = (id) => (STATUSES.find((s) => s.id === id) ?? STATUSES[0]).label;
export const categoryLabel = (id) => CONFIG.categories[id] ?? "Autre";

/* ---------- Identifiants ---------- */

export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Code lisible au téléphone, ex. "AP-K7M2QX" (sans 0/O ni 1/I). */
export function makeOrderCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `AP-${code}`;
}

/* ---------- Stockage navigateur (sans planter si indisponible) ---------- */

export const local = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage plein ou bloqué : on ignore */
    }
  },
};

/* ---------- Notifications ---------- */

let toastTimer;
export function toast(message) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------- Visuels produits ---------- */

const ART = {
  bouquets: `<path d="M50 52V92" stroke="var(--stem)" stroke-width="4"/><path d="M50 74c-10-2-16-10-16-16 8 0 14 6 16 16zm0-6c8-4 14-12 14-18-8 2-12 8-14 18z" fill="var(--stem)"/><g fill="var(--petal)"><circle cx="50" cy="22" r="12"/><circle cx="36" cy="34" r="12"/><circle cx="64" cy="34" r="12"/><circle cx="42" cy="48" r="12"/><circle cx="58" cy="48" r="12"/></g><circle cx="50" cy="36" r="8" fill="var(--surface)" opacity=".7"/>`,
  nails: `<rect x="38" y="14" width="24" height="26" rx="4" fill="var(--ink)" opacity=".85"/><rect x="28" y="38" width="44" height="50" rx="12" fill="var(--petal)"/><rect x="36" y="50" width="10" height="26" rx="5" fill="var(--surface)" opacity=".45"/>`,
  autres: `<rect x="20" y="40" width="60" height="44" rx="6" fill="var(--petal)"/><rect x="16" y="30" width="68" height="14" rx="4" fill="var(--petal)" opacity=".8"/><rect x="46" y="30" width="8" height="54" fill="var(--stem)"/><path d="M50 30c-6-14-22-14-18-4 3 6 18 4 18 4zm0 0c6-14 22-14 18-4-3 6-18 4-18 4z" fill="var(--stem)"/>`,
};

/** Illustration SVG utilisée quand un produit n'a pas de photo. */
export function categoryArt(category, size = 110) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${ART[category] ?? ART.autres}</svg>`;
}

/** Photo du produit, ou illustration de sa catégorie. */
export function productVisual(product, size = 110) {
  if (!product.imageUrl) return categoryArt(product.category, size);
  return `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" data-category="${escapeHtml(product.category)}" data-size="${size}">`;
}

// Si une photo ne se charge pas, on la remplace par l'illustration.
document.addEventListener("error", (event) => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.dataset.category) {
    img.outerHTML = categoryArt(img.dataset.category, Number(img.dataset.size) || 110);
  }
}, true);
