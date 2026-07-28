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

  const owner = method("private flushCoopBargainTerminal(): void", "private parkCoopV2AuthoritativeBargainResult");
  const ownerCommit = owner.indexOf("commitBargainOwnerOutcome(");
  const ownerAdvance = owner.indexOf("this.advanceCoopBargainFromCommittedResult()", ownerCommit);
  assert.ok(ownerCommit >= 0 && ownerAdvance > ownerCommit, "the authority-owned result advances only after commit");

  const guest = method("public settleCoopV2CommittedBargainResult(", "private closeCoopBargainOwnerTerminal");
  assert.ok(
    guest.indexOf("this.advanceCoopBargainFromCommittedResult()")
      < guest.indexOf("settleCoopV2InteractionOperation(operationId, runtime)"),
    "the guest-owner phase rotates from the exact applied result before publishing its terminal proof",
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
  const watch = method("private async coopBargainWatch(): Promise<void>", "private rollAvailableSins");
  assert.match(watch, /const controller = runtime\?\.controller \?\? getCoopController\(\)/u);
  assert.match(watch, /runWhenCoopRuntimeActive\(runtime, finish\)/u);
  assert.match(watch, /runWhenCoopRuntimeActive\(runtime, finalize\)/u);
});
