#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Boundary check for the NEW campaign driver files. check-public-boundary.mjs owns a
 * hardcoded list of the original harness files and must not be edited, so this sibling
 * checker applies the SAME private-state prohibitions to the campaign additions. The
 * campaign workflow runs both checkers. This file is itself excluded from the scan (like
 * the original checker) because it necessarily names the forbidden patterns.
 */

import { readFile } from "node:fs/promises";

const files = [
  "campaign-policy.mjs",
  "campaign.mjs",
  "run-campaign.mjs",
  "campaign-nav.mjs",
  "solo-classic.mjs",
  "run-solo.mjs",
  "terminal-watchdog.mjs",
];

// Mirror of check-public-boundary.mjs's private-state boundary: no game source import, no
// scene/phase/runtime access, no protocol injection, no persistence mutation.
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
  /__coopBrowserBridge/u,
  /globalScene/u,
  /getCoopRuntime/u,
  /captureCoop/u,
  /page\.evaluateOnNewDocument/u,
  /page\.exposeFunction/u,
  // The campaign driver only sends keyboard/DOM input through the harness; it must never
  // reach into the page for game state (the single allowed blur lives in the harness).
  /page\.evaluate\(/u,
];

const failures = [];
for (const file of files) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      failures.push(`${file}: forbidden private-state boundary ${pattern}`);
    }
  }
}

const campaign = await readFile(new URL("campaign.mjs", import.meta.url), "utf8");
if (
  !campaign.includes("currentSharedCommandAddress(clients, purpose)")
  || !campaign.includes("observedAddress === expectedAddress")
  || !campaign.includes("observation.ready?.handlerActive === true")
) {
  failures.push("campaign.mjs: battle prompt input must be address-exact and active-handler readiness-proven");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public campaign boundary verified across ${files.length} executable files`);
}
