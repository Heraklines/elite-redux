import { loadAtomicReleaseCache } from "../adapters/release-cache";
import {
  type BrowserGenerationArtifactManifestV1,
  MAXIMUM_BROWSER_RELOAD_MANIFEST_BYTES_V1,
  validateBrowserGenerationIdentityV1,
} from "./contracts";

export interface VerifiedBrowserGenerationArtifactsV1 {
  manifest: BrowserGenerationArtifactManifestV1;
  workerUrl: URL;
}

export async function fetchBrowserGenerationManifestV1(
  url: URL,
  expectedSha256: string,
): Promise<BrowserGenerationArtifactManifestV1> {
  if (url.origin !== globalThis.location.origin || !/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error("generation manifest identity is invalid");
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`generation manifest fetch failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_BROWSER_RELOAD_MANIFEST_BYTES_V1) {
    throw new Error("generation manifest is empty or oversized");
  }
  if ((await sha256(bytes)) !== expectedSha256) {
    bytes.fill(0);
    throw new Error("generation manifest digest mismatch");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as BrowserGenerationArtifactManifestV1;
  } finally {
    bytes.fill(0);
  }
}

export async function loadBrowserGenerationArtifactsV1(
  storage: CacheStorage,
  manifest: BrowserGenerationArtifactManifestV1,
): Promise<VerifiedBrowserGenerationArtifactsV1> {
  validateBrowserGenerationIdentityV1(manifest.identity);
  if (manifest.schema_version !== 1) {
    throw new Error("generation artifact manifest schema is unsupported");
  }
  const workerUrl = sameOrigin(manifest.worker_url);
  const wasmUrl = sameOrigin(manifest.wasm_url);
  const contentUrl = sameOrigin(manifest.content_url);
  if (!wasmUrl.pathname.endsWith(".wasm") || !workerUrl.pathname.endsWith(".js")) {
    throw new Error("generation artifact extensions are invalid");
  }
  const release = await loadAtomicReleaseCache(storage, manifest.identity.release_id);
  if (release.manifest.rust_sha !== manifest.identity.source_git_sha) {
    throw new Error("generation source SHA differs from atomic release cache");
  }
  for (const [url, digest] of [
    [workerUrl.href, null],
    [wasmUrl.href, manifest.identity.wasm_sha256],
    [contentUrl.href, manifest.identity.content_sha256],
  ] as const) {
    const asset = release.manifest.assets.find(
      candidate => new URL(candidate.url, globalThis.location.origin).href === url,
    );
    if (asset == null || (digest != null && asset.sha256 !== digest)) {
      throw new Error("generation asset is absent from the atomic release cache");
    }
  }
  workerUrl.searchParams.set("wasm", wasmUrl.href);
  workerUrl.searchParams.set("content", contentUrl.href);
  workerUrl.searchParams.set("wasm_sha256", manifest.identity.wasm_sha256);
  workerUrl.searchParams.set("content_sha256", manifest.identity.content_sha256);
  workerUrl.searchParams.set("kernel_generation", String(manifest.identity.generation));
  return { manifest, workerUrl };
}

function sameOrigin(value: string): URL {
  const url = new URL(value, globalThis.location.origin);
  if (url.origin !== globalThis.location.origin) {
    throw new Error("generation asset must be same-origin");
  }
  return url;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
