/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Public, non-secret workflow coordinates baked into one client bundle. */
export interface ErBuildWorkflowIdentityV1 {
  provider: "github-actions";
  runId: string | null;
  runAttempt: number | null;
  workflow: string | null;
  job: string | null;
  repository: string | null;
  ref: string | null;
}

/** Public Cloudflare Pages coordinates, when the bundle was built by Pages directly. */
export interface ErBuildDeploymentIdentityV1 {
  provider: "cloudflare-pages";
  branch: string | null;
  url: string | null;
}

/**
 * Exact identity embedded by the Vite build. It deliberately contains no tokens, credentials, account
 * identifiers, environment dumps, or arbitrary secret-bearing variables.
 */
export interface ErBuildIdentityV1 {
  version: 1;
  id: string;
  source: "github" | "cloudflare" | "local" | "legacy" | "unknown";
  sha: string | null;
  workflow: ErBuildWorkflowIdentityV1 | null;
  deployment: ErBuildDeploymentIdentityV1 | null;
}

export const ER_BUILD_IDENTITY_MARKER = "----- BUILD IDENTITY (JSON) -----";

const SHA_PATTERN = /^[0-9a-f]{7,64}$/u;
const BUILD_ID_PATTERN = /^[A-Za-z0-9:._-]{1,256}$/u;

function safeText(value: unknown, maxLength = 256): string | null {
  if (typeof value !== "string") {
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

function safeSha(value: unknown): string | null {
  const sha = safeText(value, 64)?.toLowerCase() ?? null;
  return sha != null && SHA_PATTERN.test(sha) ? sha : null;
}

function safePositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function normalizeWorkflow(value: unknown): ErBuildWorkflowIdentityV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ErBuildWorkflowIdentityV1>;
  if (candidate.provider !== "github-actions") {
    return null;
  }
  const runId = safeText(candidate.runId, 32);
  if (runId != null && !/^\d+$/u.test(runId)) {
    return null;
  }
  const runAttempt = candidate.runAttempt == null ? null : safePositiveInteger(candidate.runAttempt);
  if (candidate.runAttempt != null && runAttempt == null) {
    return null;
  }
  return {
    provider: "github-actions",
    runId,
    runAttempt,
    workflow: safeText(candidate.workflow),
    job: safeText(candidate.job),
    repository: safeText(candidate.repository),
    ref: safeText(candidate.ref),
  };
}

function normalizeDeployment(value: unknown): ErBuildDeploymentIdentityV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ErBuildDeploymentIdentityV1>;
  if (candidate.provider !== "cloudflare-pages") {
    return null;
  }
  return {
    provider: "cloudflare-pages",
    branch: safeText(candidate.branch),
    url: safeText(candidate.url, 512),
  };
}

/** Validate a compile-time identity before it enters a report. Invalid injected data fails closed. */
export function normalizeErBuildIdentity(value: unknown): ErBuildIdentityV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ErBuildIdentityV1>;
  if (
    candidate.version !== 1
    || typeof candidate.id !== "string"
    || !BUILD_ID_PATTERN.test(candidate.id)
    || !["github", "cloudflare", "local", "legacy", "unknown"].includes(candidate.source ?? "")
  ) {
    return null;
  }
  const sha = candidate.sha == null ? null : safeSha(candidate.sha);
  if (candidate.sha != null && sha == null) {
    return null;
  }
  const workflow = normalizeWorkflow(candidate.workflow);
  const deployment = normalizeDeployment(candidate.deployment);
  if ((candidate.workflow != null && workflow == null) || (candidate.deployment != null && deployment == null)) {
    return null;
  }
  return {
    version: 1,
    id: candidate.id,
    source: candidate.source as ErBuildIdentityV1["source"],
    sha,
    workflow,
    deployment,
  };
}

function legacyIdentity(): ErBuildIdentityV1 | null {
  try {
    const id = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
    if (!BUILD_ID_PATTERN.test(id)) {
      return null;
    }
    return { version: 1, id, source: "legacy", sha: null, workflow: null, deployment: null };
  } catch {
    return null;
  }
}

/** Read the exact compile-time identity without ever exposing process/browser environment state. */
export function getErBuildIdentity(): ErBuildIdentityV1 {
  try {
    const normalized = normalizeErBuildIdentity(
      typeof __BUILD_IDENTITY__ === "undefined" ? undefined : __BUILD_IDENTITY__,
    );
    if (normalized != null) {
      return normalized;
    }
  } catch {
    // A malformed/missing compile define falls through to the legacy id, then the explicit unknown value.
  }
  return (
    legacyIdentity() ?? { version: 1, id: "unknown", source: "unknown", sha: null, workflow: null, deployment: null }
  );
}

/** Stable, one-line JSON block for tester logs and machine ingestion. */
export function formatErBuildIdentity(identity: ErBuildIdentityV1 = getErBuildIdentity()): string {
  const normalized = normalizeErBuildIdentity(identity) ?? getErBuildIdentity();
  return `${ER_BUILD_IDENTITY_MARKER}\n${JSON.stringify(normalized)}`;
}
