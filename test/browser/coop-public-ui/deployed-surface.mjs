/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ASSET_TARGET = /^https:\/\/cdn\.jsdelivr\.net\/gh\/Heraklines\/er-assets@([0-9a-f]{40})\//u;
const PINNED_ASSET = /er-assets@[0-9a-f]{40}/u;
const PROBE_SPLAT = "__coop_public_ui_pin_probe__";
const FETCH_TIMEOUT_MS = 30_000;

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function fetchBytes(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ...options,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}

function parseProductionRedirects(contents) {
  const redirects = [];
  for (const rawLine of contents.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const [source, target, status, ...extra] = line.split(/\s+/gu);
    if (extra.length > 0 || status !== "302" || !source?.startsWith("/") || !ASSET_TARGET.test(target ?? "")) {
      throw new Error(`unsupported production asset redirect: ${line}`);
    }
    redirects.push({ source, target });
  }
  if (
    !redirects.some(({ source }) => source === "/images/*")
    || !redirects.some(({ source }) => source === "/fonts/*")
  ) {
    throw new Error("production asset redirects must include pinned image and font surfaces");
  }
  return redirects;
}

function assertInertManifest(bytes, url) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${url} is not valid JSON`, { cause: error });
  }
  if (
    parsed == null
    || Array.isArray(parsed)
    || typeof parsed !== "object"
    || Object.keys(parsed).length !== 1
    || parsed.manifest == null
    || Array.isArray(parsed.manifest)
    || typeof parsed.manifest !== "object"
    || Object.keys(parsed.manifest).length > 0
  ) {
    throw new Error(`${url} must contain only the inert {"manifest":{}} cache-buster payload`);
  }
}

async function captureRedirect(baseUrl, route) {
  const probePath = route.source.endsWith("/*") ? route.source.replace(/\*$/u, PROBE_SPLAT) : route.source;
  const requestUrl = new URL(probePath, baseUrl);
  const { response } = await fetchBytes(requestUrl, { redirect: "manual" });
  const location = response.headers.get("location");
  if (response.status !== 302 || location == null) {
    throw new Error(`${requestUrl} must return a 302 immutable production asset redirect`);
  }
  const absoluteLocation = new URL(location, requestUrl).href;
  const pin = ASSET_TARGET.exec(absoluteLocation)?.[1];
  if (pin == null) {
    throw new Error(`${requestUrl} redirected outside the immutable er-assets surface: ${absoluteLocation}`);
  }
  const expectedTarget = route.target.replace(PINNED_ASSET, `er-assets@${pin}`).replace(":splat", PROBE_SPLAT);
  if (absoluteLocation !== new URL(expectedTarget).href) {
    throw new Error(`${requestUrl} redirected to ${absoluteLocation}, expected ${expectedTarget}`);
  }
  return {
    source: route.source,
    probePath,
    target: absoluteLocation,
    assetSha: pin,
  };
}

export async function captureDeployedSurface(config) {
  const baseUrl = new URL(config.baseUrl);
  const rootUrl = new URL("/", baseUrl);
  const manifestUrl = new URL("/manifest.json", baseUrl);
  const redirectsText = await readFile(resolve(config.root, "deploy", "cloudflare", "_redirects"), "utf8");
  const routes = parseProductionRedirects(redirectsText);

  const [{ response: rootResponse, bytes: html }, { response: manifestResponse, bytes: manifest }, redirects] =
    await Promise.all([
      fetchBytes(rootUrl),
      fetchBytes(manifestUrl),
      Promise.all(routes.map(route => captureRedirect(baseUrl, route))),
    ]);
  if (!rootResponse.ok) {
    throw new Error(`${rootUrl} returned ${rootResponse.status} instead of the deployed application`);
  }
  if (!manifestResponse.ok) {
    throw new Error(`${manifestUrl} returned ${manifestResponse.status} instead of the inert manifest`);
  }
  assertInertManifest(manifest, manifestUrl);

  const assetShas = [...new Set(redirects.map(redirect => redirect.assetSha))];
  if (assetShas.length !== 1) {
    throw new Error(`deployed asset redirects are not pinned to one immutable SHA: ${assetShas.join(", ")}`);
  }
  const redirectDigest = sha256(
    redirects.map(({ source, probePath, target }) => `${source}\0${probePath}\0${target}\n`).join(""),
  );
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    origin: baseUrl.origin,
    htmlSha256: sha256(html),
    manifestSha256: sha256(manifest),
    assetSha: assetShas[0],
    redirectSha256: redirectDigest,
    redirects,
  };
}

export function assertStableDeployedSurface(before, after) {
  const stableFields = ["version", "origin", "htmlSha256", "manifestSha256", "assetSha", "redirectSha256"];
  const changes = stableFields
    .filter(field => before[field] !== after[field])
    .map(field => `${field}: ${before[field]} -> ${after[field]}`);
  if (changes.length > 0) {
    throw new Error(`deployed browser surface changed during the public-UI journey:\n${changes.join("\n")}`);
  }
}
