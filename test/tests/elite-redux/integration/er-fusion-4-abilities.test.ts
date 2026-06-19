/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER integration — fusion + 4-ability interactions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      // Force-enable passives so the ER 3-passive path is active. Without
      // this, `Pokemon.passive` defaults to false in tests (no save data) and
      // every passive slot is gated off via `canApplyAbility(true, slot)`.
      .hasPassiveAbility(true)
      .enemyPassiveAbility(AbilityId.BALL_FETCH);
  });

  describe("fusion ability inheritance", () => {
    it("keeps slots 1 and 3 from the base and slots 2 and 4 from the absorbed Pokemon", async () => {
      // Force a deterministic fusion: Bulbasaur (base) + Charmander (fusion).
      // Both vanilla species are equipped with ER's 3-passive triples by
      // B1a's species init. We pin both `setPassives()` triples here so the
      // assertions don't drift if B1a's tuples are re-tuned later.
      game.override.enableStarterFusion().starterFusionSpecies(SpeciesId.CHARMANDER);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);

      const player = game.field.getPlayerPokemon();
      expect(player.isFusion()).toBe(true);
      expect(player.fusionSpecies).not.toBeNull();
      expect(player.fusionSpecies?.speciesId).toBe(SpeciesId.CHARMANDER);

      // Install deterministic test triples on both parents so the merge result
      // is predictable across ER tuple revisions.
      const baseTriple = [AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD] as const;
      const fusionTriple = [AbilityId.BLAZE, AbilityId.SOLAR_POWER, AbilityId.FLAME_BODY] as const;
      const originalBase = (player.species as unknown as { _passives: unknown })._passives;
      const originalFusion = (player.fusionSpecies as unknown as { _passives: unknown })._passives;
      try {
        player.species.setPassives(baseTriple);
        player.fusionSpecies!.setPassives(fusionTriple);

        const passives = player.getPassiveAbilities();
        expect(passives).toHaveLength(3);
        expect(player.getAbility().id).toBe(player.getSpeciesForm().getAbility(player.abilityIndex));
        expect(passives[0]).not.toBeNull();
        expect(passives[0]!.id).toBe(AbilityId.BLAZE);
        expect(passives[1]).not.toBeNull();
        expect(passives[1]!.id).toBe(AbilityId.CHLOROPHYLL);
        expect(passives[2]).not.toBeNull();
        expect(passives[2]!.id).toBe(AbilityId.FLAME_BODY);
      } finally {
        (player.species as unknown as { _passives: unknown })._passives = originalBase;
        (player.fusionSpecies as unknown as { _passives: unknown })._passives = originalFusion;
      }
    });

    it("preserves duplicate abilities when both inherited slots contain them", async () => {
      game.override.enableStarterFusion().starterFusionSpecies(SpeciesId.CHARMANDER);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);

      const player = game.field.getPlayerPokemon();
      const originalBase = (player.species as unknown as { _passives: unknown })._passives;
      const originalFusion = (player.fusionSpecies as unknown as { _passives: unknown })._passives;
      try {
        player.species.setPassives([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
        player.fusionSpecies!.setPassives([AbilityId.CHLOROPHYLL, AbilityId.SOLAR_POWER, AbilityId.FLAME_BODY]);

        const passives = player.getPassiveAbilities();
        expect(passives[0]!.id).toBe(AbilityId.CHLOROPHYLL);
        expect(passives[1]!.id).toBe(AbilityId.CHLOROPHYLL);
        expect(passives[2]!.id).toBe(AbilityId.FLAME_BODY);
      } finally {
        (player.species as unknown as { _passives: unknown })._passives = originalBase;
        (player.fusionSpecies as unknown as { _passives: unknown })._passives = originalFusion;
      }
    });

    it("leaves an inherited slot empty when that parent has no ability in the slot", async () => {
      // Regression guard: a fusion where only one side has `_passives` set
      // (other side falls back to legacy single-passive) must still produce a
      // non-empty slot 0 and not crash. This is the "no regressions in vanilla
      // single-passive fusion behavior" constraint from the task.
      game.override.enableStarterFusion().starterFusionSpecies(SpeciesId.CHARMANDER);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);

      const player = game.field.getPlayerPokemon();
      const originalBase = (player.species as unknown as { _passives: unknown })._passives;
      const originalFusion = (player.fusionSpecies as unknown as { _passives: unknown })._passives;
      try {
        // Base: full 3-passive triple. Fusion: legacy fallback (null `_passives`
        // → `getPassiveAbilities()` on the species returns [legacy, NONE, NONE]).
        player.species.setPassives([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
        (player.fusionSpecies as unknown as { _passives: unknown })._passives = null;

        const passives = player.getPassiveAbilities();
        expect(passives[0]).not.toBeNull();
        expect(passives[0]!.id).not.toBe(AbilityId.OVERGROW);
        expect(passives[1]!.id).toBe(AbilityId.CHLOROPHYLL);
        expect(passives[2]).toBeNull();
      } finally {
        (player.species as unknown as { _passives: unknown })._passives = originalBase;
        (player.fusionSpecies as unknown as { _passives: unknown })._passives = originalFusion;
      }
    });

    it("applies custom overrides from the parent that owns each final slot", async () => {
      game.override.enableStarterFusion().starterFusionSpecies(SpeciesId.CHARMANDER);
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);

      const player = game.field.getPlayerPokemon();
      player.setAbilityOverrideForSlot(0, AbilityId.STURDY);
      player.setAbilityOverrideForSlot(1, AbilityId.DRIZZLE);
      player.setAbilityOverrideForSlot(2, AbilityId.MOXIE);
      player.setAbilityOverrideForSlot(3, AbilityId.SAND_STREAM);

      expect(player.getAbility().id).toBe(AbilityId.STURDY);
      expect(
        player
          .getPassiveAbilities()
          .slice(0, 3)
          .map(ability => ability?.id),
      ).toEqual([AbilityId.DRIZZLE, AbilityId.MOXIE, AbilityId.SAND_STREAM]);
    });

    it("leaves non-fused ability slots unchanged", async () => {
      // Sanity check: when not a fusion, `getPassiveAbilities()` must equal
      // exactly the species' triple — no merge logic must fire.
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);

      const player = game.field.getPlayerPokemon();
      expect(player.isFusion()).toBe(false);

      const originalBase = (player.species as unknown as { _passives: unknown })._passives;
      try {
        player.species.setPassives([AbilityId.OVERGROW, AbilityId.CHLOROPHYLL, AbilityId.LEAF_GUARD]);
        const passives = player.getPassiveAbilities();
        expect(passives[0]!.id).toBe(AbilityId.OVERGROW);
        expect(passives[1]!.id).toBe(AbilityId.CHLOROPHYLL);
        expect(passives[2]!.id).toBe(AbilityId.LEAF_GUARD);
      } finally {
        (player.species as unknown as { _passives: unknown })._passives = originalBase;
      }
    });
  });

  describe("transform copies all 3 passives", () => {
    it("setTempPassives() overrides all 3 passive slots on the user", async () => {
      // Direct unit-style coverage of setTempPassives — exercises the
      // override path independently of PokemonTransformPhase wiring.
      await game.classicMode.startBattle(SpeciesId.BULBASAUR);

      const player = game.field.getPlayerPokemon();
      const newPassives = [
        allAbilities[AbilityId.BLAZE],
        allAbilities[AbilityId.SOLAR_POWER],
        allAbilities[AbilityId.FLAME_BODY],
      ] as const;
      player.setTempPassives(newPassives);

      const passives = player.getPassiveAbilities();
      expect(passives[0]!.id).toBe(AbilityId.BLAZE);
      expect(passives[1]!.id).toBe(AbilityId.SOLAR_POWER);
      expect(passives[2]!.id).toBe(AbilityId.FLAME_BODY);
    });

    it("PokemonTransformPhase copies all 3 target passives onto the user", async () => {
      // The integration test: a transformed Pokemon should expose the
      // target's 3-passive set via `getPassiveAbilities()`. Closes the
      // "transform copies all 3 passives" gap from the user task.
      //
      // Disable the enemy passive override installed by the file-level
      // `beforeEach`: that override is meant for tests that want a *forced*
      // single passive on the enemy, but this test installs its own explicit
      // 3-passive triple on Charmander's species and needs `getPassiveAbilities()`
      // to resolve through species `_passives`, not the slot-0 override.
      // Without this, the override hijacks slot 0 and the transform copies
      // the override's id instead of the species triple.
      game.override.enemySpecies(SpeciesId.CHARMANDER).enemyPassiveAbility(AbilityId.NONE);
      await game.classicMode.startBattle(SpeciesId.DITTO);

      const ditto = game.field.getPlayerPokemon();
      const charmander = game.field.getEnemyPokemon();

      // Install a deterministic 3-passive triple on the target so we can
      // assert against known ids (not ER B1a's specific tuple — which may
      // change). Restore after to avoid polluting other tests.
      const originalCharPassives = (charmander.species as unknown as { _passives: unknown })._passives;
      try {
        charmander.species.setPassives([AbilityId.BLAZE, AbilityId.SOLAR_POWER, AbilityId.FLAME_BODY]);

        // Drive the actual transform phase.
        game.move.use(MoveId.SPLASH);
        game.scene.phaseManager.unshiftNew(
          "PokemonTransformPhase",
          ditto.getBattlerIndex(),
          charmander.getBattlerIndex(),
        );
        await game.toEndOfTurn();

        expect(ditto.isTransformed()).toBe(true);

        // Active ability copied (legacy behavior — sanity check).
        expect(ditto.getAbility().id).toBe(charmander.getAbility().id);

        // The new behavior: all 3 passives copied.
        const dittoPassives = ditto.getPassiveAbilities();
        expect(dittoPassives[0]!.id).toBe(AbilityId.BLAZE);
        expect(dittoPassives[1]!.id).toBe(AbilityId.SOLAR_POWER);
        expect(dittoPassives[2]!.id).toBe(AbilityId.FLAME_BODY);
      } finally {
        (charmander.species as unknown as { _passives: unknown })._passives = originalCharPassives;
      }
    });
  });
});
