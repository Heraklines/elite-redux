/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — build-id plugin (auto-reload on new version).
//
// The service worker is intentionally disabled (see index.html), so the app
// cannot rely on the SW update lifecycle to tell players a new build shipped.
// Instead we:
//
//   1. Stamp a unique BUILD ID into the JS bundle via `define` (`__BUILD_ID__`),
//      so the running page knows which build it is.
//   2. Emit a tiny `version.json` (`{ "build": "<id>" }`) into the output so a
//      lightweight runtime poller can fetch it (no-store) and compare. When it
//      differs from `__BUILD_ID__`, a new deploy is live -> the client reloads.
//
// version.json is intentionally minuscule (~40 bytes) so polling it costs
// essentially nothing — and it's served by Cloudflare Pages (static, unlimited
// on the free tier), NOT a Worker, so there is no quota impact.
//
// The id is generated once per Vite process (build invocation), so the bundle's
// baked-in `__BUILD_ID__` and the emitted version.json always agree.
// =============================================================================

import type { Plugin as VitePlugin } from "vite";

const NAME = "er-build-id";
const VERSION = "1.0.0";

/** A unique id for this build process. Stable for the lifetime of the Vite run. */
function generateBuildId(): string {
  // Date.now() is fine here: this runs in Node at build time, not in the app.
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Stamps a per-build id into the bundle (`__BUILD_ID__`) and emits `version.json`
 * so the runtime update-checker can detect when a newer build is deployed.
 */
export function buildIdPlugin(): VitePlugin {
  const buildId = generateBuildId();
  return {
    name: NAME,
    version: VERSION,
    // Define the compile-time constant for BOTH serve and build so the app code
    // always type-checks and resolves `__BUILD_ID__` to a real string.
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(buildId),
        },
      };
    },
    // Only emit the sidecar file for real builds (no output during `vite serve`).
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ build: buildId }),
      });
    },
  };
}
