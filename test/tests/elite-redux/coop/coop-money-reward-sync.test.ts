/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op (#698) reward-shop MONEY desync: reroll / shop-buy double-deduct.
//
// THE LIVE BUG: in authoritative co-op the shared money pool diverged between host and guest after
// a reward-shop REROLL or a shop PURCHASE. Two defects:
//   (1) the per-turn checkpoint money is captured at TURN-END, BEFORE the reward shop runs, so the
//       in-shop spend lagged a whole wave; and
//   (2) the WATCHER re-derived and applied its OWN reroll/shop cost (getRerollCost / shop `cost`),
//       which can diverge per client (Black Sludge / Merchant's Seal / Coin Purse / lock-tier pool)
//       AND double-deducts whenever a resync snapshot lands between the checkpoint and the relayed
//       reroll/buy (host=750 while guest=500 in the capture).
//
// THE FIX: make money host-authoritative on the two unguarded watcher spend paths. The OWNER
// streams its EXACT post-spend money piggybacked on the relay message it already sends - a trailing
// [COOP_MONEY_TAG, hostMoney] pair appended for REROLL / SHOP / REWARD picks only. The WATCHER strips
// the pair before its positional decode, stashes the money in `coopRelayedMoney`, and at the
// deduction site SETS `globalScene.money = coopRelayedMoney` verbatim instead of subtracting its own
// (divergent) cost. `coopRelayedMoney` is reset to -1 after each apply so it can never bleed. An
// OLDER host that does not append the tag leaves `coopRelayedMoney` at -1 -> the watcher falls back
// to its own deduction (current behavior, no regression). Everything is gated on `coopWatcher` +
// the owner-relay fence, so solo / host / lockstep are byte-identical.
//
// Tier 1 (always-on, no GameManager): the wire contract - the money tag survives a raw JSON
// round-trip through a real loopback relay, it cannot alias a positional action code, and the
// strip recovers the positional data + money for every spend shape (and yields -1 untagged).
//
// Tier 2 (ER_SCENARIO=1, real GameManager): the REAL applyRelayedRewardAction threads the streamed
// money into `coopRelayedMoney` (set-verbatim on the deduction), the untagged fallback keeps -1, the
// field resets to -1 after each apply, and the OWNER coopRelaySend appends the tag ONLY for the
// money-moving picks.

import { getGameMode } from "#app/game-mode";
import {
  COOP_INTERACTION_LEAVE,
  COOP_INTERACTION_REROLL,
  CoopInteractionRelay,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  resetCoopRewardOperationFlag,
  setCoopRewardOperationEnabled,
} from "#data/elite-redux/coop/coop-reward-operation";
import {
  clearCoopRuntime,
  getCoopInteractionRelay,
  getCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Must match the module-private constants in select-modifier-phase.ts (kept in lockstep here so a
// drift in either the tag value or an action code that would let them collide fails CI).
const COOP_MONEY_TAG = 0x4d4f; // 'MO'
const COOP_ACT_REWARD = 0;
const COOP_ACT_SHOP = 1;
const COOP_ACT_TRANSFER = 2;
const COOP_ACT_LOCK = 3;
const COOP_ACT_CHECK = 4;

/** The positional action codes the watcher decodes on data[0]; the money tag must miss all of them. */
const POSITIONAL_ACT_CODES = [COOP_ACT_REWARD, COOP_ACT_SHOP, COOP_ACT_TRANSFER, COOP_ACT_LOCK, COOP_ACT_CHECK];

/** The owner's append: exactly what coopRelaySend / coopFlushPending build for a money-moving pick. */
function appendMoneyTag(data: number[] | undefined, money: number): number[] {
  return [...(data ?? []), COOP_MONEY_TAG, Math.trunc(money)];
}

/** The watcher's strip: exactly the predicate at the top of applyRelayedRewardAction. */
function stripMoneyTag(data: number[] | undefined): { data: number[]; money: number } {
  let money = -1;
  let out = data ?? [];
  if (out.length >= 2 && out.at(-2) === COOP_MONEY_TAG) {
    money = out.at(-1) ?? -1;
    out = out.slice(0, -2);
  }
  return { data: out, money };
}

// =============================================================================
// Tier 1: wire contract (always on, no GameManager).
// =============================================================================
describe("co-op reward-shop money sync (#698) - wire contract", () => {
  it("the money tag never aliases a positional reward-shop action code", () => {
    expect(POSITIONAL_ACT_CODES).not.toContain(COOP_MONEY_TAG);
  });

  it("the money tag never aliases a choice sentinel (LEAVE / REROLL)", () => {
    expect(COOP_MONEY_TAG).not.toBe(COOP_INTERACTION_LEAVE);
    expect(COOP_MONEY_TAG).not.toBe(COOP_INTERACTION_REROLL);
  });

  it("a tagged spend payload survives a raw JSON round-trip through a real loopback relay", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // SHOP buy: data=[COOP_ACT_SHOP, row, slot, opt] + the trailing [TAG, money].
    const wire = appendMoneyTag([COOP_ACT_SHOP, 1, 2, 0], 600);
    owner.sendInteractionChoice(0, "shop", 5, wire);
    const res = await watcher.awaitInteractionChoice(0);
    expect(res?.choice).toBe(5);
    expect(res?.data).toEqual([COOP_ACT_SHOP, 1, 2, 0, COOP_MONEY_TAG, 600]);
  });

  it("strip recovers the positional data + money for a REROLL pick (no positional data)", () => {
    // Reroll's data is undefined -> the whole wire is just [TAG, money].
    const wire = appendMoneyTag(undefined, 750);
    expect(wire).toEqual([COOP_MONEY_TAG, 750]);
    const { data, money } = stripMoneyTag(wire);
    expect(money).toBe(750);
    expect(data).toEqual([]); // nothing left to positional-decode -> falls to the REROLL choice branch
  });

  it("strip recovers the positional data + money for a SHOP pick (decode unchanged)", () => {
    const wire = appendMoneyTag([COOP_ACT_SHOP, 1, 2, 3], 600);
    const { data, money } = stripMoneyTag(wire);
    expect(money).toBe(600);
    // The positional decode the watcher then runs is byte-identical to the pre-fix payload.
    expect(data).toEqual([COOP_ACT_SHOP, 1, 2, 3]);
    expect(data[0]).toBe(COOP_ACT_SHOP);
    expect(data[1]).toBe(1); // row
    expect(data[2]).toBe(2); // slot
    expect(data[3]).toBe(3); // option
  });

  it("strip recovers the positional data + money for a REWARD pick (decode unchanged)", () => {
    const wire = appendMoneyTag([COOP_ACT_REWARD, 4, 1], 900);
    const { data, money } = stripMoneyTag(wire);
    expect(money).toBe(900);
    expect(data).toEqual([COOP_ACT_REWARD, 4, 1]);
  });

  it("an UNtagged payload (older host) strips to money=-1 -> watcher keeps its own deduction", () => {
    const { data, money } = stripMoneyTag([COOP_ACT_SHOP, 1, 2, 3]);
    expect(money).toBe(-1);
    expect(data).toEqual([COOP_ACT_SHOP, 1, 2, 3]); // untouched
  });

  it("money is truncated to an int on the wire (no fractional money desync)", () => {
    expect(appendMoneyTag(undefined, 749.9)).toEqual([COOP_MONEY_TAG, 749]);
  });
});

// =============================================================================
// Tier 2: real applyRelayedRewardAction money threading + owner append (ER_SCENARIO=1).
// globalScene is a process singleton, so a real GameManager is needed for the phase's
// globalScene reads (coopEndMirror / coopLog / the deduction sites).
// =============================================================================
const RUN = process.env.ER_SCENARIO === "1";

/** Private members the test drives on a watcher SelectModifierPhase (the same the phase uses). */
type WatcherSeam = {
  coopWatcher: boolean;
  coopRelayedMoney: number;
  coopRelayedSlot: number;
  coopRelayedOption: number;
  coopInteractionStart: number;
  coopOwnerPostMoney: number;
  typeOptions: unknown[];
  applyRelayedRewardAction(action: { choice: number; data: number[] | undefined }): boolean;
  rerollModifiers(): boolean;
  selectShopModifierOption(rowCursor: number, cursor: number, cb: () => boolean): boolean;
  selectRewardModifierOption(cursor: number, cb: () => boolean): boolean;
  coopRelaySend(choice: number, data: number[] | undefined, label: string): boolean;
  coopCommitPendingAuthorityResult(): boolean;
  coopPendingAuthorityOperationId: string | null;
};

describe.skipIf(!RUN)("co-op reward-shop money sync (#698) - watcher threading + owner append", () => {
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
    resetCoopRewardOperationFlag();
  });

  /** A watcher phase with the heavy reward sub-applies stubbed to CAPTURE coopRelayedMoney at
   *  invocation - so the REAL strip/set/reset in applyRelayedRewardAction is exercised without
   *  booting the shop UI. Returns the seam + a `seen` capture array. */
  const makeWatcher = (): { seam: WatcherSeam; seen: { call: string; money: number }[] } => {
    const phase = new SelectModifierPhase();
    const seam = phase as unknown as WatcherSeam;
    seam.coopWatcher = true;
    seam.coopInteractionStart = 1; // odd -> the LOCAL host is NOT the owner (this client only watches)
    const seen: { call: string; money: number }[] = [];
    seam.rerollModifiers = () => {
      seen.push({ call: "reroll", money: seam.coopRelayedMoney });
      return true;
    };
    seam.selectShopModifierOption = () => {
      seen.push({ call: "shop", money: seam.coopRelayedMoney });
      return false;
    };
    seam.selectRewardModifierOption = () => {
      seen.push({ call: "reward", money: seam.coopRelayedMoney });
      return false;
    };
    return { seam, seen };
  };

  it("a tagged REROLL threads the streamed post-reroll money into coopRelayedMoney (set-verbatim)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const { seam, seen } = makeWatcher();

    seam.applyRelayedRewardAction({ choice: COOP_INTERACTION_REROLL, data: appendMoneyTag(undefined, 750) });

    // The watcher rerolled with the host's authoritative post-reroll money (750), NOT a self-computed
    // 1000-cost and NOT a double-deduct.
    expect(seen).toEqual([{ call: "reroll", money: 750 }]);
    // ...and the field is reset so it cannot bleed into a later action.
    expect(seam.coopRelayedMoney).toBe(-1);
  });

  it("a tagged SHOP buy threads the money AND the positional slot/opt decode is unchanged", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const { seam, seen } = makeWatcher();

    // data=[COOP_ACT_SHOP, row=1, slot=2, opt=3] + [TAG, 600].
    seam.applyRelayedRewardAction({
      choice: 5,
      data: appendMoneyTag([COOP_ACT_SHOP, 1, 2, 3], 600),
    });

    expect(seen).toEqual([{ call: "shop", money: 600 }]);
    // The positional decode after the strip still parsed slot/opt correctly.
    expect(seam.coopRelayedSlot).toBe(2);
    expect(seam.coopRelayedOption).toBe(3);
    expect(seam.coopRelayedMoney).toBe(-1);
  });

  it("an UNtagged REROLL (older host) keeps coopRelayedMoney = -1 -> the watcher self-deducts", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const { seam, seen } = makeWatcher();

    seam.applyRelayedRewardAction({ choice: COOP_INTERACTION_REROLL, data: undefined });

    // No streamed money -> -1 at the sub-apply -> rerollModifiers takes the unchanged subtract branch.
    expect(seen).toEqual([{ call: "reroll", money: -1 }]);
    expect(seam.coopRelayedMoney).toBe(-1);
  });

  it("coopRelayedMoney resets to -1 after a NON-spend action (LOCK) so it cannot bleed", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const phase = new SelectModifierPhase();
    const seam = phase as unknown as WatcherSeam;
    seam.coopWatcher = true;
    seam.coopInteractionStart = 1;
    // toggleRerollLock touches the shop handler; stub it so the LOCK branch is reachable headless.
    (seam as unknown as { toggleRerollLock(): void }).toggleRerollLock = () => {};

    // A LOCK never carries money; assert the field is left at -1 regardless.
    seam.applyRelayedRewardAction({ choice: 0, data: [COOP_ACT_LOCK] });
    expect(seam.coopRelayedMoney).toBe(-1);
  });

  it("the REROLL set-verbatim SETS globalScene.money to the streamed value (real deduction site)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const phase = new SelectModifierPhase();
    const seam = phase as unknown as WatcherSeam;
    seam.coopWatcher = true;
    seam.coopInteractionStart = 1;
    seam.coopRelayedMoney = 750;
    seam.typeOptions = []; // start() normally populates this; empty is fine for the reroll cost/unshift
    game.scene.money = 1000;

    // Drive the REAL reroll deduction path. It must SET money to the streamed 750, not subtract a
    // self-computed reroll cost off 1000 (which would land somewhere below 1000 and diverge).
    seam.rerollModifiers();

    expect(game.scene.money).toBe(750);
  });

  it("the rollback relay appends [COOP_MONEY_TAG, money] for REROLL and nothing for LEAVE/LOCK", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    // This assertion is specifically the legacy/raw compatibility wire. In retained-result mode a
    // host-owned terminal is carried by its immutable result envelope and deliberately emits no raw LEAVE.
    setCoopRewardOperationEnabled(false);
    startLocalCoopSession({ username: "Host" }); // role=host -> owner at EVEN counters
    game.scene.gameMode = getGameMode(GameModes.COOP);

    const relay = getCoopInteractionRelay();
    expect(relay).not.toBeNull();
    const sent: { choice: number; data: number[] | undefined }[] = [];
    const spy = vi
      .spyOn(relay as CoopInteractionRelay, "sendInteractionChoice")
      .mockImplementation((_seq, _kind, choice, data) => {
        sent.push({ choice, data });
      });

    const phase = new SelectModifierPhase();
    const seam = phase as unknown as WatcherSeam;
    seam.coopInteractionStart = 0; // even -> the LOCAL host IS the owner -> relay actually sends

    // A money-moving REROLL: the owner stashed its post-spend money, coopRelaySend must append the tag.
    seam.coopOwnerPostMoney = 750;
    seam.coopRelaySend(COOP_INTERACTION_REROLL, undefined, "reroll");

    // A non-spend LEAVE: no stashed money -> no tag appended (wire shape unchanged).
    seam.coopOwnerPostMoney = -1;
    seam.coopRelaySend(COOP_INTERACTION_LEAVE, undefined, "skip");

    // A non-spend LOCK: data carries only the action code, no money tag.
    seam.coopOwnerPostMoney = -1;
    seam.coopRelaySend(0, [COOP_ACT_LOCK], "lock");

    expect(sent[0].data).toEqual([COOP_MONEY_TAG, 750]); // reroll: tag appended
    expect(sent[1].data).toBeUndefined(); // leave: untouched
    expect(sent[2].data).toEqual([COOP_ACT_LOCK]); // lock: no tag
    // coopOwnerPostMoney is consumed + reset by the send so it cannot bleed to the next relay.
    expect(seam.coopOwnerPostMoney).toBe(-1);

    spy.mockRestore();
  });

  it("a host-owned LEAVE retains exactly one complete result at the relay seam before continuation", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);

    const runtime = getCoopRuntime();
    const relay = getCoopInteractionRelay();
    expect(runtime?.durability).not.toBeNull();
    expect(relay).not.toBeNull();
    const rawChoices: number[] = [];
    const rawSpy = vi
      .spyOn(relay as CoopInteractionRelay, "sendInteractionChoice")
      .mockImplementation((_seq, _kind, choice) => {
        rawChoices.push(choice);
      });

    const phase = new SelectModifierPhase();
    const seam = phase as unknown as WatcherSeam;
    seam.coopInteractionStart = 0;
    // start() always installs the authoritative option image before this terminal seam. This focused
    // fixture invokes the private seam directly, so provide the same valid (empty) image instead of
    // asking result serialization to encode an uninitialized phase.
    seam.typeOptions = [];
    const before = runtime!.durability!.unackedCount();

    expect(seam.coopRelaySend(COOP_INTERACTION_LEAVE, undefined, "skip")).toBe(false);
    expect(runtime!.durability!.unackedCount()).toBe(before + 1);
    expect(seam.coopPendingAuthorityOperationId).toBeNull();
    expect(rawChoices, "the retained envelope is the only host terminal carrier").toEqual([]);

    // Confirmation callbacks and production-fidelity drivers may both observe the terminal seam. The
    // retained terminal identity makes this an exact reassertion, never a second operation/result.
    expect(seam.coopRelaySend(COOP_INTERACTION_LEAVE, undefined, "skip")).toBe(false);
    expect(runtime!.durability!.unackedCount()).toBe(before + 1);
    expect(rawChoices).toEqual([]);

    rawSpy.mockRestore();
  });

  it("a selected reward remains intent-only until the post-mutation safe seam commits its result", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    startLocalCoopSession({ username: "Host" });
    game.scene.gameMode = getGameMode(GameModes.COOP);

    const runtime = getCoopRuntime();
    expect(runtime?.durability).not.toBeNull();
    const phase = new SelectModifierPhase();
    const seam = phase as unknown as WatcherSeam;
    seam.coopInteractionStart = 0;
    // Mirror SelectModifierPhase.start(): an empty option image is still complete authoritative material.
    seam.typeOptions = [];
    const before = runtime!.durability!.unackedCount();

    expect(seam.coopRelaySend(0, [COOP_ACT_REWARD], "reward")).toBe(false);
    expect(seam.coopPendingAuthorityOperationId).not.toBeNull();
    expect(runtime!.durability!.unackedCount(), "intent alone is not an authoritative result").toBe(before);

    // Model the selected item's authoritative mutation; the real applyModifier path invokes this same seam.
    game.scene.money += 1;
    expect(seam.coopCommitPendingAuthorityResult()).toBe(true);
    expect(runtime!.durability!.unackedCount()).toBe(before + 1);
    expect(seam.coopPendingAuthorityOperationId).toBeNull();
  });
});
