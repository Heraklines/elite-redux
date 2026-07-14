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
import {
  assembleCoopRuntime,
  clearCoopLearnMoveForwardInFlight,
  clearCoopRuntime,
  getCoopController,
  getCoopInteractionRelay,
  markCoopLearnMoveForwardInFlight,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { CoopInteractionTurn } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { LearnMovePhase } from "#phases/learn-move-phase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise<void>(r => setTimeout(r, 0));

// --- Fix 1 harness: a stub scene that records tryRemovePhase calls. --------------------------------
const rec = { removed: [] as string[] };
// #835 harness: capture the move-forget picker open + its finish callback (the human's forget-slot).
const uiRec = { summaryOpened: 0, finish: null as ((moveIndex: number) => void) | null };

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
    // #835: the guest-owned forget-picker renders via ui.setModeWithoutClear(SUMMARY, mon, LEARN_MOVE,
    // move, finish). Capture that finish callback so the test can drive the human pick + assert the
    // DEFERRED cleanup fires only then. setMode is a no-op thenable (the finish() end path).
    ui: {
      setModeWithoutClear(mode: UiMode, ..._rest: unknown[]): Promise<boolean> {
        if (mode === UiMode.SUMMARY) {
          uiRec.summaryOpened++;
          uiRec.finish = _rest[3] as (moveIndex: number) => void; // [pokemon, summaryMode, move, finish]
        }
        return Promise.resolve(true);
      },
      setMode(): Promise<boolean> {
        return Promise.resolve(true);
      },
      showText(_text: string, _delay: unknown, callback?: (() => void) | null): void {
        callback?.();
      },
      showTextPromise(): Promise<void> {
        return Promise.resolve();
      },
    },
    money: 10_000,
    updateMoneyText() {},
    animateMoneyChanged() {},
    playSound() {},
    triggerPokemonFormChange() {},
    loadSpritesheet() {},
    loadImage() {},
    loadSe() {},
    load: {
      once(_event: string, callback: () => void): void {
        callback();
      },
      isLoading: () => false,
      start() {},
    },
  } as unknown as BattleScene;
}

function startAuthoritativeGuestSession(): void {
  const pair = createLoopbackPair();
  const runtime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
  setCoopRuntime(runtime);
  runtime.controller.connect();
  const controller = getCoopController();
  if (controller == null) {
    throw new Error("expected a live co-op controller after assembling the guest runtime");
  }
  if (controller.role !== "guest") {
    throw new Error(`expected a genuine guest runtime, got ${controller.role}`);
  }
}

/** Build a LearnMovePhase + neutralize its end() (the guest branch calls this.end() last). */
function makeLearnMovePhase(learnMoveType: LearnMoveType, cost: number): LearnMovePhase {
  const phase = new LearnMovePhase(0, MoveId.TACKLE, learnMoveType, cost);
  (phase as unknown as Record<string, () => void>).end = () => {};
  return phase;
}

/** Drive the private guest dispatch (its guest branch ignores the 3 args). */
function driveGuestLearnMove(phase: LearnMovePhase): void {
  const pokemon = {
    coopOwner: "host",
    moveset: [] as { getName(): string }[],
    usedTMs: [] as number[],
    getMaxMoveCount: () => 4,
    setMove(index: number): void {
      this.moveset[index] = { getName: () => "Move" };
    },
    getNameToRender: () => "Stubmon",
    species: { getName: () => "Stubmon" },
    isEnemy: () => false,
    // Pure-renderer guest seam: learning the mirrored move must not mutate the local achievement run.
    isPlayer: () => false,
  };
  const fn = (phase as unknown as Record<string, (...args: unknown[]) => void>).coopAuthoritativeLearnMove;
  fn.call(phase, pokemon.moveset, { id: MoveId.TACKLE, name: "Tackle" }, pokemon);
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

  // --- #633 reward-shop-desync (regression): a benign MID-SHOP battle resync must NOT drop the
  // watcher off a LIVE reward shop. The resync's cancelWaiters now takes an orphan predicate
  // (peerAdvancedPast) so it spares a wait the owner is still driving and only cancels a genuinely
  // stuck one. LIVE-SESSION REPRO: host owns wave-1 shop (counter 0); the guest is the parked
  // watcher; a turn-1 checksum mismatch heals via a late stateSync whose cancelWaiters fired - and
  // sticky-cancelled the live wait, so the guest left the shop and advanced while the host stayed on
  // it (the desync the bug report shows). Gating on peerAdvancedPast fixes it.
  it("peerAdvancedPast: false while the peer is on the interaction, true once it advances past", () => {
    const turn = new CoopInteractionTurn(0);
    expect(turn.peerAdvancedPast(0)).toBe(false); // owner still on interaction 0 (pendingRemote=-1) -> LIVE
    turn.mergeRemote(1); // owner broadcasts it advanced to interaction 1 (it left the shop)
    expect(turn.peerAdvancedPast(0)).toBe(true); // now ORPHANED
  });

  it("cancelWaiters(orphan-predicate) SPARES a LIVE reward wait the owner is still driving", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);
    const turn = new CoopInteractionTurn(0); // owner is STILL on interaction 0 (the live shop)

    // The watcher parks awaiting the owner's pick for the live reward interaction seq 0.
    let settled: unknown = "pending";
    const wait = watcher.awaitInteractionChoice(0).then(r => {
      settled = r;
    });
    await flush();
    expect(settled).toBe("pending");

    // A benign mid-shop BATTLE resync fires cancelWaiters with the orphan predicate. The owner has
    // NOT advanced past seq 0, so the live wait is SPARED (pre-fix it sticky-resolved null here).
    watcher.cancelWaiters(seq => turn.peerAdvancedPast(seq));
    await flush();
    expect(settled).toBe("pending"); // still on the shop

    // The owner finishes picking -> the still-live wait resolves with the real relayed choice.
    owner.sendInteractionChoice(0, "reward", 3);
    await wait;
    expect((settled as { choice: number }).choice).toBe(3);

    // seq 0 was NOT sticky-cancelled, so a fresh await on it still delivers normally.
    owner.sendInteractionChoice(0, "reward", 1);
    await flush();
    expect((await watcher.awaitInteractionChoice(0))?.choice).toBe(1);
  });

  it("cancelWaiters(orphan-predicate) STILL rescues a genuinely ORPHANED wait (owner advanced past)", async () => {
    const { guest } = createLoopbackPair();
    const watcher = new CoopInteractionRelay(guest);
    const turn = new CoopInteractionTurn(0);
    turn.mergeRemote(9); // the owner already advanced PAST interaction 8 -> orphan

    let settled: unknown = "pending";
    const wait = watcher.awaitInteractionChoice(8).then(r => {
      settled = r;
    });
    await flush();
    expect(settled).toBe("pending");

    watcher.cancelWaiters(seq => turn.peerAdvancedPast(seq)); // peerAdvancedPast(8) === true -> cancel
    await wait;
    expect(settled).toBeNull(); // rescued: resolves null so the watcher leaves the stale shop

    // STICKY: a re-park on the same orphaned seq also resolves null at once.
    expect(await watcher.awaitInteractionChoice(8)).toBeNull();
  });
});

// =====================================================================================================
// #835 CROSS-OWNERSHIP TM-learn softlock: the reward-shop PICK owner (who buys the TM) is NOT the mon's
// owner (who chooses which move to forget). The shop applies the reward on BOTH clients, so the GUEST
// gets a REAL LearnMovePhase for a guest-owned FULL-moveset mon. Pre-#835 the guest branch immediately
// removed the continuation copy + advanced the counter + ended, and its forget-picker came ONLY from a
// DETACHED overlay (#787) that no phase kept alive -> a following setMode tore it off, the guest never
// relayed a forget-index, and the host's forwarded await stranded (the "other person stays in the
// selection screen" report). Fix: the guest renders the picker from THIS queue-protected phase and
// DEFERS the copy-removal + advance until the pick settles. These engine-free tests drive the guest
// branch directly over a real authoritative-guest relay and assert: (1) the guest OWNER of the mon
// renders the picker (single renderer, listener suppressed), the cleanup is DEFERRED to the pick, and
// the forget-index is relayed on the disjoint 9_100_000+slot channel; (2) a HOST-owned mon still takes
// the immediate no-op cleanup (the guest drives NO picker - the host does).
// =====================================================================================================

const COOP_LEARN_MOVE_FWD_SEQ_BASE = 9_100_000; // mirrors src/phases/learn-move-phase.ts (kept local)

/** Build a slot-N LearnMovePhase; track whether end() ran (the finish path calls it last). */
function makeSlotLearnMovePhase(
  slot: number,
  learnMoveType: LearnMoveType,
  cost: number,
): { phase: LearnMovePhase; ended: () => boolean } {
  const phase = new LearnMovePhase(slot, MoveId.SWORDS_DANCE, learnMoveType, cost);
  let ended = false;
  (phase as unknown as Record<string, () => void>).end = () => {
    ended = true;
  };
  return { phase, ended: () => ended };
}

/** Drive the private guest dispatch with a FULL-moveset mon of the given coopOwner. */
function driveGuestFullLearnMove(phase: LearnMovePhase, owner: "host" | "guest"): void {
  const pokemon = {
    coopOwner: owner,
    getMaxMoveCount: () => 4,
    moveset: [{}, {}, {}, {}],
  };
  const move = { id: MoveId.SWORDS_DANCE, name: "Swords Dance" };
  const fn = (phase as unknown as Record<string, (...args: unknown[]) => void>).coopAuthoritativeLearnMove;
  fn.call(phase, pokemon.moveset, move, pokemon);
}

describe("#835 cross-ownership TM-learn softlock - guest-owned mon renders + defers, host-owned defers to host", () => {
  let prevGlobalScene: BattleScene;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    rec.removed = [];
    uiRec.summaryOpened = 0;
    uiRec.finish = null;
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    clearCoopRuntime();
    initGlobalScene(prevGlobalScene);
  });

  it("GUEST-owned full-moveset mon: the guest RENDERS the forget-picker, DEFERS cleanup, relays the pick on 9_100_000+slot", async () => {
    startAuthoritativeGuestSession();
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      throw new Error("expected a live interaction relay");
    }
    const sendSpy = vi.spyOn(relay, "sendInteractionChoice");
    const SLOT = 1;
    const { phase, ended } = makeSlotLearnMovePhase(SLOT, LearnMoveType.TM, -1);

    driveGuestFullLearnMove(phase, "guest");

    // The picker OPENED once (this queue-protected phase is the sole renderer, not a detached overlay).
    expect(uiRec.summaryOpened, "the guest opened the move-forget picker exactly once").toBe(1);
    expect(uiRec.finish, "the picker exposed a finish callback").not.toBeNull();
    // The listener is SUPPRESSED: the slot is already in-flight (a duplicate learnMoveForward short-circuits).
    expect(markCoopLearnMoveForwardInFlight(SLOT), "the slot is already marked in-flight (single renderer)").toBe(
      false,
    );
    // DEFERRED: nothing committed yet - the continuation copy is still queued + no pick relayed + not ended.
    expect(rec.removed, "the continuation copy is NOT removed before the pick").not.toContain("SelectModifierPhase");
    expect(sendSpy, "no forget-index relayed before the human picks").not.toHaveBeenCalled();
    expect(ended(), "the phase stays alive (queue-protected) until the pick").toBe(false);

    // The human picks forget-slot 0 -> the deferred commit fires.
    uiRec.finish?.(0);
    await flush();

    // The forget-index is relayed to the host on the disjoint per-slot channel (the host's forwarded await).
    expect(sendSpy, "the guest relayed the forget-pick to the host").toHaveBeenCalledWith(
      COOP_LEARN_MOVE_FWD_SEQ_BASE + SLOT,
      "learnMove",
      0,
    );
    // AND only now is the continuation copy removed (commit) + the phase ended.
    expect(rec.removed, "the continuation copy is removed AFTER the pick (deferred commit)").toContain(
      "SelectModifierPhase",
    );
    expect(ended(), "the phase ends after the pick settles").toBe(true);
    sendSpy.mockRestore();
  });

  it("HOST-owned full-moveset mon: the guest opens NO picker + takes the immediate no-op cleanup (the host drives)", () => {
    startAuthoritativeGuestSession();
    const SLOT = 0;
    const { phase, ended } = makeSlotLearnMovePhase(SLOT, LearnMoveType.TM, -1);

    driveGuestFullLearnMove(phase, "host");

    // The guest does NOT drive a picker for a host-owned mon (the host's own LearnMovePhase does).
    expect(uiRec.summaryOpened, "no guest picker for a host-owned mon").toBe(0);
    // Immediate cleanup path (unchanged #698 behavior): continuation copy removed + phase ended now.
    expect(rec.removed, "host-owned mon still removes the continuation copy immediately").toContain(
      "SelectModifierPhase",
    );
    expect(ended(), "the guest no-op phase ends immediately for a host-owned mon").toBe(true);
    // The slot is NOT claimed in-flight (the guest is not the renderer here).
    expect(markCoopLearnMoveForwardInFlight(SLOT), "host-owned: guest did not claim the slot").toBe(true);
    clearCoopLearnMoveForwardInFlight(SLOT);
  });
});
