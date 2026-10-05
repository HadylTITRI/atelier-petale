/**
 * Partie client : catalogue, panier, livraison et suivi des commandes.
 */
import { CONFIG, STATUSES } from "./config.js";
import { store } from "./store/index.js";
import { cart } from "./cart.js";
import {
  $, $$, escapeHtml, formatPrice, formatDate, isoDay, local, toast,
  productVisual, categoryArt, categoryLabel, statusLabel,
} from "./utils.js";

const MY_ORDERS_KEY = "ap_my_orders";   // numéros des commandes passées sur cet appareil
const CUSTOMER_KEY = "ap_customer";     // coordonnées pré-remplies la prochaine fois
const REFRESH_MS = 20_000;

const state = {
  products: [],
  category: "all",
  status: "loading", // "loading" | "ready" | "error"
};

const emptyState = (title, text = "") =>
  `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>`;

/* ==========================================================================
   Catalogue
   ========================================================================== */

export async function loadCatalog() {
  try {
    state.products = await store.listProducts();
    state.status = "ready";
    cart.setCatalog(state.products);
  } catch (error) {
    console.error(error);
    state.status = "error";
  }
  renderCatalog();
}

function renderCatalog() {
  const categories = [["all", "Tout"], ...Object.entries(CONFIG.categories)];
  $("#category-filter").innerHTML = categories.map(([id, label]) => `
    <button type="button" class="chip" data-category="${id}" aria-pressed="${state.category === id}">${escapeHtml(label)}</button>
  `).join("");

  const grid = $("#product-grid");
  if (state.status === "loading") {
    grid.innerHTML = emptyState("Chargement du catalogue…");
    return;
  }
  if (state.status === "error") {
    grid.innerHTML = emptyState("Catalogue indisponible", "Vérifiez votre connexion puis rechargez la page.");
    return;
  }

  const visible = state.products.filter((p) => state.category === "all" || p.category === state.category);
  grid.innerHTML = visible.length
    ? visible.map(productCard).join("")
    : emptyState("Aucun article ici pour l'instant", "De nouvelles créations arrivent bientôt.");
}

function productCard(product) {
  return `
    <article class="product-card">
      <div class="visual">
        ${productVisual(product)}
        <span class="tag">${escapeHtml(categoryLabel(product.category))}</span>
      </div>
      <div class="body">
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description)}</p>
        <div class="footer">
          <span class="price num">${formatPrice(product.priceCents)}</span>
          <button class="btn btn-primary" type="button" data-action="add-to-cart" data-id="${escapeHtml(product.id)}">Ajouter</button>
        </div>
      </div>
    </article>`;
}

/* ==========================================================================
   Panier (fenêtre en 3 étapes : panier → livraison → confirmation)
   ========================================================================== */

const STEPS = { cart: "Votre panier", delivery: "Livraison", done: "Merci !" };
let currentStep = "cart";

function openCart() {
  showStep("cart");
  $("#cart-drawer").showModal();
}

function closeCart() {
  $("#cart-drawer").close();
}

function showStep(step) {
  currentStep = step;
  const index = Object.keys(STEPS).indexOf(step);
  $$("#cart-drawer [data-step]").forEach((el) => (el.hidden = el.dataset.step !== step));
  $$("#cart-drawer .progress span").forEach((bar, i) => bar.classList.toggle("done", i <= index));
  $("#drawer-title").textContent = STEPS[step];

  if (step === "cart") renderCart();
  if (step === "delivery") prepareCheckout();
}

function renderCart() {
  const linesEl = $("#cart-lines");
  const summaryEl = $("#cart-summary");

  if (cart.isEmpty) {
    linesEl.innerHTML = emptyState("Votre panier est vide", "Ajoutez un bouquet, des nails ou un cadeau depuis la boutique.");
    summaryEl.innerHTML = `<button class="btn btn-block" type="button" data-action="close-cart">Continuer mes achats</button>`;
    return;
  }

  linesEl.innerHTML = cart.lines.map(({ product, qty, totalCents }) => `
    <div class="cart-line">
      <div class="thumb">${productVisual(product, 44)}</div>
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <div class="qty">
          <button type="button" data-action="qty-minus" data-id="${escapeHtml(product.id)}" aria-label="Retirer un ${escapeHtml(product.name)}">−</button>
          <span class="num">${qty}</span>
          <button type="button" data-action="qty-plus" data-id="${escapeHtml(product.id)}" aria-label="Ajouter un ${escapeHtml(product.name)}">+</button>
        </div>
      </div>
      <strong class="num">${formatPrice(totalCents)}</strong>
    </div>
  `).join("");

  summaryEl.innerHTML = `
    <div class="sum-row"><span class="muted">Sous-total</span><span class="num">${formatPrice(cart.subtotalCents)}</span></div>
    <div class="sum-row"><span class="muted">Livraison</span><span class="num">${formatPrice(CONFIG.deliveryFeeCents)}</span></div>
    <div class="sum-row total"><span>Total</span><span class="num">${formatPrice(cart.subtotalCents + CONFIG.deliveryFeeCents)}</span></div>
    <button class="btn btn-primary btn-block" type="button" data-action="go-to-delivery">Passer à la livraison</button>`;
}

function changeQty(productId, delta) {
  const line = cart.lines.find((l) => l.productId === productId);
  if (line) cart.setQty(productId, line.qty + delta);
}

/* ==========================================================================
   Livraison
   ========================================================================== */

/** Champs du formulaire : id HTML → chemin dans la commande. */
const FIELDS = {
  "co-name": "customer.name",
  "co-phone": "customer.phone",
  "co-email": "customer.email",
  "co-recipient": "address.recipient",
  "co-street": "address.street",
  "co-zip": "address.zip",
  "co-city": "address.city",
  "co-details": "address.details",
  "co-date": "delivery.date",
  "co-slot": "delivery.slot",
  "co-card": "cardMessage",
  "co-notes": "notes",
};
const REMEMBERED_FIELDS = ["co-name", "co-phone", "co-email", "co-street", "co-zip", "co-city", "co-details"];

function prepareCheckout() {
  const slotSelect = $("#co-slot");
  if (!slotSelect.options.length) {
    slotSelect.innerHTML = CONFIG.deliverySlots.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  }

  const dateInput = $("#co-date");
  dateInput.min = isoDay(0);
  if (!dateInput.value || dateInput.value < dateInput.min) dateInput.value = isoDay(1);

  // Pré-remplit avec les coordonnées de la dernière commande.
  const saved = local.get(CUSTOMER_KEY, {});
  for (const id of REMEMBERED_FIELDS) {
    const input = $(`#${id}`);
    if (!input.value && saved[id]) input.value = saved[id];
  }

  $("#checkout-total").textContent = formatPrice(cart.subtotalCents + CONFIG.deliveryFeeCents);
  showCheckoutErrors([]);
}

function readCheckout() {
  const order = { items: cart.lines.map(({ productId, qty }) => ({ productId, qty })), customer: {}, address: {}, delivery: {} };
  for (const [id, path] of Object.entries(FIELDS)) {
    const [group, key] = path.split(".");
    const value = $(`#${id}`).value.trim();
    if (key) order[group][key] = value;
    else order[group] = value;
  }

  const errors = [];
  const { customer, address, delivery } = order;
  if (!customer.name) errors.push(["co-name", "votre nom"]);
  if (customer.phone.replace(/\D/g, "").length < 9) errors.push(["co-phone", "un numéro de téléphone valide"]);
  if (customer.email && !/^\S+@\S+\.\S+$/.test(customer.email)) errors.push(["co-email", "un e-mail valide"]);
  if (!address.street) errors.push(["co-street", "l'adresse"]);
  if (!/^\d{5}$/.test(address.zip)) errors.push(["co-zip", "un code postal à 5 chiffres"]);
  if (!address.city) errors.push(["co-city", "la ville"]);
  if (!delivery.date || delivery.date < isoDay(0)) errors.push(["co-date", "une date de livraison à venir"]);

  return { order, errors };
}

function showCheckoutErrors(errors) {
  const invalid = new Set(errors.map(([id]) => id));
  Object.keys(FIELDS).forEach((id) => $(`#${id}`).setAttribute("aria-invalid", invalid.has(id)));

  const box = $("#checkout-error");
  box.hidden = errors.length === 0;
  box.textContent = errors.length ? `Il manque ${errors.map(([, label]) => label).join(", ")}.` : "";
  if (errors.length) $(`#${errors[0][0]}`).focus();
}

async function submitCheckout(event) {
  event.preventDefault();
  const { order, errors } = readCheckout();
  showCheckoutErrors(errors);
  if (errors.length) return;

  const button = $("#checkout-submit");
  button.disabled = true;
  button.textContent = "Envoi…";
  try {
    const { code } = await store.placeOrder(order);
    local.set(CUSTOMER_KEY, Object.fromEntries(REMEMBERED_FIELDS.map((id) => [id, $(`#${id}`).value.trim()])));
    rememberOrder(code);
    cart.clear();
    $("#checkout-form").reset();
    $("#done-code").textContent = code;
    showStep("done");
  } catch (error) {
    showCheckoutErrors([]);
    const box = $("#checkout-error");
    box.textContent = error.message;
    box.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Valider la commande";
  }
}

/* ==========================================================================
   Mes commandes (suivi client)
   ========================================================================== */

const myOrderCodes = () => local.get(MY_ORDERS_KEY, []);

function rememberOrder(code) {
  local.set(MY_ORDERS_KEY, [code, ...myOrderCodes().filter((c) => c !== code)].slice(0, 30));
}

export async function showMyOrders() {
  const list = $("#my-orders");
  const codes = myOrderCodes();
  if (!codes.length) {
    list.innerHTML = emptyState("Pas encore de commande", "Vos commandes validées apparaîtront ici avec leur statut.");
    return;
  }
  try {
    const orders = await store.getOrdersByCodes(codes);
    orders.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
    list.innerHTML = orders.length
      ? orders.map(orderCard).join("")
      : emptyState("Commandes introuvables", "Vérifiez votre numéro de commande.");
  } catch (error) {
    list.innerHTML = emptyState("Suivi indisponible", error.message);
  }
}

function orderCard(order) {
  const items = order.items.map((i) => `${i.qty} × ${escapeHtml(i.name)}`).join(" · ");
  return `
    <article class="order-card">
      <header>
        <h3 class="num">${escapeHtml(order.code)}</h3>
        <span class="status st-${order.status}">${statusLabel(order.status)}</span>
      </header>
      <div class="muted">Livraison ${escapeHtml(formatDate(order.delivery.date))} · ${escapeHtml(order.delivery.slot)}</div>
      <div>${items}</div>
      <div class="sum-row"><span class="muted">Total</span><strong class="num">${formatPrice(order.totalCents)}</strong></div>
      ${tracker(order.status)}
    </article>`;
}

function tracker(status) {
  if (status === "annulee") {
    return `<p class="muted" style="margin:0">Cette commande a été annulée. Contactez l'atelier pour plus d'informations.</p>`;
  }
  const steps = STATUSES.filter((s) => s.id !== "annulee");
  const reached = steps.findIndex((s) => s.id === status);
  return `<div class="tracker">${steps.map((s, i) => `<div class="${i <= reached ? "done" : ""}">${s.label}</div>`).join("")}</div>`;
}

async function lookupOrder(event) {
  event.preventDefault();
  const input = $("#lookup-code");
  const code = input.value.trim().toUpperCase();
  if (!code) return;
  const [order] = await store.getOrdersByCodes([code]).catch(() => []);
  if (!order) {
    toast("Aucune commande avec ce numéro.");
    return;
  }
  rememberOrder(order.code);
  input.value = "";
  showMyOrders();
}

/* ==========================================================================
   Initialisation
   ========================================================================== */

export function initShop() {
  const updateBadge = () => ($("#cart-count").textContent = cart.count);
  cart.onChange(() => {
    updateBadge();
    if ($("#cart-drawer").open && currentStep === "cart") renderCart();
  });
  updateBadge();

  document.addEventListener("click", (event) => {
    const category = event.target.closest("[data-category]");
    if (category && category.closest("#category-filter")) {
      state.category = category.dataset.category;
      renderCatalog();
      return;
    }

    const target = event.target.closest("[data-action]");
    if (!target) return;
    const { id } = target.dataset;
    switch (target.dataset.action) {
      case "add-to-cart": {
        cart.add(id);
        const product = state.products.find((p) => p.id === id);
        toast(`${product?.name ?? "Article"} ajouté au panier`);
        break;
      }
      case "open-cart": openCart(); break;
      case "close-cart": closeCart(); break;
      case "qty-plus": changeQty(id, +1); break;
      case "qty-minus": changeQty(id, -1); break;
      case "go-to-delivery": showStep("delivery"); break;
      case "back-to-cart": showStep("cart"); break;
      case "refresh-orders": showMyOrders(); break;
    }
  });

  // Clic sur le fond grisé : ferme le panier.
  $("#cart-drawer").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCart();
  });

  $("#checkout-form").addEventListener("submit", submitCheckout);
  // Dès qu'un champ en erreur est corrigé, on retire son contour rouge.
  $("#checkout-form").addEventListener("input", (event) => event.target.setAttribute("aria-invalid", "false"));
  $("#lookup-form").addEventListener("submit", lookupOrder);
  $("#done-art").innerHTML = categoryArt("bouquets", 120);

  // Le statut peut changer côté atelier : on rafraîchit le suivi s'il est affiché.
  setInterval(() => {
    if (!$("#view-commandes").hidden) showMyOrders();
  }, REFRESH_MS);

  renderCatalog();
  loadCatalog();
}
