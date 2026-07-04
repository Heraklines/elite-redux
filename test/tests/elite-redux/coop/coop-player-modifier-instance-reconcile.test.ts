/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op player-wide modifier reconcile - INSTANCE IDENTITY (#844).
//
// reconcileCoopPlayerModifiers heals the guest's player-wide PERSISTENT modifiers
// to the host's full ModifierData blob set (a checksum-mismatch heal, a rejoin, or a
// me-entry heal). It USED to key the wanted set by `type.id` ALONE, so a client
// holding MULTIPLE DISTINCT instances of ONE typeId - e.g. two TEMP_STAT_STAGE_BOOSTER
// (X items) for DIFFERENT stats - had every instance COLLAPSED onto the first blob: a
// full-snapshot resync silently LOST instances (a state-destroying heal). The soak
// harness flagged it (TEMP_STAT_STAGE_BOOSTER host=[...] guest=[...] + a missing MAP).
//
// captureCoopPlayerModifiers correctly emits one blob PER instance; the collapse was
// purely in the reconcile. The fix keys the reconcile by INSTANCE IDENTITY:
// (typeId, hash(className, args)) - so N distinct instances reconcile to N.
//
// These cases drive the REAL engine through GameManager (one globalScene = the guest;
// "the host" is modeled by capturing the desired bar state before diverging it):
//   (1) a guest with a COLLAPSED single instance + a host with two DISTINCT X items ->
//       after reconcile the guest has BOTH, with the host's args + stacks.
//   (2) a guest with an EXTRA stale instance the host lacks -> removed.
//   (3) same-typeId same-args stackCount difference -> stackCount SET, no duplicate.
//   (4) a host-only single instance (incl. the ER MAP relic) -> reconstructed + added
//       (the historical single-instance ADD path stays intact; requirement (d)).
// Gated ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { captureCoopPlayerModifiers, reconcileCoopPlayerModifiers } from "#data/elite-redux/coop/coop-battle-engine";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat, type TempBattleStat } from "#enums/stat";
import {
  MapModifier,
  PersistentModifier,
  PokemonFormChangeItemModifier,
  PokemonHeldItemModifier,
  TempStatStageBoosterModifier,
} from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op player-wide modifier reconcile - instance identity (#844)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    // No coop session is opened (reconcile has no in-function gate), so nothing to tear down beyond
    // leaving the shared scene as GameManager built it.
  });

  /** A player-wide, non-held, non-form persistent modifier this heal path owns. */
  const isOwnedPlayerWide = (m: PersistentModifier): boolean =>
    m instanceof PersistentModifier
    && !(m instanceof PokemonHeldItemModifier)
    && !(m instanceof PokemonFormChangeItemModifier);

  /** Strip the bar down to a clean slate so capture/reconcile assertions are exact. */
  const stripOwned = (): void => {
    for (const m of [...globalScene.modifiers]) {
      if (isOwnedPlayerWide(m)) {
        globalScene.removeModifier(m);
      }
    }
    globalScene.updateModifiers(true);
  };

  /** Build + add a TEMP_STAT_STAGE_BOOSTER (X item) for a specific stat at a given stackCount. */
  const addXItem = (stat: TempBattleStat, stackCount = 1): PersistentModifier => {
    const type = modifierTypes
      .TEMP_STAT_STAGE_BOOSTER()
      .generateType([], [stat])
      ?.withIdFromFunc(modifierTypes.TEMP_STAT_STAGE_BOOSTER);
    const mod = type?.newModifier();
    expect(mod, "X item built").toBeInstanceOf(TempStatStageBoosterModifier);
    const pm = mod as PersistentModifier;
    pm.stackCount = stackCount;
    globalScene.addModifier(pm, true, false, false);
    globalScene.updateModifiers(true);
    return pm;
  };

  /** Add the vanilla-namespaced MAP relic (an ER-custom-adjacent single-instance player-wide modifier). */
  const addMap = (): PersistentModifier => {
    const type = modifierTypes.MAP().withIdFromFunc(modifierTypes.MAP);
    const mod = type.newModifier();
    expect(mod, "MAP built").toBeInstanceOf(MapModifier);
    const pm = mod as PersistentModifier;
    globalScene.addModifier(pm, true, false, false);
    globalScene.updateModifiers(true);
    return pm;
  };

  /** The guest's live X items as `{ stat, stack }`, sorted by stat (getArgs()[0] is the stat). */
  const xItems = (): { stat: number; stack: number }[] =>
    globalScene.modifiers
      .filter((m): m is TempStatStageBoosterModifier => m instanceof TempStatStageBoosterModifier)
      .map(m => ({ stat: m.getArgs()[0] as number, stack: m.stackCount }))
      .sort((a, b) => a.stat - b.stat);

  /** Count of live owned player-wide modifiers of a given type.id on the bar. */
  const countOfType = (typeId: string): number =>
    globalScene.modifiers.filter(m => isOwnedPlayerWide(m) && m.type.id === typeId).length;

  const startBattle = async (): Promise<void> => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    expect(globalScene.arena, "arena built (degraded scene)").toBeTruthy();
    stripOwned();
  };

  it("(1) two DISTINCT X items collapsed to one on the guest are BOTH restored with host args + stacks", async () => {
    await startBattle();
    // HOST truth: two DISTINCT X items - ATK (stack 2) and SP_ATK (stack 1). captureCoopPlayerModifiers
    // emits one blob PER instance (the fix's premise).
    addXItem(Stat.ATK, 2);
    addXItem(Stat.SPATK, 1);
    const hostBlobs = captureCoopPlayerModifiers();
    expect(hostBlobs.filter(b => b.typeId === "TEMP_STAT_STAGE_BOOSTER").length).toBe(2);

    // GUEST divergence: a prior typeId-keyed heal COLLAPSED both onto ONE instance (ATK survives, and its
    // stack even drifted). This is the exact state-destroying-heal state the soak flagged.
    stripOwned();
    addXItem(Stat.ATK, 1);
    expect(xItems()).toEqual([{ stat: Stat.ATK, stack: 1 }]);

    // Reconcile by instance identity: the ATK instance is stack-corrected AND the missing SP_ATK instance
    // is reconstructed + added - N distinct instances reconcile to N.
    expect(reconcileCoopPlayerModifiers(hostBlobs)).toBe(true);
    expect(xItems()).toEqual([
      { stat: Stat.ATK, stack: 2 },
      { stat: Stat.SPATK, stack: 1 },
    ]);
  });

  it("(2) a guest instance the host lacks (a stale extra distinct X item) is REMOVED", async () => {
    await startBattle();
    // HOST truth: exactly ONE X item (ATK).
    addXItem(Stat.ATK, 1);
    const hostBlobs = captureCoopPlayerModifiers();
    expect(hostBlobs.filter(b => b.typeId === "TEMP_STAT_STAGE_BOOSTER").length).toBe(1);

    // GUEST divergence: a stale SECOND distinct X item (DEF) the host does not have.
    addXItem(Stat.DEF, 1);
    expect(xItems()).toEqual([
      { stat: Stat.ATK, stack: 1 },
      { stat: Stat.DEF, stack: 1 },
    ]);

    // Reconcile: the stale DEF instance is dropped; the host's ATK instance stays.
    expect(reconcileCoopPlayerModifiers(hostBlobs)).toBe(true);
    expect(xItems()).toEqual([{ stat: Stat.ATK, stack: 1 }]);
  });

  it("(3) same-typeId same-args stackCount difference is SET, with no duplicate instance", async () => {
    await startBattle();
    // HOST truth: one X item (ATK) at stack 2.
    addXItem(Stat.ATK, 2);
    const hostBlobs = captureCoopPlayerModifiers();

    // GUEST divergence: the SAME instance (identical args) but a stale stack of 1.
    stripOwned();
    addXItem(Stat.ATK, 1);
    expect(xItems()).toEqual([{ stat: Stat.ATK, stack: 1 }]);

    // Reconcile: stackCount is SET to the host's; matching is side-effect-free (no second instance added).
    expect(reconcileCoopPlayerModifiers(hostBlobs)).toBe(true);
    expect(xItems()).toEqual([{ stat: Stat.ATK, stack: 2 }]);
    expect(countOfType("TEMP_STAT_STAGE_BOOSTER"), "no duplicate ATK instance").toBe(1);
  });

  it("(3b) an already-converged single instance is a no-op (returns false, unchanged)", async () => {
    await startBattle();
    addXItem(Stat.SPD, 1);
    const hostBlobs = captureCoopPlayerModifiers();
    // No divergence: reconcile must change nothing and report it.
    expect(reconcileCoopPlayerModifiers(hostBlobs)).toBe(false);
    expect(xItems()).toEqual([{ stat: Stat.SPD, stack: 1 }]);
  });

  it("(4) a host-only single instance is reconstructed + ADDED (single-instance path intact)", async () => {
    await startBattle();
    // HOST truth: one X item the guest never received (the classic #698 BUG 2 missing-modifier case).
    addXItem(Stat.SPDEF, 1);
    const hostBlobs = captureCoopPlayerModifiers();

    // GUEST divergence: it has NONE of them.
    stripOwned();
    expect(xItems()).toEqual([]);

    expect(reconcileCoopPlayerModifiers(hostBlobs)).toBe(true);
    expect(xItems()).toEqual([{ stat: Stat.SPDEF, stack: 1 }]);
  });

  it("(4b/#844 evidence) a missing MAP relic is reconstructed via the vanilla resolver (requirement d)", async () => {
    await startBattle();
    // HOST truth: the MAP relic (MapModifier lives in the vanilla Modifier namespace, so it reconstructs
    // through `Modifier[className]`). This is the soak's "missing MAP at wave 4" case.
    addMap();
    const hostBlobs = captureCoopPlayerModifiers();
    expect(hostBlobs.some(b => b.typeId === "MAP")).toBe(true);

    // GUEST divergence: the MAP is absent (the pure renderer never ran the reward grant that created it).
    stripOwned();
    expect(countOfType("MAP")).toBe(0);

    expect(reconcileCoopPlayerModifiers(hostBlobs)).toBe(true);
    expect(countOfType("MAP"), "the MAP relic is reconstructed + added").toBe(1);
  });
});
