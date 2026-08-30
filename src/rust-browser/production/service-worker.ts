import { matchVerifiedProductionAssetV2 } from "./release-cache-v2";

interface ProductionServiceWorkerScopeV1 {
  location: WorkerLocation;
  caches: CacheStorage;
  clients: Clients;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

export function installProductionReleaseServiceWorkerV2(scope: ProductionServiceWorkerScopeV1): void {
  scope.addEventListener("install", event => {
    event.waitUntil(Promise.resolve());
  });
  scope.addEventListener("activate", event => {
    event.waitUntil(scope.clients.claim());
  });
  scope.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    if (
      request.method !== "GET"
      || url.origin !== scope.location.origin
      || !url.pathname.startsWith("/__m9_releases/")
    ) {
      return;
    }
    event.respondWith(
      matchVerifiedProductionAssetV2(scope.caches, request).then(
        response => response ?? unavailable(),
        () => unavailable(),
      ),
    );
  });
}

function unavailable(): Response {
  return new Response("Verified production release unavailable", {
    status: 503,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}

const workerScope = globalThis as unknown as Partial<ProductionServiceWorkerScopeV1>;
if (typeof workerScope.addEventListener === "function" && workerScope.caches != null && workerScope.clients != null) {
  installProductionReleaseServiceWorkerV2(workerScope as ProductionServiceWorkerScopeV1);
}
