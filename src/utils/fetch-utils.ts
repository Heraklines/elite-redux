import { globalManifest } from "#app/global-manifest";

export function getCachedUrl(url: string): string {
  const manifest = globalManifest;
  if (!manifest) {
    return url;
  }

  const normalizedUrl = `/${url.replace("./", "")}`;
  const timestamp = manifest[normalizedUrl];
  if (timestamp) {
    url += `?t=${timestamp}`;
  }
  return url;
}

/**
 * A hung asset fetch (the request stalls with NO response and NO error) must
 * never block the game: an awaited `cachedFetch` on the summon / animation path
 * would otherwise freeze the run forever. Each attempt is aborted after this, so
 * a stall is converted into a fast rejection that the retry + the caller's own
 * error handler can recover from gracefully.
 */
const FETCH_TIMEOUT_MS = 8000;

/** `fetch` that aborts (rejects) if it has not responded within `ms`. */
function fetchWithTimeout(url: string, init: RequestInit | undefined, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function cachedFetch(url: string, init?: RequestInit): Promise<Response> {
  const cachedUrl = getCachedUrl(url);
  try {
    return await fetchWithTimeout(cachedUrl, init, FETCH_TIMEOUT_MS);
  } catch (_err) {
    // The request REJECTED (network / CORS error) OR timed out (a stalled
    // request the timeout above aborted). The dominant rejection cause is a
    // POISONED BROWSER CACHE: a transient CDN failure gets cached under
    // jsDelivr's 7-day TTL, after which the browser keeps failing the CORS check
    // on cache HITS even though the server now serves the file correctly. Retry
    // ONCE, bypassing the cache entirely - a unique cache-buster forces a fresh
    // URL and `cache: "reload"` skips the HTTP cache. The retry is ALSO bounded by
    // the timeout, so a genuine outage rejects (instead of hanging) and the
    // rejection propagates to the caller's own handler.
    const sep = cachedUrl.includes("?") ? "&" : "?";
    const bustUrl = `${cachedUrl}${sep}cb=${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    return fetchWithTimeout(bustUrl, { ...init, cache: "reload" }, FETCH_TIMEOUT_MS);
  }
}
