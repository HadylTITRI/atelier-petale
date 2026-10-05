/**
 * Configuration de la boutique.
 * C'est le seul fichier à modifier pour personnaliser le site.
 */
export const CONFIG = {
  shopName: "Atelier Pétale",

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

  /**
   * Options que le client peut ajouter à chaque bouquet.
   * Les prix sont en centimes : ajustez-les librement.
   *
   *   type "text"     → champ libre (initiales, prénom…), payant s'il est rempli
   *   type "quantity" → nombre d'unités, prix = unitPriceCents × quantité
   *   type "choice"   → une valeur à choisir dans `choices`
   *   type "toggle"   → case à cocher
   */
  bouquetOptions: [
    { id: "initiales", label: "Initiales", type: "text", maxLength: 3, uppercase: true,
      placeholder: "ex. AM", help: "1 à 3 lettres, posées sur le bouquet.", priceCents: 30000 },
    { id: "prenom", label: "Prénom ou nom", type: "text", maxLength: 20,
      placeholder: "ex. Camille", help: "Écrit sur un ruban ou un petit écriteau.", priceCents: 50000 },
    { id: "papillons", label: "Papillons artificiels", type: "quantity", max: 12, unitPriceCents: 10000,
      help: "Piqués dans le bouquet." },
    { id: "ruban", label: "Ruban satin", type: "choice", priceCents: 15000,
      choices: ["Rose poudré", "Blanc", "Doré", "Rouge", "Noir"] },
    { id: "emballage", label: "Emballage cadeau premium", type: "toggle", priceCents: 40000,
      help: "Papier soie et boîte ou sac rigide." },
  ],

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
