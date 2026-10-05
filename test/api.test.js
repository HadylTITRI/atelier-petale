import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../js/config.js";
import { hashPassword, signToken, verifyPassword, verifyToken } from "../server/auth.js";
import { createApp } from "../server/app.js";
import { createMemoryRepo } from "./memory-repo.js";

const SECRET = "x".repeat(40);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = { email: "gerante@exemple.dz", password: "un-mot-de-passe-solide" };

const tomorrow = () => {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.timezone }).format(d);
};

const validOrder = (overrides = {}) => ({
  items: [{ productId: "1", qty: 2, options: [] }],
  customer: { name: "Amina B.", phone: "0555 12 34 56", email: "" },
  address: { recipient: "", street: "12 rue Didouche Mourad", zip: "16000", city: "Alger", details: "" },
  delivery: { date: tomorrow(), slot: CONFIG.deliverySlots[0] },
  cardMessage: "Joyeux anniversaire", notes: "",
  ...overrides,
});

let server, base, repo;

before(async () => {
  repo = createMemoryRepo({
    products: [
      { name: "Bouquet pivoines", priceCents: 450000 },
      { name: "Bouquet masqué", priceCents: 100000, active: false },
    ],
    admins: [{ email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password) }],
  });
  const app = createApp({ repo, secret: SECRET, rootDir: root, orderLimitPerHour: 1000 });
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (method, url, { body, cookie, headers = {} } = {}) =>
  fetch(base + url, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

async function login() {
  const res = await call("POST", "/api/auth/login", { body: { email: ADMIN.email, password: ADMIN.password } });
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie").split(";")[0];
}

describe("auth (mots de passe et jetons)", () => {
  it("vérifie un mot de passe haché", async () => {
    const hash = await hashPassword("secret-123456");
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(await verifyPassword("secret-123456", hash), true);
    assert.equal(await verifyPassword("autre-chose", hash), false);
  });
  it("refuse un jeton falsifié ou expiré", () => {
    const token = signToken({ email: "a@b.dz", exp: Date.now() + 1000 }, SECRET);
    assert.equal(verifyToken(token, SECRET).email, "a@b.dz");
    assert.equal(verifyToken(token, "y".repeat(40)), null);
    assert.equal(verifyToken(token.slice(0, -2) + "xx", SECRET), null);
    assert.equal(verifyToken(signToken({ email: "a@b.dz", exp: Date.now() - 1 }, SECRET), SECRET), null);
  });
});

describe("catalogue public", () => {
  it("ne renvoie que les bouquets visibles", async () => {
    const products = await (await call("GET", "/api/products")).json();
    assert.deepEqual(products.map((p) => p.name), ["Bouquet pivoines"]);
    assert.equal(typeof products[0].id, "string");
  });
});

describe("commandes", () => {
  it("enregistre une commande et recalcule les prix avec les options", async () => {
    const order = validOrder({
      items: [{ productId: "1", qty: 2, options: [
        { id: "initiales", value: "am" }, { id: "papillons", value: 3 }, { id: "emballage", value: true },
        // un prix envoyé par le navigateur doit être ignoré
        { id: "ruban", value: "Doré", priceCents: 1 },
      ] }],
    });
    const res = await call("POST", "/api/orders", { body: order });
    assert.equal(res.status, 201);
    const { code } = await res.json();
    assert.match(code, /^AP-[A-Z2-9]{6}$/);

    const stored = repo.state.orders.find((o) => o.code === code);
    const extras = 30000 + 3 * 10000 + 40000 + 15000;
    assert.equal(stored.items[0].optionsCents, extras);
    assert.equal(stored.items[0].options.find((o) => o.id === "initiales").value, "AM");
    assert.equal(stored.subtotalCents, (450000 + extras) * 2);
    assert.equal(stored.totalCents, stored.subtotalCents + CONFIG.deliveryFeeCents);
  });

  const rejected = [
    ["produit masqué", validOrder({ items: [{ productId: "2", qty: 1, options: [] }] })],
    ["produit inconnu", validOrder({ items: [{ productId: "999", qty: 1, options: [] }] })],
    ["panier vide", validOrder({ items: [] })],
    ["quantité 0", validOrder({ items: [{ productId: "1", qty: 0, options: [] }] })],
    ["quantité décimale", validOrder({ items: [{ productId: "1", qty: 1.5, options: [] }] })],
    ["option inconnue", validOrder({ items: [{ productId: "1", qty: 1, options: [{ id: "hack", value: 1 }] }] })],
    ["trop de papillons", validOrder({ items: [{ productId: "1", qty: 1, options: [{ id: "papillons", value: 99 }] }] })],
    ["ruban hors liste", validOrder({ items: [{ productId: "1", qty: 1, options: [{ id: "ruban", value: "Vert" }] }] })],
    ["initiales trop longues", validOrder({ items: [{ productId: "1", qty: 1, options: [{ id: "initiales", value: "ABCD" }] }] })],
    ["téléphone trop court", validOrder({ customer: { name: "A", phone: "123", email: "" } })],
    ["code postal invalide", validOrder({ address: { street: "x", zip: "16A", city: "Alger" } })],
    ["date passée", validOrder({ delivery: { date: "2020-01-01", slot: CONFIG.deliverySlots[0] } })],
    ["date inexistante", validOrder({ delivery: { date: "2030-02-31", slot: CONFIG.deliverySlots[0] } })],
    ["créneau inconnu", validOrder({ delivery: { date: tomorrow(), slot: "Minuit" } })],
    ["e-mail invalide", validOrder({ customer: { name: "A", phone: "0555123456", email: "pas-un-email" } })],
  ];
  for (const [label, order] of rejected) {
    it(`refuse : ${label}`, async () => {
      const before = repo.state.orders.length;
      const res = await call("POST", "/api/orders", { body: order });
      assert.equal(res.status, 400, label);
      assert.equal(typeof (await res.json()).error, "string");
      assert.equal(repo.state.orders.length, before);
    });
  }

  it("refuse un corps qui n'est pas du JSON", async () => {
    const res = await call("POST", "/api/orders", { headers: { "Content-Type": "text/plain" }, body: undefined });
    assert.equal(res.status, 415);
  });

  it("le suivi par numéro ne montre ni téléphone ni adresse", async () => {
    const { code } = await (await call("POST", "/api/orders", { body: validOrder() })).json();
    const res = await call("POST", "/api/orders/lookup", { body: { codes: [code.toLowerCase(), "AP-FAUX00", "n'importe quoi"] } });
    const [order] = await res.json();
    assert.equal(order.code, code);
    assert.equal(order.customer, undefined);
    assert.equal(order.address, undefined);
    assert.equal(order.status, "nouvelle");
  });
});

describe("administration", () => {
  it("exige une connexion", async () => {
    for (const [method, url] of [["GET", "/api/admin/orders"], ["GET", "/api/admin/products"], ["GET", "/api/admin/orders/stamp"], ["GET", "/api/auth/me"]]) {
      assert.equal((await call(method, url)).status, 401, url);
    }
    assert.equal((await call("POST", "/api/admin/products", { body: { name: "x" } })).status, 401);
    assert.equal((await call("GET", "/api/admin/orders", { cookie: "ap_session=n-importe-quoi" })).status, 401);
  });

  it("refuse un mauvais mot de passe et un e-mail inconnu avec le même message", async () => {
    const a = await call("POST", "/api/auth/login", { body: { email: ADMIN.email, password: "faux" } });
    const b = await call("POST", "/api/auth/login", { body: { email: "inconnu@exemple.dz", password: "faux" } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal((await a.json()).error, (await b.json()).error);
  });

  it("cookie de session HttpOnly, puis accès aux commandes avec les coordonnées complètes", async () => {
    const res = await call("POST", "/api/auth/login", { body: { email: ADMIN.email.toUpperCase(), password: ADMIN.password } });
    const cookie = res.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const orders = await (await call("GET", "/api/admin/orders", { cookie: cookie.split(";")[0] })).json();
    assert.ok(orders.length > 0);
    assert.ok(orders[0].customer.phone);
  });

  it("change le statut d'une commande et l'empreinte de suivi évolue", async () => {
    const cookie = await login();
    const { stamp: before } = await (await call("GET", "/api/admin/orders/stamp", { cookie })).json();
    const [order] = await (await call("GET", "/api/admin/orders", { cookie })).json();
    assert.equal((await call("PATCH", `/api/admin/orders/${order.id}/status`, { cookie, body: { status: "preparation" } })).status, 200);
    assert.equal(repo.state.orders.find((o) => o.id === order.id).status, "preparation");
    const { stamp: after } = await (await call("GET", "/api/admin/orders/stamp", { cookie })).json();
    assert.notEqual(before, after);
    assert.equal((await call("PATCH", `/api/admin/orders/${order.id}/status`, { cookie, body: { status: "nimportequoi" } })).status, 400);
    assert.equal((await call("PATCH", "/api/admin/orders/9999/status", { cookie, body: { status: "livree" } })).status, 404);
  });

  it("crée, modifie et supprime un produit", async () => {
    const cookie = await login();
    const created = await call("POST", "/api/admin/products", { cookie, body: { name: "Bouquet de roses", category: "bouquets", priceCents: 520000, description: "12 roses", imageUrl: "", active: true } });
    assert.equal(created.status, 201);
    const product = await created.json();
    const updated = await call("PUT", `/api/admin/products/${product.id}`, { cookie, body: { ...product, priceCents: 550000 } });
    assert.equal((await updated.json()).priceCents, 550000);
    assert.equal((await call("DELETE", `/api/admin/products/${product.id}`, { cookie })).status, 200);
    assert.equal((await call("DELETE", `/api/admin/products/${product.id}`, { cookie })).status, 404);
  });

  it("refuse les produits invalides", async () => {
    const cookie = await login();
    const base = { name: "X", category: "bouquets", priceCents: 1000, description: "", imageUrl: "", active: true };
    for (const bad of [{ name: "" }, { category: "nails" }, { category: "constructor" }, { priceCents: 0 }, { priceCents: 12.5 }, { imageUrl: "javascript:alert(1)" }]) {
      const res = await call("POST", "/api/admin/products", { cookie, body: { ...base, ...bad } });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  it("refuse une requête venue d'un autre site (CSRF)", async () => {
    const cookie = await login();
    const res = await call("PATCH", "/api/admin/orders/1/status", { cookie, body: { status: "livree" }, headers: { Origin: "https://site-malveillant.example" } });
    assert.equal(res.status, 403);
  });

  it("la déconnexion supprime le cookie", async () => {
    const res = await call("POST", "/api/auth/logout", { body: {} });
    assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
  });
});

describe("fichiers du site", () => {
  it("sert la page, les styles et les scripts", async () => {
    assert.equal((await call("GET", "/")).status, 200);
    assert.match((await call("GET", "/js/config.js")).headers.get("content-type"), /javascript/);
    assert.equal((await call("GET", "/css/style.css")).status, 200);
    assert.equal((await call("GET", "/js/store/api-store.js")).status, 200);
  });
  it("ne sert jamais le code du serveur, la base ni les secrets", async () => {
    for (const url of ["/server/app.js", "/database/schema.sql", "/package.json", "/.env", "/.git/config", "/test/api.test.js",
      "/js/../package.json", "/js/%2e%2e/package.json", "/%2e%2e/package.json", "/js/..%2fpackage.json", "/js//..//server/app.js"]) {
      const res = await call("GET", url);
      assert.ok([400, 404].includes(res.status), `${url} → ${res.status}`);
    }
  });
  it("envoie les en-têtes de sécurité", async () => {
    const res = await call("GET", "/");
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });
  it("répond sur /healthz", async () => {
    assert.equal(await (await call("GET", "/healthz?db=1")).text(), "ok");
  });
});

describe("limitation des essais", () => {
  it("bloque les commandes répétées depuis une même adresse", async () => {
    const local = createServer(createApp({ repo, secret: SECRET, rootDir: root, orderLimitPerHour: 3 }));
    await new Promise((resolve) => local.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${local.address().port}/api/orders`;
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validOrder()) });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
    local.close();
  });

  it("bloque les tentatives de connexion répétées", async () => {
    const app = createApp({ repo, secret: SECRET, rootDir: root });
    const local = createServer(app);
    await new Promise((resolve) => local.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${local.address().port}/api/auth/login`;
    let last;
    for (let i = 0; i < 12; i++) {
      last = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN.email, password: "faux" }) });
    }
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get("retry-after")) > 0);
    local.close();
  });
});
