#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from "node:fs/promises";

const files = ["public-ui-harness.mjs", "journeys.mjs", "run.mjs", "deployed-surface.mjs"];
const forbidden = [
  /(?:^|["'])\.\.\/\.\.\/\.\.\/src\//mu,
  /applyResync/u,
  /gameData/u,
  /getCurrentPhase/u,
  /indexedDB/u,
  /localStorage\.setItem/u,
  /phaseQueue/u,
  /RTCDataChannel/u,
  /RTCPeerConnection/u,
  /WebSocket/u,
  /page\.evaluateOnNewDocument/u,
  /page\.exposeFunction/u,
];

const failures = [];
const sources = new Map();
for (const file of files) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  sources.set(file, source);
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      failures.push(`${file}: forbidden private-state boundary ${pattern}`);
    }
  }
}

const harness = sources.get("public-ui-harness.mjs");
const run = sources.get("run.mjs");
const evaluateCalls = harness?.match(/page\.evaluate\(/gu)?.length ?? 0;
if (evaluateCalls !== 1 || !harness?.includes("document.activeElement.blur()")) {
  failures.push(
    "public-ui-harness.mjs: page.evaluate must remain the single DOM-focus blur operation; do not inspect game state",
  );
}
if (!run?.includes("captureDeployedSurface(config)") || !run.includes("assertStableDeployedSurface")) {
  failures.push("run.mjs: deployed staging surface must be sealed and compared before/after every journey");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public browser boundary verified across ${files.length} executable files`);
}
