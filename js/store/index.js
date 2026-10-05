/**
 * Point d'entrée de la couche de données.
 * Les pages importent `store` sans savoir où sont rangées les données :
 * les deux implémentations exposent exactement les mêmes fonctions.
 *
 *   listProducts({ includeHidden })   → Produit[]
 *   saveProduct(produit)              → Produit
 *   deleteProduct(id)
 *   placeOrder(commande)              → { code }
 *   getOrdersByCodes(codes)           → Commande[] (suivi client)
 *   listOrders()                      → Commande[] (admin)
 *   updateOrderStatus(id, statut)
 *   subscribeToOrders(callback)       → fonction pour se désabonner
 *   auth.signIn(email, motDePasse) / auth.signOut() / auth.getUser()
 *
 * Deux implémentations, choisies par `mode` dans config.js :
 *   "api"   → api-store.js   (serveur Node.js + MySQL, pour la vraie boutique)
 *   "local" → local-store.js (démo dans le navigateur)
 */
import { CONFIG } from "../config.js";

async function createStore() {
  if (CONFIG.mode === "api") {
    const { createApiStore } = await import("./api-store.js");
    return createApiStore();
  }
  const { createLocalStore } = await import("./local-store.js");
  return createLocalStore();
}

export const store = await createStore();
