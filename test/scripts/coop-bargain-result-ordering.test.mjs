/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../src/phases/the-bargain-phase.ts", import.meta.url), "utf8").replace(
  /\r\n/gu,
  "\n",
);

const method = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test("Authority V2 Bargain rotation is owned by the immutable result commit", () => {
  const terminal = method("private coopBargainTerminal(): void", "private advanceCoopBargainFromCommittedResult");
  assert.match(terminal, /if \(!isCoopV2InteractionCutoverActive\(runtime\?\.durability\)\)/u);
  assert.match(terminal, /advanceCoopInteractionForContinuation\(this\.coopBargainStart\)/u);

  const owner = method("private flushCoopBargainTerminal(): boolean", "private parkCoopV2AuthoritativeBargainResult");
  const ownerCommit = owner.indexOf("commitBargainOwnerOutcome(");
  const ownerAdvance = owner.indexOf("this.advanceCoopBargainFromCommittedResult()", ownerCommit);
  assert.ok(ownerCommit >= 0 && ownerAdvance > ownerCommit, "the authority-owned result advances only after commit");

  const guest = method("public settleCoopV2CommittedBargainResult(", "private closeCoopBargainOwnerTerminal");
  assert.ok(
    guest.indexOf("this.advanceCoopBargainFromCommittedResult()")
      < guest.indexOf("settleCoopV2InteractionOperation(operationId, runtime)"),
    "the guest-owner phase rotates from the exact applied result before publishing its terminal proof",
  );
  assert.ok(
    guest.indexOf("this.queueCoopV2NextWaveAwait(operationId)") < guest.indexOf("shiftPhaseThroughCoopAuthorityCommit"),
    "the guest-owner phase installs its signed next-wave bridge before it can close",
  );

  const watcher = method("private async coopBargainWatch(): Promise<void>", "private rollAvailableSins");
  const watcherCommit = watcher.indexOf("commitBargainWatcherOutcome(");
  const watcherAdvance = watcher.indexOf("this.advanceCoopBargainFromCommittedResult()", watcherCommit);
  assert.ok(
    watcherCommit >= 0 && watcherAdvance > watcherCommit,
    "a guest-owned proposal cannot rotate the authority before its immutable result is retained",
  );

  const ownerClose = method("private closeCoopBargainOwnerTerminal(): void", "private async coopBargainWatch");
  assert.match(ownerClose, /runWhenCoopRuntimeActive\(runtime, close\)/u);
  assert.match(ownerClose, /shiftPhaseThroughCoopAuthorityCommit\(this,[\s\S]*?flushCoopBargainTerminal/u);
  const watch = method("private async coopBargainWatch(): Promise<void>", "private rollAvailableSins");
  assert.match(watch, /const controller = runtime\?\.controller \?\? getCoopController\(\)/u);
  assert.match(watch, /runWhenCoopRuntimeActive\(runtime, finish\)/u);
  assert.match(watch, /runWhenCoopRuntimeActive\(runtime, finalize\)/u);
  assert.match(watch, /shiftPhaseThroughCoopAuthorityCommit\(this,[\s\S]*?terminalSettlement/u);
});

test("Authority V2 Bargain terminal owns the signed next-wave bridge", () => {
  const install = method("public installCoopV2TerminalSuccessor(", "start(): void");
  assert.match(install, /successor\.afterOperationId !== operationId/u);
  assert.match(install, /!successor\.allowNextWaveStart/u);
  assert.match(install, /this\.coopV2NextWaveAwait \?\?= structuredClone\(successor\)/u);
  assert.match(install, /removeAllPhasesOfType\("NewBattlePhase"\)/u);
  assert.match(install, /pushNew\("NewBattlePhase", \{/u);
});
