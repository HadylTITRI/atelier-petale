/**
 * Partie administration : connexion, commandes et produits.
 * Visible uniquement après connexion avec un compte administrateur.
 */
import { CONFIG, STATUSES, ACTIVE_STATUSES } from "./config.js";
import { store } from "./store/index.js";
import {
  $, $$, escapeHtml, formatPrice, formatDate, formatDateTime, isoDay, parsePrice, toast,
  productVisual, categoryLabel, statusLabel,
} from "./utils.js";

const state = {
  orders: [],
  products: [],
  filter: "active",      // "active" | "all" | un statut
  selectedId: null,      // commande affichée dans le détail
  confirmDeleteId: null, // produit en attente de confirmation de suppression
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
  await Promise.all([loadOrders(), loadProducts()]);
}

export function stopAdmin() {
  state.unsubscribe?.();
  Object.assign(state, { orders: [], products: [], selectedId: null, unsubscribe: null });
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
        <div class="sum-row" style="margin-top:6px"><span>${i.qty} × ${escapeHtml(i.name)}</span><span class="num">${formatPrice(i.priceCents * i.qty)}</span></div>
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
        <div class="muted num" style="font-size:13px">${escapeHtml(categoryLabel(p.category))} · ${formatPrice(p.priceCents)}${p.active ? "" : " · masqué"}</div>
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

function fillProductForm(product) {
  $("#pf-id").value = product?.id ?? "";
  $("#pf-name").value = product?.name ?? "";
  $("#pf-category").value = product?.category ?? Object.keys(CONFIG.categories)[0];
  $("#pf-price").value = product ? (product.priceCents / 100).toFixed(2).replace(".", ",") : "";
  $("#pf-description").value = product?.description ?? "";
  $("#pf-image").value = product?.imageUrl ?? "";
  $("#pf-active").checked = product?.active ?? true;

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
  };

  if (!product.name || !(product.priceCents > 0)) {
    errorEl.textContent = "Indiquez un nom et un prix supérieur à 0 (ex. 39,90).";
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
   Initialisation
   ========================================================================== */

function selectTab(tab) {
  $$("[data-admin-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.adminTab === tab));
  $("#admin-orders").hidden = tab !== "orders";
  $("#admin-products").hidden = tab !== "products";
}

export function initAdmin(appHooks) {
  hooks = { ...hooks, ...appHooks };

  if (CONFIG.mode === "local") {
    const hint = $("#demo-hint");
    hint.textContent = `Mode démo : ${CONFIG.demoAdmin.email} / ${CONFIG.demoAdmin.password}`;
    hint.hidden = false;
  }

  $("#pf-category").innerHTML = Object.entries(CONFIG.categories)
    .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("");

  $("#login-form").addEventListener("submit", submitLogin);
  $("#product-form").addEventListener("submit", submitProduct);
  $("#pf-cancel").addEventListener("click", () => fillProductForm(null));

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
  });
}
