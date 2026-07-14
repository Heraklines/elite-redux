#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from "node:fs/promises";

const files = [
  "public-ui-harness.mjs",
  "journeys.mjs",
  "run.mjs",
  "evidence.mjs",
  "preview-server.mjs",
  "provision-accounts.mjs",
  "vite.config.mjs",
];
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
const evaluateCalls = harness?.match(/page\.evaluate\(/gu)?.length ?? 0;
if (evaluateCalls !== 1 || !harness?.includes("document.activeElement.blur()")) {
  failures.push(
    "public-ui-harness.mjs: page.evaluate must remain the single DOM-focus blur operation; do not inspect game state",
  );
}

const run = sources.get("run.mjs");
const preview = sources.get("preview-server.mjs");
const provision = sources.get("provision-accounts.mjs");
const viteConfig = sources.get("vite.config.mjs");
if (!run?.includes("startSealedPreview(config)")) {
  failures.push("run.mjs: every gameplay journey must start from a verified sealed browser artifact");
}
if (
  !preview?.includes('"--verify"')
  || !preview.includes('config.browserDist, "_redirects"')
  || !preview.includes("Location: redirected")
  || /safeStaticFile\([^,]+,\s*["']src/gu.test(preview)
) {
  failures.push(
    "preview-server.mjs: preview must verify the immutable manifest, honor pinned production asset redirects, and never mount game source",
  );
}
if (!viteConfig?.includes("SOURCE_ENTRY") || !viteConfig.includes("sourceEntryReplaced")) {
  failures.push("vite.config.mjs: exact-SHA browser build entry replacement must stay explicit and idempotent");
}
if (!provision?.includes("randomBytes") || /fetch\s*\(|["'`]\/coop\//u.test(provision)) {
  failures.push("provision-accounts.mjs: fixture setup may generate credentials but must not call any API");
}

const browserEntry = await readFile(new URL("../../../scripts/coop-browser-entry.ts", import.meta.url), "utf8");
if (
  !browserEntry.includes("surfaceObserverVersion: 1")
  || !browserEntry.includes("[coop-browser:binding]")
  || !browserEntry.includes("seat: runtime.controller.seat")
  || !browserEntry.includes("ui.getHandler().active")
  || !browserEntry.includes("computeMechanicalDigest(")
  || browserEntry.includes("captureCoopChecksumState")
) {
  failures.push("coop-browser-entry.ts: missing the read-only rendered-surface/address/digest observer contract");
}
if (
  !browserEntry.includes('phase === "ExpPhase"')
  || !browserEntry.includes('surfaceId: "battle:exp"')
  || !browserEntry.includes("isAwaitingPromptAction")
  || !browserEntry.includes("phaseInstance: semanticPhaseInstance")
) {
  failures.push("coop-browser-entry.ts: EXP prompts must expose complete actionable readiness to the public driver");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public browser boundary verified across ${files.length} executable files`);
}
