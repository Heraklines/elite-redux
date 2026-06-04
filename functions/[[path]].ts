/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

interface Env {
  /** Base URL of the asset CDN, no trailing slash. e.g. a jsDelivr gh URL. */
  ASSETS_CDN_BASE?: string;
}

// Big asset folders served from the CDN; everything else falls through to Pages.
const CDN_PREFIXES = ["audio/", "battle-anims/", "battle-anims-er/", "fonts/", "images/"];

const CDN_ROOT_FILES = new Set([
  "starter-colors.json",
  "exp-sprites.json",
  "biome-bgm-loop-points.json",
  "manifest.webmanifest",
  "service-worker.js",
  "logo128.png",
  "logo512.png",
]);

export const onRequest: PagesFunction<Env> = async ctx => {
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/^\/+/, "");

  const base = ctx.env.ASSETS_CDN_BASE;
  const isCdnAsset = CDN_PREFIXES.some(prefix => path.startsWith(prefix)) || CDN_ROOT_FILES.has(path);
  if (!base || !isCdnAsset) {
    return ctx.next();
  }

  const upstream = await fetch(`${base.replace(/\/+$/, "")}/${path}`, {
    cf: { cacheEverything: true, cacheTtl: 31536000 },
  });
  if (!upstream.ok) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: 200, headers });
};
