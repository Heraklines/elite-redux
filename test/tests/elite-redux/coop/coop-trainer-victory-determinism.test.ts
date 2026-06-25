/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op trainer-victory -> reward determinism (#633, lockstep desync fix). In LOCKSTEP both
// clients run the full engine in step on a SHARED seed, so the trainer-victory -> reward path
// must produce an IDENTICAL phase/async sequence on both clients even though their PER-ACCOUNT
// state differs. These engine-free tests simulate two clients with DIFFERENT per-account state
// (seen-dialogue history, skipSeenDialogues, prior voucher unlocks) and prove the co-op
// decisions are IDENTICAL on both - while solo keeps its original per-account behavior.

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import {
  coopShouldQueueBossVoucherReward,
  coopVictoryDialogueDecision,
} from "#data/elite-redux/coop/coop-trainer-victory";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { Voucher, VoucherType } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/**
 * Stand-in for the per-account UI/save state that drives the victory-dialogue branch at the
 * call site, mirroring `ui.shouldSkipDialogue`: skip iff the dialogue exists AND the per-account
 * setting is on AND this account has already seen it.
 */
interface FakeClientState {
  skipSeenDialogues: boolean;
  seen: Record<string, boolean>;
}

/** Reproduces the SOLO call-site decision (`hasCharSprite && !shouldSkipDialogue`). */
function soloShouldShowOverlay(state: FakeClientState, hasCharSprite: boolean, key: string): boolean {
  const shouldSkip = state.skipSeenDialogues && state.seen[key] === true;
  return hasCharSprite && !shouldSkip;
}

describe("co-op trainer-victory dialogue determinism (#633 Fix #1)", () => {
  // Two clients with DIVERGENT per-account dialogue state: A has seen the line + skip ON,
  // B has not seen it + skip OFF. Solo, these take OPPOSITE branches (the desync source).
  const clientA: FakeClientState = { skipSeenDialogues: true, seen: { "dialogue:youngster.victory": true } };
  const clientB: FakeClientState = { skipSeenDialogues: false, seen: {} };
  const KEY = "dialogue:youngster.victory";

  it("SOLO: the two clients DIVERGE on the overlay/dialogue branch (this is the bug)", () => {
    // Client A skips the overlay (seen + skip on); client B shows it. Different async-wait count.
    expect(soloShouldShowOverlay(clientA, true, KEY)).toBe(false);
    expect(soloShouldShowOverlay(clientB, true, KEY)).toBe(true);
  });

  it("CO-OP: the decision is ALWAYS-SKIP and IDENTICAL on both clients regardless of per-account state", () => {
    // The co-op decision ignores per-account state entirely - it is a constant `false`
    // (skip the whole flavor block), so both clients run the identical zero-async path.
    const decisionA = coopVictoryDialogueDecision(true);
    const decisionB = coopVictoryDialogueDecision(true);
    expect(decisionA).toBe(false);
    expect(decisionB).toBe(false);
    expect(decisionA).toBe(decisionB);
  });

  it("CO-OP: the decision does not depend on hasCharSprite, skipSeenDialogues, or seen-history", () => {
    // Same constant regardless of which trainer / settings - the only input that matters is isCoop.
    expect(coopVictoryDialogueDecision(true)).toBe(false);
  });

  it("SOLO: the decision defers to the existing per-account call-site logic (returns null)", () => {
    // null = "use the original branch" - solo behavior is untouched.
    expect(coopVictoryDialogueDecision(false)).toBeNull();
  });

  it("the resulting async-wait COUNT is identical on both co-op clients (0 dialogue dismissals)", () => {
    // Model the phase flow: in co-op both clients skip straight to end() => 0 awaited dismissals.
    const coopAwaits = (state: FakeClientState): number => {
      if (coopVictoryDialogueDecision(true) === false) {
        return 0; // skip the whole block -> no dialogue boxes, no overlay
      }
      // (unreachable in co-op) the per-account path would await a per-account count
      return soloShouldShowOverlay(state, true, KEY) ? 1 : 0;
    };
    expect(coopAwaits(clientA)).toBe(0);
    expect(coopAwaits(clientB)).toBe(0);
    expect(coopAwaits(clientA)).toBe(coopAwaits(clientB));
  });
});

describe("co-op trainer-victory boss-voucher queue determinism (#633 Fix #2)", () => {
  // The original gate is `!validateVoucher(...)`: true (queue the repeat reward) only when the
  // account has ALREADY unlocked this boss voucher. Two clients differ on that history.
  // creditedFirstTime mirrors validateVoucher's return: true on the FIRST unlock, false after.
  const firstWinClient = { creditedFirstTime: true }; // never beaten this boss before
  const repeatWinClient = { creditedFirstTime: false }; // beaten it on a prior run

  it("SOLO: the queue decision DIVERGES between a first-win and a repeat-win client (the bug)", () => {
    // Solo: first-win queues 0 (got the achvBar credit), repeat-win queues 1 (the repeat reward).
    expect(coopShouldQueueBossVoucherReward(false, firstWinClient.creditedFirstTime)).toBe(false);
    expect(coopShouldQueueBossVoucherReward(false, repeatWinClient.creditedFirstTime)).toBe(true);
  });

  it("CO-OP: the queue decision is IDENTICAL (never queue) on both clients regardless of voucher history", () => {
    const queueFirst = coopShouldQueueBossVoucherReward(true, firstWinClient.creditedFirstTime);
    const queueRepeat = coopShouldQueueBossVoucherReward(true, repeatWinClient.creditedFirstTime);
    expect(queueFirst).toBe(false);
    expect(queueRepeat).toBe(false);
    expect(queueFirst).toBe(queueRepeat); // structurally identical phase queue -> no desync
  });

  it("CO-OP: the queued phase COUNT after a boss win is identical (0 extra ModifierRewardPhases)", () => {
    // Both clients enqueue the same number of bonus voucher phases (zero), so the lockstep
    // queue length stays in step. Each still credits its OWN voucher (the side effect is
    // performed at the call site independently of this decision - see the live test below).
    const extraPhases = (creditedFirstTime: boolean): number =>
      coopShouldQueueBossVoucherReward(true, creditedFirstTime) ? 1 : 0;
    expect(extraPhases(firstWinClient.creditedFirstTime)).toBe(0);
    expect(extraPhases(repeatWinClient.creditedFirstTime)).toBe(0);
  });

  it("SOLO: the decision is byte-for-byte the original `!creditedFirstTime`", () => {
    expect(coopShouldQueueBossVoucherReward(false, true)).toBe(false);
    expect(coopShouldQueueBossVoucherReward(false, false)).toBe(true);
  });
});

// Live proof that suppressing the QUEUE in co-op does NOT suppress the per-account voucher
// CREDIT. The call site still invokes globalScene.validateVoucher(...) for its side effect, so
// each client still banks its OWN voucher (vouchers are per-account, not shared). Here we drive
// the real validateVoucher in a live co-op battle and confirm the credit lands.
describe.skipIf(!RUN)("co-op boss-voucher per-account credit still applies (#633 Fix #2) - live", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  it("validateVoucher credits voucherCounts on THIS client even though the bonus phase is not queued in co-op", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(globalScene.gameMode.isCoop).toBe(true);

    // A fresh, never-unlocked voucher (no conditionFunc -> validate() is true the first time).
    const voucher = new Voucher(VoucherType.PLUS, "test boss voucher");
    voucher.id = "__COOP_FIX2_TEST_VOUCHER__";

    const before = globalScene.gameData.voucherCounts[VoucherType.PLUS];
    const credited = globalScene.validateVoucher(voucher);

    // The per-account credit happened (this is the side effect the call site still performs)...
    expect(credited).toBe(true);
    expect(globalScene.gameData.voucherCounts[VoucherType.PLUS]).toBe(before + 1);
    expect(globalScene.gameData.voucherUnlocks[voucher.id]).toBeDefined();

    // ...while the QUEUE decision for the bonus reward phase stays false in co-op (no extra phase).
    expect(coopShouldQueueBossVoucherReward(true, credited)).toBe(false);
  });
});
