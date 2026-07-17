#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * ENVIRONMENT SEAL / attestation for the co-op public-UI campaign (P33 audit #920).
 *
 * Emits a single `environment-seal.json` recording the EXACT versions under test so a
 * campaign run becomes reproducible evidence:
 *   - app_sha             the integrated commit the workflow checked out (git rev-parse HEAD)
 *   - assets_sha          the pinned Heraklines/er-assets commit the build sealed into the bundle
 *   - er_save_api_version the deployed er-save-api-staging worker version actually serving the run
 *   - er_coop_api_version the deployed er-coop-api-staging worker version actually serving the run
 *   - resolved_at         when the seal was gathered
 *   - run_id              the GitHub Actions run id
 *
 * The two worker versions are read from the Cloudflare API (Workers Scripts token), which is the
 * same CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID secret pair the deploy workflows use. When that
 * auth is unavailable the reader falls back to an HTTP probe of the deployed worker and flags the
 * degraded provenance in `sources` (the workers expose no dedicated /version route).
 *
 * Best-effort by design: individual facts degrade to a clearly-sourced marker rather than aborting
 * the decisive campaign run. Only an un-writable output path fails the step (no seal = broken
 * evidence, which SHOULD fail loudly).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HEX40 = /^[0-9a-f]{40}$/u;
const CF_API = "https://api.cloudflare.com/client/v4";

function env(name) {
  return process.env[name]?.trim() || null;
}

function log(message) {
  process.stdout.write(`[env-seal] ${message}\n`);
}

function readManifest() {
  const dist = env("COOP_BROWSER_DIST");
  if (!dist) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(resolve(dist, "coop-browser-artifact.json"), "utf8"));
  } catch (error) {
    log(`could not read sealed bundle manifest: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function resolveAppSha(manifest) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const fromGit = head.status === 0 ? head.stdout.trim() : "";
  if (HEX40.test(fromGit)) {
    return { value: fromGit, source: "git rev-parse HEAD" };
  }
  const fromEnv = env("GITHUB_SHA");
  if (fromEnv && HEX40.test(fromEnv)) {
    return { value: fromEnv, source: "GITHUB_SHA (git rev-parse unavailable)" };
  }
  const fromManifest = typeof manifest.sha === "string" ? manifest.sha.trim() : "";
  if (HEX40.test(fromManifest)) {
    return { value: fromManifest, source: "sealed bundle manifest .sha (git + GITHUB_SHA unavailable)" };
  }
  return { value: "unresolved", source: "unresolved (no git / GITHUB_SHA / sealed sha)" };
}

function resolveAssetsSha(manifest) {
  const fromManifest = typeof manifest.assetSha === "string" ? manifest.assetSha.trim() : "";
  if (HEX40.test(fromManifest)) {
    return { value: fromManifest, source: "sealed bundle manifest .assetSha" };
  }
  const fallback = env("COOP_SEAL_ASSET_SHA_FALLBACK");
  if (fallback && HEX40.test(fallback)) {
    return { value: fallback, source: "er-assets HEAD fallback (manifest assetSha missing)" };
  }
  return { value: "unresolved", source: "unresolved (no sealed assetSha / fallback)" };
}

/** Query the Cloudflare API for the current deployment id of a worker script. */
async function cloudflareWorkerVersion(scriptName, token, accountId) {
  const url = `${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}/deployments`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Cloudflare API HTTP ${response.status}`);
  }
  const payload = await response.json();
  const deployments = payload?.result?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("Cloudflare API returned no deployments");
  }
  // The list is newest-first; the head deployment is the one currently serving traffic.
  const current = deployments[0];
  const id = typeof current?.id === "string" ? current.id : null;
  const versionId =
    Array.isArray(current?.versions) && typeof current.versions[0]?.version_id === "string"
      ? current.versions[0].version_id
      : null;
  const value = id ?? versionId;
  if (!value) {
    throw new Error("Cloudflare API deployment carried no id");
  }
  return versionId && versionId !== value ? `${value} (version ${versionId})` : value;
}

/** Last-resort probe: hit the deployed worker and capture status + any version-ish header. */
async function httpProbeVersion(origin, probePath) {
  const target = `${origin}${probePath}`;
  const response = await fetch(target, { method: "GET" });
  let headerVersion = null;
  for (const [name, headerValue] of response.headers) {
    if (/version/iu.test(name)) {
      headerVersion = `${name}=${headerValue}`;
      break;
    }
  }
  return headerVersion ?? `http-${response.status}`;
}

async function resolveWorkerVersion(label, scriptName, origin, probePath, token, accountId) {
  if (token && accountId) {
    try {
      const value = await cloudflareWorkerVersion(scriptName, token, accountId);
      return { value, source: `cloudflare-api:deployments (${scriptName})` };
    } catch (error) {
      log(
        `${label}: Cloudflare API read failed (${error instanceof Error ? error.message : String(error)}); falling back to HTTP probe`,
      );
    }
  } else {
    log(
      `${label}: wrangler/Cloudflare auth unavailable (no CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID); using HTTP probe`,
    );
  }
  try {
    const value = await httpProbeVersion(origin, probePath);
    const authNote = token && accountId ? "cloudflare-api read failed" : "wrangler auth unavailable";
    return { value, source: `http-probe ${origin}${probePath} (${authNote}; worker exposes no /version route)` };
  } catch (error) {
    return {
      value: "unresolved",
      source: `unresolved (Cloudflare auth + HTTP probe failed: ${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

async function main() {
  const manifest = readManifest();
  const appSha = resolveAppSha(manifest);
  const assetsSha = resolveAssetsSha(manifest);

  const token = env("CLOUDFLARE_API_TOKEN");
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const saveOrigin = env("COOP_SEAL_SAVE_ORIGIN") ?? "https://er-save-api-staging.heraklines.workers.dev";
  const coopOrigin = env("COOP_SEAL_COOP_ORIGIN") ?? "https://er-coop-api-staging.heraklines.workers.dev";
  const saveWorker = env("COOP_SEAL_SAVE_WORKER") ?? "er-save-api-staging";
  const coopWorker = env("COOP_SEAL_COOP_WORKER") ?? "er-coop-api-staging";

  const [saveVersion, coopVersion] = await Promise.all([
    resolveWorkerVersion("er-save-api-staging", saveWorker, saveOrigin, "/account/info", token, accountId),
    resolveWorkerVersion("er-coop-api-staging", coopWorker, coopOrigin, "/coop/health", token, accountId),
  ]);

  const seal = {
    app_sha: appSha.value,
    assets_sha: assetsSha.value,
    er_save_api_version: saveVersion.value,
    er_coop_api_version: coopVersion.value,
    resolved_at: new Date().toISOString(),
    run_id: env("GITHUB_RUN_ID") ?? "local",
    sources: {
      app_sha: appSha.source,
      assets_sha: assetsSha.source,
      er_save_api_version: saveVersion.source,
      er_coop_api_version: coopVersion.source,
    },
  };

  const outDir = resolve(env("COOP_SEAL_OUT_DIR") ?? resolve("dev-logs", "coop-public-ui"));
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "environment-seal.json");
  writeFileSync(outPath, `${JSON.stringify(seal, null, 2)}\n`);

  log(`app_sha             = ${seal.app_sha}`);
  log(`assets_sha          = ${seal.assets_sha}`);
  log(`er_save_api_version = ${seal.er_save_api_version}`);
  log(`er_coop_api_version = ${seal.er_coop_api_version}`);
  log(`resolved_at         = ${seal.resolved_at}`);
  log(`run_id              = ${seal.run_id}`);
  log(`wrote ${outPath}`);
}

main().catch(error => {
  process.stderr.write(`[env-seal] fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
