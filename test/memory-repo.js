/**
 * Version en mémoire de l'accès aux données, pour tester le serveur sans MySQL.
 * Elle respecte exactement la même interface que server/repo-mysql.js.
 */
export function createMemoryRepo({ products = [], admins = [] } = {}) {
  let nextProductId = 1;
  let nextOrderId = 1;
  const state = { products: [], orders: [], admins: [...admins], changes: 0 };

  const seed = (p) => ({
    id: String(nextProductId++), name: p.name, category: p.category ?? "bouquets", priceCents: p.priceCents,
    description: p.description ?? "", imageUrl: p.imageUrl ?? "", active: p.active ?? true, createdAt: new Date().toISOString(),
  });
  state.products = products.map(seed);

  return {
    state,
    async ping() {},

    async listProducts({ includeHidden = false } = {}) {
      return state.products.filter((p) => includeHidden || p.active).map((p) => ({ ...p }));
    },
    async getProductsByIds(ids) {
      return state.products.filter((p) => ids.includes(p.id)).map((p) => ({ ...p }));
    },
    async createProduct(product) {
      const created = seed(product);
      state.products.push(created);
      return { ...created };
    },
    async updateProduct(id, product) {
      const index = state.products.findIndex((p) => p.id === id);
      if (index < 0) return null;
      state.products[index] = { ...state.products[index], ...product };
      return { ...state.products[index] };
    },
    async deleteProduct(id) {
      const before = state.products.length;
      state.products = state.products.filter((p) => p.id !== id);
      return state.products.length < before;
    },

    async createOrder(order, makeCode) {
      let code;
      do code = makeCode(); while (state.orders.some((o) => o.code === code));
      state.orders.push({
        id: String(nextOrderId++), code, status: "nouvelle", createdAt: new Date().toISOString(),
        items: order.items.map((i) => ({ ...i })), subtotalCents: order.subtotalCents,
        deliveryCents: order.deliveryCents, totalCents: order.totalCents,
        customer: { ...order.customer }, address: { ...order.address }, delivery: { ...order.delivery },
        cardMessage: order.cardMessage, notes: order.notes,
      });
      state.changes++;
      return code;
    },
    async getOrdersByCodes(codes) {
      return state.orders.filter((o) => codes.includes(o.code)).map((o) => structuredClone(o));
    },
    async listOrders() {
      return structuredClone([...state.orders].reverse());
    },
    async updateOrderStatus(id, status) {
      const order = state.orders.find((o) => o.id === id);
      if (!order) return false;
      order.status = status;
      state.changes++;
      return true;
    },
    async ordersStamp() {
      return `${state.orders.length}-${state.changes}`;
    },

    async getAdminByEmail(email) {
      return state.admins.find((a) => a.email === email) ?? null;
    },
    async saveAdmin(email, passwordHash) {
      state.admins = state.admins.filter((a) => a.email !== email).concat({ email, passwordHash });
    },
  };
}
