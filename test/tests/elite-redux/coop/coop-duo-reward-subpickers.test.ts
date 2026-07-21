/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op reward SUB-PICKER regression suite (wiring-audit follow-up,
// docs/plans/2026-07-07-coop-screen-wiring-audit.md - the seven WIRED-UNTESTED rows).
//
// The reward screen's party-target sub-pickers were WIRED (select-modifier-phase.ts's
// openFusionMenu / openModifierMenu relay the owner's resolved [slot, option] and the
// WATCHER re-applies it via buildPokemonModifier without opening a party UI it cannot
// drive) but had NO dedicated duo regression - only RARE_CANDY / LEFTOVERS (the plain
// PartyUiMode.MODIFIER path, coop-duo-reward-items) and the TM-Case orphan (#698,
// coop-duo-multiwave). This file adds one focused two-engine case for each of the seven
// party sub-modes the audit flagged:
//
//   IMMEDIATE (terminal - applyModifier advances the alternating-interaction counter):
//     - SPLICE                    (FusePokemonModifierType,  openFusionMenu)
//     - MODIFIER                  (PokemonHeldItemModifierType, openModifierMenu default)
//     - MOVE_MODIFIER             (PokemonPpRestoreModifierType, openModifierMenu)
//   CONTINUATION (teach-a-move - applyModifier unshifts a shop copy + a LearnMovePhase
//   that owns the rest of the interaction; the copy must be removed, never orphaned - the
//   #698 hang class):
//     - TM_MODIFIER               (TmModifierType)
//     - REMEMBER_MOVE_MODIFIER    (RememberMoveModifierType)
//     - ER_LEARNERS_SHROOM        (ErLearnersShroomModifierType)
//     - ER_TM_CASE                (ErTmCaseModifierType)
//
// Each case: the OWNER drives the sub-pick over the real loopback, the WATCHER adopts the
// identical outcome, and the two engines stay in lockstep (immediate: counter +1 on both +
// converged party state; continuation: the guest adopts the taught move + removes the
// continuation copy so it never orphans/hangs).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-reward-subpickers.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostPartyRewardOwner,
  driveHostTeachMoveRewardOwner,
  driveRetainedTeachMoveRewardWatch,
  forceItemRewards,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair, type ScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import { PartyOption } from "#ui/party-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO reward sub-pickers: owner drives, watcher adopts, lockstep (wiring audit)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`reward-subpickers-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      // Two real moves + two FREE slots: a teach-a-move continuation reward fills a free
      // slot and auto-learns (no interactive "forget which move?" prompt to also drive).
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  /** Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  /** Drive ONE host wave to a win (both player slots FIGHT the frail enemies) under the host ctx,
   *  then replay it on the guest so both engines reach the post-battle reward shop. */
  async function playWaveToShop(rig: DuoRig): Promise<void> {
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
  }

  /** Reach both clients' queued production SelectModifierPhase. */
  async function reachShops(rig: DuoRig): Promise<{ hostShop: ShopPhaseSeam; guestShop: ShopPhaseSeam }> {
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    return { hostShop, guestShop };
  }

  /** Drive an IMMEDIATE (terminal) party-target sub-pick: OWNER (by counter parity) drives the party
   *  slot pick over the real relay, WATCHER adopts it, and the alternating-interaction counter advances
   *  exactly once on BOTH engines. `option` is the party-UI sub-option (fusion splice slot / MOVE_n). */
  async function driveImmediate(
    rig: DuoRig,
    slot: number,
    option: number,
  ): Promise<{ counterBefore: number; hostOwns: boolean }> {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    const { hostShop, guestShop } = await reachShops(rig);
    // V2 reciprocal shop rendezvous: park the WATCHER at the owner's shop barrier (partnerReady) so the
    // party-target commit is admitted, then let it mirror the relayed terminal (partnerSettle).
    if (hostOwns) {
      await withClient(rig.hostCtx, () =>
        driveHostPartyRewardOwner(hostShop, {
          slot,
          option,
          partnerReady: async () => {
            await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
          },
          partnerSettle: () =>
            withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true })),
        }),
      );
    } else {
      await withClient(rig.guestCtx, () =>
        driveHostPartyRewardOwner(guestShop, {
          slot,
          option,
          partnerReady: async () => {
            await withClient(rig.hostCtx, () => beginRewardShopWatch(hostShop));
          },
          partnerSettle: () => withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true })),
        }),
      );
    }
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the counter once").toBe(counterBefore + 1);
    return { counterBefore, hostOwns };
  }

  // ===========================================================================================
  // IMMEDIATE sub-pickers (counter advances; converged party state on both engines).
  // ===========================================================================================

  it("SPLICE (DNA splicer): owner fuses party[0]+party[1], watcher mirrors the SAME fusion", async () => {
    const SLOT = 0;
    const SPLICE_SLOT = 1;
    forceItemRewards(game.override, [{ name: "DNA_SPLICERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    const hostRootBefore = rig.hostScene.getPlayerParty()[SLOT].species.speciesId;
    // openFusionMenu's callback is (fromSlotIndex, spliceSlotIndex) - reuse the (slot, option) intercept.
    await driveImmediate(rig, SLOT, SPLICE_SLOT);

    const hostFused = rig.hostScene.getPlayerParty()[SLOT];
    const guestFused = rig.guestScene.getPlayerParty()[SLOT];
    expect(hostFused.fusionSpecies, "host fused party[0] (owner or watcher)").not.toBeNull();
    expect(guestFused.fusionSpecies, "guest fused party[0] (the other side mirrored it)").not.toBeNull();
    expect(guestFused.species.speciesId, "both engines agree on the fusion base species").toBe(
      hostFused.species.speciesId,
    );
    expect(guestFused.fusionSpecies?.speciesId, "both engines agree on the spliced-in species").toBe(
      hostFused.fusionSpecies?.speciesId,
    );
    expect(hostFused.species.speciesId, "the fusion base is still slot-0's species").toBe(hostRootBefore);
    logs.flush();
  }, 300_000);

  it("MODIFIER (held item): owner grants LEFTOVERS to party[0], watcher mirrors the grant", async () => {
    const SLOT = 0;
    forceItemRewards(game.override, [{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    const hostModsBefore = rig.hostScene.modifiers.length;
    const guestModsBefore = rig.guestScene.modifiers.length;
    await driveImmediate(rig, SLOT, 0);

    expect(rig.hostScene.modifiers.length, "one engine granted the held item").toBe(hostModsBefore + 1);
    expect(rig.guestScene.modifiers.length, "the other engine mirrored the grant (no desync)").toBe(
      guestModsBefore + 1,
    );
    logs.flush();
  }, 300_000);

  it("MOVE_MODIFIER (Ether): owner restores party[0]'s move-0 PP, watcher mirrors the restore", async () => {
    const SLOT = 0;
    forceItemRewards(game.override, [{ name: "ETHER" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    // Deplete move-0 PP on BOTH engines so Ether has an observable effect to converge on.
    const DEPLETED = 5;
    withClientSync(rig.hostCtx, () => {
      rig.hostScene.getPlayerParty()[SLOT].getMoveset()[0]!.ppUsed = DEPLETED;
    });
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerParty()[SLOT].getMoveset()[0]!.ppUsed = DEPLETED;
    });

    // Ether restores the move at PartyOption.MOVE_1 (the first move slot).
    await driveImmediate(rig, SLOT, PartyOption.MOVE_1);

    expect(rig.hostScene.getPlayerParty()[SLOT].getMoveset()[0]!.ppUsed, "one engine restored move-0 PP").toBe(0);
    expect(rig.guestScene.getPlayerParty()[SLOT].getMoveset()[0]!.ppUsed, "the other engine mirrored the restore").toBe(
      0,
    );
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // CONTINUATION sub-pickers (teach a move; the watcher must adopt the taught move AND remove the
  // shop continuation copy so it never orphans - the #698 hang class). Modeled on the proven
  // coop-duo-multiwave TM-Case regression, generalized across the four teach-a-move sub-modes.
  // Wave 1 = counter 0 = HOST owns; the guest is the WATCHER (the side that softlocked pre-#698).
  // ===========================================================================================

  /** Drive a CONTINUATION teach-a-move reward end-to-end: the HOST owner streams its rolled option
   *  list, the pick is relayed on the owner's endpoint, and the GUEST's REAL watcher + no-op
   *  LearnMovePhase adopt it. Returns the guest's phase-queue observations + whether it grew a move. */
  async function driveContinuation(
    rig: DuoRig,
    pair: ScheduledCoopPair,
    resolvePick: (party: ReturnType<BattleScene["getPlayerParty"]>) => { slot: number; moveIndex: number },
  ): Promise<{
    queuedContinuation: boolean;
    queuedLearnMove: boolean;
    continuationRemoved: boolean;
    movesetGrew: boolean;
  }> {
    // Pick a real slot + move index the guest's mirrored party can learn (both engines are identical).
    const pick = withClientSync(rig.guestCtx, () => resolvePick(rig.guestScene.getPlayerParty()));
    const movesBefore = withClientSync(
      rig.guestCtx,
      () => rig.guestScene.getPlayerParty()[pick.slot].getMoveset().length,
    );

    // From the reciprocal reward boundary onward, pump every retained transaction only under its addressed
    // client's complete context. This is the same isolation as two browser processes.
    pair.setAutomaticDelivery(false);
    const { hostShop, guestShop } = await reachShops(rig);
    // Park the watcher before the owner can commit, then drive the owner's real reward phase + PARTY
    // callback. The host retains the typed intent/result transaction; the guest materializes that exact
    // result and its real LearnMovePhase removes the continuation copy.
    const result = await withClient(rig.guestCtx, () =>
      driveRetainedTeachMoveRewardWatch(guestShop, async () => {
        await withClient(rig.hostCtx, () => driveHostTeachMoveRewardOwner(hostShop, pick));
        await withClient(rig.guestCtx, () => pair.flush("guest"));
      }),
    );

    const movesAfter = withClientSync(
      rig.guestCtx,
      () => rig.guestScene.getPlayerParty()[pick.slot].getMoveset().length,
    );
    return { ...result, movesetGrew: movesAfter > movesBefore };
  }

  it("TM_MODIFIER (TM): owner teaches a TM to party[0], watcher adopts it + removes the continuation copy", async () => {
    forceItemRewards(game.override, [{ name: "TM_COMMON" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    // A TM's move is fixed on the TmModifierType (the party-UI option is ignored by buildPokemonModifier);
    // any slot works, moveIndex is irrelevant.
    const result = await driveContinuation(rig, pair, () => ({ slot: 0, moveIndex: 0 }));
    expect(result.queuedContinuation, "guest watcher queued the continuation SelectModifierPhase copy").toBe(true);
    expect(result.queuedLearnMove, "guest watcher queued the no-op LearnMovePhase").toBe(true);
    expect(result.continuationRemoved, "guest LearnMovePhase REMOVED the continuation orphan (no hang)").toBe(true);
    logs.flush();
  }, 300_000);

  it("REMEMBER_MOVE (Memory Mushroom): owner relearns a move, watcher adopts it + removes the copy", async () => {
    forceItemRewards(game.override, [{ name: "MEMORY_MUSHROOM" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    // REMEMBER_MOVE_MODIFIER lists getLearnableLevelMoves(); pick the first slot with a relearnable move.
    const result = await driveContinuation(rig, pair, party => {
      for (let slot = 0; slot < party.length; slot++) {
        if (party[slot].getLearnableLevelMoves().length > 0) {
          return { slot, moveIndex: 0 };
        }
      }
      return { slot: 0, moveIndex: 0 };
    });
    expect(result.queuedContinuation, "guest watcher queued the continuation SelectModifierPhase copy").toBe(true);
    expect(result.queuedLearnMove, "guest watcher queued the no-op LearnMovePhase").toBe(true);
    expect(result.continuationRemoved, "guest LearnMovePhase REMOVED the continuation orphan (no hang)").toBe(true);
    logs.flush();
  }, 300_000);

  it("ER_LEARNERS_SHROOM: owner teaches an egg/TM/tutor move, watcher adopts it + removes the copy", async () => {
    forceItemRewards(game.override, [{ name: "ER_LEARNERS_SHROOM" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    const result = await driveContinuation(rig, pair, party => {
      for (let slot = 0; slot < party.length; slot++) {
        if (party[slot].getErLearnableShroomMoves().length > 0) {
          return { slot, moveIndex: 0 };
        }
      }
      return { slot: 0, moveIndex: 0 };
    });
    expect(result.queuedContinuation, "guest watcher queued the continuation SelectModifierPhase copy").toBe(true);
    expect(result.queuedLearnMove, "guest watcher queued the no-op LearnMovePhase").toBe(true);
    expect(result.continuationRemoved, "guest LearnMovePhase REMOVED the continuation orphan (no hang)").toBe(true);
    logs.flush();
  }, 300_000);

  it("ER_TM_CASE: owner teaches a compatible-TM move, watcher adopts it + removes the copy", async () => {
    forceItemRewards(game.override, [{ name: "TM_CASE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    await playWaveToShop(rig);

    const result = await driveContinuation(rig, pair, party => {
      for (let slot = 0; slot < party.length; slot++) {
        if (party[slot].getErTmCaseMoves().length > 0) {
          return { slot, moveIndex: 0 };
        }
      }
      return { slot: 0, moveIndex: 0 };
    });
    expect(result.queuedContinuation, "guest watcher queued the continuation SelectModifierPhase copy").toBe(true);
    expect(result.queuedLearnMove, "guest watcher queued the no-op LearnMovePhase").toBe(true);
    expect(result.continuationRemoved, "guest LearnMovePhase REMOVED the continuation orphan (no hang)").toBe(true);
    logs.flush();
  }, 300_000);
});
