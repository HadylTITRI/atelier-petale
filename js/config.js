/**
 * Configuration de la boutique.
 * C'est le seul fichier à modifier pour personnaliser le site.
 */
export const CONFIG = {
  shopName: "Nour Flower",

  /**
   * "api"   → vraie boutique : le site parle au serveur Node.js (dossier server/), qui utilise MySQL.
   * "local" → mode démo : les données restent dans le navigateur de chaque visiteur
   *           (pratique pour tester sans serveur, ne jamais utiliser en ligne).
   */
  mode: "api",

  /** Fuseau horaire de la boutique (sert à vérifier la date de livraison). */
  timezone: "Africa/Algiers",

  /** Monnaie : le dinar algérien. Les prix sont stockés en centimes (4500 DA = 450000). */
  currency: { label: "DA", fractionDigits: 0 },

  /** Frais de livraison en centimes (600 DA). */
  deliveryFeeCents: 60000,

  /** La boutique ne vend que des bouquets. */
  categories: {
    bouquets: "Bouquets",
  },

  /*
   * Les options des bouquets (emballage cadeau, ruban…) et leurs prix ne sont plus ici :
   * elles se gèrent dans l'espace admin, onglet « Options », et sont enregistrées en base.
   */

  deliverySlots: ["Matin (9h – 12h)", "Après-midi (14h – 18h)", "Soirée (18h – 20h)"],
};

/** Étapes d'une commande, dans l'ordre. */
export const STATUSES = [
  { id: "nouvelle", label: "Nouvelle" },
  { id: "preparation", label: "En préparation" },
  { id: "livraison", label: "En livraison" },
  { id: "livree", label: "Livrée" },
  { id: "annulee", label: "Annulée" },
];

/** Statuts qui demandent encore une action de l'atelier. */
export const ACTIVE_STATUSES = ["nouvelle", "preparation", "livraison"];
