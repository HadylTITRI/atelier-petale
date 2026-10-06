/**
 * Accès aux données : toutes les requêtes SQL de la boutique sont ici.
 * Les valeurs sont toujours passées en paramètres (`?`), jamais collées dans le texte SQL :
 * c'est ce qui protège contre l'injection SQL.
 *
 * Les identifiants sont renvoyés en texte ("12") : c'est le format utilisé par le site.
 */

const productFromRow = (row) => ({
  id: String(row.id),
  name: row.name,
  category: row.category,
  priceCents: row.price_cents,
  description: row.description,
  imageUrl: row.image_url,
  active: Boolean(row.active),
  createdAt: row.created_at,
});

const optionFromRow = (row) => ({
  id: String(row.id),
  name: row.name,
  priceCents: row.price_cents,
  active: Boolean(row.active),
  sortOrder: row.sort_order,
});

/** `options` est un mot-clé MySQL : le nom de la table est toujours entre accents graves. */
const OPTIONS_ORDER = "ORDER BY sort_order, name, id";

const parseJson = (value) => {
  if (value == null) return [];
  if (typeof value !== "string") return value; // MySQL renvoie déjà un objet pour une colonne JSON
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
};

const itemFromRow = (row) => ({
  productId: row.product_id == null ? null : String(row.product_id),
  name: row.product_name,
  priceCents: row.unit_price_cents,
  optionsCents: row.options_cents,
  options: parseJson(row.options),
  qty: row.quantity,
});

const orderFromRow = (row, items) => ({
  id: String(row.id),
  code: row.code,
  status: row.status,
  createdAt: new Date(Number(row.created_unix) * 1000).toISOString(),
  items,
  subtotalCents: row.subtotal_cents,
  deliveryCents: row.delivery_cents,
  totalCents: row.total_cents,
  customer: { name: row.customer_name, phone: row.customer_phone, email: row.customer_email },
  address: { recipient: row.recipient, street: row.street, zip: row.zip, city: row.city, details: row.address_details },
  delivery: { date: row.delivery_date, slot: row.delivery_slot },
  cardMessage: row.card_message,
  notes: row.notes,
});

const ORDER_COLUMNS = "o.*, UNIX_TIMESTAMP(o.created_at) AS created_unix";

export function createMysqlRepo(pool) {
  /** Ajoute les articles à une liste de commandes (une seule requête pour toutes). */
  async function withItems(orderRows) {
    if (!orderRows.length) return [];
    const ids = orderRows.map((row) => row.id);
    const [itemRows] = await pool.query("SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id", [ids]);
    const byOrder = new Map();
    for (const row of itemRows) {
      if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
      byOrder.get(row.order_id).push(itemFromRow(row));
    }
    return orderRows.map((row) => orderFromRow(row, byOrder.get(row.id) ?? []));
  }

  return {
    async ping() {
      await pool.query("SELECT 1");
    },

    /* ---------- produits ---------- */

    async listProducts({ includeHidden = false } = {}) {
      const where = includeHidden ? "" : "WHERE active = TRUE";
      const [rows] = await pool.query(`SELECT * FROM products ${where} ORDER BY category, name`);
      return rows.map(productFromRow);
    },

    async getProductsByIds(ids) {
      const numeric = ids.filter((id) => /^\d+$/.test(id)).map(Number);
      if (!numeric.length) return [];
      const [rows] = await pool.query("SELECT * FROM products WHERE id IN (?)", [numeric]);
      return rows.map(productFromRow);
    },

    async createProduct(product) {
      const [result] = await pool.query(
        "INSERT INTO products (name, category, price_cents, description, image_url, active) VALUES (?, ?, ?, ?, ?, ?)",
        [product.name, product.category, product.priceCents, product.description, product.imageUrl, product.active],
      );
      const [[row]] = await pool.query("SELECT * FROM products WHERE id = ?", [result.insertId]);
      return productFromRow(row);
    },

    /** Renvoie le produit modifié, ou null s'il n'existe pas. */
    async updateProduct(id, product) {
      const [result] = await pool.query(
        "UPDATE products SET name = ?, category = ?, price_cents = ?, description = ?, image_url = ?, active = ? WHERE id = ?",
        [product.name, product.category, product.priceCents, product.description, product.imageUrl, product.active, Number(id)],
      );
      if (!result.affectedRows) return null;
      const [[row]] = await pool.query("SELECT * FROM products WHERE id = ?", [Number(id)]);
      return productFromRow(row);
    },

    async deleteProduct(id) {
      const [result] = await pool.query("DELETE FROM products WHERE id = ?", [Number(id)]);
      return result.affectedRows > 0;
    },

    /* ---------- options (communes à tous les bouquets) ---------- */

    async listOptions({ includeHidden = false } = {}) {
      const where = includeHidden ? "" : "WHERE active = TRUE";
      const [rows] = await pool.query(`SELECT * FROM \`options\` ${where} ${OPTIONS_ORDER}`);
      return rows.map(optionFromRow);
    },

    /** Options demandées, actives ou non (le serveur refuse ensuite celles qui sont désactivées). */
    async getOptionsByIds(ids) {
      const numeric = ids.filter((id) => /^\d+$/.test(id)).map(Number);
      if (!numeric.length) return [];
      const [rows] = await pool.query("SELECT * FROM `options` WHERE id IN (?)", [numeric]);
      return rows.map(optionFromRow);
    },

    async createOption(option) {
      const [result] = await pool.query(
        "INSERT INTO `options` (name, price_cents, active, sort_order) VALUES (?, ?, ?, ?)",
        [option.name, option.priceCents, option.active, option.sortOrder],
      );
      const [[row]] = await pool.query("SELECT * FROM `options` WHERE id = ?", [result.insertId]);
      return optionFromRow(row);
    },

    /** Renvoie l'option modifiée, ou null si elle n'existe pas. */
    async updateOption(id, option) {
      const [[existing]] = await pool.query("SELECT id FROM `options` WHERE id = ?", [Number(id)]);
      if (!existing) return null;
      await pool.query(
        "UPDATE `options` SET name = ?, price_cents = ?, active = ?, sort_order = ? WHERE id = ?",
        [option.name, option.priceCents, option.active, option.sortOrder, Number(id)],
      );
      const [[row]] = await pool.query("SELECT * FROM `options` WHERE id = ?", [Number(id)]);
      return optionFromRow(row);
    },

    /** Active ou désactive ; renvoie l'option, ou null si elle n'existe pas. */
    async setOptionActive(id, active) {
      const [[existing]] = await pool.query("SELECT id FROM `options` WHERE id = ?", [Number(id)]);
      if (!existing) return null;
      await pool.query("UPDATE `options` SET active = ? WHERE id = ?", [active, Number(id)]);
      const [[row]] = await pool.query("SELECT * FROM `options` WHERE id = ?", [Number(id)]);
      return optionFromRow(row);
    },

    /** Les commandes déjà passées gardent le nom et le prix de l'option (copiés à l'achat). */
    async deleteOption(id) {
      const [result] = await pool.query("DELETE FROM `options` WHERE id = ?", [Number(id)]);
      return result.affectedRows > 0;
    },

    /* ---------- commandes ---------- */

    /**
     * Enregistre la commande et ses articles dans une transaction : tout ou rien.
     * Si le code tiré au hasard existe déjà (très rare), on en tire un autre.
     */
    async createOrder(order, makeCode) {
      const connection = await pool.getConnection();
      try {
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = makeCode();
          await connection.beginTransaction();
          try {
            const [result] = await connection.query(
              `INSERT INTO orders
                 (code, status, customer_name, customer_phone, customer_email,
                  recipient, street, zip, city, address_details, delivery_date, delivery_slot,
                  card_message, notes, subtotal_cents, delivery_cents, total_cents)
               VALUES (?, 'nouvelle', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                code, order.customer.name, order.customer.phone, order.customer.email,
                order.address.recipient, order.address.street, order.address.zip, order.address.city, order.address.details,
                order.delivery.date, order.delivery.slot, order.cardMessage, order.notes,
                order.subtotalCents, order.deliveryCents, order.totalCents,
              ],
            );
            const rows = order.items.map((item) => [
              result.insertId, Number(item.productId), item.name, item.priceCents, item.optionsCents,
              item.options.length ? JSON.stringify(item.options) : null, item.qty,
            ]);
            await connection.query(
              "INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, options_cents, options, quantity) VALUES ?",
              [rows],
            );
            await connection.commit();
            return code;
          } catch (error) {
            await connection.rollback();
            if (error.code === "ER_DUP_ENTRY" && /uq_orders_code|'code'/.test(error.message)) continue;
            throw error;
          }
        }
        throw new Error("Impossible de générer un numéro de commande unique.");
      } finally {
        connection.release();
      }
    },

    async getOrdersByCodes(codes) {
      const [rows] = await pool.query(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.code IN (?)`, [codes]);
      return withItems(rows);
    },

    async listOrders() {
      const [rows] = await pool.query(`SELECT ${ORDER_COLUMNS} FROM orders o ORDER BY o.created_at DESC, o.id DESC LIMIT 500`);
      return withItems(rows);
    },

    async updateOrderStatus(id, status) {
      const [result] = await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, Number(id)]);
      return result.affectedRows > 0;
    },

    /** Empreinte de l'état des commandes : change dès qu'une commande arrive ou change de statut. */
    async ordersStamp() {
      const [[row]] = await pool.query("SELECT COUNT(*) AS total, COALESCE(UNIX_TIMESTAMP(MAX(updated_at)), 0) AS changed, COALESCE(MAX(id), 0) AS last_id FROM orders");
      return `${row.total}-${row.last_id}-${row.changed}`;
    },

    /* ---------- administrateurs ---------- */

    async getAdminByEmail(email) {
      const [[row]] = await pool.query("SELECT email, password_hash FROM admins WHERE email = ?", [email]);
      return row ? { email: row.email, passwordHash: row.password_hash } : null;
    },

    async saveAdmin(email, passwordHash) {
      await pool.query(
        "INSERT INTO admins (email, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)",
        [email, passwordHash],
      );
    },
  };
}
