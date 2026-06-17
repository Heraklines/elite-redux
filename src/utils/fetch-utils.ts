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

export async function cachedFetch(url: string, init?: RequestInit): Promise<Response> {
  const cachedUrl = getCachedUrl(url);
  try {
    return await fetch(cachedUrl, init);
  } catch (_err) {
    // The request REJECTED (network / CORS error). The dominant cause is a
    // POISONED BROWSER CACHE: a transient CDN failure gets cached under
    // jsDelivr's 7-day TTL, after which the browser keeps failing the CORS check
    // on cache HITS even though the server now serves the file correctly. Retry
    // ONCE, bypassing the cache entirely - a unique cache-buster forces a fresh
    // URL and `cache: "reload"` skips the HTTP cache. If the retry also rejects
    // (a genuine outage), the rejection propagates to the caller's own handler.
    const sep = cachedUrl.includes("?") ? "&" : "?";
    const bustUrl = `${cachedUrl}${sep}cb=${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    return fetch(bustUrl, { ...init, cache: "reload" });
  }
}
