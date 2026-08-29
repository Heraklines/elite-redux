import { BrowserExecutionModeV1 } from "../contracts/browser-contracts";
import {
  type BrowserKernelReleaseManifestV1,
  validateBrowserKernelReleaseManifest,
} from "../contracts/browser-release-manifest";
import {
  type RustPhaserRouteOptionsV1,
  type RustPhaserRouteSessionV1,
  startRustPhaserRoute,
} from "./rust-phaser-entry";

export interface RustStagingRouteOptionsV1 extends Omit<RustPhaserRouteOptionsV1, "mode"> {
  manifest: BrowserKernelReleaseManifestV1;
  location: Location;
  authorize(): Promise<boolean>;
}

export async function startPrivateRustStagingRoute(
  options: RustStagingRouteOptionsV1,
): Promise<RustPhaserRouteSessionV1> {
  const manifest = validateBrowserKernelReleaseManifest(options.manifest);
  if (
    options.location.pathname !== manifest.private_route
    || manifest.production_default !== "LEGACY_TYPESCRIPT"
    || manifest.deployment_authorized !== false
  ) {
    throw new Error("Rust staging route release or path is not authorized");
  }
  if (!(await options.authorize())) {
    throw new Error("Rust staging route authorization failed");
  }
  return startRustPhaserRoute({
    workerUrl: options.workerUrl,
    executionIdentityBytes: options.executionIdentityBytes,
    sessionStartBytes: options.sessionStartBytes,
    scene: options.scene,
    mode: BrowserExecutionModeV1.RUST_STAGING_AUTHORITY,
  });
}
