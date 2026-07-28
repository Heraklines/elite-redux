/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "./config.mjs";
import {
  createSealedPreviewRequestHandler,
  createSharedProductionAssetProxy,
  parseProductionAssetRedirects,
} from "./preview-server.mjs";

const ASSET_SHA = "a".repeat(40);
const MISSING_DIRECTORY = resolve(import.meta.dirname, "../../../.missing-preview-assets");
const REQUIRED_ENV = {
  COOP_UI_BASE_URL: "https://example.test",
  COOP_UI_HOST_USERNAME: "host",
  COOP_UI_HOST_PASSWORD: "host-pw",
  COOP_UI_GUEST_USERNAME: "guest",
  COOP_UI_GUEST_PASSWORD: "guest-pw",
};

function redirectText() {
  return [
    `/images/* https://cdn.jsdelivr.net/gh/Heraklines/er-assets@${ASSET_SHA}/images/:splat 302`,
    `/fonts/* https://cdn.jsdelivr.net/gh/Heraklines/er-assets@${ASSET_SHA}/fonts/:splat 302`,
  ].join("\n");
}

function redirects() {
  return parseProductionAssetRedirects(redirectText(), ASSET_SHA);
}

function withEnv(overrides, callback) {
  const keys = [...Object.keys(REQUIRED_ENV), ...Object.keys(overrides), "COOP_UI_PROXY_PRODUCTION_ASSETS"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
      process.env[key] = value;
    }
    return callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close(error => (error ? rejectClose(error) : resolveClose()));
        server.closeAllConnections();
      }),
  };
}

function handlerFor(assetRedirects, productionAssetProxy = null) {
  return createSealedPreviewRequestHandler({
    origin: "http://127.0.0.1",
    browserDist: MISSING_DIRECTORY,
    assetDir: MISSING_DIRECTORY,
    assetRedirects,
    productionAssetProxy,
    onProxyError: () => {},
  });
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 1));
  }
  assert.equal(predicate(), true, "condition became true before its test deadline");
}

test("asset proxy config is closed by default and requires an explicit boolean opt-in", () => {
  withEnv({}, () => {
    delete process.env.COOP_UI_PROXY_PRODUCTION_ASSETS;
    assert.equal(loadConfig().proxyProductionAssets, false);
  });
  withEnv({ COOP_UI_PROXY_PRODUCTION_ASSETS: "1" }, () => {
    assert.equal(loadConfig().proxyProductionAssets, true);
  });
  withEnv({ COOP_UI_PROXY_PRODUCTION_ASSETS: "sometimes" }, () => {
    assert.throws(() => loadConfig(), /COOP_UI_PROXY_PRODUCTION_ASSETS must be a boolean/u);
  });
});

test("sealed redirect parsing binds every production target to the manifest asset SHA", () => {
  const parsed = redirects();
  assert.equal(parsed.length, 2);
  assert.ok(parsed.every(rule => rule.assetSha === ASSET_SHA));
  assert.throws(
    () => parseProductionAssetRedirects(redirectText(), "b".repeat(40)),
    /does not match sealed artifact asset SHA/u,
  );
  assert.throws(
    () =>
      parseProductionAssetRedirects(
        redirectText().replace("https://cdn.jsdelivr.net", "https://untrusted.example"),
        ASSET_SHA,
      ),
    /unsupported production asset redirect/u,
  );
  assert.throws(
    () =>
      createSharedProductionAssetProxy({
        redirects: [
          {
            source: "/images/*",
            target: `https://cdn.jsdelivr.net/gh/Heraklines/er-assets@${ASSET_SHA}/images/:splat`,
            assetSha: ASSET_SHA,
          },
        ],
      }),
    /requires the validated redirect table/u,
    "a caller cannot smuggle an arbitrary URL-shaped rule around sealed redirect validation",
  );
});

test("proxy-off sealed preview preserves the immutable exact-SHA 302", async () => {
  const preview = await serve(handlerFor(redirects()));
  try {
    const response = await fetch(`${preview.origin}/images/pokemon/test.png`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      `https://cdn.jsdelivr.net/gh/Heraklines/er-assets@${ASSET_SHA}/images/pokemon/test.png`,
    );
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  } finally {
    await preview.close();
  }
});

test("two simultaneous browser requests share one exact-SHA upstream fetch and immutable cached bytes", async () => {
  let upstreamFetches = 0;
  let releaseFetch;
  const fetchGate = new Promise(resolveFetch => {
    releaseFetch = resolveFetch;
  });
  const proxy = createSharedProductionAssetProxy({
    redirects: redirects(),
    fetchImpl: async (url, init) => {
      upstreamFetches++;
      assert.match(String(url), new RegExp(`er-assets@${ASSET_SHA}/images/pokemon/test\\.png$`, "u"));
      assert.equal(init.redirect, "error");
      await fetchGate;
      return new Response("shared-asset", {
        status: 200,
        headers: { "Cache-Control": "public, max-age=0", "Content-Type": "image/x-test" },
      });
    },
    maxBytes: 1_024,
    maxEntryBytes: 512,
    maxEntries: 8,
    maxConcurrent: 2,
  });
  const preview = await serve(handlerFor(redirects(), proxy));
  try {
    const first = fetch(`${preview.origin}/images/pokemon/test.png`);
    const second = fetch(`${preview.origin}/images/pokemon/test.png`);
    await waitFor(() => upstreamFetches === 1 && proxy.snapshot().inFlightHits === 1);
    releaseFetch();
    const responses = await Promise.all([first, second]);
    assert.deepEqual(
      responses.map(response => response.status),
      [200, 200],
    );
    assert.deepEqual(await Promise.all(responses.map(response => response.text())), ["shared-asset", "shared-asset"]);
    assert.ok(responses.every(response => response.headers.get("content-type") === "image/x-test"));
    assert.ok(
      responses.every(response => response.headers.get("cache-control") === "public, max-age=31536000, immutable"),
    );

    const cached = await fetch(`${preview.origin}/images/pokemon/test.png`);
    assert.equal(await cached.text(), "shared-asset");
    assert.equal(upstreamFetches, 1);
    assert.equal(proxy.snapshot().upstreamFetches, 1);
    assert.equal(proxy.snapshot().inFlightHits, 1);
    assert.equal(proxy.snapshot().cacheHits, 1);
  } finally {
    await preview.close();
    proxy.close();
  }
});

test("proxy cache is byte-bounded and evicts least-recently-used exact-SHA assets", async () => {
  let upstreamFetches = 0;
  const proxy = createSharedProductionAssetProxy({
    redirects: redirects(),
    fetchImpl: async url => {
      upstreamFetches++;
      return new Response(new URL(url).pathname.endsWith("a.png") ? "aaaa" : "bbbb", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    },
    maxBytes: 5,
    maxEntryBytes: 5,
    maxEntries: 2,
    maxConcurrent: 1,
  });
  try {
    await proxy.get("/images/a.png");
    await proxy.get("/images/b.png");
    assert.deepEqual(
      { bytes: proxy.snapshot().bytes, entries: proxy.snapshot().entries, evictions: proxy.snapshot().evictions },
      { bytes: 4, entries: 1, evictions: 1 },
    );
    await proxy.get("/images/a.png");
    assert.equal(upstreamFetches, 3, "the evicted oldest entry is fetched again rather than exceeding the bound");
    assert.ok(proxy.snapshot().bytes <= 5);
  } finally {
    proxy.close();
  }
});

test("an upstream body cannot exceed the per-entry working-set bound even without Content-Length", async () => {
  const proxy = createSharedProductionAssetProxy({
    redirects: redirects(),
    fetchImpl: async () =>
      new Response("four", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    maxBytes: 3,
    maxEntryBytes: 3,
    maxEntries: 1,
    maxConcurrent: 1,
  });
  try {
    await assert.rejects(() => proxy.get("/images/oversize.png"), /body exceeded the 3-byte bound/u);
    assert.equal(proxy.snapshot().entries, 0);
    assert.equal(proxy.snapshot().bytes, 0);
    assert.equal(proxy.snapshot().failures, 1);
  } finally {
    proxy.close();
  }
});

test("asset proxy fails closed and never fetches a URL outside the validated redirect table", async () => {
  let upstreamFetches = 0;
  const proxy = createSharedProductionAssetProxy({
    redirects: redirects(),
    fetchImpl: async () => {
      upstreamFetches++;
      throw new Error("upstream unavailable");
    },
    maxBytes: 1_024,
    maxEntryBytes: 512,
    maxEntries: 8,
    maxConcurrent: 1,
  });
  assert.equal(await proxy.get("/not-a-production-asset/file.png"), null);
  assert.equal(upstreamFetches, 0);

  const preview = await serve(handlerFor(redirects(), proxy));
  try {
    const unrelated = await fetch(`${preview.origin}/not-a-production-asset/file.png`, { redirect: "manual" });
    assert.equal(unrelated.status, 404);
    assert.equal(upstreamFetches, 0);

    const failedAsset = await fetch(`${preview.origin}/images/fail.png`, { redirect: "manual" });
    assert.equal(failedAsset.status, 502);
    assert.equal(failedAsset.headers.get("location"), null, "proxy failure never falls back to a redirect");
    assert.equal(failedAsset.headers.get("cache-control"), "no-store");
    assert.equal(upstreamFetches, 1);
    assert.equal(proxy.snapshot().failures, 1);
  } finally {
    await preview.close();
    proxy.close();
  }
});
