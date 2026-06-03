/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Cloudflare Pages Function — serve the game's large asset folders from a free
// CDN (#218), with NO credit card required.
//
// The game requests assets from same-origin relative paths (e.g. /images/...,
// /audio/...). Those folders are too large to bundle into the Pages deploy, so
// they're served from a free CDN over a public GitHub repo (jsDelivr) and this
// middleware proxies the asset-folder paths to it — keeping everything same-origin
// so no client code changes are needed. Everything else (the built SPA in dist/)
// falls through to Pages' static serving via `next()`.
//
// Setup (see docs/plans/er-hosting-cloudflare.md):
//   1. Push the `assets/` folder to a PUBLIC GitHub repo, e.g. <you>/er-assets.
//   2. In Cloudflare Pages → Settings → Environment variables, set:
//        ASSETS_CDN_BASE = https://cdn.jsdelivr.net/gh/<you>/er-assets@main
//   3. Copy this functions/ dir into the Pages project root.
//
// jsDelivr is free, global, and needs no account/card. (If you'd rather use
// Cloudflare R2 — which needs a card on file — swap the fetch for an R2 binding.)

interface Env {
  /** Base URL of the asset CDN, no trailing slash. e.g. a jsDelivr gh URL. */
  ASSETS_CDN_BASE?: string;
}

// Big asset folders served from the CDN (everything else comes from dist/).
const CDN_PREFIXES = ["audio/", "battle-anims/", "battle-anims-er/", "fonts/", "images/"];
// Loose asset files the game fetches from the origin root (also in er-assets).
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
  const isCdnAsset = CDN_PREFIXES.some(p => path.startsWith(p)) || CDN_ROOT_FILES.has(path);
  if (!base || !isCdnAsset) {
    // Not a CDN-hosted asset (or CDN not configured) — serve from the static SPA.
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
