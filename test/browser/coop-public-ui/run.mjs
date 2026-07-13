#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { runJourney } from "./journeys.mjs";
import { DuoPublicUiRig } from "./public-ui-harness.mjs";

const config = loadConfig();
await mkdir(config.artifactDir, { recursive: true });

const startedAt = new Date();
let rig;
let failure = null;

try {
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
