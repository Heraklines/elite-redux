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

  it("ER_AILMENT_TAGS holds frostbite + fear but NOT bleed (heal-move-only) or mechanical riders", () => {
    // BLEED is deliberately EXCLUDED: per the ER dex it is removed ONLY by a healing
    // move, never by a cure-all (Lum / Full Heal / Heal Bell / Natural Cure / ...).
    expect([...ER_AILMENT_TAGS].sort()).toEqual([BattlerTagType.ER_FROSTBITE, BattlerTagType.ER_FEAR].sort());
    expect(ER_AILMENT_TAGS).not.toContain(BattlerTagType.ER_BLEED);
  });

  // NB: the ER major statuses are mutually exclusive (a mon cannot be both
  // frostbitten AND bleeding at once), so the "clears frostbite" and "does not
  // clear bleed" properties are pinned on SEPARATE mons.
  it("Heal Bell (cure-ALL move) clears a cure-all ER ailment (frostbite)", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.HEAL_BELL])
      .startingLevel(50)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const mon = game.field.getPlayerPokemon();
    mon.addTag(BattlerTagType.ER_FROSTBITE, 5, MoveId.NONE, mon.id);
    expect(hasErAilment(mon)).toBe(true);

    game.move.select(MoveId.HEAL_BELL);
    await game.toNextTurn();

    // Heal Bell's PartyStatusCureAttr clears the cure-all ER ailments (frostbite/fear)...
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
    expect(hasErAilment(mon)).toBe(false);
    // The helper leaves an already-clean (no cure-all-ailment) mon untouched.
    expect(clearErAilments(mon)).toBe(false);
  });

  it("Heal Bell (cure-ALL move) does NOT clear ER Bleed (heal-move-only)", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.HEAL_BELL])
      .startingLevel(50)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const mon = game.field.getPlayerPokemon();
    mon.addTag(BattlerTagType.ER_BLEED, 5, MoveId.NONE, mon.id);

    game.move.select(MoveId.HEAL_BELL);
    await game.toNextTurn();

    // ER BLEED is NEVER removed by a cure-all - only a healing move clears it.
    expect(mon.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });
});
