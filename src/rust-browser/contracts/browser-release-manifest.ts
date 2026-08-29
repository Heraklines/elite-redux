import type { BrowserReleaseCacheManifestV1 } from "../adapters/release-cache";

export interface BrowserReleaseAssetIdentityV1 {
  bytes: number;
  sha256: string;
}

export interface BrowserKernelReleaseManifestV1 {
  schema_version: 1;
  release_id: string;
  candidate_sha: string;
  browser_source_sha: string;
  rust_source_sha: string;
  oracle_sha: string;
  worker_protocol: 1;
  authority_protocol: "er-coop-47";
  content_hash: string;
  assets: Record<string, BrowserReleaseAssetIdentityV1>;
  private_route: string;
  production_default: "LEGACY_TYPESCRIPT";
  deployment_authorized: false;
}

export function validateBrowserKernelReleaseManifest(
  manifest: BrowserKernelReleaseManifestV1,
): BrowserKernelReleaseManifestV1 {
  if (
    manifest.schema_version !== 1
    || !/^[a-zA-Z0-9._-]{1,128}$/u.test(manifest.release_id)
    || !/^[0-9a-f]{40}$/u.test(manifest.candidate_sha)
    || !/^[0-9a-f]{40}$/u.test(manifest.browser_source_sha)
    || !/^[0-9a-f]{40}$/u.test(manifest.rust_source_sha)
    || !/^[0-9a-f]{40}$/u.test(manifest.oracle_sha)
    || manifest.worker_protocol !== 1
    || manifest.authority_protocol !== "er-coop-47"
    || manifest.content_hash.length === 0
    || !manifest.private_route.startsWith("/private/")
    || manifest.production_default !== "LEGACY_TYPESCRIPT"
    || manifest.deployment_authorized !== false
  ) {
    throw new Error("browser kernel release identity is invalid");
  }
  const entries = Object.entries(manifest.assets);
  if (
    entries.length === 0
    || entries.length > 64
    || entries.some(
      ([name, asset]) =>
        !/^[a-zA-Z0-9._-]{1,128}$/u.test(name)
        || !Number.isSafeInteger(asset.bytes)
        || asset.bytes <= 0
        || !/^[0-9a-f]{64}$/u.test(asset.sha256),
    )
  ) {
    throw new Error("browser kernel release assets are invalid");
  }
  return manifest;
}

export function releaseCacheManifest(
  manifest: BrowserKernelReleaseManifestV1,
  assetBaseUrl: URL,
): BrowserReleaseCacheManifestV1 {
  validateBrowserKernelReleaseManifest(manifest);
  return {
    schema_version: 1,
    release_id: manifest.release_id,
    browser_sha: manifest.browser_source_sha,
    rust_sha: manifest.rust_source_sha,
    assets: Object.entries(manifest.assets).map(([name, asset]) => ({
      url: new URL(name, assetBaseUrl).href,
      sha256: asset.sha256,
    })),
  };
}
