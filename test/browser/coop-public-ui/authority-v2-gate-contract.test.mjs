/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const gateWorkflow = readFileSync(new URL(".github/workflows/coop-gate-sharded.yml", root), "utf8");
const campaignWorkflow = readFileSync(new URL(".github/workflows/coop-public-ui-campaign.yml", root), "utf8");
const stagingWorkflow = readFileSync(new URL(".github/workflows/deploy-staging.yml", root), "utf8");
const coopRuntime = readFileSync(new URL("src/data/elite-redux/coop/coop-runtime.ts", root), "utf8");
const duoHarness = readFileSync(new URL("test/tools/coop-duo-harness.ts", root), "utf8");
const phaseManager = readFileSync(new URL("src/phase-manager.ts", root), "utf8");
const commandPhase = readFileSync(new URL("src/phases/command-phase.ts", root), "utf8");
const battleEndPhase = readFileSync(new URL("src/phases/battle-end-phase.ts", root), "utf8");
const replayPhases = readFileSync(new URL("src/phases/coop-replay-phases.ts", root), "utf8");
const shadow = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/shadow.ts", root), "utf8");
const waveAdapter = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts", root),
  "utf8",
);

function jobBlock(workflow, job) {
  const lines = workflow.split(/\r?\n/gu);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `workflow contains the ${job} job`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^ {2}[a-z0-9-]+:\s*$/iu.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("every real-engine shard qualifies Authority V2 instead of hiding behind legacy", () => {
  const gate = jobBlock(gateWorkflow, "gate");
  assert.match(gate, /COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(gate, /node scripts\/run-coop-gate\.mjs/u);
  assert.doesNotMatch(
    gate,
    /COOP_AUTHORITY_V2_(?:TURN|REPLACEMENT|WAVE|INTERACTION|RECOVERY):\s*"(?:off|false|0)"/u,
    "the exhaustive gameplay matrix may never downgrade the production architecture",
  );
});

test("public-browser campaign and staging bundle qualify the same V2 cutover", () => {
  const browserBuild = jobBlock(gateWorkflow, "browser-build");
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_TURN=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_REPLACEMENT=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_WAVE=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_INTERACTION=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_RECOVERY=on"/u);
});

test("wave/terminal cutover carries full settled state and retires every legacy wave authority", () => {
  assert.match(waveAdapter, /interface CoopWaveTerminalAuthorityCarrierV2[\s\S]*authoritativeState: unknown/u);
  assert.match(waveAdapter, /interface CoopWaveTerminalAuthorityCarrierV2[\s\S]*transition: unknown/u);
  assert.match(coopRuntime, /entry\.kind === "WAVE_ADVANCE" \|\| entry\.kind === "TERMINAL_COMMIT"/u);
  assert.match(
    coopRuntime,
    /if \(entry\.kind === "WAVE_ADVANCE" \|\| entry\.kind === "TERMINAL_COMMIT"\)[\s\S]*?applyCoopV2WaveEntry\(runtime, entry\)[\s\S]*?markCoopV2ControlMaterialApplied\(runtime, entry\)/u,
  );
  assert.match(coopRuntime, /if \(isCoopV2WaveCutoverActive\(\)\)[\s\S]*commitCoopV2SettledWaveAdvance/u);
  assert.match(
    coopRuntime,
    /if \(isCoopV2WaveCutoverActive\(\)\)[\s\S]*\}\s*else\s*\{[\s\S]*commitWaveAdvanceOwnerIntent/u,
  );
  assert.match(replayPhases, /if \(!isCoopV2WaveCutoverActive\(\)\)[\s\S]*adoptWaveAdvanceWatcherChoice/u);
  assert.match(battleEndPhase, /getCoopPendingRetainedWaveBoundary\(\)/u);
  assert.match(shadow, /waveBoundarySubsumes\(this\.log\.retained\(\), input\.transition\.wave\)/u);
  assert.match(shadow, /terminalSubsumes\(this\.log\.retained\(\)\)/u);
});

test("correlated recovery is wired through all four production progression fences", () => {
  assert.match(commandPhase, /isCoopV2CommandAdmissionFrozen\(\)/u);
  assert.match(phaseManager, /replaceWithCoopRecoveryPhase/u);
  assert.match(phaseManager, /coopRecoveryProgressionFrozen\(\)/u);
  assert.match(shadow, /isMaterializationFrozen\(\).*"deferred"/su);
  assert.match(coopRuntime, /isAuthorityWaitCreationFrozen:\s*\(\)\s*=>/u);
  assert.match(coopRuntime, /queueCoopV2AtomicSnapshotApply/u);
  assert.match(coopRuntime, /retainUntilReleased/u);
});

test("an existing Authority V2 runtime rebinds only after the replacement channel is authenticated", () => {
  const start = coopRuntime.indexOf("export function getCoopV2Shadow(");
  const end = coopRuntime.indexOf("\nexport function ", start + 1);
  assert.notEqual(start, -1, "runtime exposes the Authority V2 harness resolver");
  assert.notEqual(end, -1, "runtime resolver has a bounded source block");
  const resolver = coopRuntime.slice(start, end);
  const identity = resolver.indexOf("const identity = resolveCoopV2ShadowIdentity(runtime);");
  const unavailable = resolver.indexOf("if (identity == null)");
  const existing = resolver.indexOf("const existing = coopV2ShadowHarnesses.get(runtime);");
  const rebind = resolver.indexOf("existing.rebindIdentity(identity);");
  assert.ok(identity >= 0 && unavailable > identity, "replacement identity is resolved and required");
  assert.ok(existing > unavailable && rebind > existing, "a retained harness is rebound only after identity proof");
  assert.match(resolver, /reasonCode:\s*"binding-mismatch"/u, "a rejected rebind fails the shared session closed");
});

test("a cold-resume or new-run epoch boundary replaces the V2 log instead of hot-rebinding it", () => {
  const start = coopRuntime.indexOf("const applyOperationEpoch = (epoch: number): void => {");
  const end = coopRuntime.indexOf("\n  };", start);
  assert.notEqual(start, -1, "runtime owns one epoch-boundary callback");
  assert.notEqual(end, -1, "epoch-boundary callback has a bounded source block");
  const callback = coopRuntime.slice(start, end);
  const detectsAdvance = callback.indexOf("authorityV2Epoch !== epoch");
  const disposes = callback.indexOf("disposeCoopV2Shadow(runtime);");
  const publishesEpoch = callback.indexOf("authorityV2Epoch = epoch;");
  const appliesEpoch = callback.indexOf("applyCoopOperationEpoch(epoch, waveOperationBinding)");
  assert.ok(detectsAdvance >= 0, "the callback distinguishes a hard epoch advance from same-epoch hot rejoin");
  assert.ok(disposes > detectsAdvance, "the prior epoch log is retired at the hard boundary");
  assert.ok(
    publishesEpoch > disposes && appliesEpoch > publishesEpoch,
    "the replacement epoch is published only after the old V2 authority is gone",
  );
});

test("the real command proof edge eagerly completes V2 and the duo fixture creates both browser controls", () => {
  const proofStart = coopRuntime.indexOf("export function recordCoopV2CommandControlStarted(");
  const proofEnd = coopRuntime.indexOf("\nexport function ", proofStart + 1);
  assert.notEqual(proofStart, -1, "runtime exposes the real CommandPhase proof chokepoint");
  assert.notEqual(proofEnd, -1, "command proof chokepoint has a bounded source block");
  const proof = coopRuntime.slice(proofStart, proofEnd);
  const records = proof.indexOf("v2InstalledCommandTargets.add");
  const schedulesRetry = proof.indexOf("scheduleCoopV2CommandProofRetry");
  assert.ok(records >= 0, "the real phase records its exact command target");
  assert.ok(schedulesRetry > records, "the real proof schedules replica completion after projection");

  const retryStart = coopRuntime.indexOf("function scheduleCoopV2CommandProofRetry(");
  const retryEnd = coopRuntime.indexOf("\n}\n", retryStart) + 2;
  assert.notEqual(retryStart, -1, "runtime exposes a coalesced command-proof retry helper");
  assert.ok(retryEnd > retryStart, "command-proof retry helper has a bounded source block");
  const retry = coopRuntime.slice(retryStart, retryEnd);
  const defersRetry = retry.indexOf("queueMicrotask");
  const waitsForRuntime = retry.indexOf("runWhenCoopRuntimeActive");
  const retriesReplica = retry.indexOf("retryPendingReplicaEntries");
  assert.ok(
    defersRetry >= 0 && waitsForRuntime > defersRetry && retriesReplica > waitsForRuntime,
    "replica completion is coalesced after the in-flight apply stack and runs under its destination runtime",
  );

  const buildStart = duoHarness.indexOf("export async function buildDuo(");
  const buildEnd = duoHarness.indexOf("\nexport async function remirrorWave(", buildStart);
  assert.notEqual(buildStart, -1, "duo harness exposes its shared builder");
  assert.notEqual(buildEnd, -1, "duo builder has a bounded source block");
  const build = duoHarness.slice(buildStart, buildEnd);
  const adoptsHost = build.indexOf("adoptAlreadyOpenHostCommandBoundary");
  const materializesGuest = build.indexOf("materializeMirroredGuestInputTurn");
  const startsGuest = build.indexOf("guestOwnCommand.start()");
  const marksGuest = build.indexOf("markRealGuestCommandBoundary");
  const restartsHost = build.indexOf("hostScene.phaseManager.getCurrentPhase().start()");
  assert.ok(adoptsHost >= 0, "the already-real host control is adopted");
  assert.ok(
    materializesGuest > adoptsHost
      && startsGuest > materializesGuest
      && marksGuest > startsGuest
      && restartsHost > marksGuest,
    "the synthetic second browser crosses the same TurnInit/Command/proof/pacing order as production",
  );
});
