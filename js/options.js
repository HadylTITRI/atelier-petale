/**
 * Options des bouquets (emballage cadeau, ruban…), communes à tous les produits.
 * Elles sont gérées par l'administrateur et chargées depuis le serveur :
 *   { id: "3", name: "Emballage cadeau premium", priceCents: 40000, active: true, sortOrder: 50 }
 *
 * Une « sélection » brute est la liste des options cochées par le client : [{ id }].
 * `normalizeSelection` la vérifie contre la liste des options disponibles et la transforme
 * en lignes sûres { id, name, priceCents } : c'est ce résultat qui est enregistré dans la
 * commande, jamais le prix envoyé par le navigateur. Le serveur utilise ce même module
 * avec les options lues en base.
 */

export const MAX_OPTIONS_PER_ITEM = 30;

export const UNAVAILABLE_OPTION = "Une option choisie n'est plus disponible. Retirez-la et réessayez.";

/** Ordre d'affichage : `sortOrder` croissant, puis nom, puis identifiant. */
export function sortOptions(options) {
  return [...options].sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || String(a.name).localeCompare(String(b.name), "fr")
    || Number(a.id) - Number(b.id));
}

/**
 * Vérifie une sélection et la renvoie dans l'ordre d'affichage.
 * `available` = options proposées (seules les actives sont acceptées).
 * Lève une erreur si une option est inconnue ou désactivée. Une option choisie deux fois compte une fois.
 */
export function normalizeSelection(raw = [], available = []) {
  const entries = Array.isArray(raw) ? raw : [];
  if (entries.length > MAX_OPTIONS_PER_ITEM) throw new Error("Trop d'options choisies.");

  const byId = new Map(available.filter((o) => o.active !== false).map((o) => [String(o.id), o]));
  const chosen = new Set();
  for (const entry of entries) {
    const id = String(entry !== null && typeof entry === "object" ? entry.id ?? "" : entry ?? "");
    if (!byId.has(id)) throw new Error(UNAVAILABLE_OPTION);
    chosen.add(id);
  }

  return sortOptions([...chosen].map((id) => byId.get(id)))
    .map((o) => ({ id: String(o.id), name: o.name, priceCents: o.priceCents }));
}

/**
 * Texte lisible d'une option enregistrée dans une commande.
 * Les commandes passées avant la gestion des options par l'admin utilisaient
 * { label, value } (« Initiales : AM », « Papillons artificiels × 3 ») : elles restent lisibles.
 */
export function describeOption(option) {
  if (option.name) return option.name;
  if (option.value === true || option.value === undefined) return option.label ?? "";
  if (typeof option.value === "number") return `${option.label} × ${option.value}`;
  return `${option.label} : ${option.value}`;
}

export const optionsTotalCents = (options = []) => options.reduce((sum, o) => sum + o.priceCents, 0);

/** Prix d'une unité (bouquet + options) pour une ligne de commande. */
export const lineUnitCents = (line) => line.priceCents + (line.optionsCents ?? 0);

/** Identifiant stable d'une configuration : mêmes options = même ligne de panier. */
export function configKey(productId, options = []) {
  return [productId, ...options.map((o) => o.id)].join("|");
}
