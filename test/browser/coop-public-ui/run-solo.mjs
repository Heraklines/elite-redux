#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { loadConfig } from "./config.mjs";
import { startSealedPreview } from "./preview-server.mjs";
import { PublicUiClient } from "./public-ui-harness.mjs";
import { runSoloClassic } from "./solo-classic.mjs";
import { raceJourneyWithTerminal } from "./terminal-watchdog.mjs";

// Single-context solo classic run: proves the state-aware navigation primitive against the
// v2 semantic mirror with NO co-op pairing (independent of co-op signaling). Reuses the exact
// sealed-artifact boot, PublicUiClient login/keyboard input, and evidence sink.
const config = loadConfig();
await mkdir(config.artifactDir, { recursive: true });

const startedAt = new Date();
let browser;
let client;
let preview;
let failure = null;

try {
  preview = await startSealedPreview(config);
  browser = await puppeteer.launch({
    headless: config.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.createBrowserContext();
  client = new PublicUiClient(context, config.credentials.hostSeat, config);
  await client.init();
  await raceJourneyWithTerminal([client], runSoloClassic(client));
  client.evidence.assertClean();
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  process.exitCode = 1;
  if (client) {
    await client.checkpoint("solo-failed").catch(() => {});
  }
} finally {
  if (client) {
    await client.checkpoint("solo-final-flush").catch(() => {});
    await client.evidence.flush().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (preview) {
    await preview.close().catch(error => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      process.exitCode = 1;
    });
  }

  const finishedAt = new Date();
  const summary = {
    journey: "solo-classic",
    status: failure ? "failed" : "passed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    baseOrigin: new URL(config.baseUrl).origin,
    browserArtifact: preview
      ? { sha: preview.manifest.sha, digest: preview.manifest.digest, entryContract: preview.manifest.entryContract }
      : null,
    error: failure ? { name: failure.name, message: failure.message, stack: failure.stack } : null,
  };
  await writeFile(resolve(config.artifactDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

if (failure) {
  console.error(failure.stack ?? failure.message);
} else {
  console.log(`Public-UI solo-classic journey passed; evidence: ${config.artifactDir}`);
}
