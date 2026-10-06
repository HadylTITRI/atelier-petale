/**
 * Partie administration : connexion, commandes, produits et options.
 * Visible uniquement après connexion avec un compte administrateur.
 */
import { CONFIG, STATUSES, ACTIVE_STATUSES } from "./config.js";
import { store } from "./store/index.js";
import { DEFAULT_MAX, OPTION_TYPES, describeOption, lineUnitCents, sortOptions } from "./options.js";
import {
  $, $$, escapeHtml, formatPrice, formatDate, formatDateTime, isoDay, parsePrice, toast,
  productVisual, categoryLabel, statusLabel,
} from "./utils.js";

const state = {
  orders: [],
  products: [],
  options: [],
  filter: "active",      // "active" | "all" | un statut
  selectedId: null,      // commande affichée dans le détail
  confirmDeleteId: null, // produit en attente de confirmation de suppression
  confirmDeleteOptionId: null, // option en attente de confirmation de suppression
  unsubscribe: null,
};

/** Fonctions fournies par app.js. */
let hooks = { onLogin() {}, onLogout() {}, onCatalogChange() {} };

const emptyState = (title, text = "") =>
  `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>`;

/* ==========================================================================
   Connexion
   ========================================================================== */

async function submitLogin(event) {
  event.preventDefault();
  const errorEl = $("#login-error");
  const button = event.submitter;
  errorEl.hidden = true;
  button.disabled = true;
  try {
    const user = await store.auth.signIn($("#login-email").value, $("#login-password").value);
    $("#login-form").reset();
    hooks.onLogin(user);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await store.auth.signOut();
  hooks.onLogout();
}

/* ==========================================================================
   Démarrage / arrêt (appelés par app.js selon la connexion)
   ========================================================================== */

export async function startAdmin() {
  state.unsubscribe?.();
  state.unsubscribe = store.subscribeToOrders(onOrdersChanged);
  await Promise.all([loadOrders(), loadProducts(), loadOptions()]);
}

export function stopAdmin() {
  state.unsubscribe?.();
  Object.assign(state, { orders: [], products: [], options: [], selectedId: null, unsubscribe: null });
}

/* ==========================================================================
   Commandes
   ========================================================================== */

const statusOf = (order) => order.status || "nouvelle";

async function loadOrders() {
  try {
    state.orders = await store.listOrders();
  } catch (error) {
    toast(error.message);
  }
  renderOrders();
}

async function onOrdersChanged() {
  const known = new Set(state.orders.map((o) => o.id));
  await loadOrders();
  if (state.orders.some((o) => !known.has(o.id))) toast("Nouvelle commande reçue");
}

function filteredOrders() {
  return state.orders.filter((order) => {
    if (state.filter === "all") return true;
    if (state.filter === "active") return ACTIVE_STATUSES.includes(statusOf(order));
    return statusOf(order) === state.filter;
  });
}

function renderOrders() {
  renderKpis();
  renderStatusFilter();

  const visible = filteredOrders();
  if (!visible.some((o) => o.id === state.selectedId)) state.selectedId = visible[0]?.id ?? null;

  $("#order-table").innerHTML = visible.length
    ? visible.map(orderRow).join("")
    : state.orders.length
      ? emptyState("Rien dans ce filtre", "Changez de filtre pour voir les autres commandes.")
      : emptyState("Aucune commande pour l'instant", "Dès qu'un client valide son panier, la commande arrive ici en direct.");

  renderOrderDetail(state.orders.find((o) => o.id === state.selectedId));
}

function renderKpis() {
  const count = (status) => state.orders.filter((o) => statusOf(o) === status).length;
  const today = isoDay(0);
  const toDeliverToday = state.orders.filter((o) => o.delivery.date === today && ACTIVE_STATUSES.includes(statusOf(o))).length;
  const revenue = state.orders.filter((o) => statusOf(o) !== "annulee").reduce((sum, o) => sum + o.totalCents, 0);
  const newCount = count("nouvelle");

  $("#kpis").innerHTML = `
    <div class="kpi ${newCount ? "alert" : ""}"><span class="eyebrow">Nouvelles</span><b class="num">${newCount}</b></div>
    <div class="kpi"><span class="eyebrow">En préparation</span><b class="num">${count("preparation")}</b></div>
    <div class="kpi"><span class="eyebrow">À livrer aujourd'hui</span><b class="num">${toDeliverToday}</b></div>
    <div class="kpi"><span class="eyebrow">Chiffre d'affaires</span><b class="num">${formatPrice(revenue)}</b></div>`;
}

function renderStatusFilter() {
  const filters = [["active", "À traiter"], ...STATUSES.map((s) => [s.id, s.label]), ["all", "Toutes"]];
  $("#status-filter").innerHTML = filters.map(([id, label]) => `
    <button type="button" class="chip" data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>
  `).join("");
}

function orderRow(order) {
  const status = statusOf(order);
  const articles = order.items.reduce((n, i) => n + i.qty, 0);
  return `
    <button type="button" class="order-row st-${status}" data-order-id="${escapeHtml(order.id)}" aria-current="${order.id === state.selectedId}">
      <span class="stripe"></span>
      <span class="who">${escapeHtml(order.customer.name)} <span class="muted num">· ${escapeHtml(order.code)}</span></span>
      <span class="amount num">${formatPrice(order.totalCents)}</span>
      <span class="meta">${escapeHtml(formatDate(order.delivery.date))} · ${escapeHtml(order.delivery.slot.split(" (")[0])} · ${articles} article${articles > 1 ? "s" : ""}</span>
      <span class="status st-${status}">${statusLabel(status)}</span>
    </button>`;
}

function renderOrderDetail(order) {
  const panel = $("#order-detail");
  if (!order) {
    panel.innerHTML = `<p class="muted" style="margin:0">Sélectionnez une commande pour voir le détail.</p>`;
    return;
  }

  const status = statusOf(order);
  const { customer, address } = order;
  const fullAddress = `${address.street}, ${address.zip} ${address.city}`;
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : "");
  const copyButton = (text) => `<button type="button" class="copy-btn" data-copy="${escapeHtml(text)}">Copier</button>`;

  panel.innerHTML = `
    <div>
      <div class="sum-row" style="align-items:center">
        <h3 class="num">${escapeHtml(order.code)}</h3>
        <span class="status st-${status}">${statusLabel(status)}</span>
      </div>
      <span class="muted" style="font-size:13px">Reçue le ${escapeHtml(formatDateTime(order.createdAt))}</span>
    </div>

    <div>
      <span class="eyebrow">Changer le statut</span>
      <div class="status-buttons">
        ${STATUSES.map((s) => `
          <button type="button" class="st-${s.id}" data-set-status="${s.id}" aria-pressed="${status === s.id}"><span>${s.label}</span></button>
        `).join("")}
      </div>
    </div>

    <div>
      <span class="eyebrow">Articles</span>
      ${order.items.map((i) => `
        <div class="order-item">
          <div class="sum-row"><span>${i.qty} × ${escapeHtml(i.name)}</span><span class="num">${formatPrice(lineUnitCents(i) * i.qty)}</span></div>
          ${(i.options ?? []).length ? `<ul class="line-options">${i.options.map((o) => `
            <li><strong>${escapeHtml(describeOption(o))}</strong> <span class="num">(+${formatPrice(o.priceCents)} / bouquet)</span></li>`).join("")}</ul>` : ""}
        </div>
      `).join("")}
      <div class="sum-row muted" style="margin-top:6px"><span>Livraison</span><span class="num">${formatPrice(order.deliveryCents)}</span></div>
      <div class="sum-row total" style="margin-top:6px"><span>Total</span><span class="num">${formatPrice(order.totalCents)}</span></div>
    </div>

    <dl class="details">
      ${row("Client", escapeHtml(customer.name))}
      ${row("Téléphone", `<span class="num">${escapeHtml(customer.phone)}</span>${copyButton(customer.phone)}`)}
      ${row("E-mail", escapeHtml(customer.email))}
      ${row("Destinataire", escapeHtml(address.recipient))}
      ${row("Adresse", `${escapeHtml(address.street)}<br>${escapeHtml(address.zip)} ${escapeHtml(address.city)}${address.details ? `<br><span class="muted">${escapeHtml(address.details)}</span>` : ""}${copyButton(fullAddress)}`)}
      ${row("Livraison", `${escapeHtml(formatDate(order.delivery.date))} · ${escapeHtml(order.delivery.slot)}`)}
      ${row("Précisions", escapeHtml(order.notes))}
    </dl>

    ${order.cardMessage ? `<div><span class="eyebrow">Message de la carte</span><div class="card-message">${escapeHtml(order.cardMessage)}</div></div>` : ""}`;
}

async function setStatus(orderId, status) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.status === status) return;

  const previous = order.status;
  order.status = status; // mise à jour immédiate à l'écran
  renderOrders();
  try {
    await store.updateOrderStatus(orderId, status);
    toast(`${order.code} : ${statusLabel(status)}`);
  } catch (error) {
    order.status = previous;
    renderOrders();
    toast(error.message);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copié");
  } catch {
    toast(text);
  }
}

/* ==========================================================================
   Produits
   ========================================================================== */

async function loadProducts() {
  try {
    state.products = await store.listProducts({ includeHidden: true });
  } catch (error) {
    toast(error.message);
  }
  renderProducts();
  renderOptions(); // nombre de bouquets par option
}

function renderProducts() {
  const list = $("#product-list");
  if (!state.products.length) {
    list.innerHTML = emptyState("Catalogue vide", "Ajoutez votre premier produit avec le formulaire.");
    return;
  }
  list.innerHTML = state.products.map((p) => `
    <div class="product-row ${p.active ? "" : "hidden-product"}">
      <div class="thumb">${productVisual(p, 40)}</div>
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="muted num" style="font-size:13px">${escapeHtml(categoryLabel(p.category))} · ${formatPrice(p.priceCents)} · ${optionCount(p)}${p.active ? "" : " · masqué"}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-edit-product="${escapeHtml(p.id)}">Modifier</button>
        <button type="button" class="btn btn-danger" data-delete-product="${escapeHtml(p.id)}">
          ${state.confirmDeleteId === p.id ? "Confirmer" : "Supprimer"}
        </button>
      </div>
    </div>
  `).join("");
}

const optionCount = (product) => {
  const n = product.optionIds?.length ?? 0;
  return n ? `${n} option${n > 1 ? "s" : ""}` : "sans option";
};

/** Cases à cocher des options dans le formulaire produit, cochées selon `selected`. */
function renderProductOptions(selected = []) {
  const list = $("#pf-option-list");
  const chosen = new Set(selected);
  list.innerHTML = state.options.length
    ? sortOptions(state.options).map((o) => `
        <label class="checkbox">
          <input type="checkbox" value="${escapeHtml(o.id)}" ${chosen.has(o.id) ? "checked" : ""}>
          ${escapeHtml(o.name)} <span class="muted">· ${escapeHtml(OPTION_TYPES[o.type] ?? "")}${o.active ? "" : " · désactivée"}</span>
        </label>`).join("")
    : `<span class="hint">Aucune option : créez-en dans l'onglet Options.</span>`;
}

const checkedProductOptions = () => $$("#pf-option-list input:checked").map((input) => input.value);

function fillProductForm(product) {
  $("#pf-id").value = product?.id ?? "";
  $("#pf-name").value = product?.name ?? "";
  $("#pf-category").value = product?.category ?? Object.keys(CONFIG.categories)[0];
  $("#pf-price").value = product ? (product.priceCents / 100).toFixed(2).replace(".", ",") : "";
  $("#pf-description").value = product?.description ?? "";
  $("#pf-image").value = product?.imageUrl ?? "";
  $("#pf-active").checked = product?.active ?? true;
  renderProductOptions(product?.optionIds ?? []);

  $("#product-form-title").textContent = product ? "Modifier le produit" : "Ajouter un produit";
  $("#pf-submit").textContent = product ? "Enregistrer" : "Ajouter le produit";
  $("#pf-cancel").hidden = !product;
  $("#product-error").hidden = true;
  if (product) $("#pf-name").focus();
}

async function submitProduct(event) {
  event.preventDefault();
  const errorEl = $("#product-error");
  const product = {
    id: $("#pf-id").value || undefined,
    name: $("#pf-name").value.trim(),
    category: $("#pf-category").value,
    priceCents: parsePrice($("#pf-price").value),
    description: $("#pf-description").value.trim(),
    imageUrl: $("#pf-image").value.trim(),
    active: $("#pf-active").checked,
    optionIds: checkedProductOptions(),
  };

  if (!product.name || !(product.priceCents > 0)) {
    errorEl.textContent = "Indiquez un nom et un prix supérieur à 0 (ex. 4500).";
    errorEl.hidden = false;
    return;
  }

  try {
    await store.saveProduct(product);
    toast(product.id ? "Produit enregistré" : "Produit ajouté");
    fillProductForm(null);
    await loadProducts();
    hooks.onCatalogChange();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  }
}

async function deleteProduct(id) {
  // Premier clic : demande confirmation. Second clic (dans les 4 s) : supprime.
  if (state.confirmDeleteId !== id) {
    state.confirmDeleteId = id;
    renderProducts();
    setTimeout(() => {
      if (state.confirmDeleteId === id) {
        state.confirmDeleteId = null;
        renderProducts();
      }
    }, 4000);
    return;
  }

  state.confirmDeleteId = null;
  try {
    await store.deleteProduct(id);
    toast("Produit supprimé");
    if ($("#pf-id").value === id) fillProductForm(null);
    await loadProducts();
    hooks.onCatalogChange();
  } catch (error) {
    toast(error.message);
  }
}

/* ==========================================================================
   Options (chaque bouquet choisit les siennes dans le formulaire produit)
   ========================================================================== */

/** 40000 centimes → « 400 » ; 40050 → « 400,5 » (pour le champ du formulaire). */
const priceInput = (cents) => String(cents / 100).replace(".", ",");

async function loadOptions() {
  try {
    state.options = await store.listOptions({ includeHidden: true });
  } catch (error) {
    toast(error.message);
  }
  renderOptions();
  // Le formulaire produit affiche la liste des options : on la garde à jour, sans perdre les cases cochées.
  const alreadyShown = $$("#pf-option-list input").length > 0;
  renderProductOptions(alreadyShown ? checkedProductOptions() : currentProductOptionIds());
}

const currentProductOptionIds = () => state.products.find((p) => p.id === $("#pf-id").value)?.optionIds ?? [];

/** Combien de bouquets proposent une option. */
const productsUsing = (option) => state.products.filter((p) => p.optionIds?.includes(option.id)).length;

/** Détail affiché sous le nom d'une option : type, prix, réglages. */
function optionSummary(o) {
  const price = o.priceCents ? `+${formatPrice(o.priceCents)}${o.type === "quantity" ? " / unité" : ""}` : "Offerte";
  const detail = o.type === "choice" ? ` (${o.choices.join(", ")})`
    : o.type === "text" ? ` (${o.maxValue} car. max)`
    : o.type === "quantity" ? ` (jusqu'à ${o.maxValue})` : "";
  const used = productsUsing(o);
  return `${OPTION_TYPES[o.type] ?? ""}${detail} · ${price} · ${used ? `${used} bouquet${used > 1 ? "s" : ""}` : "aucun bouquet"}`;
}

function renderOptions() {
  const list = $("#option-list");
  if (!state.options.length) {
    list.innerHTML = emptyState("Aucune option", "Ajoutez une option (emballage cadeau, ruban…) avec le formulaire : elle sera proposée pour tous les bouquets.");
    return;
  }
  list.innerHTML = state.options.map((o) => `
    <div class="product-row option-row ${o.active ? "" : "hidden-product"}">
      <div>
        <strong>${escapeHtml(o.name)}</strong>
        <div class="muted num" style="font-size:13px">${escapeHtml(optionSummary(o))} · ordre ${o.sortOrder}${o.active ? "" : " · désactivée"}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-edit-option="${escapeHtml(o.id)}">Modifier</button>
        <button type="button" class="btn" data-toggle-option="${escapeHtml(o.id)}">${o.active ? "Désactiver" : "Activer"}</button>
        <button type="button" class="btn btn-danger" data-delete-option="${escapeHtml(o.id)}">
          ${state.confirmDeleteOptionId === o.id ? "Confirmer" : "Supprimer"}
        </button>
      </div>
    </div>
  `).join("");
}

function fillOptionForm(option) {
  $("#of-id").value = option?.id ?? "";
  $("#of-name").value = option?.name ?? "";
  $("#of-price").value = option ? priceInput(option.priceCents) : "";
  $("#of-order").value = option?.sortOrder ?? nextSortOrder();
  $("#of-active").checked = option?.active ?? true;
  $("#of-type").value = option?.type ?? "toggle";
  $("#of-choices").value = (option?.choices ?? []).join("\n");
  $("#of-max").value = option?.maxValue || "";
  $("#of-all").checked = false;
  $("#of-all-field").hidden = Boolean(option); // seulement à la création
  showOptionTypeFields();

  $("#option-form-title").textContent = option ? "Modifier l'option" : "Ajouter une option";
  $("#of-submit").textContent = option ? "Enregistrer" : "Ajouter l'option";
  $("#of-cancel").hidden = !option;
  $("#option-error").hidden = true;
  if (option) $("#of-name").focus();
}

/** Affiche les champs utiles au type choisi (liste de choix, maximum). */
function showOptionTypeFields() {
  const type = $("#of-type").value;
  $("#of-choices-field").hidden = type !== "choice";
  $("#of-max-field").hidden = type !== "text" && type !== "quantity";
  $("#of-max-label").textContent = type === "text" ? "Nombre de caractères maximum" : "Nombre maximum que le client peut demander";
  $("#of-max").max = type === "text" ? 200 : 99;
  $("#of-max").placeholder = String(DEFAULT_MAX[type] ?? "");
  $("#of-price-hint").textContent = type === "quantity" ? "Prix d'une unité : il est multiplié par le nombre demandé. 0 = offert." : "0 pour une option offerte.";
}

/** Ordre proposé pour une nouvelle option : après la dernière, par pas de 10. */
const nextSortOrder = () => Math.min(9999, Math.max(0, ...state.options.map((o) => o.sortOrder)) + 10);

async function submitOption(event) {
  event.preventDefault();
  const errorEl = $("#option-error");
  const priceText = $("#of-price").value.trim();
  const orderText = $("#of-order").value.trim();
  const type = $("#of-type").value;
  const maxText = $("#of-max").value.trim();
  const option = {
    id: $("#of-id").value || undefined,
    name: $("#of-name").value.trim(),
    type,
    priceCents: priceText ? parsePrice(priceText) : NaN,
    choices: type === "choice" ? $("#of-choices").value.split("\n").map((c) => c.trim()).filter(Boolean) : [],
    maxValue: maxText ? Number(maxText) : 0,
    sortOrder: orderText ? Number(orderText) : 0,
    active: $("#of-active").checked,
    addToAllProducts: !$("#of-id").value && $("#of-all").checked,
  };

  if (!option.name || !(option.priceCents >= 0)) {
    errorEl.textContent = "Indiquez un nom et un prix (0 pour une option offerte, ex. 400).";
    errorEl.hidden = false;
    return;
  }
  if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0 || option.sortOrder > 9999) {
    errorEl.textContent = "L'ordre d'affichage est un nombre entier de 0 à 9999.";
    errorEl.hidden = false;
    return;
  }

  if (type === "choice" && !option.choices.length) {
    errorEl.textContent = "Indiquez au moins un choix, un par ligne.";
    errorEl.hidden = false;
    return;
  }

  try {
    await store.saveOption(option);
    toast(option.id ? "Option enregistrée" : "Option ajoutée");
    // Une option ajoutée à tous les bouquets change aussi la liste des produits.
    if (option.addToAllProducts) await loadProducts();
    await loadOptions();
    fillOptionForm(null);
    hooks.onCatalogChange();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  }
}

async function toggleOption(id) {
  const option = state.options.find((o) => o.id === id);
  if (!option) return;
  try {
    await store.setOptionActive(id, !option.active);
    toast(option.active ? "Option désactivée" : "Option activée");
    await loadOptions();
    if ($("#of-id").value === id) $("#of-active").checked = !option.active;
    hooks.onCatalogChange();
  } catch (error) {
    toast(error.message);
  }
}

async function deleteOption(id) {
  // Premier clic : demande confirmation. Second clic (dans les 4 s) : supprime.
  if (state.confirmDeleteOptionId !== id) {
    state.confirmDeleteOptionId = id;
    renderOptions();
    setTimeout(() => {
      if (state.confirmDeleteOptionId === id) {
        state.confirmDeleteOptionId = null;
        renderOptions();
      }
    }, 4000);
    return;
  }

  state.confirmDeleteOptionId = null;
  try {
    await store.deleteOption(id);
    toast("Option supprimée");
    await loadProducts(); // l'option est retirée des bouquets
    await loadOptions();
    if ($("#of-id").value === id) fillOptionForm(null);
    hooks.onCatalogChange();
  } catch (error) {
    toast(error.message);
  }
}

/* ==========================================================================
   Initialisation
   ========================================================================== */

function selectTab(tab) {
  $$("[data-admin-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.adminTab === tab));
  $("#admin-orders").hidden = tab !== "orders";
  $("#admin-products").hidden = tab !== "products";
  $("#admin-options").hidden = tab !== "options";
  if (tab === "options" && !$("#of-id").value && !$("#of-name").value) fillOptionForm(null);
}

export function initAdmin(appHooks) {
  hooks = { ...hooks, ...appHooks };

  if (store.demoAdmin) {
    const hint = $("#demo-hint");
    hint.textContent = `Mode démo : ${store.demoAdmin.email} / ${store.demoAdmin.password}`;
    hint.hidden = false;
  }

  $("#pf-category").innerHTML = Object.entries(CONFIG.categories)
    .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");
  // Une seule catégorie (bouquets) : inutile d'afficher le choix.
  if (Object.keys(CONFIG.categories).length === 1) $("#pf-category-field").hidden = true;

  $("#login-form").addEventListener("submit", submitLogin);
  $("#product-form").addEventListener("submit", submitProduct);
  $("#pf-cancel").addEventListener("click", () => fillProductForm(null));
  $("#option-form").addEventListener("submit", submitOption);
  $("#of-cancel").addEventListener("click", () => fillOptionForm(null));
  $("#of-type").addEventListener("change", showOptionTypeFields);

  $("#view-admin").addEventListener("click", (event) => {
    const el = event.target.closest("button");
    if (!el) return;
    const d = el.dataset;
    if (d.action === "logout") logout();
    else if (d.adminTab) selectTab(d.adminTab);
    else if (d.filter) { state.filter = d.filter; renderOrders(); }
    else if (d.orderId) { state.selectedId = d.orderId; renderOrders(); }
    else if (d.setStatus) setStatus(state.selectedId, d.setStatus);
    else if (d.copy) copyText(d.copy);
    else if (d.editProduct) fillProductForm(state.products.find((p) => p.id === d.editProduct));
    else if (d.deleteProduct) deleteProduct(d.deleteProduct);
    else if (d.editOption) fillOptionForm(state.options.find((o) => o.id === d.editOption));
    else if (d.toggleOption) toggleOption(d.toggleOption);
    else if (d.deleteOption) deleteOption(d.deleteOption);
  });
}
