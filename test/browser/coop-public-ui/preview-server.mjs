/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, relative, resolve } from "node:path";
import { delay } from "./evidence.mjs";

/** One year + immutable: the exact production semantics for content-addressed assets. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * True for Vite's content-addressed build output (`assets/<name>-<hash>.<ext>`). Only these
 * (and the exact-SHA CDN redirects) may be cached; index.html/manifests stay no-store so a
 * re-sealed bundle always wins (optimization brief R5).
 */
function isHashedBuildAsset(requested) {
  return /^assets\/[^/]*-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u.test(requested);
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

function safeStaticFile(directory, requested) {
  const absolute = normalize(resolve(directory, requested));
  const inside = relative(directory, absolute);
  return !inside.startsWith("..") && !inside.includes(":") && existsSync(absolute) && statSync(absolute).isFile()
    ? absolute
    : null;
}

function verifyArtifact(config) {
  const verify = spawnSync(
    process.execPath,
    [resolve(config.root, "scripts", "prepare-coop-browser-artifact.mjs"), "--verify"],
    {
      cwd: config.root,
      env: {
        ...process.env,
        COOP_BROWSER_DIST: config.browserDist,
        COOP_BROWSER_ENTRY_CONTRACT: config.entryContract,
      },
      encoding: "utf8",
    },
  );
  if (verify.status !== 0) {
    throw new Error(`browser artifact verification failed:\n${verify.stdout ?? ""}\n${verify.stderr ?? ""}`);
  }
  process.stdout.write(verify.stdout);
  const manifest = JSON.parse(readFileSync(resolve(config.browserDist, "coop-browser-artifact.json"), "utf8"));
  if (process.env.GITHUB_SHA && manifest.sha !== process.env.GITHUB_SHA) {
    throw new Error(`browser artifact SHA mismatch: built=${manifest.sha} runtime=${process.env.GITHUB_SHA}`);
  }
  if (manifest.entryContract !== config.entryContract) {
    throw new Error(
      `browser artifact entry contract mismatch: built=${manifest.entryContract} expected=${config.entryContract}`,
    );
  }
  if (config.expectedApiOrigin && manifest.apiOrigin !== config.expectedApiOrigin) {
    throw new Error(
      `browser artifact account/save API origin mismatch: built=${manifest.apiOrigin} expected=${config.expectedApiOrigin}`,
    );
  }
  if (config.expectedSignalOrigin && manifest.signalOrigin !== config.expectedSignalOrigin) {
    throw new Error(
      `browser artifact signaling origin mismatch: built=${manifest.signalOrigin} expected=${config.expectedSignalOrigin}`,
    );
  }
  return manifest;
}

function productionAssetRedirects(config) {
  const redirectsPath = resolve(config.browserDist, "_redirects");
  const redirects = [];
  for (const rawLine of readFileSync(redirectsPath, "utf8").split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const [source, target, status, ...extra] = line.split(/\s+/gu);
    if (
      extra.length > 0
      || status !== "302"
      || !source?.startsWith("/")
      || !/^https:\/\/cdn\.jsdelivr\.net\/gh\/Heraklines\/er-assets@[0-9a-f]{40}\//u.test(target ?? "")
    ) {
      throw new Error(`unsupported production asset redirect: ${line}`);
    }
    redirects.push({ source, target });
  }
  if (
    !redirects.some(({ source }) => source === "/images/*")
    || !redirects.some(({ source }) => source === "/fonts/*")
  ) {
    throw new Error("production asset redirects must include the pinned image and font surfaces");
  }
  return redirects;
}

function redirectedAsset(pathname, redirects) {
  for (const { source, target } of redirects) {
    if (source.endsWith("/*")) {
      const prefix = source.slice(0, -1);
      if (pathname.startsWith(prefix)) {
        return target.replace(":splat", pathname.slice(prefix.length));
      }
    } else if (pathname === source) {
      return target;
    }
  }
  return null;
}

/** Serve only the sealed bundle and the exact pinned production assets; game source is never mounted. */
export async function startSealedPreview(config) {
  if (!config.browserDist) {
    throw new Error("COOP_UI_BROWSER_DIST is required; public-UI journeys refuse an unsealed/deployed bundle");
  }
  const origin = new URL(config.baseUrl).origin;
  const url = new URL(origin);
  if (
    url.protocol !== "http:"
    || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    || url.port.length === 0
  ) {
    throw new Error("sealed public-UI preview must use an isolated localhost HTTP origin");
  }
  const manifest = verifyArtifact(config);
  const assetRedirects = productionAssetRedirects(config);
  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", origin).pathname);
    } catch {
      response.writeHead(400).end("bad request");
      return;
    }
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const absolute = safeStaticFile(config.browserDist, requested);
    const redirected = redirectedAsset(pathname, assetRedirects);
    if (absolute == null && redirected != null) {
      // Optimization brief R5: the redirect target is pinned to an exact er-assets commit
      // SHA (content-addressed), so the redirect is IMMUTABLE - production-faithful (prod
      // serves these assets content-addressed) and it stops each cold seat re-fetching
      // ~7.5k unchanged CDN assets on every reload.
      response.writeHead(302, { "Cache-Control": IMMUTABLE_CACHE_CONTROL, Location: redirected }).end();
      return;
    }
    const fallbackAsset = absolute ?? safeStaticFile(config.assetDir, requested);
    if (fallbackAsset == null) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    // Optimization brief R5: hashed build chunks are content-addressed by Vite, so they are
    // IMMUTABLE exactly like production hosting serves them. index.html, manifests, and any
    // un-hashed fallback stay no-store so a re-sealed bundle is always picked up.
    response.writeHead(200, {
      "Cache-Control": isHashedBuildAsset(requested) ? IMMUTABLE_CACHE_CONTROL : "no-store",
      "Content-Type": CONTENT_TYPES[extname(fallbackAsset)] ?? "application/octet-stream",
    });
    createReadStream(fallbackAsset).pipe(response);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(Number(url.port), url.hostname, resolveListen);
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) {
        return {
          manifest,
          close: () => {
            // A failed browser can leave keep-alive asset requests open. Stop accepting new
            // requests and sever those sockets so campaign teardown cannot wait forever.
            return new Promise((resolveClose, rejectClose) => {
              server.close(error => (error ? rejectClose(error) : resolveClose()));
              server.closeAllConnections();
            });
          },
        };
      }
    } catch {
      // The listener is still becoming reachable.
    }
    await delay(100);
  }
  await new Promise(resolveClose => server.close(() => resolveClose()));
  throw new Error("timed out waiting for sealed public-UI preview");
}
