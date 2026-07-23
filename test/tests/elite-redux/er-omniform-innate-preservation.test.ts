/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform (5929) — Partner Eevee family innate-unlock ownership.
//
// Maintainer directive: "if you unlock innates on partner eevee those same
// innates need to be unlocked on all its mid battle evos". Partner Eevee is the
// vanilla Eevee "partner" FORM; it adapts mid-battle into standalone partner
// eeveelution species (ids 70012+). Those target species are transform-only — the
// player never candy-unlocks them — so their `starterData[...].passiveAttr` is 0.
// The original fix used the pre-transform SOURCE while adapting, but a saved or
// directly-instantiated partner Eeveelution has no transform snapshot. The family
// unlock-owner registry makes both paths read Partner Eevee's exact per-slot mask
// and preserves it across chained transforms and leaveField reverts.
//
// This exercises the REAL production Omniform mappings + the REAL partner family
// composites (NOT forced active — the innate CANDY-UNLOCK path is the whole point,
// so a `.ability()` override would mask it). Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import {
  ER_PARTNER_EEVEE_ABILITY_ID,
  ER_PARTNER_FLAREON_ABILITY_ID,
  ER_PARTNER_VAPOREON_ABILITY_ID,
} from "#data/elite-redux/abilities/composite-newcomers";
import { erOmniformOnMoveStart, erOmniformRevertOnLeaveField } from "#data/elite-redux/abilities/omniform";
import {
  ER_PARTNER_FAMILY,
  ER_PARTNER_FLAREON_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { isSlotActive, unlockSlot } from "#utils/passive-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (Partner Eevee IS this form, not a new species). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

describe.skipIf(!RUN)("ER Omniform (5929) — innate-unlock preservation across transform", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.WATER_GUN, MoveId.EMBER, MoveId.TACKLE, MoveId.SPLASH])
      // Spawn Eevee in the partner form. Do NOT force the composite active — the
      // innate CANDY-UNLOCK gate is exactly what is under test.
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() });
  });

  /** Unlock the given Partner Eevee innate slots on the player's account candy data. */
  function unlockEeveeSlots(...slots: (0 | 1 | 2)[]): number {
    let attr = 0;
    for (const s of slots) {
      attr = unlockSlot(attr, s);
    }
    game.scene.gameData.starterData[SpeciesId.EEVEE].passiveAttr = attr;
    return attr;
  }

  it("target eeveelution species are transform-only (never candy-unlocked) — the bug precondition", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    // Partner Vaporeon's evolution root is itself (a standalone transform target),
    // NOT Eevee, and the player never candy-unlocks it — so reading ITS passiveAttr
    // yields 0 (all innates locked). That is precisely why the source must be
    // consulted for a transformed holder.
    const target = getPokemonSpecies(ER_PARTNER_VAPOREON_SPECIES_ID as SpeciesId);
    expect(target.getRootSpeciesId()).not.toBe(SpeciesId.EEVEE);
    expect(game.scene.gameData.starterData[target.getRootSpeciesId()]?.passiveAttr ?? 0).toBe(0);
  });

  const directUnlockCases = ER_PARTNER_FAMILY.flatMap(member => [
    { ...member, maskName: "all locked", unlockedSlots: [] as const, expected: [false, false, false] as const },
    {
      ...member,
      maskName: "only slot 2 unlocked",
      unlockedSlots: [1] as const,
      expected: [false, true, false] as const,
    },
    { ...member, maskName: "all unlocked", unlockedSlots: [0, 1, 2] as const, expected: [true, true, true] as const },
  ]);

  it.each(directUnlockCases)("a directly-instantiated $name keeps Partner Eevee's $maskName mask", async ({
    partnerId,
    unlockedSlots,
    expected,
  }) => {
    await game.classicMode.startBattle(partnerId as SpeciesId);
    const holder = game.field.getPlayerPokemon();
    const eeveeAttr = unlockEeveeSlots(...unlockedSlots);

    // A saved/restored or directly-created partner Eeveelution has no transient
    // Omniform source snapshot. It must still use the registered family head
    // (Partner Eevee) as its permanent candy-unlock owner.
    expect(holder.getSpeciesForm().speciesId).toBe(partnerId);
    for (const slot of [0, 1, 2] as const) {
      expect(holder.innateSlotPassiveAttr(slot)).toBe(eeveeAttr);
      expect(isSlotActive(holder.innateSlotPassiveAttr(slot), slot)).toBe(expected[slot]);
    }
  });

  it("(a) an innate unlocked on Partner Eevee stays ACTIVE after it adapts into a partner eeveelution", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    const eeveeAttr = unlockEeveeSlots(0);

    // Pre-transform: the [Fluffy + Omniform] composite innate is unlocked-active.
    expect(holder.innateSlotPassiveAttr(0)).toBe(eeveeAttr);
    expect(holder.hasUnlockedAbility(ER_PARTNER_EEVEE_ABILITY_ID as AbilityId)).toBe(true);

    // Water move -> Partner Vaporeon (production mapping).
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);

    // The transformed form's innate unlock reads the SOURCE (Eevee) mask, not the
    // target species (whose passiveAttr is 0) — so the grafted innate stays live.
    expect(holder.innateSlotPassiveAttr(0)).toBe(eeveeAttr);
    expect(isSlotActive(holder.innateSlotPassiveAttr(0), 0)).toBe(true);
    expect(holder.hasUnlockedAbility(ER_PARTNER_VAPOREON_ABILITY_ID as AbilityId)).toBe(true);
  });

  it("(b) a slot LOCKED on Partner Eevee stays LOCKED after transform (per-slot fidelity, not a blanket unlock)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    // Unlock slots 0 and 2 on Eevee, leave slot 1 LOCKED.
    unlockEeveeSlots(0, 2);

    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);

    // Each slot's live state mirrors the SOURCE Eevee mask, slot by slot.
    expect(isSlotActive(holder.innateSlotPassiveAttr(0), 0)).toBe(true);
    expect(isSlotActive(holder.innateSlotPassiveAttr(1), 1)).toBe(false);
    expect(isSlotActive(holder.innateSlotPassiveAttr(2), 2)).toBe(true);
  });

  it("(c) revert (leaveField) restores exactly the pre-transform unlock state", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    const eeveeAttr = unlockEeveeSlots(0);

    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);
    expect(holder.innateSlotPassiveAttr(0)).toBe(eeveeAttr);

    // leaveField (switch-out / wave end) reverts the species; the unlock read now
    // falls back to the reverted base species and is identical to pre-transform.
    holder.resetSummonData();
    erOmniformRevertOnLeaveField(holder);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
    expect(holder.innateSlotPassiveAttr(0)).toBe(eeveeAttr);
    expect(holder.hasUnlockedAbility(ER_PARTNER_EEVEE_ABILITY_ID as AbilityId)).toBe(true);
  });

  it("(d) a chained transform (type -> type) preserves the SOURCE unlock across every link", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    const eeveeAttr = unlockEeveeSlots(0);

    // Eevee partner form -> Partner Vaporeon (Water).
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);
    expect(holder.innateSlotPassiveAttr(0)).toBe(eeveeAttr);

    // Chained -> Partner Flareon (Fire). The source snapshot is captured once per
    // battle, so every link reads Partner Eevee's unlock, not the intermediate's.
    erOmniformOnMoveStart(holder, allMoves[MoveId.EMBER]);
    expect(holder.getSpeciesForm().speciesId).toBe(ER_PARTNER_FLAREON_SPECIES_ID);
    expect(holder.innateSlotPassiveAttr(0)).toBe(eeveeAttr);
    expect(isSlotActive(holder.innateSlotPassiveAttr(0), 0)).toBe(true);
    expect(holder.hasUnlockedAbility(ER_PARTNER_FLAREON_ABILITY_ID as AbilityId)).toBe(true);
  });
});
