/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8").replace(/\r\n/gu, "\n");
const authority = read("src/phases/learn-move-batch-phase.ts");
const replica = read("src/phases/coop-replay-learn-move-batch.ts");
const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");
const envelope = read("src/data/elite-redux/coop/coop-operation-envelope.ts");
const cutover = read("src/data/elite-redux/coop/authority-v2/cutover-interaction.ts");
const duo = read("test/tests/elite-redux/coop/coop-duo-learn-move.test.ts");

const method = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test("batch decisions close the authority UI, retain one immutable result, then release its phase", () => {
  const terminal = method(authority, "private closeAndCommitCoopV2BatchResult(", "private coopBatchLearnMove(");
  const close = terminal.indexOf(".setModeBoundedWhen(");
  const retire = terminal.indexOf("this.retire();", close);
  const proof = terminal.indexOf("settleCoopV2InteractionOperation(", retire);
  const commit = terminal.indexOf("this.commitCoopBatchResult(", proof);
  const successor = terminal.indexOf("afterCommit();", commit);
  const shift = terminal.indexOf("scene.phaseManager.shiftPhase();", successor);
  assert.ok(
    close >= 0 && retire > close && proof > retire && commit > proof && successor > commit && shift > successor,
    "the real panel must close/retire before proof; the immutable successor must install before scheduler release",
  );
  assert.match(terminal, /this\.dispatchCoopRuntime\(owningRuntime/u);
  assert.match(terminal, /const scene = this\.coopOwningScene/u);
  assert.ok(
    terminal.indexOf("this.dispatchCoopRuntime(owningRuntime") < close,
    "the panel transition itself must re-enter the exact authority runtime, not only its completion callback",
  );

  const watcher = method(authority, "private async coopHostWatchBatch(", "\n  }\n}");
  assert.match(watcher, /v2 \? null : COOP_LEARN_MOVE_BATCH_WAIT_MS/u);
  assert.match(watcher, /getCoopV2InteractionRuntimeCancellationSignal/u);
  assert.match(watcher, /this\.coopV2ControlOperationId \?\? undefined/u);
  assert.match(watcher, /decodeExactCoopLearnMoveBatchTerminal/u);
  assert.doesNotMatch(
    watcher.slice(watcher.indexOf("if (res == null)"), watcher.indexOf("if (res.choice")),
    /closeAndCommitCoopV2BatchResult/u,
    "a null V2 proposal wait cannot authorize fallback or progression",
  );
});

test("guest owner and watcher release only through the exact committed batch result", () => {
  const committed = method(replica, "public settleCoopV2CommittedLearnMoveBatchResult(", "\n  }\n}\n\n/**");
  assert.match(committed, /control\?\.kind !== "AWAIT_SUCCESSOR"/u);
  assert.match(committed, /sourceEntry\?\.kind !== "INTERACTION_COMMIT"/u);
  assert.match(committed, /decodeCoopV2InteractionEnvelope\(sourceEntry\)/u);
  assert.doesNotMatch(committed, /decodeInteractionMaterial/u);
  assert.match(committed, /sourceOperation\?\.kind === "LEARN_MOVE_BATCH"/u);
  assert.match(committed, /!committedMatches/u);
  assert.match(committed, /!this\.coopPanelReady/u);
  assert.match(committed, /submitted\.assignments\.every/u);
  assert.match(committed, /\.setModeBoundedWhen\(/u);
  assert.match(committed, /this\.dispatchCoopRuntime\(runtime/u);
  assert.match(committed, /const scene = this\.coopOwningScene/u);
  const phaseEnd = committed.indexOf("super.end();");
  const retired = committed.indexOf("scene.phaseManager.getCurrentPhase() === this", phaseEnd);
  const terminalProof = committed.indexOf("settleCoopV2InteractionOperation(operationId, runtime)", retired);
  assert.ok(
    phaseEnd >= 0 && retired > phaseEnd && terminalProof > retired,
    "replica terminal proof is published only after the exact projected phase proves it retired",
  );

  const owner = method(replica, "if (ownerIsGuest) {", "// GUEST WATCHES");
  assert.match(owner, /scene\.ui\.setModeWithoutClear\(UiMode\.LEARN_MOVE_BATCH/u);
  assert.ok(
    owner.indexOf("phase.parkCoopV2Decision(") < owner.indexOf("sendProposal();"),
    "the exact proposal is parked before a synchronous result can race back",
  );
  assert.match(owner, /retainCoopV2InteractionProposal\(/u);
  assert.match(owner, /markCoopV2PanelReady/u);
  assert.match(owner, /parked guest batch owner for committed result/u);
  assert.ok(
    owner.indexOf("parked guest batch owner for committed result") < owner.indexOf("mirror?.endSession()"),
    "the V2 owner returns parked before the legacy close branch",
  );

  const watcher = replica.slice(replica.indexOf("// GUEST WATCHES"));
  assert.match(watcher, /scene\.ui\.setModeWithoutClear\(UiMode\.LEARN_MOVE_BATCH/u);
  assert.ok(
    watcher.indexOf("if (isCoopLearnMoveAuthorityV2Active(operationBinding))")
      < watcher.indexOf(".awaitInteractionChoice("),
    "the V2 watcher returns before the raw 20-minute result FIFO",
  );
});

test("runtime and focused two-engine coverage reject raw, wrong, duplicate, and fallback release seams", () => {
  const materializer = method(
    runtime,
    "function settleCoopV2CommittedLearnMoveBatchResult(",
    "/** Route journaled learn presentations/terminals",
  );
  assert.match(materializer, /control\?\.kind !== "AWAIT_SUCCESSOR"/u);
  assert.match(materializer, /sourceEntry\?\.kind !== "INTERACTION_COMMIT"/u);
  assert.match(materializer, /settleCoopV2CommittedLearnMoveBatchResult\?\./u);

  const learnMaterializer = method(
    runtime,
    "function materializeCoopLearnMoveFromOp(",
    "/** Feed one journal-delivered colosseum",
  );
  const proofFastPath = learnMaterializer.indexOf("runtime.v2SettledInteractionOperations.has(op.id)");
  const direct = learnMaterializer.indexOf("return settleCoopV2CommittedLearnMoveBatchResult(runtime, op.id, payload)");
  const legacyEcho = learnMaterializer.indexOf("materializeCommittedInteractionChoice(", direct);
  assert.ok(
    proofFastPath >= 0 && direct > proofFastPath && legacyEcho > direct,
    "V2 completes a proven redelivery or returns through the exact phase consumer before legacy echo code",
  );
  const batchMarker = learnMaterializer.indexOf('if (op?.kind !== "LEARN_MOVE_BATCH")');
  const batchPromptStart = learnMaterializer.indexOf('if (payload.type === "prompt") {', batchMarker);
  const batchPromptCutover = learnMaterializer.indexOf("if (isCoopV2InteractionCutoverActive", batchPromptStart);
  const batchPromptEnd = learnMaterializer.indexOf("if (isCoopV2InteractionCutoverActive", batchPromptCutover + 1);
  const batchPrompt = learnMaterializer.slice(batchPromptStart, batchPromptEnd);
  assert.ok(
    batchMarker >= 0
      && batchPromptStart > batchMarker
      && batchPromptCutover > batchPromptStart
      && batchPromptEnd > batchPromptCutover,
  );
  assert.match(batchPrompt, /isCoopV2InteractionCutoverActive\(runtime\.durability\)[\s\S]*return true/u);
  assert.ok(
    batchPrompt.indexOf("return true") < batchPrompt.indexOf("materializeCommittedInteractionOutcome("),
    "V2 batch prompt material cannot queue a legacy panel behind its central projector",
  );

  assert.match(duo, /guest owner remains on the exact projected phase after sending its raw proposal/u);
  assert.match(duo, /a wrong result identity cannot close the parked owner/u);
  assert.match(duo, /a same-address but wrong immutable assignment is rejected after the commit exists/u);
  assert.match(duo, /a duplicate immutable result cannot close or advance twice/u);
  assert.match(duo, /dropBatchCommittedChoiceEcho/u);
  assert.match(duo, /HOST-owned fallback: immutable fallback closes both panels/u);
  assert.match(duo, /a projected batch phase that refuses to retire cannot publish terminal proof/u);
});

test("batch phase runtime activations are owned and cancelled by their exact phase generation", () => {
  for (const [name, source] of [
    ["authority", authority],
    ["replica", replica],
  ]) {
    assert.match(source, /coopRuntimeContinuations = new Set<\(\) => void>\(\)/u, `${name} owns activation cancels`);
    assert.match(source, /cancel = runWhenCoopRuntimeActive\(runtime/u, `${name} wraps runtime re-entry`);
    const retireStart = source.indexOf("public override retire(): void");
    const retireEnd = source.indexOf(
      name === "authority" ? "\n\n  start(): void" : "\n\n  public install",
      retireStart,
    );
    const retire = source.slice(retireStart, retireEnd);
    assert.match(retire, /for \(const cancel of this\.coopRuntimeContinuations\)/u, `${name} drains cancels`);
    assert.match(retire, /this\.coopRuntimeContinuations\.clear\(\)/u, `${name} clears cancellation ownership`);
  }
});

test("batch fallback carries one mandatory immutable single-move successor into the V2 wait allowlist", () => {
  const payloadStart = envelope.indexOf("export type CoopLearnMoveBatchPayload =");
  const payload = envelope.slice(
    payloadStart,
    envelope.indexOf("// -----------------------------------------------------------------------------", payloadStart),
  );
  assert.match(
    payload,
    /readonly fallback: true;[\s\S]*readonly nextInteraction: Extract<CoopInteractionSuccessorRef, \{ readonly kind: "learn-move" \}>/u,
  );

  const validator = method(cutover, "LEARN_MOVE_BATCH: {", "ME_BUTTON: {");
  assert.match(
    validator,
    /payload\.fallback[\s\S]*isCoopInteractionSuccessorRef\(payload\.nextInteraction\)[\s\S]*payload\.nextInteraction\.kind === "learn-move"[\s\S]*payload\.nextInteraction === undefined/u,
  );

  const successor = method(cutover, 'case "LEARN_MOVE":', 'case "ME_PRESENT":');
  assert.match(successor, /isCoopInteractionSuccessorRef\(payload\?\.nextInteraction\)/u);
  assert.match(successor, /interactionAddressOf\(payload\.nextInteraction\)/u);

  const commit = method(authority, "private commitCoopBatchResult(", "private closeAndCommitCoopV2BatchResult(");
  assert.match(commit, /nextInteraction: \{ kind: "learn-move" as const, wave, turn \}/u);
  assert.match(duo, /the fallback commit names its exact single-move successor in allowedInteractionAddresses/u);
});

test("both batch panels retain one source address across every UI and relay callback", () => {
  for (const [name, source] of [
    ["authority", authority],
    ["replica", replica],
  ]) {
    assert.match(source, /private readonly coopSourceWave: number;/u, `${name} retains its source wave`);
    assert.match(source, /private readonly coopSourceTurn: number;/u, `${name} retains its source turn`);
    assert.equal(
      source.match(/this\.coopOwningScene\.currentBattle\?\.(?:waveIndex|turn)/gu)?.length,
      2,
      `${name} reads both coordinates only at construction`,
    );
    assert.doesNotMatch(source, /(?:wave|turn): scene\.currentBattle|const (?:wave|turn) = scene\.currentBattle/u);
  }
  assert.match(replica, /const \{ wave, turn \} = phase\.sourceAddress\(\);/u);
});
