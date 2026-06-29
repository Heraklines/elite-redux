/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#332/#333, revised): Gifted Mind read as broken on Galar Articuno.
// The 2.65 dex text is "grants immunity to Dark, Ghost, and Bug-type moves while
// making all status moves used by this Pokemon never miss." The earlier port only
// neutralized the Psychic type's weakness (and only when the holder was Psychic-
// typed), so Dark/Ghost still chipped and Bug was untouched. It is now flat x0
// IMMUNITY to Dark, Ghost, and Bug attacks regardless of the holder's typing
// (three AttackTypeImmunityAbAttr, Levitate-style), plus the status-moves-always-
// hit half (ConditionalAlwaysHit on STATUS-category moves).
// Gated behind ER_SCENARIO=1 (boots a real battle so the ability immunity fires).
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const GIFTED_MIND = ER_ID_MAP.abilities[422];

describe.skipIf(!RUN)("ER Gifted Mind — flat immunity to Dark/Ghost/Bug", () => {
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
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(GIFTED_MIND);
  });

  it("carries 3 attack-type immunities (Dark/Ghost/Bug) + status-moves-always-hit", () => {
    const ab = allAbilities[GIFTED_MIND];
    const immuneTypes = ab.attrs
      .filter(a => a.constructor.name === "AttackTypeImmunityAbAttr")
      .map(a => (a as unknown as { getImmuneType: () => PokemonType }).getImmuneType());
    expect(immuneTypes).toContain(PokemonType.DARK);
    expect(immuneTypes).toContain(PokemonType.GHOST);
    expect(immuneTypes).toContain(PokemonType.BUG);
    expect(ab.attrs.some(a => a.constructor.name === "ConditionalAlwaysHitAbAttr")).toBe(true);
  });

  it("zeroes Dark/Ghost/Bug effectiveness on a Psychic holder; leaves other types alone", async () => {
    // Espeon is pure Psychic: Dark/Ghost/Bug are all x2 against it WITHOUT the ability.
    await game.classicMode.startBattle(SpeciesId.ESPEON);
    const mon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(mon.getAbility().id).toBe(GIFTED_MIND);

    // The three immunities flip x2 -> x0.
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.DARK_PULSE])).toBe(0);
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.SHADOW_BALL])).toBe(0);
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.BUG_BUZZ])).toBe(0);

    // Unrelated types are untouched: Normal is neutral (x1), Psychic resists itself (x0.5).
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.SWIFT])).toBe(1);
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.PSYCHIC])).toBe(0.5);
  });

  it("grants the immunity regardless of the holder's own typing (non-Psychic holder)", async () => {
    // Snorlax is pure Normal: Ghost is x0 already (type chart), but Dark/Bug are x1.
    // Gifted Mind must still zero Dark and Bug here - the immunity is type-based on
    // the ATTACK, not a Psychic-weakness patch.
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const mon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.DARK_PULSE])).toBe(0);
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.BUG_BUZZ])).toBe(0);
    // A Fighting move (Normal's real weakness) is still super-effective.
    expect(mon.getMoveEffectiveness(enemy, allMoves[MoveId.AURA_SPHERE])).toBe(2);
  });
});
