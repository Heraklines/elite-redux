#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCampaign } from "./campaign.mjs";
import { forceKillBrowsers, loadCampaignLifecyclePolicy, withinDeadline } from "./campaign-lifecycle.mjs";
import { loadCampaignPolicy } from "./campaign-policy.mjs";
import { loadConfig } from "./config.mjs";
import { startSealedPreview } from "./preview-server.mjs";
import { DuoPublicUiRig } from "./public-ui-harness.mjs";
import { raceJourneyWithTerminal } from "./terminal-watchdog.mjs";

// The campaign reuses the exact sealed-artifact + two-context boot the journeys use;
// only the driven surface set differs (a full >=30-wave co-op run vs. the wave-2 probes).
const config = loadConfig();
const policy = loadCampaignPolicy();
const lifecycle = loadCampaignLifecyclePolicy();
await mkdir(config.artifactDir, { recursive: true });

const startedAt = new Date();
let rig;
let preview;
let failure = null;
const cleanupErrors = [];
let gracefulCleanupCompleted = true;

let rejectSignal;
const signalAbort = new Promise((_resolve, reject) => {
  rejectSignal = reject;
});
const signalHandlers = new Map(
  ["SIGINT", "SIGTERM"].map(signal => {
    const handler = () => rejectSignal(new Error(`[campaign-lifecycle] received ${signal}; preserving evidence`));
    process.once(signal, handler);
    return [signal, handler];
  }),
);

try {
  const execution = (async () => {
    preview = await startSealedPreview(config);
    rig = await DuoPublicUiRig.launch(config);
    // Fast-abort on a known-fatal terminal marker instead of riding out generic timeouts.
    await raceJourneyWithTerminal(Object.values(rig.clients), runCampaign(rig));
    rig.assertClean();
  })();
  execution.catch(() => {});
  await withinDeadline(
    Promise.race([execution, signalAbort]),
    lifecycle.campaignTimeoutMs,
    "sealed preview + two-browser campaign",
  );
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  process.exitCode = 1;
  if (rig) {
    try {
      await withinDeadline(
        Promise.all(Object.values(rig.clients).map(client => client.checkpoint("campaign-failed").catch(() => {}))),
        lifecycle.diagnosticTimeoutMs,
        "failure checkpoints",
      );
    } catch (diagnosticError) {
      cleanupErrors.push(diagnosticError instanceof Error ? diagnosticError : new Error(String(diagnosticError)));
    }
  }
} finally {
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
  if (rig) {
    await withinDeadline(rig.close(), lifecycle.cleanupTimeoutMs, "browser evidence flush and graceful close").catch(
      error => {
        gracefulCleanupCompleted = false;
        const cleanupError = error instanceof Error ? error : new Error(String(error));
        cleanupErrors.push(cleanupError);
        failure ??= cleanupError;
        process.exitCode = 1;
        forceKillBrowsers(rig);
      },
    );
  }
  if (preview) {
    await withinDeadline(preview.close(), lifecycle.cleanupTimeoutMs, "sealed preview close").catch(error => {
      gracefulCleanupCompleted = false;
      const cleanupError = error instanceof Error ? error : new Error(String(error));
      cleanupErrors.push(cleanupError);
      failure ??= cleanupError;
      process.exitCode = 1;
    });
  }

  const finishedAt = new Date();
  const summary = {
    journey: "campaign",
    targetWaves: policy.targetWaves,
    rewardMode: policy.rewardMode,
    renderProfile: policy.renderProfile,
    moveAnimations: policy.moveAnimationsExpected,
    animationFidelity: policy.moveAnimationsExpected
      ? "move-animation rendering covered"
      : "move-animation rendering intentionally skipped; mechanics/network/public UI retained",
    autoFirst: policy.autoFirst,
    status: failure ? "failed" : "passed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    lifecycle: {
      campaignTimeoutMs: lifecycle.campaignTimeoutMs,
      diagnosticTimeoutMs: lifecycle.diagnosticTimeoutMs,
      cleanupTimeoutMs: lifecycle.cleanupTimeoutMs,
      gracefulCleanupCompleted,
      cleanupErrors: cleanupErrors.map(error => ({
        name: error.name,
        message: error.message,
      })),
    },
    baseOrigin: new URL(config.baseUrl).origin,
    requesterSeat: config.requesterSeat,
    replacementCount: rig?.replacementCount ?? 0,
    finalWave: rig?.activeBattleWave ?? null,
    marketCoverage: rig?.marketCoverage ?? null,
    browserArtifact: preview
      ? {
          sha: preview.manifest.sha,
          digest: preview.manifest.digest,
          apiOrigin: preview.manifest.apiOrigin,
          signalOrigin: preview.manifest.signalOrigin,
          entryContract: preview.manifest.entryContract,
          assetSha: preview.manifest.assetSha,
        }
      : null,
    error: failure
      ? {
          name: failure.name,
          message: failure.message,
          stack: failure.stack,
        }
      : null,
  };
  await writeFile(resolve(config.artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

if (failure) {
  console.error(failure.stack ?? failure.message);
} else {
  console.log(
    `Public-UI campaign (${policy.targetWaves} waves, ${policy.renderProfile}) passed; evidence: ${config.artifactDir}`,
  );
}
