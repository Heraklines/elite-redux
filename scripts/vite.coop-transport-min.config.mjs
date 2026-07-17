/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Optimization brief R6 tier-1: build ONLY the minimal transport entry (the production
// connector factory) - no game entry, no asset graph, no Phaser. Seconds instead of the
// multi-minute full-app build. Env handling mirrors the full config so VITE_COOP_SERVER_URL
// resolves identically.

import { resolve } from "node:path";
import { defineConfig } from "vite";

// biome-ignore lint/style/noDefaultExport: required for vite
export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  resolve: { tsconfigPaths: true },
  build: {
    outDir: process.env.COOP_TRANSPORT_MIN_OUT_DIR ?? "dist-coop-transport-min",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
    lib: false,
    rollupOptions: {
      input: { "transport-min": resolve(import.meta.dirname, "coop-transport-min.html") },
    },
  },
});
