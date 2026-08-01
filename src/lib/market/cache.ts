/**
 * Process-local TTL cache with single-flight de-duplication.
 *
 * Yahoo's public endpoints rate-limit aggressively, and a scan touches dozens
 * of symbols at once, so two things matter: never re-fetch a symbol that is
 * still fresh, and never let two concurrent callers fire the same request.
 *
 * State lives in the module, so it is per-server-instance. That is the right
 * scope for a single long-running Node server; on serverless each instance
 * warms its own copy, which is still a large win over no cache at all.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Returns the cached value for `key`, or computes and caches it. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = produce()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Returns a stale value for `key` regardless of expiry.
 *
 * Used as a fallback when the upstream is rate-limiting us: a slightly old
 * price beats an empty panel.
 */
export function stale<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

export function clearCache() {
  store.clear();
  inFlight.clear();
}
