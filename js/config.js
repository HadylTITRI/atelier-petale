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

  categories: {
    bouquets: "Bouquets",
    nails: "Nails",
    autres: "Cadeaux & autres",
  },

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
