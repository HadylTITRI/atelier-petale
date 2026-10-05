/**
 * Limiteur de requêtes en mémoire : au plus `max` appels par `windowMs` et par clé (adresse IP).
 * Suffisant pour une boutique sur un seul serveur ; il se remet à zéro quand le serveur redémarre.
 */
export function createLimiter({ windowMs, max }) {
  const hits = new Map(); // clé → { count, resetAt }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, 60_000);
  cleanup.unref();

  return function check(key) {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= max, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  };
}
