import { useEffect, useState } from "react";

import { signAvatarUrl } from "./teamsData";

/**
 * A signed URL for one avatar, cached for the life of the process.
 *
 * The bucket is private, so every avatar on a leaderboard needs its own signed
 * URL, and a screen of twenty rows would otherwise fire twenty signing requests
 * on every refetch — including the ones a Realtime nudge triggers, which is the
 * case that makes it expensive rather than merely wasteful.
 *
 * So the cache is keyed by storage path and shared across every row and screen.
 * Entries expire a minute before the URL does, so a long session re-signs
 * rather than starts rendering broken images. The cache is a module-level Map
 * rather than React state on purpose: it has to survive the unmount of the
 * screen that filled it, because coming back to that screen is exactly when it
 * pays.
 */

const TTL_SECONDS = 3600;
const RENEW_MARGIN_MS = 60 * 1000;

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string | null>>();

function cached(path: string): string | null {
  const entry = cache.get(path);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt - RENEW_MARGIN_MS <= Date.now()) {
    cache.delete(path);
    return null;
  }

  return entry.url;
}

/** Exported for the sign-out path: a signed URL outlives the session otherwise. */
export function clearAvatarUrlCache(): void {
  cache.clear();
  inFlight.clear();
}

export async function resolveAvatarUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) {
    return null;
  }

  const hit = cached(path);

  if (hit) {
    return hit;
  }

  // Twenty rows sharing one avatar path — or one row rendered twice while a
  // refetch is in flight — make one request, not twenty.
  const pending = inFlight.get(path);

  if (pending) {
    return pending;
  }

  const request = signAvatarUrl(path, TTL_SECONDS)
    .then((url) => {
      if (url) {
        cache.set(path, { url, expiresAt: Date.now() + TTL_SECONDS * 1000 });
      }

      return url;
    })
    .finally(() => {
      inFlight.delete(path);
    });

  inFlight.set(path, request);

  return request;
}

export function useAvatarUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? cached(path) : null));

  useEffect(() => {
    let active = true;

    if (!path) {
      setUrl(null);
      return () => {
        active = false;
      };
    }

    const hit = cached(path);

    if (hit) {
      setUrl(hit);
      return () => {
        active = false;
      };
    }

    void resolveAvatarUrl(path).then((next) => {
      if (active) {
        setUrl(next);
      }
    });

    return () => {
      active = false;
    };
  }, [path]);

  return url;
}
