/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../../..");

// biome-ignore lint/style/noDefaultExport: Vite loads configuration through a default export.
export default defineConfig({
  root,
  build: {
    target: "node22",
    outDir: resolve(root, "dist-coop-local-workers"),
    emptyOutDir: true,
    minify: false,
    ssr: resolve(import.meta.dirname, "local-worker-server.ts"),
    rollupOptions: {
      output: { entryFileNames: "local-worker-server.mjs" },
    },
  },
});
