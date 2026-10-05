/**
 * Le serveur HTTP de la boutique : API JSON + fichiers du site.
 * Aucune dépendance : seulement les modules intégrés de Node.
 *
 * `createApp` reçoit l'accès aux données (`repo`) ; en production c'est MySQL (repo-mysql.js),
 * dans les tests c'est une version en mémoire.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../js/config.js";
import { DUMMY_HASH, signToken, verifyPassword, verifyToken } from "./auth.js";
import { createLimiter } from "./rate-limit.js";
import { HttpError, ORDER_CODE_PATTERN, makeOrderCode } from "./util.js";
import { priceOrder, validateOrder, validateProduct, validateStatus } from "./validation.js";

const SESSION_COOKIE = "ap_session";
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 h
const MAX_BODY_BYTES = 100_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

/** Seuls ces dossiers et fichiers du projet sont publics. Le reste (server/, database/, .env…) ne l'est jamais. */
const PUBLIC_DIRS = ["css", "js"];

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

async function readJson(req) {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Format de requête non pris en charge.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "Requête illisible.");
  }
}

/** Ce que le client a le droit de voir de sa commande (pas de téléphone ni d'adresse). */
const publicOrder = (order) => ({
  code: order.code,
  status: order.status,
  createdAt: order.createdAt,
  items: order.items,
  subtotalCents: order.subtotalCents,
  deliveryCents: order.deliveryCents,
  totalCents: order.totalCents,
  delivery: order.delivery,
});

export function createApp({ repo, secret, production = false, trustProxy = false, rootDir, orderLimitPerHour = 15 }) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET doit contenir au moins 32 caractères.");

  const limits = {
    order: createLimiter({ windowMs: 60 * 60 * 1000, max: orderLimitPerHour }),
    lookup: createLimiter({ windowMs: 10 * 60 * 1000, max: 60 }),
    login: createLimiter({ windowMs: 15 * 60 * 1000, max: 10 }),
    api: createLimiter({ windowMs: 60 * 1000, max: 300 }),
  };

  const clientIp = (req) => {
    if (trustProxy) {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? "inconnue";
  };

  function limit(req, name) {
    const { allowed, retryAfterSeconds } = limits[name](`${name}:${clientIp(req)}`);
    if (!allowed) {
      const error = new HttpError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
      error.retryAfter = retryAfterSeconds;
      throw error;
    }
  }

  function send(res, status, body, extraHeaders = {}) {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
    res.end(payload);
  }

  const sessionCookie = (value, maxAgeSeconds) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${production ? "; Secure" : ""}`;

  /** Administrateur connecté (cookie valide ET compte toujours présent en base), sinon erreur 401. */
  async function requireAdmin(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const payload = verifyToken(token, secret);
    const admin = payload && (await repo.getAdminByEmail(payload.email));
    if (!admin) throw new HttpError(401, "Connexion requise.");
    return admin;
  }

  /** Protection CSRF : une requête qui modifie des données doit venir de notre propre site. */
  function requireSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.headers.host) throw new HttpError(403, "Requête refusée.");
  }

  /* ------------------------------ API ------------------------------ */

  async function api(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    limit(req, "api");
    if (method !== "GET") requireSameOrigin(req);

    // ----- public -----
    if (method === "GET" && pathname === "/api/products") {
      return send(res, 200, await repo.listProducts({ includeHidden: false }));
    }

    if (method === "POST" && pathname === "/api/orders") {
      limit(req, "order");
      const clean = validateOrder(await readJson(req));
      const ids = [...new Set(clean.items.map((item) => item.productId))];
      const products = await repo.getProductsByIds(ids);
      const order = priceOrder(clean, products);
      const code = await repo.createOrder(order, makeOrderCode);
      return send(res, 201, { code });
    }

    if (method === "POST" && pathname === "/api/orders/lookup") {
      limit(req, "lookup");
      const body = await readJson(req);
      const codes = Array.isArray(body?.codes)
        ? [...new Set(body.codes.map((c) => String(c).trim().toUpperCase()).filter((c) => ORDER_CODE_PATTERN.test(c)))].slice(0, 30)
        : [];
      const orders = codes.length ? await repo.getOrdersByCodes(codes) : [];
      return send(res, 200, orders.map(publicOrder));
    }

    // ----- connexion admin -----
    if (method === "POST" && pathname === "/api/auth/login") {
      limit(req, "login");
      const body = await readJson(req);
      const email = String(body?.email ?? "").trim().toLowerCase().slice(0, 190);
      const password = String(body?.password ?? "").slice(0, 200);
      const admin = email ? await repo.getAdminByEmail(email) : null;
      // Même travail de hachage si l'e-mail n'existe pas : on ne révèle pas quels comptes existent.
      const valid = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH);
      if (!admin || !valid) throw new HttpError(401, "E-mail ou mot de passe incorrect.");
      const token = signToken({ email: admin.email, exp: Date.now() + SESSION_MS }, secret);
      return send(res, 200, { email: admin.email }, { "Set-Cookie": sessionCookie(token, SESSION_MS / 1000) });
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      const admin = await requireAdmin(req);
      return send(res, 200, { email: admin.email });
    }

    // ----- administration (connexion obligatoire) -----
    if (pathname.startsWith("/api/admin/")) {
      await requireAdmin(req);

      if (method === "GET" && pathname === "/api/admin/products") {
        return send(res, 200, await repo.listProducts({ includeHidden: true }));
      }
      if (method === "POST" && pathname === "/api/admin/products") {
        const product = validateProduct(await readJson(req));
        return send(res, 201, await repo.createProduct(product));
      }

      const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
      if (productMatch && method === "PUT") {
        const product = validateProduct(await readJson(req));
        const saved = await repo.updateProduct(productMatch[1], product);
        if (!saved) throw new HttpError(404, "Produit introuvable.");
        return send(res, 200, saved);
      }
      if (productMatch && method === "DELETE") {
        if (!(await repo.deleteProduct(productMatch[1]))) throw new HttpError(404, "Produit introuvable.");
        return send(res, 200, { ok: true });
      }

      if (method === "GET" && pathname === "/api/admin/orders") {
        return send(res, 200, await repo.listOrders());
      }
      if (method === "GET" && pathname === "/api/admin/orders/stamp") {
        return send(res, 200, { stamp: await repo.ordersStamp() });
      }
      const statusMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
      if (statusMatch && method === "PATCH") {
        const status = validateStatus(await readJson(req));
        if (!(await repo.updateOrderStatus(statusMatch[1], status))) throw new HttpError(404, "Commande introuvable.");
        return send(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, "Adresse inconnue.");
  }

  /* ------------------------- fichiers du site ------------------------- */

  async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Méthode non autorisée.");

    let relative;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, "Adresse invalide.");
    }
    if (relative === "/") relative = "/index.html";

    const segments = relative.split("/").filter(Boolean);
    const isPage = relative === "/index.html";
    const isAsset = PUBLIC_DIRS.includes(segments[0]) && segments.length > 1;
    if (!isPage && !isAsset) throw new HttpError(404, "Page introuvable.");
    if (segments.some((s) => s === ".." || s.startsWith(".") || s.includes("\\") || s.includes("\0"))) {
      throw new HttpError(404, "Page introuvable.");
    }

    const file = path.join(rootDir, ...segments);
    const type = MIME[path.extname(file)];
    if (!type) throw new HttpError(404, "Page introuvable.");

    let content;
    try {
      content = await readFile(file);
    } catch {
      throw new HttpError(404, "Page introuvable.");
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": content.length,
      "Cache-Control": isPage ? "no-cache" : "public, max-age=300",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  }

  /* --------------------------- point d'entrée --------------------------- */

  return async function handle(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (production) res.setHeader("Strict-Transport-Security", "max-age=15552000");

    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/healthz") {
        if (url.searchParams.has("db")) await repo.ping();
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        return res.end("ok");
      }
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      return await serveStatic(req, res, url.pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      const message = status === 500 ? "Erreur du serveur. Réessayez dans un instant." : error.message;
      const isApi = req.url?.startsWith("/api/");
      const headers = error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {};
      if (isApi || status === 500) return send(res, status, { error: message }, headers);
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
      return res.end(message);
    }
  };
}
