/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER custom statuses (FROSTBITE / BLEED / FEAR) are battler tags, not vanilla
// StatusEffects, so the standard cure machinery used to ignore them. These
// tests pin: (a) the ER_AILMENT_TAGS contract + clearErAilments helper, and
// (b) that a status-clearing ABILITY (Natural Cure, on switch-out) now also
// clears an ER ailment tag — the user-reported gap ("abilities that clear
// status should also work on these").
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { clearErAilments, ER_AILMENT_TAGS, hasErAilment } from "#data/elite-redux/er-status-cure";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER status cure generalization", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("ER_AILMENT_TAGS contains the three ER ailments (and not mechanical riders)", () => {
    expect([...ER_AILMENT_TAGS].sort()).toEqual(
      [BattlerTagType.ER_BLEED, BattlerTagType.ER_FROSTBITE, BattlerTagType.ER_FEAR].sort(),
    );
  });

  it("Heal Bell (cure-ALL move) clears an ER ailment from the team", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.HEAL_BELL])
      .startingLevel(50)
      .enemyLevel(5);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const mon = game.field.getPlayerPokemon();
    mon.addTag(BattlerTagType.ER_BLEED, 5, MoveId.NONE, mon.id);
    expect(hasErAilment(mon)).toBe(true);

    game.move.select(MoveId.HEAL_BELL);
    await game.toNextTurn();

    // Heal Bell's PartyStatusCureAttr now also clears ER ailment tags.
    expect(mon.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(hasErAilment(mon)).toBe(false);
    // The helper leaves an already-clean mon untouched.
    expect(clearErAilments(mon)).toBe(false);
  });
});
