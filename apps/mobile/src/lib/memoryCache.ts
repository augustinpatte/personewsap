type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getCachedValue<T>(key: string): T | null {
  const entry = memoryCache.get(key);

  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setCachedValue<T>(
  key: string,
  value: T,
  ttlMs: number
): void {
  memoryCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value
  });
}

export function clearMemoryCache(prefix?: string): void {
  if (!prefix) {
    memoryCache.clear();
    return;
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}
