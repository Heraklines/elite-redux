import type { ArtifactIdentityV1, ProductionReleaseManifestV2 } from "./contracts";
import { M9_RELEASE_OBJECT_ORIGIN_V1 } from "./preview-account";
import { validateProductionReleaseManifestV2 } from "./release-manifest";

const REGISTRY_CACHE = "er-m9-release-registry-v2";
const REGISTRY_URL = new URL("/__er_m9_release_registry_v2__", globalThis.location?.origin ?? "https://invalid.local")
  .href;
const RELEASE_PREFIX = "er-m9-release-v2-";
const MAXIMUM_RETAINED_COMPLETE_RELEASES = 3;

interface CachedReleaseRegistryV2 {
  schema_version: 2;
  releases: Record<string, { pins: string[]; release_epoch: number; last_used: number }>;
}

export interface CompleteProductionReleaseV2 {
  manifest: ProductionReleaseManifestV2;
  cache: Cache;
}

export async function installCompleteProductionReleaseV2(
  storage: CacheStorage,
  manifest: ProductionReleaseManifestV2,
): Promise<CompleteProductionReleaseV2> {
  validateProductionReleaseManifestV2(manifest);
  const cacheName = `${RELEASE_PREFIX}${manifest.release_id}`;
  await storage.delete(cacheName);
  const cache = await storage.open(cacheName);
  try {
    const verifiedArtifacts = await settleAllOrThrow(
      Object.values(manifest.artifacts).map(async artifact => {
        const url = releaseObjectUrl(artifact.url);
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
        return { url, response: await verifyArtifactResponseV1(response, artifact) };
      }),
    );
    await settleAllOrThrow(verifiedArtifacts.map(artifact => cache.put(artifact.url, artifact.response)));
    await verifyCompleteProductionReleaseV2(cache, manifest);
    await recordRelease(storage, manifest);
    await evictUnpinnedReleasesV2(storage, manifest.release_id);
    return { manifest, cache };
  } catch (error) {
    await storage.delete(cacheName);
    throw error;
  }
}

export async function loadCompleteProductionReleaseV2(
  storage: CacheStorage,
  manifest: ProductionReleaseManifestV2,
): Promise<CompleteProductionReleaseV2> {
  validateProductionReleaseManifestV2(manifest);
  const registry = await readRegistry(storage);
  if (registry.releases[manifest.release_id] == null) {
    throw new Error("production release is absent from the verified registry");
  }
  const cache = await storage.open(`${RELEASE_PREFIX}${manifest.release_id}`);
  await verifyCompleteProductionReleaseV2(cache, manifest);
  registry.releases[manifest.release_id].last_used = Date.now();
  await writeRegistry(storage, registry);
  return { manifest, cache };
}

export async function materializeVerifiedArtifactUrlV1(
  release: CompleteProductionReleaseV2,
  artifact: ArtifactIdentityV1,
): Promise<{ url: string; revoke(): void }> {
  const bytes = await readVerifiedArtifactBytesV1(release, artifact);
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: artifact.media_type }));
  bytes.fill(0);
  let revoked = false;
  return {
    url,
    revoke() {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(url);
      }
    },
  };
}

export async function readVerifiedArtifactBytesV1(
  release: CompleteProductionReleaseV2,
  artifact: ArtifactIdentityV1,
): Promise<Uint8Array> {
  const response = await release.cache.match(releaseObjectUrl(artifact.url));
  if (response == null) {
    throw new Error("verified production artifact is absent");
  }
  const verified = await verifyArtifactResponseV1(response, artifact);
  return new Uint8Array(await verified.arrayBuffer());
}

export async function retainProductionReleasePinV2(
  storage: CacheStorage,
  releaseId: string,
  pinId: string,
): Promise<void> {
  const registry = await readRegistry(storage);
  const release = registry.releases[releaseId];
  if (release == null || pinId.length === 0 || release.pins.length >= 64) {
    throw new Error("production release pin cannot be retained");
  }
  if (!release.pins.includes(pinId)) {
    release.pins.push(pinId);
    release.pins.sort();
  }
  release.last_used = Date.now();
  await writeRegistry(storage, registry);
}

export async function releaseProductionReleasePinV2(
  storage: CacheStorage,
  releaseId: string,
  pinId: string,
): Promise<void> {
  const registry = await readRegistry(storage);
  const release = registry.releases[releaseId];
  const index = release?.pins.indexOf(pinId) ?? -1;
  if (release == null || index < 0) {
    throw new Error("production release pin underflow");
  }
  release.pins.splice(index, 1);
  release.last_used = Date.now();
  await writeRegistry(storage, registry);
}

export async function matchVerifiedProductionAssetV2(
  storage: CacheStorage,
  request: Request,
): Promise<Response | null> {
  const registry = await readRegistry(storage);
  const releases = Object.entries(registry.releases).sort(
    ([, left], [, right]) => right.release_epoch - left.release_epoch,
  );
  for (const [releaseId] of releases) {
    const cache = await storage.open(`${RELEASE_PREFIX}${releaseId}`);
    const response = await cache.match(releaseObjectUrl(new URL(request.url).pathname), {
      ignoreSearch: false,
      ignoreMethod: false,
      ignoreVary: false,
    });
    if (response != null) {
      return response;
    }
  }
  return null;
}

async function verifyCompleteProductionReleaseV2(cache: Cache, manifest: ProductionReleaseManifestV2): Promise<void> {
  await settleAllOrThrow(
    Object.values(manifest.artifacts).map(async artifact => {
      const response = await cache.match(releaseObjectUrl(artifact.url));
      if (response == null) {
        throw new Error("production release cache is incomplete");
      }
      await verifyArtifactResponseV1(response, artifact);
    }),
  );
}

async function settleAllOrThrow<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure != null) {
    throw failure.reason;
  }
  return settled.map(result => (result as PromiseFulfilledResult<T>).value);
}

async function verifyArtifactResponseV1(response: Response, artifact: ArtifactIdentityV1): Promise<Response> {
  const expectedUrl = releaseObjectUrl(artifact.url);
  const responseIdentity = response.url || response.headers.get("x-er-source-url") || "";
  if (!response.ok || response.redirected || responseIdentity !== expectedUrl) {
    throw new Error("production artifact response identity is invalid");
  }
  const declared = Number(response.headers.get("content-length") ?? artifact.bytes);
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (declared !== artifact.bytes || mediaType !== artifact.media_type) {
    throw new Error("production artifact length or media type differs from manifest");
  }
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  let verifiedBytes: Uint8Array;
  try {
    if (bytes.byteLength !== artifact.bytes || (await sha256(bytes)) !== artifact.sha256) {
      throw new Error("production artifact bytes differ from manifest");
    }
    verifiedBytes = Uint8Array.from(bytes);
  } finally {
    bytes.fill(0);
  }
  const responseBody = new ArrayBuffer(verifiedBytes.byteLength);
  new Uint8Array(responseBody).set(verifiedBytes);
  verifiedBytes.fill(0);
  return new Response(responseBody, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(artifact.bytes),
      "content-type": artifact.media_type,
      "x-er-source-url": expectedUrl,
    },
  });
}
function releaseObjectUrl(path: string): string {
  if (!/^\/__m9_releases\/[a-zA-Z0-9._:/-]+$/u.test(path)) {
    throw new Error("production artifact path is outside the release-object namespace");
  }
  return new URL(path, M9_RELEASE_OBJECT_ORIGIN_V1).href;
}

async function recordRelease(storage: CacheStorage, manifest: ProductionReleaseManifestV2): Promise<void> {
  const registry = await readRegistry(storage);
  registry.releases[manifest.release_id] ??= {
    pins: [],
    release_epoch: manifest.release_epoch,
    last_used: Date.now(),
  };
  await writeRegistry(storage, registry);
}

async function evictUnpinnedReleasesV2(storage: CacheStorage, activeRelease: string): Promise<void> {
  const registry = await readRegistry(storage);
  const candidates = Object.entries(registry.releases)
    .filter(([releaseId, value]) => releaseId !== activeRelease && value.pins.length === 0)
    .sort(([, left], [, right]) => left.last_used - right.last_used);
  while (Object.keys(registry.releases).length > MAXIMUM_RETAINED_COMPLETE_RELEASES) {
    const candidate = candidates.shift();
    if (candidate == null) {
      break;
    }
    const [releaseId] = candidate;
    await storage.delete(`${RELEASE_PREFIX}${releaseId}`);
    delete registry.releases[releaseId];
  }
  await writeRegistry(storage, registry);
}

async function readRegistry(storage: CacheStorage): Promise<CachedReleaseRegistryV2> {
  const cache = await storage.open(REGISTRY_CACHE);
  const response = await cache.match(REGISTRY_URL);
  if (response == null) {
    return { schema_version: 2, releases: {} };
  }
  const value = (await response.json()) as CachedReleaseRegistryV2;
  if (value.schema_version !== 2 || typeof value.releases !== "object" || value.releases == null) {
    throw new Error("production release registry is invalid");
  }
  return value;
}

async function writeRegistry(storage: CacheStorage, registry: CachedReleaseRegistryV2): Promise<void> {
  const cache = await storage.open(REGISTRY_CACHE);
  await cache.put(
    REGISTRY_URL,
    new Response(JSON.stringify(registry), { headers: { "content-type": "application/json" } }),
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
