#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { assertStableDeployedSurface, captureDeployedSurface } from "./deployed-surface.mjs";
import { runJourney } from "./journeys.mjs";
import { DuoPublicUiRig } from "./public-ui-harness.mjs";

const config = loadConfig();
await mkdir(config.artifactDir, { recursive: true });

const startedAt = new Date();
let rig;
let failure = null;
const deployedSurface = {
  before: null,
  after: null,
  stable: false,
  verificationError: null,
};

try {
  try {
    deployedSurface.before = await captureDeployedSurface(config);
    console.log(
      `[coop-public-ui] sealed deployed surface html=${deployedSurface.before.htmlSha256} `
        + `manifest=${deployedSurface.before.manifestSha256} assets=${deployedSurface.before.assetSha} `
        + `redirects=${deployedSurface.before.redirects.length}`,
    );
  } catch (error) {
    const surfaceFailure = error instanceof Error ? error : new Error(String(error));
    deployedSurface.verificationError = {
      name: surfaceFailure.name,
      message: surfaceFailure.message,
      stack: surfaceFailure.stack,
    };
    throw surfaceFailure;
  }
  rig = await DuoPublicUiRig.launch(config);
  await runJourney(rig, config.journey);
  rig.assertClean();
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  process.exitCode = 1;
  if (rig) {
    await Promise.all(Object.values(rig.clients).map(client => client.checkpoint("journey-failed").catch(() => {})));
  }
} finally {
  if (rig) {
    await rig.close().catch(error => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      process.exitCode = 1;
    });
  }
  if (deployedSurface.before) {
    try {
      deployedSurface.after = await captureDeployedSurface(config);
      assertStableDeployedSurface(deployedSurface.before, deployedSurface.after);
      deployedSurface.stable = true;
      console.log(
        `[coop-public-ui] deployed surface remained stable assets=${deployedSurface.after.assetSha} `
          + `html=${deployedSurface.after.htmlSha256}`,
      );
    } catch (error) {
      const surfaceFailure = error instanceof Error ? error : new Error(String(error));
      deployedSurface.verificationError = {
        name: surfaceFailure.name,
        message: surfaceFailure.message,
        stack: surfaceFailure.stack,
      };
      failure ??= surfaceFailure;
      process.exitCode = 1;
    }
  }

  const finishedAt = new Date();
  const summary = {
    journey: config.journey,
    status: failure ? "failed" : "passed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    baseOrigin: new URL(config.baseUrl).origin,
    requesterSeat: config.requesterSeat,
    replacementCount: rig?.replacementCount ?? 0,
    deployedSurface,
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
  console.log(`Public-UI journey ${config.journey} passed; evidence: ${config.artifactDir}`);
}
