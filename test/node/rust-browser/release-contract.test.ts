import { describe, expect, it } from "vitest";
import {
  type BrowserKernelReleaseManifestV1,
  releaseCacheManifest,
  validateBrowserKernelReleaseManifest,
} from "../../../src/rust-browser/contracts/browser-release-manifest";
import { startPrivateRustStagingRoute } from "../../../src/rust-browser/routes/rust-staging-entry";

const manifest: BrowserKernelReleaseManifestV1 = {
  schema_version: 1,
  release_id: "m8-candidate",
  candidate_sha: "a".repeat(40),
  browser_source_sha: "b2ed1a6eb050a18d5f335ec826e01b7b425ce311",
  rust_source_sha: "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273",
  oracle_sha: "b2ed1a6eb050a18d5f335ec826e01b7b425ce311",
  worker_protocol: 1,
  authority_protocol: "er-coop-47",
  content_hash: "content-v1",
  assets: { "er_web.wasm": { bytes: 10, sha256: "c".repeat(64) } },
  private_route: "/private/rust-m8",
  production_default: "LEGACY_TYPESCRIPT",
  deployment_authorized: false,
};

describe("M8 browser release contract", () => {
  it("validates an immutable default-off release and derives its cache identity", () => {
    expect(validateBrowserKernelReleaseManifest(manifest)).toBe(manifest);
    expect(releaseCacheManifest(manifest, new URL("https://example.invalid/assets/"))).toEqual({
      schema_version: 1,
      release_id: "m8-candidate",
      browser_sha: manifest.browser_source_sha,
      rust_sha: manifest.rust_source_sha,
      assets: [{ url: "https://example.invalid/assets/er_web.wasm", sha256: "c".repeat(64) }],
    });
  });

  it("fails authorization before creating any staging kernel owner", async () => {
    let authorizationCalls = 0;
    await expect(
      startPrivateRustStagingRoute({
        manifest,
        location: { pathname: manifest.private_route } as Location,
        authorize: async () => {
          authorizationCalls += 1;
          return false;
        },
        workerUrl: new URL("https://example.invalid/worker.js"),
        executionIdentityBytes: Uint8Array.from([1]),
        sessionStartBytes: Uint8Array.from([2]),
        scene: {} as never,
      }),
    ).rejects.toThrow(/authorization failed/u);
    expect(authorizationCalls).toBe(1);
  });

  it("rejects production and mismatched private paths before authorization", async () => {
    let called = false;
    await expect(
      startPrivateRustStagingRoute({
        manifest,
        location: { pathname: "/" } as Location,
        authorize: async () => {
          called = true;
          return true;
        },
        workerUrl: new URL("https://example.invalid/worker.js"),
        executionIdentityBytes: Uint8Array.from([1]),
        sessionStartBytes: Uint8Array.from([2]),
        scene: {} as never,
      }),
    ).rejects.toThrow(/not authorized/u);
    expect(called).toBe(false);
  });
});
