/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Self-healing service worker (#218 cache fix).
//
// An earlier broken deploy poisoned the service worker cache with index.html
// ("<!-- SPDX") responses for asset URLs, so returning players could keep
// getting broken sprites even though the server is fixed.
//
// This worker installs in place of the bad one, deletes every cache, and then
// serves nothing from cache. With no fetch handler, every request goes straight
// to the network and through the jsDelivr redirects. Each stuck player auto-heals
// on their next visit without manually clearing site data.

self.addEventListener("install", () => {
  // Take over immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      // Purge all previously-cached poisoned responses.
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
      // Control already-open pages so the bad worker stops serving stale content.
      await self.clients.claim();
    })(),
  );
});

// Intentionally no fetch handler: this worker never serves from cache.
