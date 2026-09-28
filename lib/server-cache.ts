// Process-local, bounded metadata cache. Call only after authentication.
interface CacheEntry {
  expires: number;
  value?: unknown;
  pending?: Promise<unknown>;
  pendingStarted?: number;
}

const cache = new Map<string, CacheEntry>();

export function invalidateCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function cachedValue<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
  fallback?: T,
): Promise<T> {
  const current = cache.get(key);
  const now = Date.now();

  // Fresh cache hit
  if (current?.value !== undefined && current.expires > now) {
    return current.value as T;
  }

  // Stale cache hit: return stale value immediately and refresh in background
  if (current?.value !== undefined) {
    if (!current.pending || now - (current.pendingStarted || 0) > 12000) {
      current.pendingStarted = now;
      current.pending = load()
        .then((value) => {
          cache.set(key, { expires: Date.now() + ttl, value });
          return value;
        })
        .catch(() => current.value)
        .finally(() => {
          const entry = cache.get(key);
          if (entry) {
            entry.pending = undefined;
            entry.pendingStarted = undefined;
          }
        });
    }
    return current.value as T;
  }

  // If a pending load is still recent (< 12 seconds), join it
  if (current?.pending && now - (current.pendingStarted || 0) < 12000) {
    return current.pending as Promise<T>;
  }

  // Cold start: if fallback is provided, return fallback immediately and populate cache in background
  if (fallback !== undefined) {
    const pending = load()
      .then((value) => {
        cache.set(key, { expires: Date.now() + ttl, value });
        return value;
      })
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, { expires: 0, pending, value: fallback, pendingStarted: now });
    return fallback;
  }

  const pending = load()
    .then((value) => {
      cache.set(key, { expires: Date.now() + ttl, value });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: 0, pending, pendingStarted: now });
  return pending;
}
