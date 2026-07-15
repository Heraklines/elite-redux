/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — build-id plugin (auto-reload on new version).
//
// The service worker is intentionally disabled (see index.html), so the app
// cannot rely on the SW update lifecycle to tell players a new build shipped.
// Instead we:
//
//   1. Stamp an exact BUILD ID + structured, non-secret source identity into the JS bundle via `define`,
//      so the running page and every tester report know which code/deployment produced it.
//   2. Emit `version.json` (`{ "build": "<id>", "identity": {...} }`) into the output so a
//      lightweight runtime poller can fetch it (no-store) and compare. When it
//      differs from `__BUILD_ID__`, a new deploy is live -> the client reloads.
//
// version.json is intentionally tiny so polling it costs
// essentially nothing — and it's served by Cloudflare Pages (static, unlimited
// on the free tier), NOT a Worker, so there is no quota impact.
//
// CI ids are deterministic exact-SHA/deployment coordinates. Local ids remain unique per Vite process.
// In all cases the bundle's baked-in identity and the emitted version.json always agree.
// =============================================================================

import { createHash, randomBytes } from "node:crypto";
import type { Plugin as VitePlugin } from "vite";
import type { ErBuildDeploymentIdentityV1, ErBuildIdentityV1 } from "../../src/utils/build-identity";

const NAME = "er-build-id";
const VERSION = "1.0.0";

export interface BuildIdentityOptions {
  /** Dependency injection for engine-free tests. Production uses the narrowly-read `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  entropy?: () => string;
}

const SHA_PATTERN = /^[0-9a-f]{7,64}$/iu;

function text(value: string | undefined, maxLength = 256): string | null {
  if (value == null) {
    return null;
  }
  const cleaned = [...value]
    .filter(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
  return cleaned || null;
}

function sha(value: string | undefined): string | null {
  const candidate = text(value, 64)?.toLowerCase() ?? null;
  return candidate != null && SHA_PATTERN.test(candidate) ? candidate : null;
}

function positiveInteger(value: string | undefined): number | null {
  if (value == null || !/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function publicUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    // A Pages URL is public identity only. Strip any accidentally supplied credentials/query material.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return text(url.toString(), 512);
  } catch {
    return null;
  }
}

function cloudflareDeployment(env: Readonly<Record<string, string | undefined>>): ErBuildDeploymentIdentityV1 | null {
  const branch = text(env.CF_PAGES_BRANCH);
  const url = publicUrl(env.CF_PAGES_URL);
  return branch == null && url == null ? null : { provider: "cloudflare-pages", branch, url };
}

function deploymentDigest(deployment: ErBuildDeploymentIdentityV1 | null): string {
  if (deployment == null) {
    return "";
  }
  return createHash("sha256")
    .update(JSON.stringify({ branch: deployment.branch, url: deployment.url }))
    .digest("hex")
    .slice(0, 12);
}

function githubIdentity(
  env: Readonly<Record<string, string | undefined>>,
  deployment: ErBuildDeploymentIdentityV1 | null,
): ErBuildIdentityV1 | null {
  const githubSha = sha(env.GITHUB_SHA);
  if (githubSha == null) {
    return null;
  }
  const runId = /^\d+$/u.test(env.GITHUB_RUN_ID ?? "") ? env.GITHUB_RUN_ID! : null;
  const runAttempt = positiveInteger(env.GITHUB_RUN_ATTEMPT);
  const runSuffix = runId == null ? "" : `:run-${runId}${runAttempt == null ? "" : `.${runAttempt}`}`;
  return {
    version: 1,
    id: `github:${githubSha}${runSuffix}`,
    source: "github",
    sha: githubSha,
    workflow: {
      provider: "github-actions",
      runId,
      runAttempt,
      workflow: text(env.GITHUB_WORKFLOW),
      job: text(env.GITHUB_JOB),
      repository: text(env.GITHUB_REPOSITORY),
      ref: text(env.GITHUB_REF_NAME ?? env.GITHUB_REF),
    },
    deployment,
  };
}

function cloudflareIdentity(
  env: Readonly<Record<string, string | undefined>>,
  deployment: ErBuildDeploymentIdentityV1 | null,
): ErBuildIdentityV1 | null {
  const cloudflareSha = sha(env.CF_PAGES_COMMIT_SHA);
  if (cloudflareSha == null) {
    return null;
  }
  const digest = deploymentDigest(deployment);
  return {
    version: 1,
    id: `cloudflare:${cloudflareSha}${digest ? `:deploy-${digest}` : ""}`,
    source: "cloudflare",
    sha: cloudflareSha,
    workflow: null,
    deployment,
  };
}

function localIdentity(options: BuildIdentityOptions): ErBuildIdentityV1 {
  const now = options.now?.() ?? Date.now();
  const rawEntropy = options.entropy?.() ?? randomBytes(8).toString("hex");
  const entropy = rawEntropy.replace(/[^A-Za-z0-9._-]/gu, "").slice(0, 32) || randomBytes(8).toString("hex");
  return {
    version: 1,
    id: `local:${Math.max(0, Math.floor(now)).toString(36)}:${entropy}`,
    source: "local",
    sha: null,
    workflow: null,
    deployment: null,
  };
}

/**
 * Resolve one exact, report-safe build identity. Only the named public CI coordinates are read; arbitrary
 * environment variables, tokens, account ids and credentials can never enter the bundle or a bug report.
 */
export function resolveBuildIdentity(options: BuildIdentityOptions = {}): ErBuildIdentityV1 {
  const env = options.env ?? process.env;
  const deployment = cloudflareDeployment(env);
  return githubIdentity(env, deployment) ?? cloudflareIdentity(env, deployment) ?? localIdentity(options);
}

/**
 * Stamps a per-build id into the bundle (`__BUILD_ID__`) and emits `version.json`
 * so the runtime update-checker can detect when a newer build is deployed.
 */
export function buildIdPlugin(options: BuildIdentityOptions = {}): VitePlugin {
  const identity = resolveBuildIdentity(options);
  const buildId = identity.id;
  return {
    name: NAME,
    version: VERSION,
    // Define the compile-time constant for BOTH serve and build so the app code
    // always type-checks and resolves `__BUILD_ID__` to a real string.
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(buildId),
          __BUILD_IDENTITY__: JSON.stringify(identity),
        },
      };
    },
    // Only emit the sidecar file for real builds (no output during `vite serve`).
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ build: buildId, identity }),
      });
    },
  };
}
