/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repros (gated behind ER_SCENARIO=1):
//
// 1. Thunder Shock base power was 40 (a stale beta carry-over in the c-source
//    correction pass). ER (er-moves.ts id 84) lists Thunder Shock at 80 power.
//    The c-source override is the authoritative final `.power` writer, so the
//    fix corrects the override value to 80 → allMoves[THUNDER_SHOCK].power === 80.
//
// 2. Cross Poison showed Power 90 (c-source override 90) while the move is wired
//    as a 2-hit move (MultiHitType.TWO). ER (er-moves.ts id 440) lists Cross
//    Poison at 40 power PER HIT. The fix corrects the override to 40, preserving
//    the existing high-crit + 10% poison + 2-hit mechanics that already match ER.
//
// 3. ER Frostbite is a battler tag (BattlerTagType.ER_FROSTBITE), not a vanilla
//    StatusEffect, so Full Heal (PokemonStatusHealModifier) did not clear it.
//    The fix has the modifier also removeTag(ER_FROSTBITE).
// =============================================================================

import { allMoves, modifierTypes } from "#data/data-lists";
import { MultiHitAttr } from "#data/moves/move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PokemonStatusHealModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER move power fixes (Thunder Shock, Cross Poison)", () => {
  it("Thunder Shock base power is 80 (not the stale 40)", () => {
    expect(allMoves[MoveId.THUNDER_SHOCK].power).toBe(80);
  });

  it("Cross Poison base power is 40 per hit (not 90)", () => {
    expect(allMoves[MoveId.CROSS_POISON].power).toBe(40);
  });

  it("Cross Poison keeps its ER mechanics: 2-hit, high crit, 10% poison, Poison-type", () => {
    const move = allMoves[MoveId.CROSS_POISON];
    expect(move.type).toBe(PokemonType.POISON);
    // High crit ratio.
    expect(move.attrs.map(a => a.constructor.name)).toContain("HighCritAttr");
    // 10% poison chance.
    expect(move.attrs.map(a => a.constructor.name)).toContain("StatusEffectAttr");
    expect(move.chance).toBe(10);
    // Hits twice (MultiHitType.TWO wired by the ER move-patch pass).
    const multi = move.attrs.find((a): a is MultiHitAttr => a instanceof MultiHitAttr);
    expect(multi).toBeDefined();
  });
});

describe.skipIf(!RUN)("Full Heal clears ER Frostbite", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("removes the ER_FROSTBITE battler tag when applied", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();

    mon.addTag(BattlerTagType.ER_FROSTBITE);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeDefined();

    const modifier = modifierTypes.FULL_HEAL().newModifier(mon) as PokemonStatusHealModifier;
    expect(modifier).toBeInstanceOf(PokemonStatusHealModifier);
    const applied = modifier.apply(mon);

    expect(applied).toBe(true);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
  });
});
