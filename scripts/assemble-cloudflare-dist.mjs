/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Cloudflare Pages dist assembly (#431 cache-bust hardening).
//
// Runs as part of `build:standalone` (after `vite build`, before the payload
// check) so STAGING (GitHub Actions) and PRODUCTION (Cloudflare git build)
// produce an IDENTICAL dist no matter which side forgets a copy step:
//
//   1. Copies deploy/cloudflare/{_redirects,_headers,service-worker.js} into
//      dist/ — the asset redirects, cache headers and the self-healing SW are
//      part of the BUILD, not a per-environment afterthought.
//   2. Strips *.map sourcemaps from dist (smaller payload, no source leak).
//   3. Writes an EMPTY dist/manifest.json. The legacy `?t=` asset-timestamp
//      cache-buster fetches /manifest.json at boot; nothing generated it, so
//      every player hit a 404 on every load. The layer is redundant in the
//      current architecture (HTML + all JSON are no-cache, the JS bundle is
//      content-hashed, the heavy assets are jsDelivr-immutable via _redirects)
//      — an empty manifest keeps getCachedUrl inert and kills the 404.
//   4. If ER_ASSETS_SHA is set (the staging workflow resolves the current
//      Heraklines/er-assets HEAD per deploy), rewrites every pinned
//      `er-assets@<sha>` ref in dist/_redirects to it. This is THE fix for the
//      recurring stale-asset class: the pin used to be bumped BY HAND, and a
//      forgotten bump meant players kept old art/audio (or 404s for brand-new
//      assets) until someone remembered. Production (no env) keeps the
//      committed pin — bump it with `node scripts/bump-er-assets-pin.mjs`
//      before a production release.
// =============================================================================

import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = "dist";
const CLOUDFLARE_DIR = join("deploy", "cloudflare");
const CLOUDFLARE_FILES = ["_redirects", "_headers", "service-worker.js"];
const SHA_RE = /er-assets@[0-9a-f]{40}/g;

async function removeSourcemaps(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await removeSourcemaps(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".map")) {
      await (await import("node:fs/promises")).unlink(fullPath);
      removed++;
    }
  }
  return removed;
}

// 1. Cloudflare config into dist.
for (const file of CLOUDFLARE_FILES) {
  await copyFile(join(CLOUDFLARE_DIR, file), join(DIST_DIR, file));
}
console.log(`Copied ${CLOUDFLARE_FILES.join(", ")} into ${DIST_DIR}/.`);

// 2. Strip sourcemaps.
const removed = await removeSourcemaps(DIST_DIR);
console.log(`Removed ${removed} sourcemap file(s).`);

// 3. Empty cache-buster manifest (see header).
await writeFile(join(DIST_DIR, "manifest.json"), '{"manifest":{}}\n');
console.log("Wrote empty manifest.json (legacy ?t= buster stays inert, no more boot 404).");

// 4. Per-deploy er-assets pin rewrite.
const sha = process.env.ER_ASSETS_SHA?.trim();
if (sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`ER_ASSETS_SHA is set but is not a 40-char lowercase hex sha: "${sha}"`);
  }
  const redirectsPath = join(DIST_DIR, "_redirects");
  const before = await readFile(redirectsPath, "utf8");
  const pins = [...new Set(before.match(SHA_RE) ?? [])];
  if (pins.length === 0) {
    throw new Error("dist/_redirects has no er-assets@<sha> pins to rewrite - redirect format changed?");
  }
  const after = before.replace(SHA_RE, `er-assets@${sha}`);
  await writeFile(redirectsPath, after);
  console.log(`Re-pinned er-assets in dist/_redirects: ${pins.join(", ")} -> er-assets@${sha}`);
} else {
  console.log("ER_ASSETS_SHA not set - dist/_redirects keeps the committed er-assets pin.");
}
