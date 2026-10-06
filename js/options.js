/**
 * Options des bouquets (emballage cadeau, initiales, ruban…).
 * Elles sont gérées par l'administrateur, qui choisit pour chaque bouquet celles qu'il propose
 * (`product.optionIds`). Une option chargée depuis le serveur ressemble à :
 *   { id: "3", name: "Ruban satin", type: "choice", priceCents: 15000,
 *     choices: ["Rose poudré", "Blanc"], maxValue: 0, active: true, sortOrder: 40 }
 *
 * Quatre types, chacun avec ce que le client remplit :
 *   toggle   → case à cocher                       (valeur : true)
 *   text     → texte libre, `maxValue` caractères  (valeur : "AM")
 *   choice   → une valeur parmi `choices`          (valeur : "Blanc")
 *   quantity → nombre de 1 à `maxValue`, prix × nombre (valeur : 3)
 *
 * Une « sélection » brute est ce que le client a rempli : [{ id, value }].
 * `normalizeSelection` la vérifie contre les options du bouquet et la transforme en lignes sûres
 * { id, name, value, priceCents } : c'est ce résultat qui est enregistré dans la commande, jamais
 * le prix envoyé par le navigateur. Le serveur utilise ce même module avec les options lues en base.
 */

export const OPTION_TYPES = {
  toggle: "Case à cocher",
  text: "Texte à écrire",
  choice: "Choix dans une liste",
  quantity: "Quantité",
};

/** Valeur de `maxValue` quand l'admin n'en indique pas. */
export const DEFAULT_MAX = { text: 30, quantity: 10 };

export const MAX_OPTIONS_PER_ITEM = 30;

export const UNAVAILABLE_OPTION = "Une option choisie n'est plus disponible. Retirez-la et réessayez.";

/** Ordre d'affichage : `sortOrder` croissant, puis nom, puis identifiant. */
export function sortOptions(options) {
  return [...options].sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || String(a.name).localeCompare(String(b.name), "fr")
    || Number(a.id) - Number(b.id));
}

/** Options proposées pour un bouquet, parmi `options`, dans l'ordre d'affichage. */
export function optionsForProduct(product, options) {
  const ids = new Set((product?.optionIds ?? []).map(String));
  return sortOptions(options.filter((o) => ids.has(String(o.id))));
}

/** Nettoie un texte libre : espaces normalisés, caractères de contrôle retirés. */
const cleanText = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

const maxOf = (option) => option.maxValue || DEFAULT_MAX[option.type] || 0;

/**
 * Valeur et prix d'une option remplie par le client, ou null si elle est laissée vide
 * (case décochée, texte vide, « Sans », quantité 0). Lève une erreur si la valeur est invalide.
 */
function priceEntry(option, input) {
  const label = `« ${option.name} »`;
  switch (option.type ?? "toggle") {
    case "toggle":
      return input === false || input === "" || input === 0 || input === null ? null : { value: true, priceCents: option.priceCents };
    case "text": {
      const value = cleanText(input);
      if (!value) return null;
      if (value.length > maxOf(option)) throw new Error(`${label} : ${maxOf(option)} caractères maximum.`);
      return { value, priceCents: option.priceCents };
    }
    case "choice": {
      const value = cleanText(input);
      if (!value) return null;
      if (!(option.choices ?? []).includes(value)) throw new Error(`${label} : choix invalide.`);
      return { value, priceCents: option.priceCents };
    }
    case "quantity": {
      if (input === undefined || input === null || input === "" || Number(input) === 0) return null;
      const qty = Number(input);
      if (!Number.isInteger(qty) || qty < 1 || qty > maxOf(option)) throw new Error(`${label} : de 1 à ${maxOf(option)}.`);
      return { value: qty, priceCents: option.priceCents * qty };
    }
    default:
      throw new Error(UNAVAILABLE_OPTION);
  }
}

/**
 * Vérifie une sélection et la renvoie dans l'ordre d'affichage.
 * `available` = options proposées pour ce bouquet (seules les actives sont acceptées).
 * Lève une erreur si une option est inconnue, désactivée ou mal remplie. Une option vide est ignorée ;
 * une option envoyée deux fois garde sa dernière valeur.
 */
export function normalizeSelection(raw = [], available = []) {
  const entries = Array.isArray(raw) ? raw : [];
  if (entries.length > MAX_OPTIONS_PER_ITEM) throw new Error("Trop d'options choisies.");

  const byId = new Map(available.filter((o) => o.active !== false).map((o) => [String(o.id), o]));
  const values = new Map();
  for (const entry of entries) {
    const isEntry = entry !== null && typeof entry === "object";
    const id = String(isEntry ? entry.id ?? "" : entry ?? "");
    if (!byId.has(id)) throw new Error(UNAVAILABLE_OPTION);
    // Un identifiant seul (ancien panier) vaut « case cochée ».
    values.set(id, isEntry && "value" in entry ? entry.value : true);
  }

  const result = [];
  for (const option of sortOptions([...values.keys()].map((id) => byId.get(id)))) {
    const priced = priceEntry(option, values.get(String(option.id)));
    if (priced) result.push({ id: String(option.id), name: option.name, ...priced });
  }
  return result;
}

/**
 * Texte lisible d'une option enregistrée dans une commande :
 * « Emballage cadeau premium », « Initiales : AM », « Papillons artificiels × 3 ».
 * Les commandes plus anciennes utilisaient `label` au lieu de `name` : elles restent lisibles.
 */
export function describeOption(option) {
  const name = option.name ?? option.label ?? "";
  if (option.value === true || option.value === undefined) return name;
  if (typeof option.value === "number") return `${name} × ${option.value}`;
  return `${name} : ${option.value}`;
}

export const optionsTotalCents = (options = []) => options.reduce((sum, o) => sum + o.priceCents, 0);

/** Prix d'une unité (bouquet + options) pour une ligne de commande. */
export const lineUnitCents = (line) => line.priceCents + (line.optionsCents ?? 0);

/** Identifiant stable d'une configuration : mêmes options et mêmes valeurs = même ligne de panier. */
export function configKey(productId, options = []) {
  return [productId, ...options.map((o) => `${o.id}=${o.value}`)].join("|");
}
