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
const sessionController = readFileSync(new URL("src/data/elite-redux/coop/coop-session-controller.ts", root), "utf8");
const duoHarness = readFileSync(new URL("test/tools/coop-duo-harness.ts", root), "utf8");
const phaseManager = readFileSync(new URL("src/phase-manager.ts", root), "utf8");
const commandPhase = readFileSync(new URL("src/phases/command-phase.ts", root), "utf8");
const battleEndPhase = readFileSync(new URL("src/phases/battle-end-phase.ts", root), "utf8");
const replayPhases = readFileSync(new URL("src/phases/coop-replay-phases.ts", root), "utf8");
const crossroadsPhase = readFileSync(new URL("src/phases/er-crossroads-phase.ts", root), "utf8");
const selectBiomePhase = readFileSync(new URL("src/phases/select-biome-phase.ts", root), "utf8");
const titlePhase = readFileSync(new URL("src/phases/title-phase.ts", root), "utf8");
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
  assert.match(projector, /phaseManager\.clearPhaseQueue\(\)/u);
  assert.match(projector, /current\.end\(\)/u);
  assert.match(
    projector,
    /projected exact mystery generation/u,
    "the authenticated successor replaces a stuck local predecessor",
  );
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

test("Crossroads result envelopes retain the exact V2 control turn instead of a legacy turn-zero sentinel", () => {
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
    coopRuntime,
    /create\("ErCrossroadsPhase", plan\.sourceWave, control\.turn\)[\s\S]*installCoopV2CrossroadsProjection\(plan\.operationId, plan\.sourceWave, control\.turn\)/u,
    "ordinary and recovery projection pass the authority-stated turn into Crossroads",
  );
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
});
