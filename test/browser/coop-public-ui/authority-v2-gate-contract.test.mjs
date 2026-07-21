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
const journeyWorkflow = readFileSync(new URL(".github/workflows/coop-public-ui-journey.yml", root), "utf8");
const stagingWorkflow = readFileSync(new URL(".github/workflows/deploy-staging.yml", root), "utf8");
const coopRuntime = readFileSync(new URL("src/data/elite-redux/coop/coop-runtime.ts", root), "utf8");
const meOperation = readFileSync(new URL("src/data/elite-redux/coop/coop-me-operation.ts", root), "utf8");
const operationSurfaceRegistry = readFileSync(
  new URL("src/data/elite-redux/coop/coop-operation-surface-registry.ts", root),
  "utf8",
);
const sessionController = readFileSync(new URL("src/data/elite-redux/coop/coop-session-controller.ts", root), "utf8");
const duoHarness = readFileSync(new URL("test/tools/coop-duo-harness.ts", root), "utf8");
const phaseManager = readFileSync(new URL("src/phase-manager.ts", root), "utf8");
const commandPhase = readFileSync(new URL("src/phases/command-phase.ts", root), "utf8");
const turnInitPhase = readFileSync(new URL("src/phases/turn-init-phase.ts", root), "utf8");
const battleEndPhase = readFileSync(new URL("src/phases/battle-end-phase.ts", root), "utf8");
const victoryPhase = readFileSync(new URL("src/phases/victory-phase.ts", root), "utf8");
const mysteryEncounterPhases = readFileSync(new URL("src/phases/mystery-encounter-phases.ts", root), "utf8");
const erQuizPhase = readFileSync(new URL("src/phases/er-quiz-phase.ts", root), "utf8");
const guestFaintSwitchPhase = readFileSync(new URL("src/phases/coop-guest-faint-switch-phase.ts", root), "utf8");
const pushReplacementCheckpointPhase = readFileSync(
  new URL("src/phases/coop-push-replacement-checkpoint-phase.ts", root),
  "utf8",
);
const replayPhases = readFileSync(new URL("src/phases/coop-replay-phases.ts", root), "utf8");
const replayTurnPhase = readFileSync(new URL("src/phases/coop-replay-turn-phase.ts", root), "utf8");
const replayMePhase = readFileSync(new URL("src/phases/coop-replay-me-phase.ts", root), "utf8");
const crossroadsPhase = readFileSync(new URL("src/phases/er-crossroads-phase.ts", root), "utf8");
const selectBiomePhase = readFileSync(new URL("src/phases/select-biome-phase.ts", root), "utf8");
const biomeShopPhase = readFileSync(new URL("src/phases/biome-shop-phase.ts", root), "utf8");
const soakDriver = readFileSync(new URL("test/tools/coop-soak-driver.ts", root), "utf8");
const hostFaintSoak = readFileSync(new URL("test/tests/elite-redux/coop/coop-soak-host-faint.test.ts", root), "utf8");
const switchPhase = readFileSync(new URL("src/phases/switch-phase.ts", root), "utf8");
const titlePhase = readFileSync(new URL("src/phases/title-phase.ts", root), "utf8");
const shadow = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/shadow.ts", root), "utf8");
const waveAdapter = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts", root),
  "utf8",
);
const replacementAdapter = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts", root),
  "utf8",
);
const interactionCutover = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/cutover-interaction.ts", root),
  "utf8",
);
const nextControl = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/next-control.ts", root), "utf8");
const controlLedger = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/control-ledger.ts", root), "utf8");
const proposalAdmission = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/proposal-admission.ts", root),
  "utf8",
);
const interactionRelay = readFileSync(new URL("src/data/elite-redux/coop/coop-interaction-relay.ts", root), "utf8");
const rewardOperation = readFileSync(new URL("src/data/elite-redux/coop/coop-reward-operation.ts", root), "utf8");
const biomeOperation = readFileSync(new URL("src/data/elite-redux/coop/coop-biome-operation.ts", root), "utf8");
const selectModifierPhase = readFileSync(new URL("src/phases/select-modifier-phase.ts", root), "utf8");
const rendererGate = readFileSync(new URL("src/data/elite-redux/coop/coop-renderer-gate.ts", root), "utf8");
const switchBiomePhase = readFileSync(new URL("src/phases/switch-biome-phase.ts", root), "utf8");

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
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_TURN=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_REPLACEMENT=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_WAVE=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_INTERACTION=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_RECOVERY=on"/u);
});

test("Showdown cannot skip the shared epoch/run/binding boundary when it skips save discovery", () => {
  const branchStart = titlePhase.indexOf('if (sessionKind === "versus") {');
  const branchEnd = titlePhase.indexOf("\n        void controller", branchStart + 1);
  assert.notEqual(branchStart, -1, "title phase owns an explicit versus launch path");
  assert.ok(branchEnd > branchStart, "the versus branch ends before ordinary co-op save discovery");
  const versus = titlePhase.slice(branchStart, branchEnd);
  const checksCompatibility = versus.indexOf(".awaitPartnerCompatibility()");
  const commitsFreshIdentity = versus.indexOf(".sendResumeStartNew()");
  const waitsForBinding = versus.indexOf("controller.awaitGameplayBinding()");
  const entersRun = versus.indexOf("startNewRun()");
  assert.ok(checksCompatibility >= 0, "versus proves the opponent build before launch");
  assert.ok(commitsFreshIdentity > checksCompatibility, "the authority commits one shared fresh run/epoch");
  assert.ok(waitsForBinding > checksCompatibility, "both seats wait for the exact gameplay binding");
  assert.ok(entersRun > waitsForBinding, "battle entry is reachable only after binding proof");
  assert.doesNotMatch(versus, /getCoopResumeLobbySnapshot|findCoopResumeCandidate|loadSaveSlot/u);

  const waitStart = sessionController.indexOf("awaitGameplayBinding(");
  const waitEnd = sessionController.indexOf("\n  /** Tear down:", waitStart);
  assert.notEqual(waitStart, -1, "the controller exposes a bounded gameplay-binding barrier");
  assert.ok(waitEnd > waitStart, "the gameplay-binding barrier has a bounded source block");
  const wait = sessionController.slice(waitStart, waitEnd);
  assert.match(wait, /this\.exactP33BindingAxes\(\)/u);
  assert.match(wait, /this\.sessionEpochValue > 0 && isCoopRunId\(this\.runIdValue\)/u);
  assert.match(wait, /this\.p33BindingRejected \|\| this\.authenticatedProtocolViolation/u);
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

  const boundaryStart = coopRuntime.indexOf("function tryApplyCoopSettledWaveData(");
  const legacyStart = coopRuntime.indexOf("  const staged = getCoopStagedWaveAdvanceTransaction", boundaryStart);
  assert.notEqual(boundaryStart, -1, "the V2 wave DATA boundary has an executable integration edge");
  assert.ok(legacyStart > boundaryStart, "the V2 edge is bounded before the legacy fallback");
  const v2Boundary = coopRuntime.slice(boundaryStart, legacyStart);
  const appliesData = v2Boundary.indexOf("applyCoopV2WaveDataAtBoundary(runtime, transaction)");
  const completesEntry = v2Boundary.indexOf("retryPendingReplicaEntries()");
  assert.ok(appliesData >= 0, "the boundary first applies the complete immutable V2 wave image");
  assert.ok(
    completesEntry > appliesData,
    "the same boundary then installs AWAIT_SUCCESSOR before a later interaction presentation can deadlock it",
  );
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

test("recovery rebuilds wave terminals and installs a multi-target command supervisor without a fence cycle", () => {
  const waveStart = coopRuntime.indexOf("function prepareCoopV2RecoveryWaveTransaction(");
  const waveEnd = coopRuntime.indexOf("\n/**\n * Complete recovery integration", waveStart);
  assert.notEqual(waveStart, -1, "recovery has a dedicated immutable wave-frontier rebuilder");
  assert.ok(waveEnd > waveStart, "the wave-frontier rebuilder has a bounded source block");
  const waveRecovery = coopRuntime.slice(waveStart, waveEnd);
  assert.match(waveRecovery, /decodeCoopV2WaveTransaction\(entry\)/u);
  assert.match(waveRecovery, /transaction\.bootstrapProjected = true/u);
  assert.match(waveRecovery, /transaction\.dataApplied = true/u);
  assert.match(waveRecovery, /runtime\.v2WaveTransactions\.set/u);
  assert.doesNotMatch(
    waveRecovery,
    /pendingWaveAdvance|bootstrapCoopV2WaveTransaction/u,
    "snapshot recovery must not replay BattleEnd or consult an obsolete local wave latch",
  );

  const surfaceStart = coopRuntime.indexOf("function prepareCoopV2RecoveryControlSurface(");
  const surfaceEnd = coopRuntime.indexOf("\n/**\n * Rebuild the runtime-owned wave/terminal transaction", surfaceStart);
  assert.notEqual(surfaceStart, -1, "recovery exposes one exact control-surface constructor");
  assert.ok(surfaceEnd > surfaceStart, "the recovery surface constructor has a bounded source block");
  const surface = coopRuntime.slice(surfaceStart, surfaceEnd);
  assert.match(
    surface,
    /control\.kind === "TERMINAL"[\s\S]*matchingCoopV2WaveTransaction[\s\S]*pushNew\("GameOverPhase"/u,
    "terminal recovery reconstructs the runtime transaction and a real GameOver phase",
  );
  assert.match(surface, /runtime\.v2RecoveryCommandBootstrap = \{/u);
  assert.match(surface, /localTargetIds: localCommands\.map/u);
  assert.match(surface, /pushNew\("CommandPhase", fieldIndex\)/u);

  const proofStart = coopRuntime.indexOf("function isCoopV2RecoveryCommandBootstrapInstalled(");
  const proofEnd = coopRuntime.indexOf("\n/**", proofStart + 1);
  assert.notEqual(proofStart, -1, "recovery has an address-exact command bootstrap proof");
  assert.ok(proofEnd > proofStart, "the recovery command proof has a bounded source block");
  const proof = coopRuntime.slice(proofStart, proofEnd);
  assert.match(proof, /localTargetIds\.length !== bootstrap\.localTargetIds\.length/u);
  assert.match(proof, /runtime\.v2InstalledCommandTargets\.has\(firstTargetId\)/u);

  const liveProjectStart = coopRuntime.indexOf("projectControl: (");
  const liveProjectEnd = coopRuntime.indexOf("\n  };\n  return seams;", liveProjectStart);
  assert.ok(liveProjectStart >= 0 && liveProjectEnd > liveProjectStart, "live control projection is bounded");
  const liveProject = coopRuntime.slice(liveProjectStart, liveProjectEnd);
  assert.match(
    liveProject,
    /missing\.length > 0 && !isCoopV2RecoveryCommandBootstrapInstalled/u,
    "only an exact recovery bootstrap bypasses the ordinary all-target-live wait",
  );
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

test("ME_PRESENT DATA cannot wait on the successor phase that V2 projection must create", () => {
  const materialStart = coopRuntime.indexOf("function materializeCoopMeOperationFromOp(");
  const materialEnd = coopRuntime.indexOf("\ntype CoopV2InteractionLiveMaterializer", materialStart);
  assert.notEqual(materialStart, -1, "runtime exposes the registered Mystery materializer");
  assert.ok(materialEnd > materialStart, "Mystery materializer has a bounded source block");
  const materializer = coopRuntime.slice(materialStart, materialEnd);
  assert.match(materializer, /setCoopMeInteractionStart\(pinned\)/u);
  assert.match(
    materializer,
    /materializeCommittedInteractionOutcome\(seq,\s*payload\.presentation,\s*op\.id\)/u,
    "DATA installs the exact immutable presentation into the addressed relay",
  );
  assert.doesNotMatch(
    materializer,
    /installCoopV2MePresentation/u,
    "DATA must not require the successor phase before materialApplied",
  );

  const projectionStart = coopRuntime.indexOf("function prepareCoopV2OrdinaryInteractionControlSurface(");
  const projectionEnd = coopRuntime.indexOf(
    "\n/**\n * Construct the exact engine generation recovery",
    projectionStart,
  );
  assert.notEqual(projectionStart, -1, "runtime exposes the ordinary immutable interaction projector");
  assert.ok(projectionEnd > projectionStart, "ordinary interaction projector has a bounded source block");
  const projector = coopRuntime.slice(projectionStart, projectionEnd);
  assert.match(projector, /plan\.kind !== "mystery"/u);
  assert.match(projector, /materializeCoopV2InteractionProjection\(runtime, control, plan\)/u);
  assert.match(projector, /phaseManager\.replaceWithCoopAuthoritativePhase\(current, phase\)/u);
  assert.doesNotMatch(
    projector,
    /current\.end\(\)/u,
    "the obsolete local phase must not derive a successor after the ordered log did",
  );
  assert.match(
    projector,
    /projected exact mystery generation/u,
    "the authenticated successor replaces a stuck local predecessor",
  );
});

test("V2 Mystery waits for its ordered presentation and destructively replaces the local classifier", () => {
  const guestStart = mysteryEncounterPhases.indexOf("if (isCoopAuthoritativeGuest())");
  const guestEnd = mysteryEncounterPhases.indexOf(
    "// Clears out queued phases that are part of standard battle",
    guestStart,
  );
  assert.ok(guestStart >= 0, "the authoritative guest Mystery classifier exists");
  assert.ok(guestEnd > guestStart, "the guest classifier has a bounded source section");
  const guestClassifier = mysteryEncounterPhases.slice(guestStart, guestEnd);
  const cutover = guestClassifier.indexOf("isCoopV2InteractionCutoverActive(getCoopRuntime()?.durability)");
  const legacyPush = guestClassifier.indexOf('globalScene.phaseManager.pushNew("CoopReplayMePhase"');
  assert.ok(cutover >= 0, "V2 cutover is checked before deriving a local Mystery successor");
  assert.ok(legacyPush > cutover, "the legacy replay fallback remains strictly behind the V2 hold");
  assert.match(
    guestClassifier.slice(cutover, legacyPush),
    /return;/u,
    "V2 holds the classifier until the authenticated ME_PRESENT projector installs its successor",
  );

  const replacementStart = phaseManager.indexOf("public replaceWithCoopAuthoritativePhase(");
  const replacementEnd = phaseManager.indexOf("/**", replacementStart + 1);
  assert.ok(replacementStart >= 0, "the destructive Authority V2 phase replacement exists");
  assert.ok(replacementEnd > replacementStart, "the replacement has a bounded source section");
  const replacement = phaseManager.slice(replacementStart, replacementEnd);
  assert.match(replacement, /this\.currentPhase !== predecessor/u);
  assert.match(replacement, /this\.clearAllPhases\(\)/u);
  assert.match(replacement, /this\.currentPhase = successor/u);
  assert.match(replacement, /this\.startCurrentPhase\(\)/u);
  assert.doesNotMatch(
    replacement,
    /predecessor\.end\(\)/u,
    "the legacy predecessor never gets another chance to choose progression",
  );

  const harnessStart = duoHarness.indexOf("export async function startGuestMeReplay(");
  const harnessEnd = duoHarness.indexOf("/**", harnessStart + 1);
  assert.ok(harnessStart >= 0, "the two-engine Mystery scheduler exists");
  assert.ok(harnessEnd > harnessStart, "the Mystery scheduler has a bounded source section");
  const harness = duoHarness.slice(harnessStart, harnessEnd);
  assert.match(
    harness,
    /current\?\.phaseName === "CoopReplayMePhase" \? current : null/u,
    "the headless scheduler observes V2's directly installed phase rather than requiring a legacy queue tap",
  );
});

test("every Mystery result stays on the presentation's pre-battle authority coordinate", () => {
  assert.match(meOperation, /export const COOP_ME_AUTHORITY_TURN = 0;/u);
  assert.match(
    meOperation,
    /if \(params\.turn !== COOP_ME_AUTHORITY_TURN\) \{\s+coopWarn\("me", `ME op OWNER rejected/u,
    "the runtime commit boundary also rejects an untyped or stale ambient turn",
  );
  assert.match(
    meOperation,
    /guest\(\)\.hasApplied\(id\) \? \{ epoch: s\.epoch, wave, turn: COOP_ME_AUTHORITY_TURN \} : null/u,
    "guest result proof returns the same fixed coordinate",
  );

  for (const functionName of [
    "commitCoopMeBattleSettlementAtBattleEnd",
    "commitCoopMeNoBattleRewardSettlementAfterPreparation",
    "coopMeOwnerRelayBattleHandoff",
  ]) {
    const start = coopRuntime.indexOf(`function ${functionName}(`);
    const end = coopRuntime.indexOf("\n/**", start + 1);
    assert.ok(start >= 0, `${functionName} exists`);
    assert.ok(end > start, `${functionName} has a bounded source section`);
    const source = coopRuntime.slice(start, end);
    assert.match(source, /kind: "ME_TERMINAL"/u, `${functionName} commits a Mystery terminal`);
    assert.match(
      source,
      /turn: COOP_ME_AUTHORITY_TURN/u,
      `${functionName} preserves the presentation's authority coordinate`,
    );
    assert.doesNotMatch(
      source,
      /turn: (?:battle\.turn|hostTurn)/u,
      `${functionName} must not borrow the battle's ambient turn for log ordering`,
    );
  }

  const mysteryCoordinates = mysteryEncounterPhases.match(/turn: COOP_ME_AUTHORITY_TURN/g) ?? [];
  assert.equal(
    mysteryCoordinates.length,
    4,
    "presentation, owner picks, and the no-battle terminal all share the fixed Mystery coordinate",
  );
});

test("Mystery projection construction cannot recursively attest an unopened handler", () => {
  const installerStart = replayMePhase.indexOf("public installCoopV2MePresentation(");
  const installerEnd = replayMePhase.indexOf("/**", installerStart + 1);
  assert.ok(installerStart >= 0, "the V2 Mystery presentation installer exists");
  assert.ok(installerEnd > installerStart, "the V2 Mystery presentation installer has a bounded source section");
  const installer = replayMePhase.slice(installerStart, installerEnd);
  assert.doesNotMatch(
    installer,
    /notifyCoopV2InteractionSurfaceReady/u,
    "constructing a replay phase must not re-enter projection before that phase owns a public handler",
  );

  const readinessStart = replayMePhase.indexOf("private openV2MysterySurface(");
  const readinessEnd = replayMePhase.indexOf("constructor(", readinessStart);
  assert.ok(readinessStart >= 0, "the live Mystery surface opener exists");
  assert.ok(readinessEnd > readinessStart, "the live Mystery surface opener has a bounded source section");
  const readiness = replayMePhase.slice(readinessStart, readinessEnd);
  assert.match(readiness, /openModeBounded\(UiMode\.MYSTERY_ENCOUNTER/u);
  assert.match(readiness, /boundaryStillLive\(\)/u);
  const openingIndex = readiness.indexOf("const opening = this.openModeBounded(");
  const immediateProofIndex = readiness.indexOf("notifyCoopV2InteractionSurfaceReady(this.boundRuntime)", openingIndex);
  const settledRetryIndex = readiness.indexOf("void opening.then(", immediateProofIndex);
  assert.ok(openingIndex >= 0, "the Mystery surface starts opening before it can attest control");
  assert.ok(
    immediateProofIndex > openingIndex && settledRetryIndex > immediateProofIndex,
    "the synchronously actionable handler is proved before public input can outrun the settled retry",
  );
  assert.match(
    readiness,
    /void opening\.then\([\s\S]*notifyCoopV2InteractionSurfaceReady\(this\.boundRuntime\)/u,
    "an asynchronously actionable Mystery handler retains its settled proof retry",
  );
});

test("biome-market readiness proves the exact actionable owner or fully armed watcher surface", () => {
  const readinessStart = biomeShopPhase.indexOf("private notifyCoopBiomeContinuationSurfaceReady(");
  const readinessEnd = biomeShopPhase.indexOf(
    "/** Never let a market continue against locally generated stock",
    readinessStart,
  );
  assert.ok(readinessStart >= 0, "the biome-market readiness publisher exists");
  assert.ok(readinessEnd > readinessStart, "the biome-market publisher has a bounded source section");
  const readiness = biomeShopPhase.slice(readinessStart, readinessEnd);
  assert.match(readiness, /coopAsyncBoundaryStillLive\(generation, wave, pinned\)/u);
  assert.match(readiness, /handler\?\.active === true/u);
  assert.match(readiness, /handler\.isCoopV2InputActionable\?\.\(\) === true/u);
  assert.match(readiness, /mode === UiMode\.BIOME_SHOP && actionable/u);
  assert.match(
    readiness,
    /this\.coopBiomeWatcherContinuationReady && mode === UiMode\.MESSAGE && actionable/u,
    "watcher readiness requires stock materialization and its live terminal consumer",
  );
  const interactionReady = readiness.indexOf("notifyCoopV2InteractionSurfaceReady(");
  const surfaceProof = readiness.indexOf("const publicSurface");
  assert.ok(interactionReady > surfaceProof, "V2 cannot retire before the concrete market surface is proven");
});

test("a committed replacement wake cannot be stranded behind its own turn finalizer", () => {
  const markStart = coopRuntime.indexOf("function markCoopV2ControlMaterialApplied(");
  const markEnd = coopRuntime.indexOf("\n}\n", markStart) + 2;
  assert.notEqual(markStart, -1, "runtime exposes the materialApplied successor edge");
  assert.ok(markEnd > markStart, "materialApplied successor edge has a bounded source block");
  const mark = coopRuntime.slice(markStart, markEnd);
  const reconstructsPicker = mark.indexOf("releaseCoopV2DeferredInteractionStarts");
  const releasesFinalizer = mark.indexOf("releaseCoopV2ParkedTurnBoundary");
  assert.ok(reconstructsPicker >= 0, "the exact deferred replacement picker is reconstructed");
  assert.ok(
    releasesFinalizer > reconstructsPicker,
    "the parked turn is released only after its exact replacement wake is queued",
  );

  const releaseStart = replayPhases.indexOf("public releaseForCoopV2Control(");
  const releaseEnd = replayPhases.indexOf("\n  private completeCoopV2ControlRelease(", releaseStart);
  assert.notEqual(releaseStart, -1, "the real finalizer exposes one authenticated release edge");
  assert.ok(releaseEnd > releaseStart, "the finalizer release edge has a bounded source block");
  const release = replayPhases.slice(releaseStart, releaseEnd);
  assert.match(release, /successor\.revision === this\.authorityRevision/u);
  assert.match(release, /statedControl\?\.kind === "REPLACEMENT"/u);
  assert.match(release, /controlIdOf\(successor\.nextControl\) === controlIdOf\(statedControl\)/u);
  assert.match(
    release,
    /successor\.revision === this\.authorityRevision \+ 1[\s\S]*statedControl\?\.kind === "REPLACEMENT"[\s\S]*successor\.kind === "REPLACEMENT_COMMIT"[\s\S]*successor\.operationId === statedControl\.operationId/u,
    "the executable replacement control releases only through its exact globally-next immutable result",
  );
  assert.match(release, /this\.authoritySuccessorReady \?\?= successor/u);

  const parkStart = replayPhases.indexOf("} else if (v2NoImmediateCommand) {");
  const parkEnd = replayPhases.indexOf("\n      } else {", parkStart);
  assert.notEqual(parkStart, -1, "the finalizer has an explicit non-command park");
  assert.ok(parkEnd > parkStart, "the non-command park has a bounded source block");
  const park = replayPhases.slice(parkStart, parkEnd);
  const marksParked = park.indexOf("this.awaitingAuthoritySuccessor = true");
  const consumesEarlyWake = park.indexOf("this.authoritySuccessorReady != null");
  assert.ok(
    marksParked >= 0 && consumesEarlyWake > marksParked,
    "a wake installed during receipt completion is consumed at the exact park decision",
  );
});

test("a materially complete non-control entry wakes the exact command frontier it already owns", () => {
  const markStart = coopRuntime.indexOf("function markCoopV2ControlMaterialApplied(");
  const markEnd = coopRuntime.indexOf("\n}\n", markStart) + 2;
  assert.notEqual(markStart, -1, "runtime exposes the shared material-terminal seam");
  assert.ok(markEnd > markStart, "material-terminal seam has a bounded source block");
  const mark = coopRuntime.slice(markStart, markEnd);
  assert.match(
    mark,
    /entry\.kind !== "CONTROL_COMMIT" && entry\.nextControl\.kind === "COMMAND_FRONTIER"[\s\S]*releaseCoopV2DeferredCommandStarts\(runtime, entry\.nextControl\)/u,
    "replacement/turn/wave entries release a CommandPhase parked while their own material was applying",
  );
});

test("ordinary replacement projection has an immutable fallback when cosmetic faint replay is absent", () => {
  const prepareStart = coopRuntime.indexOf("function prepareCoopV2OrdinaryReplacementControlSurface(");
  const prepareEnd = coopRuntime.indexOf("\n/**\n * Install an ordinary replica's exact V2 successor", prepareStart);
  assert.notEqual(prepareStart, -1, "runtime exposes the ordinary replacement projector");
  assert.ok(prepareEnd > prepareStart, "ordinary replacement projector has a bounded source block");
  const prepare = coopRuntime.slice(prepareStart, prepareEnd);
  const readsImmutableEntry = prepare.indexOf("v2ControlLedger.sourceEntryOf(control)");
  const checksExactControl = prepare.indexOf("controlsEqual(sourceEntry.nextControl, control)");
  const queuesExactPicker = prepare.indexOf('unshiftNew("CoopGuestFaintSwitchPhase"');
  const releasesFinalizer = prepare.lastIndexOf("releaseCoopV2ParkedTurnBoundary(runtime, sourceEntry)");
  assert.ok(readsImmutableEntry >= 0, "projection starts from the retained mechanical entry");
  assert.ok(checksExactControl > readsImmutableEntry, "the retained entry must state the identical control");
  assert.ok(
    queuesExactPicker > checksExactControl,
    "the exact picker is reconstructed without a faint-event side token",
  );
  assert.ok(
    releasesFinalizer > queuesExactPicker,
    "the predecessor finalizer cannot yield until the immutable picker wake exists",
  );

  const projectStart = coopRuntime.indexOf("function projectCoopV2InteractionControl(");
  const projectEnd = coopRuntime.indexOf("\n/**\n * Mark the exact globally-registered successor", projectStart);
  assert.notEqual(projectStart, -1, "runtime exposes the ordinary interaction projector");
  assert.ok(projectEnd > projectStart, "ordinary interaction projector has a bounded source block");
  const project = coopRuntime.slice(projectStart, projectEnd);
  assert.match(project, /prepareCoopV2OrdinaryReplacementControlSurface\(runtime, control\)/u);
});

test("replacement controls are proven by the real async PARTY surface and multi-faints advance one picker at a time", () => {
  const openParty = guestFaintSwitchPhase.indexOf("const openedParty = scene.ui.setMode(");
  const awaitParty = guestFaintSwitchPhase.indexOf("Promise.resolve(openedParty).then(", openParty);
  const notifyReady = guestFaintSwitchPhase.indexOf("notifyCoopV2InteractionSurfaceReady(runtime)", awaitParty);
  assert.notEqual(openParty, -1, "the replacement phase retains the real setMode completion");
  assert.ok(
    awaitParty > openParty && notifyReady > awaitParty,
    "control readiness is published only after PARTY's asynchronous public handler opens",
  );
  const ownerOpenParty = switchPhase.indexOf("const openedParty = scene.ui.setMode(");
  const ownerAwaitParty = switchPhase.indexOf("Promise.resolve(openedParty).then(", ownerOpenParty);
  const ownerNotifyReady = switchPhase.indexOf("notifyCoopV2InteractionSurfaceReady(ownerRuntime)", ownerAwaitParty);
  assert.notEqual(ownerOpenParty, -1, "the authority owner replacement retains the real setMode completion");
  assert.ok(
    ownerAwaitParty > ownerOpenParty && ownerNotifyReady > ownerAwaitParty,
    "the authority owner also proves control only after PARTY is public",
  );

  const successorStart = replacementAdapter.indexOf('case "next-replacement":');
  const successorEnd = replacementAdapter.indexOf('\n    case "terminal":', successorStart);
  assert.notEqual(successorStart, -1, "the replacement adapter exposes its ordered-chain successor");
  assert.ok(successorEnd > successorStart, "the ordered-chain successor has a bounded source block");
  const successor = replacementAdapter.slice(successorStart, successorEnd);
  assert.match(successor, /return successor\.control/u);

  assert.match(
    pushReplacementCheckpointPhase,
    /Every completed summon is now its own immutable V2 transaction/u,
    "each picker result is captured before the next modal can act",
  );
  assert.match(
    pushReplacementCheckpointPhase,
    /if \(!isCoopV2ReplacementCutoverActive\(\)\)[\s\S]*partySlotStillFainted/u,
    "only rollback/legacy mode retains the old whole-batch capture guard",
  );
  assert.match(
    pushReplacementCheckpointPhase,
    /v2\?\.kind === "no-pending"[\s\S]*refusing an unlogged compatibility checkpoint/u,
    "a full-V2 replacement carrier without its exact staged result fails closed instead of reviving legacy authority",
  );
  assert.match(
    replayTurnPhase,
    /envelope\.authorityNextControl\?\.kind === "REPLACEMENT"[\s\S]*acknowledgeReplacement\(envelope, "continuationReady"\)/u,
    "an intermediate complete carrier advances to its stated picker without demanding a command",
  );
});

test("TURN_RESOLVE prompts form a closed command-to-turn Authority V2 path", () => {
  assert.match(nextControl, /const TURN_RESOLVE_PROMPT_SURFACES = \{/u);
  for (const [kind, surface] of [
    ["CATCH_FULL", "op:catchFull"],
    ["LEARN_MOVE", "op:learnMove"],
    ["LEARN_MOVE_BATCH", "op:learnMove"],
    ["REVIVAL", "op:revival"],
  ]) {
    assert.match(nextControl, new RegExp(`${kind}: "${surface}"`, "u"));
  }
  assert.match(nextControl, /envelope\?\.logicalPhase === "TURN_RESOLVE"/u);
  assert.match(nextControl, /operation\?\.id === next\.operationId/u);
  assert.match(nextControl, /operation\.status === "applied"/u);
  assert.match(nextControl, /payload\?\.type === "prompt"/u);

  const turnResolveCases = interactionCutover.slice(
    interactionCutover.indexOf('case "REVIVAL":'),
    interactionCutover.indexOf('case "ME_PRESENT":'),
  );
  assert.match(
    turnResolveCases,
    /\["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"\]/u,
  );
  assert.match(
    coopRuntime,
    /authorityControl\?\.kind === "SHARED_INTERACTION"[\s\S]*v2DeferredCommandStarts\.set\(key,[\s\S]*return "deferred"/u,
    "a transient authority CommandPhase parks instead of aborting while the exact mid-turn interaction owns control",
  );
  assert.match(
    coopRuntime,
    /entry\.nextControl\.kind === "AWAIT_SUCCESSOR"[\s\S]*allowedKinds\.includes\("CONTROL_COMMIT"\)[\s\S]*resumeOneCoopV2DeferredAuthorityCommandStart/u,
    "the installed interaction successor wait retries the parked authority CommandPhase",
  );
});

test("Crossroads result envelopes retain the exact V2 control turn instead of a legacy turn-zero sentinel", () => {
  assert.match(
    victoryPhase,
    /const postBattleSettlementTurn = this\.coopSourceTurn \?\? globalScene\.currentBattle\.turn \+ 1/u,
    "local Victory advances once while retained Victory preserves its immutable V2 settlement turn",
  );
  assert.match(
    replayPhases,
    /pushNew\("VictoryPhase", battlerArg, false, pending\.wave, pending\.settledTurn\)/u,
    "the retained WAVE_ADVANCE turn reaches the guest Victory capsule without ambient re-derivation",
  );
  assert.match(
    victoryPhase,
    /pushNew\("ErCrossroadsPhase", currentWaveIndex, postBattleSettlementTurn\)/u,
    "Victory freezes Crossroads at the settlement turn shared by the terminal reward",
  );
  assert.match(
    victoryPhase,
    /pushNew\("SelectBiomePhase", currentWaveIndex, postBattleSettlementTurn\)/u,
    "the natural World Map successor uses the same exact settlement coordinate",
  );
  const ownerStart = crossroadsPhase.indexOf("private coopOwnerCommit(");
  const ownerEnd = crossroadsPhase.indexOf("\n  /**", ownerStart);
  assert.notEqual(ownerStart, -1, "Crossroads exposes the owner result seam");
  assert.ok(ownerEnd > ownerStart, "Crossroads owner result seam has a bounded source block");
  const ownerCommit = crossroadsPhase.slice(ownerStart, ownerEnd);

  const watcherStart = crossroadsPhase.indexOf("private applyCrossroadsWatcherDecision(");
  const watcherEnd = crossroadsPhase.indexOf("\n  private ", watcherStart + 1);
  assert.notEqual(watcherStart, -1, "Crossroads exposes the watcher result seam");
  assert.ok(watcherEnd > watcherStart, "Crossroads watcher result seam has a bounded source block");
  const watcherApply = crossroadsPhase.slice(watcherStart, watcherEnd);

  assert.match(ownerCommit, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(ownerCommit, /turn: 0/u);
  assert.match(watcherApply, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(watcherApply, /turn: 0/u);
  assert.match(
    crossroadsPhase,
    /enterCoopV2CrossroadsControlBoundary\(\{[\s\S]*sourceWave: wave,[\s\S]*sourceTurn: this\.coopSourceTurn/u,
    "the control-open receives the same constructor-captured coordinate as the result",
  );
  const crossroadsBoundaryStart = coopRuntime.indexOf("export function enterCoopV2CrossroadsControlBoundary(");
  const crossroadsBoundaryEnd = coopRuntime.indexOf("\nfunction commandStartKey(", crossroadsBoundaryStart);
  assert.notEqual(crossroadsBoundaryStart, -1, "runtime exposes the Crossroads control boundary");
  assert.ok(crossroadsBoundaryEnd > crossroadsBoundaryStart, "Crossroads control boundary has a bounded source block");
  const crossroadsBoundary = coopRuntime.slice(crossroadsBoundaryStart, crossroadsBoundaryEnd);
  assert.match(crossroadsBoundary, /captureCoopAuthoritativeBattleState\(input\.sourceTurn\)/u);
  assert.doesNotMatch(crossroadsBoundary, /captureCoopAuthoritativeBattleState\(battle\.turn\)/u);

  assert.match(
    coopRuntime,
    /create\("ErCrossroadsPhase", plan\.sourceWave, control\.turn\)[\s\S]*installCoopV2CrossroadsProjection\(plan\.operationId, plan\.sourceWave, control\.turn\)/u,
    "ordinary and recovery projection pass the authority-stated turn into Crossroads",
  );

  const ownerReadyStart = crossroadsPhase.indexOf("private publishCoopOwnerSurfaceWhenActionable(");
  const ownerReadyEnd = crossroadsPhase.indexOf("\n  /**", ownerReadyStart + 1);
  assert.notEqual(ownerReadyStart, -1, "Crossroads exposes a bounded owner actionability proof");
  assert.ok(ownerReadyEnd > ownerReadyStart, "Crossroads owner actionability proof has a bounded source block");
  const ownerReady = crossroadsPhase.slice(ownerReadyStart, ownerReadyEnd);
  const actionableCheck = ownerReady.indexOf("handler.isCoopV2InputActionable?.() === true");
  const controlProof = ownerReady.indexOf("notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime)");
  assert.ok(actionableCheck >= 0, "Crossroads checks the exact option handler's input-delay state");
  assert.ok(
    controlProof > actionableCheck,
    "Crossroads cannot publish controlInstalled before the handler is actionable",
  );
  assert.match(
    ownerReady,
    /runWhenCoopRuntimeActive\(this\.coopOwningRuntime, publish\)/u,
    "delayed Crossroads readiness re-enters the phase's own browser runtime",
  );
});

test("the learn-move soak proves the real guest UI-to-relay terminal before rebuilding combat", () => {
  const start = soakDriver.indexOf("const processLearnMoveWave = async");
  const end = soakDriver.indexOf(
    "\n  // ---------------------------------------------------------------------------",
    start + 1,
  );
  assert.notEqual(start, -1, "the representative soak exposes its learn-move wave");
  assert.ok(end > start, "the learn-move wave has a bounded source block");
  const learnMove = soakDriver.slice(start, end);
  const schedulesDestinations = learnMove.indexOf("setDestinationContextDelivery?.(destinationScheduled)");
  const createsHostPhase = learnMove.indexOf('phaseManager.create("LearnMoveBatchPhase"');
  const installsHostPhase = learnMove.indexOf("phaseManager.overridePhase(hostLearnPhase)");
  const startsHostPhase = learnMove.indexOf("hostLearnPhase.start()");
  const provesPhase = learnMove.indexOf('guestLearnPhase?.phaseName !== "CoopReplayLearnMoveBatchPhase"');
  const startsProvenPhase = learnMove.indexOf("guestLearnPhase.start()");
  const provesMode = learnMove.indexOf(
    'awaitClientUiMode(rig.guestCtx, UiMode.LEARN_MOVE_BATCH, "guest-owned learn-move batch")',
  );
  const firstInput = learnMove.indexOf('"learn-move select offered move"');
  const secondInput = learnMove.indexOf('"learn-move overwrite slot zero"');
  const provesTerminal = learnMove.indexOf("isCoopLearnMoveForwardInFlightEmpty()");
  assert.ok(schedulesDestinations >= 0, "transport callbacks are pinned to their destination browser");
  assert.ok(
    createsHostPhase >= 0 && installsHostPhase > createsHostPhase && startsHostPhase > installsHostPhase,
    "the host control proof belongs to the exact current LearnMoveBatchPhase, never a detached UI producer",
  );
  assert.ok(
    provesPhase > schedulesDestinations && startsProvenPhase > provesPhase && provesMode > startsProvenPhase,
    "the interceptor starts only the exact queue-owned replay phase before proving its public handler",
  );
  assert.ok(
    firstInput > provesMode && secondInput > firstInput,
    "both human button presses traverse the public input layer in order",
  );
  assert.ok(
    provesTerminal > secondInput,
    "the driver waits for the UI-to-relay-to-authority terminal instead of trusting shared fixture objects",
  );
});

test("the duo Mystery split cannot inject a choice before public V2 input is actionable", () => {
  const helperStart = duoHarness.indexOf("export function relayGuestMeOptionIndexOnly(");
  const helperEnd = duoHarness.indexOf("\n/**", helperStart + 1);
  assert.notEqual(helperStart, -1, "the duo harness exposes its context-safe Mystery proposal split");
  assert.ok(helperEnd > helperStart, "the Mystery proposal split has a bounded source block");
  const helper = duoHarness.slice(helperStart, helperEnd);
  const handlerActionable = helper.indexOf("handler.isCoopV2InputActionable?.() !== true");
  const v2InputGate = helper.indexOf("isCoopV2InteractionHumanInputFrozen()");
  const ownerCommit = helper.indexOf("commitMeOwnerIntent({");
  const relayDispatch = helper.indexOf("resend();", ownerCommit);
  assert.ok(handlerActionable >= 0, "the split observes the same actionable Mystery handler as a human");
  assert.ok(
    v2InputGate > handlerActionable,
    "the split crosses the production Authority V2 physical-input gate only after actionability",
  );
  assert.ok(
    ownerCommit > v2InputGate && relayDispatch > ownerCommit,
    "no owner intent or relay packet may precede the installed public control proof",
  );
  assert.match(
    helper,
    /relay\.sendInteractionChoice\(seam\.seq, "me", index, \[step\], undefined, operationId \?\? undefined\)/u,
    "the shared-process split must carry the same exact immutable proposal identity as the browser handler",
  );
  assert.match(
    helper,
    /resend: isCoopMeOperationJournalActive\(\) \? resend : undefined/u,
    "proposal retries must preserve that exact immutable identity",
  );

  const mysteryDriveStart = soakDriver.indexOf("hitMode(UiMode.MYSTERY_ENCOUNTER);");
  const mysteryDriveEnd = soakDriver.indexOf(
    "\n  // ---------------------------------------------------------------------------",
    mysteryDriveStart + 1,
  );
  assert.notEqual(mysteryDriveStart, -1, "the representative soak exposes its Mystery drive");
  assert.ok(mysteryDriveEnd > mysteryDriveStart, "the representative Mystery drive has a bounded source block");
  const mysteryDrive = soakDriver.slice(mysteryDriveStart, mysteryDriveEnd);
  assert.equal(
    [...mysteryDrive.matchAll(/relayGuestMeOptionIndexOnly\(/gu)].length,
    3,
    "every shared-process guest-owned Mystery path is inventoried",
  );
  assert.equal(
    [...mysteryDrive.matchAll(/awaitClientActionableUiMode\([\s\S]*?UiMode\.MYSTERY_ENCOUNTER/gu)].length,
    4,
    "both owners' battle-handoff and flat/nested paths await the real input boundary before direct helpers",
  );
  assert.equal(
    [...mysteryDrive.matchAll(/assertClientV2HumanInputLease\(rig\.hostCtx,/gu)].length,
    2,
    "both host-owned paths cross the production physical-input projector before their legacy engine helper",
  );

  const hostMysteryStart = mysteryEncounterPhases.indexOf("export class MysteryEncounterPhase extends Phase");
  const hostMysteryEnd = mysteryEncounterPhases.indexOf(
    "\nexport class MysteryEncounterOptionSelectedPhase",
    hostMysteryStart + 1,
  );
  assert.notEqual(hostMysteryStart, -1, "production exposes the authoritative host Mystery selector");
  assert.ok(hostMysteryEnd > hostMysteryStart, "the host Mystery selector has a bounded source block");
  const hostMystery = mysteryEncounterPhases.slice(hostMysteryStart, hostMysteryEnd);
  const addressField = hostMystery.indexOf("public coopV2ControlOperationId: string | null = null;");
  const presentationCommit = hostMystery.indexOf("const operationId = commitMeOwnerIntent({");
  const addressBind = hostMystery.indexOf("this.coopV2ControlOperationId = operationId;");
  const presentationGuard = hostMystery.indexOf("if (!this.coopHostStreamPresentation())");
  const selectorOpen = hostMystery.indexOf("setModeBoundedWhen(UiMode.MYSTERY_ENCOUNTER");
  assert.ok(addressField >= 0, "the live host phase carries its immutable ME_PRESENT address");
  assert.ok(
    presentationCommit > addressField && addressBind > presentationCommit,
    "the host binds the exact operation returned by the committed presentation",
  );
  assert.ok(
    presentationGuard > addressField && selectorOpen > presentationGuard,
    "runtime execution completes the presentation commit/bind guard before exposing the delayed selector",
  );
});

test("guest-owned Mystery control is installed only by an exact authority proposal wait", () => {
  assert.match(
    mysteryEncounterPhases,
    /awaitInteractionChoice\([\s\S]*?COOP_ME_PICK_CHOICE_KINDS,[\s\S]*?authorityControlOperationId \?\? undefined/u,
    "the authority arms the host wait at the exact phase-owned ME_PRESENT address",
  );
  assert.match(
    interactionRelay,
    /projectV2AuthorityProposalWait\(authorityWait\)/u,
    "the relay refuses to park an addressed V2 waiter unless the global ledger installs it",
  );
  assert.match(
    coopRuntime,
    /function projectCoopV2AuthorityProposalWait\([\s\S]*?projectAuthorityProposalWait\(/u,
    "the runtime derives and installs the proposal ingress through the one global control ledger",
  );
  assert.match(
    controlLedger,
    /kind: "authority-proposal-wait"/u,
    "a remote proposal wait is distinct from executable owner UI and cosmetic watcher UI",
  );
  assert.match(
    interactionRelay,
    /res == null && authorityWait != null[\s\S]*?revokeV2AuthorityProposalWait\(authorityWait\)/u,
    "timeout, cancellation, and supersession retire the exact waiter generation",
  );
});

test("every retained V2 interaction proposal is identity-idempotent before any later waiter", () => {
  assert.match(
    proposalAdmission,
    /return existing === proposal\.fingerprint \? "duplicate" : "conflict"/u,
    "one proposal ID has one immutable fingerprint for the whole epoch",
  );
  assert.match(
    proposalAdmission,
    /capacity-exhausted[\s\S]*Eviction would make a sufficiently late retry executable again/u,
    "the admission ledger fails closed instead of evicting exactly-once history",
  );
  assert.match(
    interactionRelay,
    /cosmeticOperationId: proposalOperationId/u,
    "the frozen interaction carrier transports the retained proposal's stable operation ID",
  );
  assert.match(
    interactionRelay,
    /v2GuestProposal[\s\S]*!isValidOperationId\(proposalOperationId\)[\s\S]*onV2AuthorityProposalViolation\(reason\)/u,
    "a new guest-owned interaction surface cannot silently send an unidentified V2 proposal",
  );
  assert.match(
    interactionRelay,
    /requiresV2GuestProposalIdentity\(msg\.kind\)[\s\S]*!isValidOperationId\(msg\.cosmeticOperationId\)[\s\S]*onV2AuthorityProposalViolation\(reason\)/u,
    "the authority rejects a forged unidentified proposal before FIFO admission",
  );
  assert.match(
    interactionRelay,
    /interactionAuthorityV2 && kind === "meBtn"[\s\S]*suppressed retired raw Mystery button[\s\S]*return;/u,
    "a V2 sender must not emit the obsolete Mystery button carrier",
  );
  assert.match(
    interactionRelay,
    /this\.isInteractionAuthorityV2\(\) && msg\.kind === "meBtn"[\s\S]*dropped retired raw Mystery button[\s\S]*return;/u,
    "a stale peer cannot inject an obsolete Mystery button into a V2 waiter or FIFO",
  );
  assert.match(
    interactionRelay,
    /if \(admission === "duplicate"\)[\s\S]*return;/u,
    "same-ID retries are dropped before the per-sequence FIFO can feed a later action",
  );
  assert.match(
    interactionRelay,
    /if \(admission !== "admitted"\)[\s\S]*onV2AuthorityProposalViolation\(reason\)/u,
    "same-ID conflicting material terminates instead of being reinterpreted",
  );
  assert.match(
    rewardOperation,
    /isCoopV2InteractionCutoverActive\(binding\?\.durability\)[\s\S]*params\.action\.operationId !== opId[\s\S]*proposal-operation-id-mismatch/u,
    "the authority accepts only the exact operation ID derived for its current shop ordinal",
  );
  assert.match(
    selectModifierPhase,
    /sendInteractionChoice\([\s\S]*this\.coopRewardSurface,[\s\S]*prepared\?\.operationId/u,
    "reward, reroll, lock, transfer, and check proposals carry the ID retained by the owner",
  );
  assert.match(
    biomeShopPhase,
    /retainCoopV2InteractionProposal\([\s\S]*operationId: preparedOperationId[\s\S]*resend/u,
    "non-terminal market purchases use the same durable identity lease",
  );
  assert.match(
    biomeOperation,
    /v2InteractionActive\(binding\) && params\.res\.operationId !== opId[\s\S]*proposal-operation-id-mismatch/u,
    "biome and crossroads choices must match the exact deterministic authority address",
  );
  assert.match(
    meOperation,
    /params\.operationId !== expectedOperationId[\s\S]*return \{ kind: "failed" \}/u,
    "Mystery option and sub-option retries cannot be reinterpreted under a later ordinal",
  );
});

test("Mystery dialogue and quiz verdicts retain the same address-exact human-input lease", () => {
  const mysteryProofStart = operationSurfaceRegistry.indexOf("  ME_PRESENT: {");
  const mysteryProofEnd = operationSurfaceRegistry.indexOf("\n  ME_SUB:", mysteryProofStart);
  assert.notEqual(mysteryProofStart, -1, "the V2 registry declares the Mystery presentation proof");
  assert.ok(mysteryProofEnd > mysteryProofStart, "the Mystery presentation proof has a bounded source block");
  const mysteryProof = operationSurfaceRegistry.slice(mysteryProofStart, mysteryProofEnd);
  assert.match(mysteryProof, /UiMode\.MYSTERY_ENCOUNTER/u);
  assert.match(
    mysteryProof,
    /UiMode\.MESSAGE/u,
    "selected-option dialogue remains actionable under the live ME_PRESENT address",
  );
  assert.match(mysteryProof, /"MysteryEncounterPhase"/u);
  assert.match(
    mysteryEncounterPhases,
    /continueEncounter\(\)[\s\S]*setMode\(UiMode\.MESSAGE\)\.then\(showNextDialogue\)/u,
  );

  const quizProofStart = operationSurfaceRegistry.indexOf("  QUIZ_ANSWER: {");
  const quizProofEnd = operationSurfaceRegistry.indexOf("\n  REVIVAL:", quizProofStart);
  assert.notEqual(quizProofStart, -1, "the V2 registry declares the quiz-answer proof");
  assert.ok(quizProofEnd > quizProofStart, "the quiz-answer proof has a bounded source block");
  const quizProof = operationSurfaceRegistry.slice(quizProofStart, quizProofEnd);
  assert.match(quizProof, /UiMode\.ER_QUIZ/u);
  assert.match(quizProof, /UiMode\.MESSAGE/u, "the answer verdict retains the live QUIZ_ANSWER address");
  assert.match(quizProof, /"ErQuizPhase"/u);
  assert.match(
    erQuizPhase,
    /onAnswer\(choice: number\)[\s\S]*setModeBoundedWhen\(UiMode\.MESSAGE[\s\S]*showText\([\s\S]*afterVerdict/u,
    "the production quiz crosses MESSAGE before the next ordered question",
  );

  assert.match(
    controlLedger,
    /installed\.observation\.phaseToken === observation\.phaseToken[\s\S]*claim\.installed =/u,
    "handler rebinding remains limited to the exact same phase generation",
  );
  assert.match(
    controlLedger,
    /installed\.phaseToken === observation\.phaseToken[\s\S]*installed\.handlerToken === observation\.handlerToken/u,
    "physical input still requires the exact newly installed handler token",
  );
});

test("the host-faint soak observes the actionable successor without consuming it", () => {
  assert.match(
    hostFaintSoak,
    /phaseInterceptor\.to\("CommandPhase", false\)/u,
    "the focused replacement proof stops at CommandPhase instead of running past the boundary under test",
  );
});

test("a retained V2 replacement is consumed before the next replica command can fence the queue", () => {
  const guestTurnStart = turnInitPhase.indexOf("private startAuthoritativeGuestInputTurn(): boolean");
  const guestTurnEnd = turnInitPhase.indexOf("\n  start()", guestTurnStart);
  assert.notEqual(guestTurnStart, -1, "TurnInit exposes the authoritative replica branch");
  assert.ok(guestTurnEnd > guestTurnStart, "the authoritative replica branch has a bounded source block");
  const guestTurn = turnInitPhase.slice(guestTurnStart, guestTurnEnd);
  const pendingProbe = guestTurn.indexOf("this.pendingAuthoritativeReplacementTurn()");
  const replacementReplay = guestTurn.indexOf('"CoopReplayTurnPhase"');
  const ordinaryCommand = guestTurn.indexOf('"CommandPhase"');
  assert.ok(pendingProbe >= 0, "the replica probes the exact retained replacement before queuing input");
  assert.ok(
    replacementReplay > pendingProbe && ordinaryCommand > replacementReplay,
    "replacement replay is structurally queued before the ordinary command path",
  );

  const probeStart = turnInitPhase.indexOf("private pendingAuthoritativeReplacementTurn(): number | null");
  const probeEnd = turnInitPhase.indexOf("\n  /**", probeStart + 1);
  assert.notEqual(probeStart, -1, "TurnInit exposes the retained replacement probe");
  assert.ok(probeEnd > probeStart, "the retained replacement probe has a bounded source block");
  const probe = turnInitPhase.slice(probeStart, probeEnd);
  assert.match(probe, /isCoopV2ReplacementCutoverActive\(\)/u);
  assert.match(probe, /pending\.epoch !== controller\.sessionEpoch/u);
  assert.match(probe, /pending\.wave !== currentWave/u);
  assert.match(probe, /pending\.turn !== currentTurn && pending\.turn !== currentTurn \+ 1/u);
});

test("a chained biome picker preserves its exact interaction coordinate through owner, watcher, and recovery", () => {
  const watcherStart = selectBiomePhase.indexOf("private async applyBiomeWatcherDecision(");
  const watcherEnd = selectBiomePhase.indexOf("\n  private ", watcherStart + 1);
  assert.notEqual(watcherStart, -1, "SelectBiome exposes the watcher result seam");
  assert.ok(watcherEnd > watcherStart, "SelectBiome watcher result seam has a bounded source block");
  const watcherApply = selectBiomePhase.slice(watcherStart, watcherEnd);

  const ownerStart = selectBiomePhase.indexOf("private coopRelayOwnerBiome(");
  const ownerEnd = selectBiomePhase.length;
  assert.notEqual(ownerStart, -1, "SelectBiome exposes the owner result seam");
  assert.ok(ownerEnd > ownerStart, "SelectBiome owner result seam has a bounded source block");
  const ownerCommit = selectBiomePhase.slice(ownerStart, ownerEnd);

  assert.match(watcherApply, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(watcherApply, /turn: 0/u);
  assert.match(ownerCommit, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(ownerCommit, /turn: 0/u);
  assert.match(
    coopRuntime,
    /create\("SelectBiomePhase", plan\.sourceWave, control\.turn\)[\s\S]*installCoopV2BiomeProjection\(plan\.operationId, plan\.sourceWave, control\.turn\)/u,
    "ordinary and recovery projection pass the authority-stated turn into the chained biome picker",
  );
  const readyStart = selectBiomePhase.indexOf("private publishCoopBiomeSurfaceWhenActionable(");
  const readyEnd = selectBiomePhase.indexOf("\n  private ", readyStart + 1);
  assert.notEqual(readyStart, -1, "SelectBiome exposes one bounded public-control proof");
  assert.ok(readyEnd > readyStart, "SelectBiome public-control proof has a bounded source block");
  const ready = selectBiomePhase.slice(readyStart, readyEnd);
  const actionableCheck = ready.indexOf("handler.isCoopV2InputActionable?.() === true");
  const interactionProof = ready.indexOf("notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime)");
  const continuationProof = ready.indexOf("notifyCoopWaveContinuationSurfaceReady(wave)");
  assert.ok(actionableCheck >= 0, "SelectBiome checks the exact World Map handler");
  assert.ok(
    interactionProof > actionableCheck,
    "SelectBiome cannot retire the chained V2 interaction before the World Map is actionable",
  );
  assert.ok(
    continuationProof > interactionProof,
    "the same actionable World Map proves V2 interaction control before the retained wave continuation",
  );
  assert.equal(
    [...selectBiomePhase.matchAll(/this\.publishCoopBiomeSurfaceWhenActionable\(generation, (?:wave|boundaryWave)\)/gu)]
      .length,
    2,
    "both the owner and watcher map paths publish through the same exact proof",
  );
});

test("overlapping duo scopes cannot overwrite a newer browser-local biome permit snapshot", () => {
  assert.match(
    duoHarness,
    /outgoing\.biomeStateSaveGeneration = \(outgoing\.biomeStateSaveGeneration \?\? 0\) \+ 1;[\s\S]*outgoing\.biomeState = snapshotBiomeModuleState\(\)/u,
    "cross-client preemption claims and persists the newest World Map snapshot",
  );
  assert.equal(
    [
      ...duoHarness.matchAll(
        /ctx\.biomeState !== undefined && ctx\.biomeStateSaveGeneration === biomeStateSaveGeneration/gu,
      ),
    ].length,
    2,
    "both synchronous and asynchronous client windows fence stale biome-state save-back",
  );
});

test("superseded control addresses can reopen without weakening live-address conflicts", () => {
  const registerStart = controlLedger.indexOf("registerEntry(entry: CoopAuthorityEntry): boolean");
  const registerEnd = controlLedger.indexOf("\n  /**", registerStart + 1);
  assert.notEqual(registerStart, -1, "the global ledger exposes its registration boundary");
  assert.ok(registerEnd > registerStart, "the registration boundary has a bounded source block");
  const register = controlLedger.slice(registerStart, registerEnd);
  assert.match(register, /if \(!prior\.superseded \|\| entry\.revision <= prior\.revision\) \{\s*return false;/u);
  assert.ok(
    register.indexOf("if (duplicate)") < register.indexOf("if (!prior.superseded"),
    "identical redelivery stays idempotent before a newer lease generation is considered",
  );
});

test("biome result materialization cannot invalidate its exact queued transition tail", () => {
  const adoptStart = rendererGate.indexOf("export function adoptCoopBiomeTransitionSwitchPermit(");
  const adoptEnd = rendererGate.indexOf("\nexport function markCoopBiomeTransitionHistoryRecorded", adoptStart);
  assert.notEqual(adoptStart, -1, "the renderer gate exposes the biome permit adopter");
  assert.ok(adoptEnd > adoptStart, "the biome permit adopter has a bounded source block");
  const adopt = rendererGate.slice(adoptStart, adoptEnd);
  assert.match(
    adopt,
    /const destinationAlreadyMaterialized =[\s\S]*permit\.destinationBiomeId === params\.sourceBiomeId[\s\S]*permit\.wave === params\.wave/u,
    "an exact same-wave destination state may precede first tail adoption",
  );
  assert.match(
    switchBiomePhase,
    /erRecordBiomeEntry\(permit\.sourceBiomeId as BiomeId\)/u,
    "history is derived from immutable source authority instead of the already-materialized arena",
  );
});

test("the replacement harness preserves an already-installed command frontier", () => {
  const helperStart = duoHarness.indexOf("export async function materializeGuestInputAfterReplacement(");
  const helperEnd = duoHarness.indexOf("\n/**", helperStart + 1);
  assert.notEqual(helperStart, -1, "the duo harness exposes its post-replacement materializer");
  assert.ok(helperEnd > helperStart, "the post-replacement materializer has a bounded source block");
  const helper = duoHarness.slice(helperStart, helperEnd);
  const commandReturn = helper.indexOf('if (scene.phaseManager.getCurrentPhase()?.phaseName === "CommandPhase")');
  const bootFallback = helper.indexOf("materializeMirroredGuestInputTurn(scene)");
  assert.ok(
    commandReturn >= 0 && bootFallback > commandReturn,
    "an exact V2 CommandPhase is retained before the mirrored-boot fallback is considered",
  );
});
