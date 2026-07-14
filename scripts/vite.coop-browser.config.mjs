/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../vite.config.ts";

// Structural entry-injection ported from the campaign config
// test/browser/coop-public-ui/vite.config.mjs (commit a366ed8a377f) so a future
// consolidation of the two configs is straightforward. Behavior is identical:
// exact-match fast path, structural fallback tolerant of attribute order/quoting/
// path prefix/query, fail closed only when no application entry exists.

// Fast-path exact match for this branch's `<script type="module" src="./src/main.ts">`.
const SOURCE_ENTRY = /(<script\b[^>]*\bsrc=["'])(?:\.\/|\/)?src\/main\.ts(["'][^>]*>)/iu;
// Keep the programmatic transport connector out of the human-fidelity bundle. This config is used only
// by the transport checkpoint; public-UI journeys inject the separate read-only observer entry through
// test/browser/coop-public-ui/vite.config.mjs.
const BROWSER_ENTRY = "./scripts/coop-browser-transport-entry.ts";
// Structural fallback so the build survives a different index.html (integration branch): any
// <script> whose src is a `src/` module AND either declares type="module" or looks like a
// `main.*` entry, regardless of attribute order, quote style, path prefix, or ?query/#hash.
const SRC_ATTR = /\bsrc=(["'])((?:\.\/|\/)?src\/[^"']+)\1/iu;
const MAIN_ENTRY_SRC = /\/main\.[jt]sx?(?:[?#][^"']*)?$/iu;

/** Swap the src of the application entry <script> for the coop CI entry. Returns null if none. */
function injectBrowserEntryStructural(html) {
  const scriptTag = /<script\b[^>]*>/giu;
  let match = scriptTag.exec(html);
  while (match !== null) {
    const tag = match[0];
    const srcMatch = SRC_ATTR.exec(tag);
    if (srcMatch != null) {
      const isModule = /\btype=["']module["']/iu.test(tag);
      const looksLikeEntry = MAIN_ENTRY_SRC.test(srcMatch[2]);
      if (isModule || looksLikeEntry) {
        const rewrittenTag = tag.replace(srcMatch[2], BROWSER_ENTRY);
        return html.slice(0, match.index) + rewrittenTag + html.slice(match.index + tag.length);
      }
    }
    match = scriptTag.exec(html);
  }
  return null;
}

// biome-ignore lint/style/noDefaultExport: Vite config discovery requires a default export.
export default defineConfig(async env => {
  const resolvedBase = typeof baseConfig === "function" ? await baseConfig(env) : baseConfig;
  let sourceEntryReplaced = false;
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
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            if (html.includes(BROWSER_ENTRY)) {
              sourceEntryReplaced = true;
              return html;
            }
            const exact = html.replace(SOURCE_ENTRY, `$1${BROWSER_ENTRY}$2`);
            if (exact !== html) {
              sourceEntryReplaced = true;
              return exact;
            }
            // Fall back to a structural match so a differently-shaped index.html still builds.
            const structural = injectBrowserEntryStructural(html);
            if (structural != null) {
              sourceEntryReplaced = true;
              return structural;
            }
            // Vite 8 can invoke HTML hooks again after it has emitted the hashed entry. The first pass is
            // load-bearing and must replace the normal app entry; later output passes are intentionally inert.
            if (sourceEntryReplaced) {
              return html;
            }
            // Fail closed ONLY when the coop entry genuinely cannot be injected (no app-entry script).
            throw new Error(
              'co-op browser build could not inject the coop entry: no application <script src="src/..."> found in index.html',
            );
          },
        },
      },
    ],
  });
});
