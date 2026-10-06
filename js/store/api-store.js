/**
 * Mode production : le site parle au serveur Node.js (dossier server/),
 * qui lit et écrit dans MySQL. Le navigateur ne voit jamais la base de données.
 *
 *  - le catalogue et le passage de commande sont publics ;
 *  - le suivi se fait avec le numéro de commande ;
 *  - tout ce qui touche aux commandes et aux produits côté admin passe par une
 *    session (cookie HttpOnly) obtenue en se connectant ;
 *  - les options actives sont publiques, leur gestion est réservée à l'admin.
 */

const POLL_MS = 15_000;

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Connexion au serveur impossible. Vérifiez votre connexion internet.");
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error ?? "Une erreur est survenue. Réessayez dans un instant.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function createApiStore() {
  return {
    async listProducts({ includeHidden = false } = {}) {
      return request("GET", includeHidden ? "/api/admin/products" : "/api/products");
    },

    async saveProduct(product) {
      return product.id
        ? request("PUT", `/api/admin/products/${encodeURIComponent(product.id)}`, product)
        : request("POST", "/api/admin/products", product);
    },

    async deleteProduct(id) {
      await request("DELETE", `/api/admin/products/${encodeURIComponent(id)}`);
    },

    /** Options des bouquets : actives seulement pour la boutique, toutes pour l'admin. */
    async listOptions({ includeHidden = false } = {}) {
      return request("GET", includeHidden ? "/api/admin/options" : "/api/options");
    },

    async saveOption(option) {
      return option.id
        ? request("PUT", `/api/admin/options/${encodeURIComponent(option.id)}`, option)
        : request("POST", "/api/admin/options", option);
    },

    async setOptionActive(id, active) {
      return request("PATCH", `/api/admin/options/${encodeURIComponent(id)}/active`, { active });
    },

    async deleteOption(id) {
      await request("DELETE", `/api/admin/options/${encodeURIComponent(id)}`);
    },

    async placeOrder(order) {
      return request("POST", "/api/orders", order);
    },

    async getOrdersByCodes(codes) {
      if (!codes.length) return [];
      return request("POST", "/api/orders/lookup", { codes });
    },

    async listOrders() {
      return request("GET", "/api/admin/orders");
    },

    async updateOrderStatus(id, status) {
      await request("PATCH", `/api/admin/orders/${encodeURIComponent(id)}/status`, { status });
    },

    /** Interroge le serveur toutes les 15 s et prévient quand une commande est arrivée ou a changé. */
    subscribeToOrders(callback) {
      let last = null;
      const timer = setInterval(async () => {
        try {
          const { stamp } = await request("GET", "/api/admin/orders/stamp");
          if (last !== null && stamp !== last) callback();
          last = stamp;
        } catch {
          /* réseau coupé ou session expirée : on réessaiera au prochain tour */
        }
      }, POLL_MS);
      return () => clearInterval(timer);
    },

    auth: {
      async signIn(email, password) {
        return request("POST", "/api/auth/login", { email, password });
      },
      async signOut() {
        await request("POST", "/api/auth/logout", {}).catch(() => {});
      },
      async getUser() {
        try {
          return await request("GET", "/api/auth/me");
        } catch {
          return null; // pas connecté, ou serveur injoignable : le site reste utilisable
        }
      },
    },
  };
}
