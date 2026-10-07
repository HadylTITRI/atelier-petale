/**
 * Version en mémoire de l'accès aux données, pour tester le serveur sans MySQL.
 * Elle respecte exactement la même interface que server/repo-mysql.js.
 */
export function createMemoryRepo({ products = [], options = [], admins = [] } = {}) {
  let nextProductId = 1;
  let nextOptionId = 1;
  let nextOrderId = 1;
  let nextImageId = 1;
  const state = { products: [], options: [], orders: [], images: [], admins: [...admins], changes: 0 };

  const seed = (p) => ({
    id: String(nextProductId++), name: p.name, category: p.category ?? "bouquets", priceCents: p.priceCents,
    description: p.description ?? "", imageUrl: p.imageUrl ?? "", active: p.active ?? true, createdAt: new Date().toISOString(),
    optionIds: [...(p.optionIds ?? [])],
  });
  state.products = products.map(seed);

  const seedOption = (o) => ({
    id: String(nextOptionId++), name: o.name, type: o.type ?? "toggle", priceCents: o.priceCents,
    choices: [...(o.choices ?? [])], maxValue: o.maxValue ?? 0, active: o.active ?? true, sortOrder: o.sortOrder ?? 0,
  });
  const copyProduct = (p) => ({ ...p, optionIds: [...p.optionIds] });
  const copyOption = (o) => ({ ...o, choices: [...o.choices] });
  state.options = options.map(seedOption);
  // Même tri que repo-mysql.js : ORDER BY sort_order, name, id
  const byDisplayOrder = (a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || Number(a.id) - Number(b.id);

  return {
    state,
    async ping() {},

    async listProducts({ includeHidden = false } = {}) {
      return state.products.filter((p) => includeHidden || p.active).map(copyProduct);
    },
    async getProductsByIds(ids) {
      return state.products.filter((p) => ids.includes(p.id)).map(copyProduct);
    },
    async createProduct(product) {
      const created = seed(product);
      state.products.push(created);
      return copyProduct(created);
    },
    async updateProduct(id, product) {
      const index = state.products.findIndex((p) => p.id === id);
      if (index < 0) return null;
      state.products[index] = { ...state.products[index], ...product, optionIds: [...product.optionIds] };
      return copyProduct(state.products[index]);
    },
    async deleteProduct(id) {
      const before = state.products.length;
      state.products = state.products.filter((p) => p.id !== id);
      return state.products.length < before;
    },

    async listOptions({ includeHidden = false } = {}) {
      return state.options.filter((o) => includeHidden || o.active).sort(byDisplayOrder).map(copyOption);
    },
    async getOptionsByIds(ids) {
      return state.options.filter((o) => ids.includes(o.id)).map(copyOption);
    },
    async createOption({ addToAllProducts, ...option }) {
      const created = seedOption(option);
      state.options.push(created);
      if (addToAllProducts) state.products.forEach((p) => p.optionIds.push(created.id));
      return copyOption(created);
    },
    async updateOption(id, { addToAllProducts, ...option }) {
      const index = state.options.findIndex((o) => o.id === id);
      if (index < 0) return null;
      state.options[index] = { ...state.options[index], ...option, choices: [...option.choices] };
      return copyOption(state.options[index]);
    },
    async setOptionActive(id, active) {
      const option = state.options.find((o) => o.id === id);
      if (!option) return null;
      option.active = active;
      return copyOption(option);
    },
    async deleteOption(id) {
      const before = state.options.length;
      state.options = state.options.filter((o) => o.id !== id);
      // Comme ON DELETE CASCADE sur product_options.
      state.products.forEach((p) => (p.optionIds = p.optionIds.filter((optionId) => optionId !== id)));
      return state.options.length < before;
    },

    async createImage(contentType, data) {
      const image = { id: String(nextImageId++), contentType, data: Buffer.from(data), createdAt: Date.now() };
      state.images.push(image);
      return image.id;
    },
    async getImage(id) {
      const image = state.images.find((i) => i.id === id);
      return image ? { contentType: image.contentType, data: image.data } : null;
    },
    async deleteUnusedImages() {
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      state.images = state.images.filter((i) => i.createdAt >= dayAgo || state.products.some((p) => p.imageUrl === `/images/${i.id}`));
    },

    async createOrder(order, makeCode) {
      let code;
      do code = makeCode(); while (state.orders.some((o) => o.code === code));
      state.orders.push({
        id: String(nextOrderId++), code, status: "nouvelle", createdAt: new Date().toISOString(),
        items: structuredClone(order.items), subtotalCents: order.subtotalCents,
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
