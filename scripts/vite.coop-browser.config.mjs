/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../vite.config.ts";

// biome-ignore lint/style/noDefaultExport: Vite config discovery requires a default export.
export default defineConfig(async env => {
  const resolvedBase = typeof baseConfig === "function" ? await baseConfig(env) : baseConfig;
  return mergeConfig(resolvedBase, {
    build: {
      emptyOutDir: true,
      outDir: process.env.COOP_BROWSER_OUT_DIR ?? "dist-coop-browser",
      sourcemap: false,
    },
    plugins: [
      {
        name: "coop-browser-ci-entry",
        enforce: "pre",
        transformIndexHtml(html) {
          const replaced = html.replace("./src/main.ts", "./scripts/coop-browser-entry.ts");
          if (replaced === html) {
            throw new Error("co-op browser build could not replace the application entry");
          }
          return replaced;
        },
      },
    ],
  });
});
