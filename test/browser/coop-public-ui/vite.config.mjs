/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../../../vite.config.ts";

const SOURCE_ENTRY = /(<script\b[^>]*\bsrc=["'])(?:\.\/|\/)?src\/main\.ts(["'][^>]*>)/iu;
const BROWSER_ENTRY = "./scripts/coop-browser-entry.ts";

// biome-ignore lint/style/noDefaultExport: Vite config discovery requires a default export.
export default defineConfig(async env => {
  const resolvedBase = typeof baseConfig === "function" ? await baseConfig(env) : baseConfig;
  let sourceEntryReplaced = false;
  return mergeConfig(resolvedBase, {
    build: {
      emptyOutDir: true,
      outDir: process.env.COOP_BROWSER_OUT_DIR ?? "dist-coop-public-ui",
      sourcemap: false,
    },
    plugins: [
      {
        name: "coop-public-ui-ci-entry",
        enforce: "pre",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            if (html.includes(BROWSER_ENTRY)) {
              sourceEntryReplaced = true;
              return html;
            }
            const replaced = html.replace(SOURCE_ENTRY, `$1${BROWSER_ENTRY}$2`);
            if (replaced !== html) {
              sourceEntryReplaced = true;
              return replaced;
            }
            // Vite 8 can invoke HTML hooks again after it has emitted the hashed entry. The first pass is
            // load-bearing and must replace the normal app entry; later output passes are intentionally inert.
            if (sourceEntryReplaced) {
              return html;
            }
            throw new Error("public-UI browser build could not replace the normal application entry");
          },
        },
      },
    ],
  });
});
