/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// CI-only production-bundle entry. It boots the normal application first, then exposes the narrow transport
// seam used by the browser checkpoint. This file is included only by vite.coop-browser.config.mjs; no staged
// or production deployment imports it.
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
