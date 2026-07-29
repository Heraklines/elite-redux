/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8").replace(/\r\n/gu, "\n");
const catchFull = read("src/data/elite-redux/coop/coop-catch-full.ts");
const revivalOwner = read("src/phases/revival-blessing-phase.ts");
const revivalWatcher = read("src/phases/coop-guest-revival-phase.ts");
const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");
const lease = read("src/data/elite-redux/coop/authority-v2/human-input-lease.ts");
const catchFullDuo = read("test/tests/elite-redux/coop/coop-duo-catch-full.test.ts");

function assertProofGatedExternalWait(source, label) {
  const proof = source.indexOf("armCoopV2InteractionOwnerWindowAfterControlProof(");
  const externalWait = source.indexOf("null,", proof);
  const signal = source.indexOf("lease.signal", externalWait);
  const expiry = source.indexOf("lease.expired()", signal);
  assert.ok(
    proof >= 0 && externalWait > proof && signal > externalWait && expiry > signal,
    `${label} must prove exact control, then use an unclocked relay wait governed only by its lease`,
  );
}

test("catch-full and Revival start V2 decision time only after exact PARTY control proof", () => {
  assertProofGatedExternalWait(catchFull, "catch-full");
  assertProofGatedExternalWait(revivalOwner, "guest-owned Revival");

  const catchLegacy = catchFull.slice(catchFull.indexOf("if (!isCoopV2InteractionCutoverActive"));
  assert.match(catchLegacy, /getCoopFaintSwitchWaitMs\(\)/u, "legacy catch-full keeps its existing timeout");
  assert.match(
    revivalOwner.slice(revivalOwner.indexOf("lease.expired()")),
    /outcome\.kind === "fallback"[\s\S]*party\.findIndex/u,
    "only the explicit expired-lease verdict reaches Revival's deterministic fallback",
  );

  const watcher = revivalWatcher.slice(revivalWatcher.indexOf("private async awaitHostOwnedDecision("));
  assert.match(watcher, /const v2 = isCoopRevivalAuthorityV2Active\(operationBinding\)/u);
  assert.match(watcher, /v2 \? null : getCoopFaintSwitchWaitMs\(\)/u);
  assert.match(watcher, /getCoopV2InteractionRuntimeCancellationSignal/u);
  assert.doesNotMatch(
    watcher,
    /awaitInteractionChoice\(seq, getCoopFaintSwitchWaitMs\(\)/u,
    "the V2 watcher cannot burn a local wall timer while the host owner becomes actionable",
  );
});

test("the shared interaction lease is address-exact, control-proven, and recovery-fail-closed", () => {
  assert.ok(
    lease.indexOf("await Promise.race(") < lease.indexOf("ctx.scheduler.schedule("),
    "pre-actionability time cannot create a humanInput timer",
  );
  assert.match(lease, /ctx\.cancellation\.addEventListener\("abort", onAbort/u);
  assert.match(lease, /expired && !ctx\.cancellation\.aborted && controlProofIsCurrent\(\)/u);

  const ownerWindow = runtime.slice(
    runtime.indexOf("export async function armCoopV2InteractionOwnerWindowAfterControlProof("),
    runtime.indexOf("export function getCoopV2InteractionRuntimeCancellationSignal("),
  );
  assert.match(ownerWindow, /control\?\.kind !== "SHARED_INTERACTION"/u);
  assert.match(ownerWindow, /sourceEntryOf\(control\)/u);
  assert.match(ownerWindow, /waitForAuthorityPeerStage\([\s\S]*"controlInstalled"/u);
  assert.match(ownerWindow, /!isCoopV2AuthorityWaitCreationFrozen\(runtime\)/u);
  assert.match(ownerWindow, /expired: \(\) => expired/u);

  const surfaceReady = runtime.slice(
    runtime.indexOf("export function notifyCoopV2InteractionSurfaceReady("),
    runtime.indexOf("export function getCoopV2ActiveSharedInteractionOperationId("),
  );
  assert.match(surfaceReady, /const boundScene = runtimeSceneBindings\.get\(runtime\)/u);
  assert.match(surfaceReady, /active !== runtime \|\| \(boundScene != null && boundScene !== globalScene\)/u);
  assert.match(
    surfaceReady,
    /runWhenCoopRuntimeActive\(runtime, \(\) => notifyCoopV2InteractionSurfaceReady\(runtime\)\)/u,
    "an async public-surface continuation must rebind the exact runtime and scene before attesting control",
  );
});

test("the catch-full duo drives only a manager-owned, control-installed public picker", () => {
  const revivalPromptHandler = runtime.slice(
    runtime.indexOf("interactionRelay.onRevivalPrompt ="),
    runtime.indexOf("interactionRelay.onCatchFullPrompt ="),
  );
  assert.match(
    revivalPromptHandler,
    /isCoopV2InteractionCutoverActive\(runtime\.durability\)[\s\S]+return;[\s\S]+(?:create|overridePhase)\(/u,
    "the raw Revival compatibility prompt cannot construct or rebind UI after V2 owns the surface",
  );

  const promptHandler = runtime.slice(
    runtime.indexOf("interactionRelay.onCatchFullPrompt ="),
    runtime.indexOf("// #807: a fresh SESSION", runtime.indexOf("interactionRelay.onCatchFullPrompt =")),
  );
  assert.match(
    promptHandler,
    /isCoopV2InteractionCutoverActive\(runtime\.durability\)[\s\S]+return;[\s\S]+unshiftNew\("CoopGuestCatchFullPhase"/u,
    "the raw compatibility prompt cannot create a second picker after V2 owns interaction authority",
  );

  const guestDrive = catchFullDuo.slice(catchFullDuo.indexOf("// ===== (B/C) GUEST:"));
  const drain = guestDrive.indexOf("await drainLoopback()");
  const currentProof = guestDrive.indexOf("getCurrentPhase()", drain);
  const noDuplicate = guestDrive.indexOf('phaseQueue.find("CoopGuestCatchFullPhase")', currentProof);
  const harnessStart = guestDrive.indexOf("guestPicker.start()", noDuplicate);
  const installedProof = guestDrive.indexOf("v2ControlLedger.activeControl", harnessStart);
  const exactAddress = guestDrive.indexOf(
    "installed.operationId === guestPicker.coopV2ControlOperationId",
    installedProof,
  );
  const click = guestDrive.indexOf("partyPicker.current?.(OWNER_PICK_SLOT)", exactAddress);

  assert.ok(
    drain >= 0
      && currentProof > drain
      && noDuplicate > currentProof
      && harnessStart > noDuplicate
      && installedProof > harnessStart
      && exactAddress > installedProof
      && click > exactAddress,
    "the harness must reproduce V2 projection, manager ownership, its one suppressed start edge, exact controlInstalled, and no legacy duplicate before the public click",
  );
  assert.doesNotMatch(
    guestDrive.slice(0, click),
    /\(guestPicker as Phase\)\.start\(\)[\s\S]*await Promise\.resolve\(\)/u,
    "a detached phase plus one microtask is not evidence that a browser-owned V2 surface is actionable",
  );
  assert.doesNotMatch(guestDrive.slice(0, click), /replaceWithCoopAuthoritativePhase/u);
  assert.equal(
    [...guestDrive.slice(0, click).matchAll(/guestPicker\.start\(\)/gu)].length,
    1,
    "the headless harness restores only its one intentionally suppressed manager start",
  );
});
