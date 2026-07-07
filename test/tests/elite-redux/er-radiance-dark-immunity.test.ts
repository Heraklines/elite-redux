/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Radiance (437) Dark-move immunity.
//
// DEX (2.65): "+20% accuracy; Dark moves fail when user is present."
//
// The field-wide "Dark moves fail" half is wired globally by
// `patchDarkMovesForRadiance` — a MoveCondition attached to every move whose
// DECLARED type is Dark. That misses a move that becomes Dark at RUNTIME
// (Deviate/Hydrate-style -ate abilities, Judgment/Multi-Attack via plate/memory,
// Tera Blast when Tera-Dark), so it still hit the Radiance holder (the reported
// "Radiance doesn't prevent dark type moves from damaging you" bug).
//
// The fix adds an `AttackTypeImmunityAbAttr(DARK)` to the holder so the immunity
// is resolved by the attacker's RUNTIME move type (`getMoveType`) at defend time,
// closing the dynamic-Dark gap while the field-wide condition still handles the
// static-Dark ally/field semantics.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AttackTypeImmunityAbAttr } from "#abilities/ab-attrs";
import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// ER custom ability ids live in the ErAbilityId numeric space; the established
// cast pattern for engine APIs typed on AbilityId (see move-condition.ts).
const RADIANCE = ErAbilityId.RADIANCE as unknown as AbilityId;
const DEVIATE = ErAbilityId.DEVIATE as unknown as AbilityId; // Normal-type moves become Dark

describe("ER Radiance — Dark-move immunity", () => {
  it("wires an AttackTypeImmunityAbAttr(DARK) on the holder (attr-level)", () => {
    const row = ER_ABILITY_ARCHETYPES[437];
    expect(row, "no archetype row for Radiance (437)").toBeDefined();
    const attrs: readonly AbAttr[] = dispatchArchetype(row.archetype, row.params, 437).attrs;
    const immunity = attrs.find((a): a is AttackTypeImmunityAbAttr => a instanceof AttackTypeImmunityAbAttr);
    expect(immunity, "Radiance should carry an AttackTypeImmunityAbAttr").toBeDefined();
    expect(immunity?.getImmuneType()).toBe(PokemonType.DARK);
  });

  describe.skipIf(!RUN)("behavior", () => {
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
        .ability(RADIANCE)
        // Wave 145 is past the #419 elite-BST-cap ladder, so Gengar (500 BST) is
        // not devolved/swapped at a low wave.
        .startingWave(145)
        .enemySpecies(SpeciesId.GENGAR)
        .enemyLevel(100)
        .startingLevel(100);
    });

    it("a statically-Dark move (Dark Pulse) does no damage to the holder", async () => {
      game.override.enemyAbility(AbilityId.BALL_FETCH).enemyMoveset(MoveId.DARK_PULSE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.SPLASH); // player idles; enemy uses Dark Pulse
      await game.toEndOfTurn();

      expect(player.hp).toBe(player.getMaxHp());
    }, 40000);

    it("a move that becomes Dark at runtime (Deviate + Tackle) does no damage to the holder", async () => {
      // Deviate turns the enemy's Normal Tackle into a Dark move. The static-only
      // field condition misses it; the AttackTypeImmunityAbAttr catches it.
      game.override.enemyAbility(DEVIATE).enemyMoveset(MoveId.TACKLE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      game.move.use(MoveId.SPLASH); // player idles; enemy uses Dark-ified Tackle
      await game.toEndOfTurn();

      expect(player.hp).toBe(player.getMaxHp());
    }, 40000);
  });
});
