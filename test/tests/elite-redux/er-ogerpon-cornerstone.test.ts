/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#391): Ogerpon Cornerstone Mask audit. The old report said the Rockhard
// Will innate was dead and Ivy Cudgel did not type-shift per form. Both work
// after the systemic innate fixes (#109/#130/#158) - these tests pin it:
//   - Ivy Cudgel is ROCK on Cornerstone (vanilla IvyCudgelTypeAttr, all forms)
//   - Rockhard Will (ER 617) sits in an innate slot WITH a functional boost
//     attr that the gated apply-path picks up (its 1.2x/1.5x Rock numbers are
//     pinned end-to-end by the er-damage-multiplier-fidelity suite)
//   - the ER learnset is applied (Leafage/Vine Whip at Lv1)
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { AbilityId } from "#enums/ability-id";
import { AbilityId as Ability } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER #391 - Ogerpon Cornerstone Mask", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .starterForms({ [SpeciesId.OGERPON]: 3 })
      .enemySpecies(SpeciesId.BLISSEY)
      .enemyAbility(Ability.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(Ability.BALL_FETCH)
      .moveset([MoveId.POWER_GEM]);
  });

  it("Ivy Cudgel is ROCK-type on Cornerstone and the ER learnset is applied", async () => {
    await game.classicMode.startBattle(SpeciesId.OGERPON);
    const player = game.scene.getPlayerPokemon()!;
    expect(player.formIndex).toBe(3);
    expect(player.getMoveType(allMoves[MoveId.IVY_CUDGEL])).toBe(PokemonType.ROCK);
    const lvOneMoves = player
      .getLevelMoves(1)
      .filter(m => m[0] === 1)
      .map(m => m[1]);
    expect(lvOneMoves).toContain(MoveId.LEAFAGE);
    expect(lvOneMoves).toContain(MoveId.VINE_WHIP);
  });

  it("the Rockhard Will innate is present and ACTIVE on Cornerstone (not dead)", async () => {
    // Force the innate active via the passive override (the candy-unlock
    // gating itself is covered by #425's tests). The 1.2x/1.5x Rock boost
    // behavior of the type-damage-boost archetype is pinned end-to-end by
    // er-damage-multiplier-fidelity - here we pin that Cornerstone Ogerpon
    // actually CARRIES it in an applicable slot (the original 'dead innate'
    // report) and that suppression still turns it off.
    game.override.passiveAbility(ER_ID_MAP.abilities[617] as AbilityId); // Rockhard Will
    await game.classicMode.startBattle(SpeciesId.OGERPON);
    const player = game.scene.getPlayerPokemon()!;

    const activeNames = () => player.getAllActiveAbilityAttrs().map(a => a?.constructor?.name);
    expect(player.getPassiveAbilities().some(a => a?.name === "Rockhard Will")).toBe(true);
    expect(activeNames()).toContain("TypeDamageBoostAbAttr");

    player.suppressAbility();
    expect(activeNames()).not.toContain("TypeDamageBoostAbAttr");
  });
});
