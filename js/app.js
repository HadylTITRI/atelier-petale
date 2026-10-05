/**
 * Point d'entrée de l'application : navigation entre les pages
 * et affichage de l'espace admin selon la connexion.
 *
 *   #boutique   catalogue (tout le monde)
 *   #commandes  suivi des commandes (tout le monde)
 *   #admin      tableau de bord (admin connecté) — sinon formulaire de connexion
 */
import { CONFIG } from "./config.js";
import { $, $$, escapeHtml } from "./utils.js";

const ROUTES = ["boutique", "commandes", "admin"];
let isAdmin = false;
let shop;
let admin;

function route() {
  const requested = location.hash.slice(1);
  let view = ROUTES.includes(requested) ? requested : "boutique";
  if (view === "admin" && !isAdmin) view = "login";

  $$("[data-view]").forEach((section) => (section.hidden = section.dataset.view !== view));
  $$("[data-route]").forEach((link) => {
    if (link.dataset.route === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (view === "commandes") shop.showMyOrders();
  if (view === "login") $("#login-email").focus();
}

function setAdmin(user) {
  isAdmin = Boolean(user);
  $$("[data-admin-only]").forEach((el) => (el.hidden = !isAdmin));
  if (isAdmin) admin.startAdmin();
  else admin.stopAdmin();
}

function showFatalError(message) {
  $("main").innerHTML = `<div class="empty-state"><strong>Le site ne peut pas démarrer</strong>${escapeHtml(message)}</div>`;
}

async function start() {
  $$("[data-shop-name]").forEach((el) => (el.textContent = CONFIG.shopName));

  try {
    // Chargés ici pour pouvoir afficher un message clair si la base n'est pas configurée.
    [shop, admin] = await Promise.all([import("./shop.js"), import("./admin.js")]);
  } catch (error) {
    console.error(error);
    showFatalError(error.message);
    return;
  }
  const { store } = await import("./store/index.js");

  shop.initShop();
  admin.initAdmin({
    onLogin(user) {
      setAdmin(user);
      route();
    },
    onLogout() {
      setAdmin(null);
      location.hash = "#boutique";
    },
    onCatalogChange: shop.loadCatalog,
  });

  setAdmin(await store.auth.getUser());
  window.addEventListener("hashchange", route);
  route();
}

start();
