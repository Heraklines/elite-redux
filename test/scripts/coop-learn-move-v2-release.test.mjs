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

  const queueOwned = section(
    learnMove,
    "public settleCoopV2CommittedLearnMoveResult(",
    "private async coopHostForwardLearnMove(",
  );
  assert.match(queueOwned, /ownerSeatId !== coopSeatOfRole\(monOwner\)/u);
  assert.match(queueOwned, /this\.coopSubmittedV2ForgetSlot !== forgetSlot/u);
  assert.match(queueOwned, /!this\.coopAwaitingHostOwnedPresentation/u);
  assert.match(queueOwned, /const scene = globalScene/u);
  assert.match(queueOwned, /runWhenCoopRuntimeActive\(runtime/u);
  assert.match(queueOwned, /globalScene !== scene/u);
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
  assert.match(projected, /runWhenCoopRuntimeActive\(runtime/u);
  assert.match(projected, /globalScene !== scene/u);
  const projectedEnd = projected.indexOf("super.end()");
  const projectedClosed = projected.indexOf("scene.phaseManager.getCurrentPhase() === this", projectedEnd);
  const projectedProof = projected.indexOf("settleCoopV2InteractionOperation(", projectedClosed);
  assert.ok(
    projectedEnd >= 0 && projectedClosed > projectedEnd && projectedProof > projectedClosed,
    "the projected picker proves terminal only after its real phase ends",
  );
  assert.match(duo, /the single-move terminal resumes under the peer ambient before its captured runtime reactivates/u);
});
