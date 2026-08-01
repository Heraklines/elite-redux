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
const EXACT_ASSET_SHA = /^[0-9a-f]{40}$/u;
const EXACT_ASSET_TARGET = /^https:\/\/cdn\.jsdelivr\.net\/gh\/Heraklines\/er-assets@([0-9a-f]{40})\/[^\s]*$/u;
const DEFAULT_PROXY_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_PROXY_MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const DEFAULT_PROXY_MAX_ENTRIES = 8_192;
const DEFAULT_PROXY_MAX_CONCURRENT = 8;
const DEFAULT_PROXY_FETCH_TIMEOUT_MS = 120_000;
const VALIDATED_ASSET_REDIRECT = Symbol("validated-asset-redirect");

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
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
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

export function parseProductionAssetRedirects(contents, expectedAssetSha) {
  if (!EXACT_ASSET_SHA.test(expectedAssetSha ?? "")) {
    throw new Error(`sealed artifact asset SHA is invalid: ${expectedAssetSha ?? ""}`);
  }
  const redirects = [];
  for (const rawLine of contents.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const [source, target, status, ...extra] = line.split(/\s+/gu);
    const targetMatch = EXACT_ASSET_TARGET.exec(target ?? "");
    const wildcard = source?.endsWith("/*") === true;
    const splatCount = target?.match(/:splat/gu)?.length ?? 0;
    if (
      extra.length > 0
      || status !== "302"
      || !source?.startsWith("/")
      || source.includes("..")
      || source.includes("\\")
      || targetMatch == null
      || (wildcard ? splatCount !== 1 : splatCount !== 0)
    ) {
      throw new Error(`unsupported production asset redirect: ${line}`);
    }
    const targetUrl = new URL(target);
    if (
      targetUrl.protocol !== "https:"
      || targetUrl.hostname !== "cdn.jsdelivr.net"
      || targetUrl.port !== ""
      || targetUrl.username !== ""
      || targetUrl.password !== ""
      || targetUrl.search !== ""
      || targetUrl.hash !== ""
    ) {
      throw new Error(`unsupported production asset redirect: ${line}`);
    }
    const assetSha = targetMatch[1];
    if (assetSha !== expectedAssetSha) {
      throw new Error(
        `production asset redirect SHA ${assetSha} does not match sealed artifact asset SHA ${expectedAssetSha}`,
      );
    }
    redirects.push(Object.freeze({ source, target, assetSha, [VALIDATED_ASSET_REDIRECT]: true }));
  }
  if (
    !redirects.some(({ source }) => source === "/images/*")
    || !redirects.some(({ source }) => source === "/fonts/*")
  ) {
    throw new Error("production asset redirects must include the pinned image and font surfaces");
  }
  return Object.freeze(redirects);
}

function productionAssetRedirects(config, expectedAssetSha) {
  return parseProductionAssetRedirects(
    readFileSync(resolve(config.browserDist, "_redirects"), "utf8"),
    expectedAssetSha,
  );
}

function resolveRedirectedAsset(pathname, redirects) {
  for (const rule of redirects) {
    const { source, target, assetSha } = rule;
    let redirected;
    let requiredTargetPath;
    if (source.endsWith("/*")) {
      const prefix = source.slice(0, -1);
      if (pathname.startsWith(prefix)) {
        const splat = pathname.slice(prefix.length);
        if (splat.includes("\\") || splat.split("/").some(segment => segment === "." || segment === "..")) {
          return null;
        }
        redirected = target.replace(
          ":splat",
          splat
            .split("/")
            .map(segment => encodeURIComponent(segment))
            .join("/"),
        );
        requiredTargetPath = new URL(target.replace(":splat", "")).pathname;
      }
    } else if (pathname === source) {
      redirected = target;
      requiredTargetPath = new URL(target).pathname;
    }
    if (redirected == null) {
      continue;
    }
    const url = new URL(redirected);
    const exactRepoPrefix = `/gh/Heraklines/er-assets@${assetSha}/`;
    if (
      url.protocol !== "https:"
      || url.hostname !== "cdn.jsdelivr.net"
      || url.port !== ""
      || url.username !== ""
      || url.password !== ""
      || url.search !== ""
      || url.hash !== ""
      || !url.pathname.startsWith(exactRepoPrefix)
      || (source.endsWith("/*") ? !url.pathname.startsWith(requiredTargetPath) : url.pathname !== requiredTargetPath)
    ) {
      return null;
    }
    return Object.freeze({ href: url.href, assetSha, source });
  }
  return null;
}

function exactAssetUpstreamCandidates(asset) {
  const primary = new URL(asset.href);
  const repoPrefix = `/gh/Heraklines/er-assets@${asset.assetSha}/`;
  if (primary.hostname !== "cdn.jsdelivr.net" || !primary.pathname.startsWith(repoPrefix)) {
    throw new Error("validated production asset lost its exact-SHA jsDelivr binding");
  }
  const repoPath = primary.pathname.slice(repoPrefix.length);
  return Object.freeze([
    primary.href,
    `https://fastly.jsdelivr.net${primary.pathname}`,
    `https://raw.githubusercontent.com/Heraklines/er-assets/${asset.assetSha}/${repoPath}`,
  ]);
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireValidatedAssetRedirects(redirects) {
  if (
    !Array.isArray(redirects)
    || redirects.length === 0
    || redirects.some(rule => rule?.[VALIDATED_ASSET_REDIRECT] !== true)
  ) {
    throw new Error("sealed preview requires the validated redirect table");
  }
  return redirects;
}

/**
 * One bounded cache shared by both browser processes behind the sealed localhost origin.
 *
 * The proxy accepts a request pathname, never a caller-provided URL. Its only possible upstream URL
 * comes from `resolveRedirectedAsset()` over the manifest-SHA-validated redirect table above. At most
 * `maxBytes + 2 * maxConcurrent * maxEntryBytes` bytes can be resident while misses are downloading
 * (stream chunks plus their final contiguous buffers); the settled LRU itself never exceeds
 * maxBytes/maxEntries. Failed/incomplete responses are never retained.
 */
export function createSharedProductionAssetProxy({
  redirects,
  fetchImpl = fetch,
  maxBytes = DEFAULT_PROXY_MAX_BYTES,
  maxEntryBytes = DEFAULT_PROXY_MAX_ENTRY_BYTES,
  maxEntries = DEFAULT_PROXY_MAX_ENTRIES,
  maxConcurrent = DEFAULT_PROXY_MAX_CONCURRENT,
  fetchTimeoutMs = DEFAULT_PROXY_FETCH_TIMEOUT_MS,
} = {}) {
  requireValidatedAssetRedirects(redirects);
  positiveInteger(maxBytes, "asset proxy maxBytes");
  positiveInteger(maxEntryBytes, "asset proxy maxEntryBytes");
  positiveInteger(maxEntries, "asset proxy maxEntries");
  positiveInteger(maxConcurrent, "asset proxy maxConcurrent");
  positiveInteger(fetchTimeoutMs, "asset proxy fetchTimeoutMs");
  if (maxEntryBytes > maxBytes) {
    throw new Error("asset proxy maxEntryBytes cannot exceed maxBytes");
  }

  const cache = new Map();
  const inFlight = new Map();
  const waiting = [];
  const controllers = new Set();
  let active = 0;
  let cacheBytes = 0;
  let closed = false;
  const stats = {
    requests: 0,
    cacheHits: 0,
    inFlightHits: 0,
    upstreamFetches: 0,
    fallbackFetches: 0,
    fallbackSuccesses: 0,
    evictions: 0,
    failures: 0,
  };

  function acquire() {
    if (closed) {
      return Promise.reject(new Error("production asset proxy is closed"));
    }
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolveAcquire, rejectAcquire) => waiting.push({ resolveAcquire, rejectAcquire }));
  }

  function release() {
    active--;
    const next = waiting.shift();
    if (next != null && !closed) {
      active++;
      next.resolveAcquire();
    }
  }

  function cached(href) {
    const entry = cache.get(href);
    if (entry == null) {
      return null;
    }
    cache.delete(href);
    cache.set(href, entry);
    return entry;
  }

  function retain(href, entry) {
    while (cache.size >= maxEntries || cacheBytes + entry.body.length > maxBytes) {
      const oldest = cache.entries().next().value;
      if (oldest == null) {
        break;
      }
      cache.delete(oldest[0]);
      cacheBytes -= oldest[1].body.length;
      stats.evictions++;
    }
    cache.set(href, entry);
    cacheBytes += entry.body.length;
  }

  async function fetchEntry(asset) {
    await acquire();
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new Error(`production asset fetch exceeded ${fetchTimeoutMs}ms`)),
      fetchTimeoutMs,
    );
    timeout.unref?.();
    try {
      let lastError = null;
      const candidates = exactAssetUpstreamCandidates(asset);
      for (const [candidateIndex, candidate] of candidates.entries()) {
        try {
          stats.upstreamFetches++;
          if (candidateIndex > 0) {
            stats.fallbackFetches++;
          }
          const upstream = await fetchImpl(candidate, {
            method: "GET",
            redirect: "error",
            signal: controller.signal,
            headers: { Accept: "*/*" },
          });
          if (upstream.status !== 200 || upstream.body == null) {
            throw new Error(`exact-SHA asset fetch returned HTTP ${upstream.status}`);
          }
          const declaredLength = upstream.headers.get("content-length");
          if (declaredLength != null) {
            const value = Number(declaredLength);
            if (!Number.isSafeInteger(value) || value < 0 || value > maxEntryBytes) {
              throw new Error(`exact-SHA asset Content-Length is outside the ${maxEntryBytes}-byte bound`);
            }
          }
          const chunks = [];
          let bytes = 0;
          for await (const value of upstream.body) {
            const chunk = Buffer.from(value);
            bytes += chunk.length;
            if (bytes > maxEntryBytes) {
              throw new Error(`exact-SHA asset body exceeded the ${maxEntryBytes}-byte bound`);
            }
            chunks.push(chunk);
          }
          const entry = Object.freeze({
            body: Buffer.concat(chunks, bytes),
            contentType:
              upstream.headers.get("content-type")
              || CONTENT_TYPES[extname(new URL(candidate).pathname)]
              || "application/octet-stream",
            etag: upstream.headers.get("etag"),
            lastModified: upstream.headers.get("last-modified"),
          });
          retain(asset.href, entry);
          if (candidateIndex > 0) {
            stats.fallbackSuccesses++;
          }
          return entry;
        } catch (error) {
          if (controller.signal.aborted) {
            throw error;
          }
          lastError = error;
        }
      }
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`all exact-SHA asset sources failed: ${detail}`, { cause: lastError });
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
      release();
    }
  }

  return Object.freeze({
    async get(pathname) {
      stats.requests++;
      const asset = resolveRedirectedAsset(pathname, redirects);
      if (asset == null) {
        return null;
      }
      const retained = cached(asset.href);
      if (retained != null) {
        stats.cacheHits++;
        return retained;
      }
      const pending = inFlight.get(asset.href);
      if (pending != null) {
        stats.inFlightHits++;
        return pending;
      }
      const request = fetchEntry(asset)
        .catch(error => {
          stats.failures++;
          throw error;
        })
        .finally(() => inFlight.delete(asset.href));
      inFlight.set(asset.href, request);
      return request;
    },
    snapshot() {
      return Object.freeze({
        enabled: true,
        ...stats,
        entries: cache.size,
        bytes: cacheBytes,
        maxBytes,
        maxEntryBytes,
        maxEntries,
        maxConcurrent,
        activeFetches: active,
        queuedFetches: waiting.length,
        inFlight: inFlight.size,
        workingSetLimitBytes: maxBytes + 2 * maxConcurrent * maxEntryBytes,
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const controller of controllers) {
        controller.abort(new Error("production asset proxy closed"));
      }
      for (const waiter of waiting.splice(0)) {
        waiter.rejectAcquire(new Error("production asset proxy closed"));
      }
      cache.clear();
      cacheBytes = 0;
    },
  });
}

function assetResponseHeaders(entry) {
  return {
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    "Content-Length": String(entry.body.length),
    "Content-Type": entry.contentType,
    ...(entry.etag == null ? {} : { ETag: entry.etag }),
    ...(entry.lastModified == null ? {} : { "Last-Modified": entry.lastModified }),
  };
}

/** Request handler extracted so node-pure contracts can prove redirect/proxy behavior without booting Chrome. */
export function createSealedPreviewRequestHandler({
  origin,
  browserDist,
  assetDir,
  assetRedirects,
  productionAssetProxy = null,
  onProxyError = error => process.stderr.write(`[sealed-preview] production asset proxy failed: ${error.message}\n`),
}) {
  requireValidatedAssetRedirects(assetRedirects);
  return (request, response) =>
    (async () => {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", origin).pathname);
      } catch {
        response.writeHead(400).end("bad request");
        return;
      }
      const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const absolute = safeStaticFile(browserDist, requested);
      const redirected = resolveRedirectedAsset(pathname, assetRedirects);
      if (absolute == null && redirected != null) {
        if (productionAssetProxy == null) {
          // Default remains the exact pre-proxy behavior: a content-addressed immutable 302.
          response.writeHead(302, { "Cache-Control": IMMUTABLE_CACHE_CONTROL, Location: redirected.href }).end();
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { "Cache-Control": "no-store", Allow: "GET, HEAD" }).end();
          return;
        }
        let entry;
        try {
          entry = await productionAssetProxy.get(pathname);
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          onProxyError(new Error(`${pathname}: ${cause.message}`, { cause }));
          response
            .writeHead(502, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" })
            .end("bad gateway");
          return;
        }
        if (entry == null) {
          response
            .writeHead(404, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" })
            .end("not found");
          return;
        }
        response.writeHead(200, assetResponseHeaders(entry));
        response.end(request.method === "HEAD" ? undefined : entry.body);
        return;
      }
      const fallbackAsset = absolute ?? safeStaticFile(assetDir, requested);
      if (fallbackAsset == null) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": isHashedBuildAsset(requested) ? IMMUTABLE_CACHE_CONTROL : "no-store",
        "Content-Type": CONTENT_TYPES[extname(fallbackAsset)] ?? "application/octet-stream",
      });
      createReadStream(fallbackAsset).pipe(response);
    })().catch(error => {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        response.writeHead(500, { "Cache-Control": "no-store" }).end("internal server error");
      }
      process.stderr.write(
        `[sealed-preview] request handler failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
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
  const assetRedirects = productionAssetRedirects(config, manifest.assetSha);
  const productionAssetProxy = config.proxyProductionAssets
    ? createSharedProductionAssetProxy({ redirects: assetRedirects })
    : null;
  const server = createServer(
    createSealedPreviewRequestHandler({
      origin,
      browserDist: config.browserDist,
      assetDir: config.assetDir,
      assetRedirects,
      productionAssetProxy,
    }),
  );
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
          assetProxyStats: () => productionAssetProxy?.snapshot() ?? Object.freeze({ enabled: false }),
          close: () => {
            // A failed browser can leave keep-alive asset requests open. Stop accepting new
            // requests and sever those sockets so campaign teardown cannot wait forever.
            return new Promise((resolveClose, rejectClose) => {
              server.close(error => (error ? rejectClose(error) : resolveClose()));
              server.closeAllConnections();
              productionAssetProxy?.close();
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
  productionAssetProxy?.close();
  throw new Error("timed out waiting for sealed public-UI preview");
}
