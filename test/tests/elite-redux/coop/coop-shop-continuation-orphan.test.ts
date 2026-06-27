/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #698 stale-reward-shop softlock - the guest stuck on a reward shop the host already left.
//
// ROOT CAUSE: a TM Case / Memory-Mushroom (cost=-1) reward queues a back-out "continuation"
// SelectModifierPhase copy alongside a LearnMovePhase (SelectModifierPhase.applyModifier, queuesContinuation).
// On the HOST the real learnMove() deletes that copy via tryRemovePhase("SelectModifierPhase"). The
// authoritative GUEST's LearnMovePhase is a no-op renderer that never runs learnMove(), so the copy
// orphaned -> the watcher re-entered a reward shop the owner already left and hung on a 20-min await,
// which ALSO blocked the resync snapshot (queued behind it) that should have rescued the guest.
//
// FIX 1 (root cause): the guest no-op LearnMovePhase mirrors the host's exact tryRemovePhase conditions
// (TM, or MEMORY with cost=-1) so its phase queue converges - no orphan is ever created.
// FIX 3 (resync safety net): CoopInteractionRelay.cancelWaiters() STICKY-cancels every parked (and any
// immediately re-parked) watcher wait so a resync can always drain the queue and rescue a stuck watcher,
// even for a future/other way of getting stuck.
//
// Both are exercised engine-free: Fix 1 by driving the real coopAuthoritativeLearnMove guest branch over
// a real authoritative-guest session with a stub scene that spies tryRemovePhase; Fix 3 by parking a real
// CoopInteractionRelay wait over a LoopbackTransport and asserting cancelWaiters() is sticky-per-seq.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, getCoopController, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { LearnMovePhase } from "#phases/learn-move-phase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const flush = () => new Promise<void>(r => setTimeout(r, 0));

// --- Fix 1 harness: a stub scene that records tryRemovePhase calls. --------------------------------
const rec = { removed: [] as string[] };

function makeStubScene(): BattleScene {
  return {
    // The LearnMovePhase ctor (PartyMemberPokemonPhase) reads this to derive fieldIndex.
    currentBattle: {
      getBattlerCount(): number {
        return 2;
      },
    },
    phaseManager: {
      tryRemovePhase(name: string): boolean {
        rec.removed.push(name);
        return true;
      },
      shiftPhase() {},
    },
  } as unknown as BattleScene;
}

function startAuthoritativeGuestSession(): void {
  startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
  const controller = getCoopController();
  if (controller == null) {
    throw new Error("expected a live co-op controller after startLocalCoopSession");
  }
  controller.role = "guest";
}

/** Build a LearnMovePhase + neutralize its end() (the guest branch calls this.end() last). */
function makeLearnMovePhase(learnMoveType: LearnMoveType, cost: number): LearnMovePhase {
  const phase = new LearnMovePhase(0, MoveId.TACKLE, learnMoveType, cost);
  (phase as unknown as Record<string, () => void>).end = () => {};
  return phase;
}

/** Drive the private guest dispatch (its guest branch ignores the 3 args). */
function driveGuestLearnMove(phase: LearnMovePhase): void {
  const fn = (phase as unknown as Record<string, (...args: unknown[]) => void>).coopAuthoritativeLearnMove;
  fn.call(phase, [], {}, {});
}

describe("#698 stale-reward-shop softlock - continuation-copy orphan + resync rescue", () => {
  let prevGlobalScene: BattleScene;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    rec.removed = [];
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    clearCoopRuntime();
    // Citizenship (#710): this engine-free file replaces globalScene with a reset-less stub. Restore
    // the prior scene so the NEXT ER_SCENARIO file's `new GameManager` reuses a real scene instead of
    // crashing on `stub.reset is not a function`. Order-robust: each stub file restores before the
    // next file's beforeEach captures, so even back-to-back stub files chain the real scene through.
    initGlobalScene(prevGlobalScene);
  });

  // --- Fix 1: the guest no-op LearnMovePhase removes the continuation shop exactly when the host would.
  it("guest no-op LearnMovePhase removes the continuation SelectModifierPhase for a TM reward", () => {
    startAuthoritativeGuestSession();
    driveGuestLearnMove(makeLearnMovePhase(LearnMoveType.TM, -1));
    expect(rec.removed).toContain("SelectModifierPhase");
  });

  it("guest no-op LearnMovePhase removes it for a free (cost=-1) MEMORY reward (Memory Mushroom / Learner's Shroom)", () => {
    startAuthoritativeGuestSession();
    driveGuestLearnMove(makeLearnMovePhase(LearnMoveType.MEMORY, -1));
    expect(rec.removed).toContain("SelectModifierPhase");
  });

  it("guest no-op LearnMovePhase does NOT remove it for a PAID MEMORY move (cost>0) - matches the host", () => {
    startAuthoritativeGuestSession();
    driveGuestLearnMove(makeLearnMovePhase(LearnMoveType.MEMORY, 100));
    expect(rec.removed).not.toContain("SelectModifierPhase");
  });

  it("guest no-op LearnMovePhase does NOT remove it for a level-up learn (no shop continuation)", () => {
    startAuthoritativeGuestSession();
    driveGuestLearnMove(makeLearnMovePhase(LearnMoveType.LEARN_MOVE, -1));
    expect(rec.removed).not.toContain("SelectModifierPhase");
  });

  // --- Fix 3: the relay sticky-cancel rescues a parked (and re-parked) watcher wait.
  it("cancelWaiters() resolves a parked reward await to null AND stays sticky for the same seq", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // The watcher parks on the owner's reward options for interaction seq 8 (the orphan's await).
    let rewardSettled: unknown = "pending";
    const rewardAwait = watcher.awaitRewardOptions(8, 1).then(r => {
      rewardSettled = r;
    });
    await flush();
    expect(rewardSettled).toBe("pending"); // genuinely parked (network-wait), not resolved

    // The resync rescue: sticky-cancel everything parked.
    watcher.cancelWaiters();
    await rewardAwait;
    expect(rewardSettled).toBeNull();

    // STICKY: the watch loop re-parks on the SAME seq 8 (awaitInteractionChoice) -> resolves null at once.
    const reParked = await watcher.awaitInteractionChoice(8);
    expect(reParked).toBeNull();

    // A DIFFERENT, later interaction seq is unaffected: a normally-delivered choice still arrives.
    owner.sendInteractionChoice(9, "reward", 3);
    await flush();
    const choice9 = await watcher.awaitInteractionChoice(9);
    expect(choice9?.choice).toBe(3);
  });

  it("cancelWaiters() is a no-op when nothing is parked", () => {
    const { guest } = createLoopbackPair();
    const watcher = new CoopInteractionRelay(guest);
    expect(() => watcher.cancelWaiters()).not.toThrow();
  });
});
