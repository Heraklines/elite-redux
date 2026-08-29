export interface BrowserReleaseAssetV1 {
  url: string;
  sha256: string;
}

export interface BrowserReleaseCacheManifestV1 {
  schema_version: 1;
  release_id: string;
  browser_sha: string;
  rust_sha: string;
  assets: BrowserReleaseAssetV1[];
}

const POINTER_CACHE = "er-rust-release-pointer-v1";
const POINTER_URL = new URL("/__er_rust_release_pointer__", globalThis.location?.origin ?? "https://invalid.local")
  .href;
const MAXIMUM_RELEASE_ASSET_BYTES = 33_554_432;

export async function installAtomicReleaseCache(
  storage: CacheStorage,
  manifest: BrowserReleaseCacheManifestV1,
): Promise<void> {
  validateManifest(manifest);
  const cacheName = `er-rust-release-${manifest.release_id}`;
  const cache = await storage.open(cacheName);
  try {
    for (const asset of manifest.assets) {
      const request = new Request(asset.url, { cache: "no-store", credentials: "same-origin" });
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`release asset fetch failed: ${response.status}`);
      }
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (
        bytes.byteLength === 0
        || bytes.byteLength > MAXIMUM_RELEASE_ASSET_BYTES
        || (await sha256(bytes)) !== asset.sha256
      ) {
        throw new Error("release asset size or digest mismatch");
      }
      await cache.put(request, response);
    }
    const pointer = await storage.open(POINTER_CACHE);
    await pointer.put(
      POINTER_URL,
      new Response(JSON.stringify(manifest), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
  } catch (error) {
    await storage.delete(cacheName);
    throw error;
  }
}

export async function loadAtomicReleaseCache(
  storage: CacheStorage,
  expectedReleaseId: string,
): Promise<{ manifest: BrowserReleaseCacheManifestV1; cache: Cache }> {
  const pointer = await storage.open(POINTER_CACHE);
  const response = await pointer.match(POINTER_URL);
  if (response == null) {
    throw new Error("Rust release cache pointer is absent");
  }
  const manifest = (await response.json()) as BrowserReleaseCacheManifestV1;
  validateManifest(manifest);
  if (manifest.release_id !== expectedReleaseId) {
    throw new Error("mixed Rust browser release cache is forbidden");
  }
  const cache = await storage.open(`er-rust-release-${manifest.release_id}`);
  for (const asset of manifest.assets) {
    if ((await cache.match(asset.url)) == null) {
      throw new Error("Rust release cache is incomplete");
    }
  }
  return { manifest, cache };
}

export async function pruneInactiveReleaseCaches(storage: CacheStorage, activeReleaseId: string): Promise<void> {
  const active = `er-rust-release-${activeReleaseId}`;
  await Promise.all(
    (await storage.keys())
      .filter(name => name.startsWith("er-rust-release-") && name !== active)
      .map(name => storage.delete(name)),
  );
}

function validateManifest(manifest: BrowserReleaseCacheManifestV1): void {
  if (
    manifest.schema_version !== 1
    || !/^[a-zA-Z0-9._-]{1,128}$/u.test(manifest.release_id)
    || !/^[0-9a-f]{40}$/u.test(manifest.browser_sha)
    || !/^[0-9a-f]{40}$/u.test(manifest.rust_sha)
    || manifest.assets.length === 0
    || manifest.assets.length > 64
    || new Set(manifest.assets.map(asset => asset.url)).size !== manifest.assets.length
    || manifest.assets.some(asset => !/^[0-9a-f]{64}$/u.test(asset.sha256))
  ) {
    throw new Error("Rust browser release manifest is invalid");
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
