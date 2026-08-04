/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8").replace(/\r\n/gu, "\n");
const learnMove = read("src/phases/learn-move-phase.ts");
const replay = read("src/phases/coop-replay-learn-move-phase.ts");
const operation = read("src/data/elite-redux/coop/coop-learn-move-operation.ts");
const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");
const manager = read("src/phase-manager.ts");
const duo = read("test/tests/elite-redux/coop/coop-duo-exploration.test.ts");

const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section ${start}`);
  return source.slice(from, to);
};

test("single-move V2 emits prompts/results only through the immutable authority log", () => {
  const prompt = section(
    operation,
    "export function sendCoopLearnMovePromptWithOperationId(",
    "export function sendCoopLearnMovePrompt(",
  );
  assert.match(prompt, /if \(!isCoopLearnMoveAuthorityV2Active\(binding\)\)/u);
  assert.match(prompt, /sendInteractionOutcome\([\s\S]*"learnMoveForward"/u);

  const hostResult = section(learnMove, "private coopRelayLearnResult(", "private async coopWatchLearnMove(");
  const prepare = hostResult.indexOf("this.prepareCoopV2LearnMoveDecision(");
  const v2Return = hostResult.indexOf("return;", prepare);
  const rawResult = hostResult.indexOf("sendInteractionChoice(", v2Return);
  assert.ok(
    prepare >= 0 && v2Return > prepare && rawResult > v2Return,
    "the V2 host prepares its exact result then returns before the legacy result broadcast",
  );
  assert.match(
    hostResult.slice(v2Return, rawResult),
    /if \(this\.coopOperationBinding != null && localRole === "host"\)/u,
    "the retained legacy branch remains available only below the V2 return",
  );
});

test("the authority closes the real phase, proves it, retains exact state, and only then rotates", () => {
  const terminal = section(
    learnMove,
    "private closeAndCommitPreparedCoopV2LearnMoveDecision(): boolean",
    "private endAfterCoopLearnMoveDecision(): void",
  );
  const capture = terminal.indexOf("captureCoopAuthoritativeBattleState(");
  const shift = terminal.indexOf("shiftPhaseThroughCoopAuthorityCommit(");
  const proof = terminal.indexOf("settleCoopV2InteractionOperation(", shift);
  const commit = terminal.indexOf("commitCoopLearnMoveDecision(", proof);
  const rotate = terminal.indexOf("advanceInteractionFromAuthoritativeCommit(", commit);
  assert.ok(
    capture >= 0 && shift > capture && proof > shift && commit > proof && rotate > commit,
    "state capture -> real phase close -> terminal proof -> immutable commit -> authoritative rotation",
  );
  assert.match(terminal, /authoritativeState: state/u);
  assert.match(terminal, /const learned = pending\.forgetSlot >= 0 && pending\.forgetSlot < pending\.maxMoveCount/u);
  assert.doesNotMatch(
    terminal,
    /advanceCoopInteractionForContinuation/u,
    "legacy continuation advancement cannot run inside the V2 terminal",
  );

  const scheduler = section(
    manager,
    "public shiftPhaseThroughCoopAuthorityCommit(",
    "/**\n   * Helper method to start and log the current phase.",
  );
  const callback = scheduler.lastIndexOf("commitAfterClose()");
  const start = scheduler.indexOf("this.startCurrentPhase()", callback);
  assert.ok(callback >= 0 && start > callback, "the queued successor cannot start before result retention succeeds");
  assert.match(
    scheduler,
    /const selectedSuccessor = this\.currentPhase;[\s\S]*startSelectedSuccessor = commitAfterClose\(\)[\s\S]*this\.currentPhase !== selectedSuccessor[\s\S]*!startSelectedSuccessor[\s\S]*this\.startCurrentPhase\(\)/u,
    "a V2 modal projected by the atomic callback owns its single start and suppresses the obsolete successor",
  );
  assert.match(
    scheduler,
    /const selectedAfterClose = this\.currentPhase;[\s\S]*const successorWasStarted = this\.startedPhases\.has\(selectedAfterClose\)[\s\S]*startSelectedSuccessor = commitAfterClose\(\)[\s\S]*if \(!successorWasStarted\) \{[\s\S]*this\.startCurrentPhase\(\)/u,
    "closing a projected modal starts a retained unstarted successor without restarting an ordinary predecessor",
  );
});

test("every host-owned prompt and decline continuation re-enters its captured V2 runtime", () => {
  const runtimeFence = section(learnMove, "private runInCoopV2Runtime<T>(", "constructor(\n");
  assert.match(runtimeFence, /const runtime = this\.coopOwningRuntime/u);
  assert.match(runtimeFence, /runWhenCoopRuntimeActive\(runtime/u);
  assert.match(runtimeFence, /getCoopRuntime\(\) !== runtime/u);
  assert.match(runtimeFence, /globalScene\.phaseManager\.getCurrentPhase\(\) !== this/u);
  assert.match(runtimeFence, /failCoopSharedSession\(reason\)/u);
  assert.match(runtimeFence, /this\.coopRuntimeActivations\.add\(cancel\)/u);
  assert.match(
    learnMove,
    /public override retire\(\): void[\s\S]+for \(const cancel of this\.coopRuntimeActivations\)[\s\S]+cancel\(\)[\s\S]+this\.coopRuntimeActivations\.clear\(\)/u,
    "destructive recovery cancels every promise tail still queued under the retired phase",
  );

  const replace = section(learnMove, "async replaceMoveCheck(", "async forgetMoveProcess(");
  assert.equal(
    [...replace.matchAll(/this\.runInCoopV2Runtime\(/gu)].length,
    4,
    "both introductory messages, the exact CONFIRM open, and readiness proof are runtime-bound",
  );
  const decline = section(learnMove, "async rejectMoveAndEnd(", "async learnMove(");
  assert.ok(
    [...decline.matchAll(/this\.runInCoopV2Runtime\(/gu)].length >= 5,
    "stop confirmation, terminal narration, close, reconsideration, and readiness cannot resume under the peer",
  );
});

test("guest-owned decisions confirm on the owner and cannot wait on host presentation input before retention", () => {
  const guestOwner = section(learnMove, "private coopGuestForwardOwnedLearnMove(", "/**\n   * ER Omniform");
  const stopMirror = guestOwner.indexOf("mirror?.endSession()");
  const stopPrompt = guestOwner.indexOf('i18next.t("battle:learnMoveStopTeaching"', stopMirror);
  const stopConfirm = guestOwner.indexOf("UiMode.CONFIRM", stopPrompt);
  const finalDecline = guestOwner.indexOf("finish(pokemon.getMaxMoveCount())", stopConfirm);
  assert.ok(
    stopMirror >= 0 && stopPrompt > stopMirror && stopConfirm > stopPrompt && finalDecline > stopConfirm,
    "the owner confirms a cancellation before the immutable decline proposal is sent",
  );

  const application = section(
    learnMove,
    "private applyPreparedCoopV2LearnMoveDecision(",
    "/**\n   * Close and retain one host-authored V2 decision",
  );
  assert.match(application, /this\.applyLearnMoveMutation\(forgetSlot, pokemon\)/u);
  assert.match(application, /this\.endAfterCoopLearnMoveDecision\(\)/u);
  assert.doesNotMatch(
    application,
    /showText(?:Promise)?\(/u,
    "a non-owner host presentation prompt cannot sit between admitted intent and immutable retention",
  );

  const result = section(learnMove, "private async applyForgetResult(", "/**\n   * Co-op AUTHORITATIVE dispatch");
  const immediateV2 = result.indexOf("this.applyPreparedCoopV2LearnMoveDecision(");
  const legacyNarration = result.indexOf("showTextPromise(", immediateV2);
  assert.ok(immediateV2 >= 0 && legacyNarration > immediateV2, "V2 exits before the legacy input-gated narration");
});

test("exact host/guest owner material is the sole replica release and duplicate delivery is idempotent", () => {
  const settle = section(
    runtime,
    "function settleCoopV2CommittedLearnMoveResult(",
    "function settleCoopV2CommittedLearnMoveBatchResult(",
  );
  assert.match(settle, /decodeCoopV2InteractionEnvelope\(sourceEntry\)/u);
  assert.match(settle, /sourceOperation\?\.kind !== "LEARN_MOVE"/u);
  assert.match(settle, /sourceOperation\.status !== "applied"/u);
  assert.match(settle, /JSON\.stringify\(sourceOperation\.payload\) !== JSON\.stringify\(payload\)/u);
  assert.match(settle, /runtime\.v2SettledInteractionOperations\.has\(operationId\)[\s\S]*return true/u);
  assert.match(settle, /sourceOperation\.owner,[\s\S]*runtime/u);

  const materializer = section(
    runtime,
    "function materializeCoopLearnMoveFromOp(",
    "type CoopV2InteractionLiveMaterializer",
  );
  const exactRelease = materializer.indexOf("settleCoopV2CommittedLearnMoveResult(");
  const rawCompatibility = materializer.indexOf("materializeCommittedInteractionChoice(", exactRelease);
  assert.ok(
    exactRelease >= 0 && rawCompatibility > exactRelease,
    "V2 returns through the exact consumer before the legacy raw-result materializer",
  );
  const promptStart = materializer.indexOf('if (payload.type === "prompt") {');
  const promptCutover = materializer.indexOf("if (isCoopV2InteractionCutoverActive", promptStart);
  const promptEnd = materializer.indexOf("if (isCoopV2InteractionCutoverActive", promptCutover + 1);
  const prompt = materializer.slice(promptStart, promptEnd);
  assert.ok(promptStart >= 0 && promptCutover > promptStart && promptEnd > promptCutover);
  assert.match(prompt, /isCoopV2InteractionCutoverActive\(runtime\.durability\)[\s\S]*return true/u);
  assert.ok(
    prompt.indexOf("return true") < prompt.indexOf("materializeCommittedInteractionOutcome("),
    "V2 prompt material is acknowledged before the legacy forward carrier can queue a duplicate picker",
  );

  const queueOwned = section(
    learnMove,
    "public settleCoopV2CommittedLearnMoveResult(",
    "private async coopHostForwardLearnMove(",
  );
  assert.match(queueOwned, /ownerSeatId !== coopSeatOfRole\(monOwner\)/u);
  assert.match(queueOwned, /this\.coopSubmittedV2ForgetSlot !== forgetSlot/u);
  assert.match(queueOwned, /!this\.coopAwaitingHostOwnedPresentation/u);
  assert.match(queueOwned, /const scene = globalScene/u);
  assert.match(queueOwned, /retirePresentationMode\(UiMode\.SUMMARY, this\.messageMode\)/u);
  assert.doesNotMatch(queueOwned, /setModeBoundedWhen|runWhenCoopRuntimeActive/u);
  const queueEnd = queueOwned.indexOf("super.end()");
  const queueClosed = queueOwned.indexOf("scene.phaseManager.getCurrentPhase() === this", queueEnd);
  const queueProof = queueOwned.indexOf("settleCoopV2InteractionOperation(", queueClosed);
  const queueRotate = queueOwned.indexOf("advanceInteractionFromAuthoritativeCommit(", queueProof);
  assert.ok(
    queueEnd >= 0 && queueClosed > queueEnd && queueProof > queueClosed && queueRotate > queueProof,
    "the real queued phase closes before proof and rotates only from the applied commit",
  );
  assert.doesNotMatch(queueOwned, /advanceCoopInteractionForContinuation/u);

  const projected = section(replay, "public settleCoopV2CommittedLearnMoveResult(", "private relayAndEnd(");
  assert.match(projected, /ownerSeatId !== coopSeatOfRole\(this\.ownerIsGuest \? "guest" : "host"\)/u);
  assert.match(projected, /this\.ownerIsGuest && this\.submittedV2MoveIndex !== forgetSlot/u);
  assert.match(projected, /!this\.ownerIsGuest && this\.submittedV2MoveIndex != null/u);
  assert.match(projected, /const scene = globalScene/u);
  assert.match(projected, /retirePresentationMode\(UiMode\.SUMMARY, UiMode\.MESSAGE\)/u);
  assert.doesNotMatch(projected, /setModeBoundedWhen|runWhenCoopRuntimeActive/u);
  const projectedShift = projected.indexOf("shiftPhaseThroughCoopAuthorityCommit(");
  const projectedProof = projected.indexOf("settleCoopV2InteractionOperation(", projectedShift);
  const projectedFailure = projected.indexOf("if (!closed)", projectedProof);
  assert.ok(
    projectedShift >= 0 && projectedProof > projectedShift && projectedFailure > projectedProof,
    "the projected picker proves terminal atomically before its retained successor starts",
  );
  assert.doesNotMatch(projected, /super\.end\(\)/u, "the projected picker cannot restore an unstarted standby blindly");
  assert.match(duo, /the single-move V2 terminal cannot delegate phase retirement to an ambient async UI callback/u);
  assert.match(
    duo,
    /firstConfirmGeneration[\s\S]+getSurfaceGeneration\?\.\(\)[\s\S]+> firstConfirmGeneration/u,
    "reused CONFIRM handlers distinguish successive public prompts by surface generation, not object identity",
  );
  assert.doesNotMatch(duo, /handler !== firstConfirm/u);
});
