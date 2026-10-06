/**
 * Partie client : catalogue, panier, livraison et suivi des commandes.
 */
import { CONFIG, STATUSES } from "./config.js";
import { store } from "./store/index.js";
import { cart } from "./cart.js";
import { normalizeSelection, describeOption, optionsTotalCents, optionsForProduct } from "./options.js";
import {
  $, $$, escapeHtml, formatPrice, formatDate, isoDay, local, toast,
  productVisual, categoryArt, statusLabel,
} from "./utils.js";

const MY_ORDERS_KEY = "ap_my_orders";   // numéros des commandes passées sur cet appareil
const CUSTOMER_KEY = "ap_customer";     // coordonnées pré-remplies la prochaine fois
const REFRESH_MS = 20_000;

const state = {
  products: [],
  options: [],       // options actives, chargées depuis le serveur
  status: "loading", // "loading" | "ready" | "error"
};

const emptyState = (title, text = "") =>
  `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>`;

/* ==========================================================================
   Catalogue
   ========================================================================== */

export async function loadCatalog() {
  const [products, options] = await Promise.allSettled([store.listProducts(), store.listOptions()]);
  if (products.status === "fulfilled") {
    state.products = products.value;
    // Sans les options, la boutique reste utilisable : les bouquets se commandent sans option.
    if (options.status === "rejected") console.error(options.reason);
    state.options = options.status === "fulfilled" ? options.value : [];
    state.status = "ready";
    cart.setCatalog(state.products, state.options);
  } else {
    console.error(products.reason);
    state.status = "error";
  }
  renderCatalog();
}

function renderCatalog() {
  const grid = $("#product-grid");
  if (state.status === "loading") {
    grid.innerHTML = emptyState("Chargement du catalogue…");
    return;
  }
  if (state.status === "error") {
    grid.innerHTML = emptyState("Catalogue indisponible", "Vérifiez votre connexion puis rechargez la page.");
    return;
  }

  grid.innerHTML = state.products.length
    ? state.products.map(productCard).join("")
    : emptyState("Aucun bouquet pour l'instant", "De nouvelles créations arrivent bientôt.");
}

function productCard(product) {
  return `
    <article class="product-card">
      <div class="visual">
        ${productVisual(product)}
      </div>
      <div class="body">
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.description)}</p>
        <div class="footer">
          <span class="price num">${formatPrice(product.priceCents)}</span>
          <button class="btn btn-primary" type="button" data-action="customize" data-id="${escapeHtml(product.id)}">Personnaliser</button>
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
    linesEl.innerHTML = emptyState("Votre panier est vide", "Choisissez un bouquet dans la boutique et personnalisez-le.");
    summaryEl.innerHTML = `<button class="btn btn-block" type="button" data-action="close-cart">Continuer mes achats</button>`;
    return;
  }

  linesEl.innerHTML = cart.lines.map(({ key, product, qty, options, totalCents }) => `
    <div class="cart-line">
      <div class="thumb">${productVisual(product, 44)}</div>
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        ${options.length ? `<ul class="line-options">${options.map((o) => `
          <li>${escapeHtml(describeOption(o))} <span class="num">(+${formatPrice(o.priceCents)})</span></li>`).join("")}
        </ul>` : ""}
        <div class="qty">
          <button type="button" data-action="qty-minus" data-key="${escapeHtml(key)}" aria-label="Retirer un ${escapeHtml(product.name)}">−</button>
          <span class="num">${qty}</span>
          <button type="button" data-action="qty-plus" data-key="${escapeHtml(key)}" aria-label="Ajouter un ${escapeHtml(product.name)}">+</button>
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

function changeQty(key, delta) {
  const line = cart.lines.find((l) => l.key === key);
  if (line) cart.setQty(key, line.qty + delta);
}

/* ==========================================================================
   Personnalisation d'un bouquet (fenêtre : options → ajout au panier)
   ========================================================================== */

let customizing = null;   // bouquet en cours de personnalisation
let customOptions = [];  // options proposées pour ce bouquet

const optionPrice = (option) => {
  if (!option.priceCents) return "Offert";
  return option.type === "quantity" ? `+${formatPrice(option.priceCents)} / unité` : `+${formatPrice(option.priceCents)}`;
};

/** Une option : nom et prix, puis le champ adapté à son type. */
function optionField(option) {
  const id = escapeHtml(`opt-${option.id}`);
  const data = `data-option-id="${escapeHtml(option.id)}"`;
  const name = escapeHtml(option.name);
  let control = "";
  let hint = "";

  if (option.type === "text") {
    control = `<input id="${id}" ${data} maxlength="${option.maxValue}" autocomplete="off" placeholder="À écrire (facultatif)">`;
    hint = `${option.maxValue} caractères maximum. Laissez vide si vous n'en voulez pas.`;
  } else if (option.type === "choice") {
    control = `<select id="${id}" ${data}><option value="">Sans</option>${
      option.choices.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select>`;
  } else if (option.type === "quantity") {
    control = `<input id="${id}" ${data} type="number" inputmode="numeric" min="0" max="${option.maxValue}" step="1" value="0" class="num">`;
    hint = `De 0 à ${option.maxValue}.`;
  }

  if (!control) {
    // Case à cocher : le libellé et la case sur la même ligne.
    return `
      <div class="option">
        <div class="option-head">
          <label class="checkbox" for="${id}"><input type="checkbox" id="${id}" ${data}> ${name}</label>
          <span class="price-tag num">${optionPrice(option)}</span>
        </div>
      </div>`;
  }
  return `
    <div class="option">
      <div class="option-head"><label for="${id}">${name}</label><span class="price-tag num">${optionPrice(option)}</span></div>
      ${control}
      ${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ""}
    </div>`;
}

/** Lit les options remplies dans la fenêtre : [{ id, value }]. */
function readSelection() {
  return $$("#custom-options [data-option-id]").map((input) => {
    const { optionId: id } = input.dataset;
    if (input.type === "checkbox") return { id, value: input.checked };
    if (input.type === "number") return { id, value: input.value === "" ? 0 : Number(input.value) };
    return { id, value: input.value };
  });
}

/** Met à jour le prix affiché ; renvoie la sélection validée, ou null si une option est invalide. */
function refreshCustomTotal() {
  const error = $("#custom-error");
  let options;
  try {
    options = normalizeSelection(readSelection(), customOptions);
    error.hidden = true;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    return null;
  }
  const extras = optionsTotalCents(options);
  $("#custom-total").textContent = formatPrice(customizing.priceCents + extras);
  $("#custom-breakdown").textContent = extras
    ? `Bouquet ${formatPrice(customizing.priceCents)} + options ${formatPrice(extras)}`
    : "";
  return options;
}

function openCustomize(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  customizing = product;
  $("#custom-title").textContent = product.name;
  $("#custom-desc").textContent = product.description;
  $("#custom-visual").innerHTML = productVisual(product, 56);
  customOptions = optionsForProduct(product, state.options);
  const fieldset = $("#custom-options");
  fieldset.hidden = customOptions.length === 0;
  fieldset.innerHTML = `<legend>Personnalisez votre bouquet</legend>${customOptions.map(optionField).join("")}`;
  refreshCustomTotal();
  $("#custom-dialog").showModal();
}

function closeCustomize() {
  $("#custom-dialog").close();
  customizing = null;
}

function submitCustomize(event) {
  event.preventDefault();
  const options = refreshCustomTotal();
  if (!options || !customizing) return;
  try {
    cart.add(customizing.id, options.map(({ id, value }) => ({ id, value })));
  } catch (error) {
    $("#custom-error").textContent = error.message;
    $("#custom-error").hidden = false;
    return;
  }
  toast(`${customizing.name} ajouté au panier`);
  closeCustomize();
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
  const order = {
    items: cart.lines.map(({ productId, qty, options }) => ({
      productId, qty, options: options.map(({ id, value }) => ({ id, value })),
    })),
    customer: {}, address: {}, delivery: {},
  };
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
  const items = order.items.map((i) => `
    <div>${i.qty} × ${escapeHtml(i.name)}${(i.options ?? []).length
      ? `<div class="muted" style="font-size:13px">${i.options.map((o) => escapeHtml(describeOption(o))).join(" · ")}</div>` : ""}</div>`).join("");
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
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const { id, key } = target.dataset;
    switch (target.dataset.action) {
      case "customize": openCustomize(id); break;
      case "close-custom": closeCustomize(); break;
      case "open-cart": openCart(); break;
      case "close-cart": closeCart(); break;
      case "qty-plus": changeQty(key, +1); break;
      case "qty-minus": changeQty(key, -1); break;
      case "go-to-delivery": showStep("delivery"); break;
      case "back-to-cart": showStep("cart"); break;
      case "refresh-orders": showMyOrders(); break;
    }
  });

  // Clic sur le fond grisé : ferme le panier.
  $("#cart-drawer").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCart();
  });

  // Fenêtre de personnalisation : prix en direct, fond grisé pour fermer.
  const custom = $("#custom-dialog");
  $("#custom-form").addEventListener("submit", submitCustomize);
  $("#custom-form").addEventListener("input", refreshCustomTotal);
  custom.addEventListener("click", (event) => {
    if (event.target === custom) closeCustomize();
  });
  custom.addEventListener("close", () => (customizing = null));

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
