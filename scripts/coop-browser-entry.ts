/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// CI-only production-bundle entry. It boots the normal application first, then exposes the narrow transport
// seam used by the browser checkpoint. This file is included only by vite.coop-browser.config.mjs; no staged
// or production deployment imports it.

// build-only syntax fix, superseded by campaign v2 observer on merge: the file uses top-level `await` but had
// only dynamic `import()` expressions (no static import/export), so TS treats it as a script and rejects the
// top-level await (TS1375), which fails the vite:build-html entry replacement. `export {}` makes it a module.
// Module-shape only; observer semantics are untouched and owned by the campaign branch.
export {};

await import("../src/main");

const [{ globalScene }, { connectCoopWithCode }] = await Promise.all([
  import("../src/global-scene"),
  import("../src/data/elite-redux/coop/coop-webrtc-connect"),
]);

Object.defineProperty(globalThis, "__coopBrowserBridge", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    ready: () => globalScene?.gameData != null,
    connect: connectCoopWithCode,
  }),
});
