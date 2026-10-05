/**
 * Mode production : les données sont dans Supabase (PostgreSQL).
 * La sécurité est assurée côté serveur par les règles de supabase/schema.sql :
 *  - tout le monde peut lire les produits visibles et passer commande ;
 *  - seuls les comptes inscrits dans la table `admins` voient et modifient les commandes.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* Conversion ligne SQL ↔ objet utilisé par les pages */

const productFromRow = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  priceCents: row.price_cents,
  description: row.description,
  imageUrl: row.image_url,
  active: row.active,
  createdAt: row.created_at,
});

const productToRow = (p) => ({
  ...(p.id ? { id: p.id } : {}),
  name: p.name,
  category: p.category,
  price_cents: p.priceCents,
  description: p.description ?? "",
  image_url: p.imageUrl ?? "",
  active: p.active ?? true,
});

const orderFromRow = (row) => ({
  id: row.id,
  code: row.code,
  status: row.status,
  createdAt: row.created_at,
  items: row.items ?? [],
  subtotalCents: row.subtotal_cents,
  deliveryCents: row.delivery_cents,
  totalCents: row.total_cents,
  customer: row.customer ?? {},
  address: row.address ?? {},
  delivery: { date: row.delivery_date, slot: row.delivery_slot },
  cardMessage: row.card_message ?? "",
  notes: row.notes ?? "",
});

/** Transforme une erreur Supabase en message lisible. */
function fail(error, fallback) {
  if (!error) return;
  console.error(error);
  // Les messages levés par nos fonctions SQL (raise exception) sont déjà en français.
  const readable = error.code === "P0001" ? error.message : fallback;
  throw new Error(readable);
}

export function createSupabaseStore({ url, anonKey }) {
  if (!url || !anonKey) {
    throw new Error("Supabase n'est pas configuré : renseignez url et anonKey dans js/config.js.");
  }
  const db = createClient(url, anonKey);

  return {
    async listProducts({ includeHidden = false } = {}) {
      let query = db.from("products").select("*").order("category").order("name");
      if (!includeHidden) query = query.eq("active", true);
      const { data, error } = await query;
      fail(error, "Impossible de charger le catalogue.");
      return data.map(productFromRow);
    },

    async saveProduct(product) {
      const { data, error } = await db.from("products").upsert(productToRow(product)).select().single();
      fail(error, "Le produit n'a pas été enregistré.");
      return productFromRow(data);
    },

    async deleteProduct(id) {
      const { error } = await db.from("products").delete().eq("id", id);
      fail(error, "Le produit n'a pas été supprimé.");
    },

    async placeOrder(order) {
      // La fonction SQL recalcule les prix et vérifie les champs.
      const { data, error } = await db.rpc("place_order", { payload: order });
      fail(error, "La commande n'a pas pu être envoyée. Réessayez dans un instant.");
      return { code: data };
    },

    async getOrdersByCodes(codes) {
      if (!codes.length) return [];
      const { data, error } = await db.rpc("orders_by_codes", { codes });
      fail(error, "Impossible de récupérer vos commandes.");
      return data.map(orderFromRow);
    },

    async listOrders() {
      const { data, error } = await db.from("orders").select("*").order("created_at", { ascending: false });
      fail(error, "Impossible de charger les commandes.");
      return data.map(orderFromRow);
    },

    async updateOrderStatus(id, status) {
      const { error } = await db.from("orders").update({ status }).eq("id", id);
      fail(error, "Le statut n'a pas été enregistré.");
    },

    /** Temps réel : prévient à chaque nouvelle commande ou changement de statut. */
    subscribeToOrders(callback) {
      const channel = db
        .channel("orders-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => callback())
        .subscribe();
      return () => db.removeChannel(channel);
    },

    auth: {
      async signIn(email, password) {
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw new Error("E-mail ou mot de passe incorrect.");
        const { data: isAdmin } = await db.rpc("is_admin");
        if (!isAdmin) {
          await db.auth.signOut();
          throw new Error("Ce compte n'a pas accès à l'administration.");
        }
        return data.user;
      },
      async signOut() {
        await db.auth.signOut();
      },
      async getUser() {
        const { data } = await db.auth.getUser();
        if (!data.user) return null;
        const { data: isAdmin } = await db.rpc("is_admin");
        return isAdmin ? data.user : null;
      },
    },
  };
}
