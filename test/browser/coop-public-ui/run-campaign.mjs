#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCampaign } from "./campaign.mjs";
import { loadCampaignPolicy } from "./campaign-policy.mjs";
import { loadConfig } from "./config.mjs";
import { startSealedPreview } from "./preview-server.mjs";
import { DuoPublicUiRig } from "./public-ui-harness.mjs";
import { raceJourneyWithTerminal } from "./terminal-watchdog.mjs";

// The campaign reuses the exact sealed-artifact + two-context boot the journeys use;
// only the driven surface set differs (a full >=30-wave co-op run vs. the wave-2 probes).
const config = loadConfig();
const policy = loadCampaignPolicy();
await mkdir(config.artifactDir, { recursive: true });

const startedAt = new Date();
let rig;
let preview;
let failure = null;

try {
  preview = await startSealedPreview(config);
  rig = await DuoPublicUiRig.launch(config);
  // Fast-abort on a known-fatal terminal marker instead of riding out generic timeouts.
  await raceJourneyWithTerminal(Object.values(rig.clients), runCampaign(rig));
  rig.assertClean();
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  process.exitCode = 1;
  if (rig) {
    await Promise.all(Object.values(rig.clients).map(client => client.checkpoint("campaign-failed").catch(() => {})));
  }
} finally {
  if (rig) {
    await rig.close().catch(error => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      process.exitCode = 1;
    });
  }
  if (preview) {
    await preview.close().catch(error => {
      failure ??= error instanceof Error ? error : new Error(String(error));
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
