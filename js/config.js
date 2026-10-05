/**
 * Configuration de la boutique.
 * C'est le seul fichier à modifier pour personnaliser le site.
 */
export const CONFIG = {
  shopName: "Atelier Pétale",

  /**
   * "local"    → mode démo : les données restent dans le navigateur.
   *              Idéal pour tester, mais chaque visiteur a ses propres données.
   * "supabase" → vraie base de données en ligne (voir README.md).
   */
  mode: "local",

  supabase: {
    url: "",      // ex. "https://abcd1234.supabase.co"
    anonKey: "",  // clé publique "anon" (Project Settings → API)
  },

  /** Identifiants admin du mode démo uniquement (aucune sécurité réelle). */
  demoAdmin: { email: "admin@demo.fr", password: "admin123" },

  /** Frais de livraison en centimes. En mode Supabase, garder la même valeur que dans supabase/schema.sql. */
  deliveryFeeCents: 590,

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
      placeholder: "ex. AM", help: "1 à 3 lettres, posées sur le bouquet.", priceCents: 350 },
    { id: "prenom", label: "Prénom ou nom", type: "text", maxLength: 20,
      placeholder: "ex. Camille", help: "Écrit sur un ruban ou un petit écriteau.", priceCents: 590 },
    { id: "papillons", label: "Papillons artificiels", type: "quantity", max: 12, unitPriceCents: 150,
      help: "Piqués dans le bouquet." },
    { id: "ruban", label: "Ruban satin", type: "choice", priceCents: 200,
      choices: ["Rose poudré", "Blanc", "Doré", "Rouge", "Noir"] },
    { id: "emballage", label: "Emballage cadeau premium", type: "toggle", priceCents: 300,
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
