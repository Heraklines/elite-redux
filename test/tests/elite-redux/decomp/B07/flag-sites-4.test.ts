/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4: the engine sites that the shared L1 / L2 suites cannot see for the two live classes of the chunk.
//
//   TerrainEventTypeChangeAbAttr  the shared twin only watches ONE terrain (Electric); the table of the class has four pairs, a revert and the
//                                 Terastallized rule, so each is driven through Arena.trySetTerrain, the real dispatch site.
//   AlwaysHitAbAttr               an engine query by presence: MoveEffectPhase.checkBypassAccAndInvuln asks the USER and the TARGET.
//
// Each is run three ways: the live ability (original), the same ability rebuilt from its declaration (what a staff blueprint compiles to)
// and Ball Fetch (control, no such attr). The rebuilt run must equal the original and the control must differ, so equal results are never
// two empty recordings.
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { MoveEffectPhase } from "#phases/move-effect-phase";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Ids from the live game (dump of the live attrs, see the declarations).
const MIMICRY = 250;
const NO_GUARD = 99;
const SIGHTING_SYSTEM = 5106;
const IRON_BARRAGE = 5132;
const BRAWLING_WYVERN = 5307;
const QIGONG = 5463;
const BALL_FETCH = AbilityId.BALL_FETCH as number;

describe("B07 chunk 4 at the engine sites", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    unregisterShadows();
    vi.restoreAllMocks();
  });

  /** Rebuilds a live ability from its declarations and puts it into the ability list under a shadow id. */
  function shadowOf(abilityId: number, expectedRebuilt: number[]): number {
    const original = allAbilities[abilityId] as Ability;
    const shadowId = allocateShadowId();
    const result = rebuildAbility(original, shadowId, { registry: declRegistry });
    for (const index of expectedRebuilt) {
      expect(result.rebuilt, `${original.name} attr ${index} must be rebuilt`).toContain(index);
    }
    registerShadow(shadowId, result.ability);
    return shadowId;
  }

  // ---------------------------------------------------------------------------------------------
  // TerrainEventTypeChangeAbAttr
  // ---------------------------------------------------------------------------------------------
  async function mimicryRun(abilityId: number): Promise<Record<string, unknown>> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const typesAfter = (terrain: TerrainType): string => {
      globalScene.arena.trySetTerrain(terrain, true, undefined, undefined, true);
      return holder.getTypes().join(",");
    };
    const seen: Record<string, unknown> = { start: holder.getTypes().join(",") };
    for (const terrain of [
      TerrainType.ELECTRIC,
      TerrainType.MISTY,
      TerrainType.GRASSY,
      TerrainType.PSYCHIC,
      TerrainType.NONE,
      TerrainType.TOXIC,
      TerrainType.NONE,
    ]) {
      seen[`after ${TerrainType[terrain]} (${Object.keys(seen).length})`] = typesAfter(terrain);
    }
    // A Terastallized holder keeps its type (canApply `!pokemon.isTerastallized`).
    holder.isTerastallized = true;
    seen["terastallized, Grassy"] = typesAfter(TerrainType.GRASSY);
    holder.isTerastallized = false;
    // Once the Terastallized state is gone the same attr works again.
    seen["tera over, Psychic"] = typesAfter(TerrainType.PSYCHIC);
    return seen;
  }

  it("TerrainEventTypeChangeAbAttr: Electric, Fairy, Grass and Psychic by terrain, base types without one, nothing when Terastallized (Mimicry)", async () => {
    const shadow = shadowOf(MIMICRY, [0]);
    const original = await mimicryRun(MIMICRY);
    const rebuilt = await mimicryRun(shadow);
    const control = await mimicryRun(BALL_FETCH);

    // The table of the class (Blissey is Normal, so each answer is exactly the terrain's type).
    const types = (key: string): string => String(original[key]);
    expect(types("after ELECTRIC (1)")).toBe(String(PokemonType.ELECTRIC));
    expect(types("after MISTY (2)")).toBe(String(PokemonType.FAIRY));
    expect(types("after GRASSY (3)")).toBe(String(PokemonType.GRASS));
    expect(types("after PSYCHIC (4)")).toBe(String(PokemonType.PSYCHIC));
    // NONE puts the base types back, the Toxic terrain has no pair so it also gives the base types (recorded oddity 2 in the declaration).
    expect(types("after NONE (5)")).toBe(types("start"));
    expect(types("after TOXIC (6)")).toBe(types("start"));
    expect(types("terastallized, Grassy")).toBe(types("start"));
    expect(rebuilt).toEqual(original);
    // The control never changes type, which proves the terrain calls above reach the attr.
    expect(new Set(Object.values(control)).size).toBe(1);
    expect(original).not.toEqual(control);
  });

  // ---------------------------------------------------------------------------------------------
  // AlwaysHitAbAttr
  // ---------------------------------------------------------------------------------------------
  /** Whether the engine's no-miss check answers true when the holder USES the move (side "user") or is the TARGET (side "target"). */
  async function bypass(abilityId: number, side: "user" | "target"): Promise<boolean> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.THUNDER])
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyMoveset(MoveId.SPLASH)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false)
      .criticalHits(false);
    if (side === "user") {
      game.override.ability(abilityId as AbilityId).enemyAbility(AbilityId.BALL_FETCH);
    } else {
      game.override.ability(AbilityId.BALL_FETCH).enemyAbility(abilityId as AbilityId);
    }
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    game.move.select(MoveId.THUNDER);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("MoveEffectPhase", false);
    const phase = game.scene.phaseManager.getCurrentPhase() as MoveEffectPhase;
    // The engine function answers `true`, or falls through with undefined when nothing makes the move skip the checks.
    return phase.checkBypassAccAndInvuln(game.field.getEnemyPokemon()) === true;
  }

  it("AlwaysHitAbAttr: the no-miss answer is true for the user AND for the target, and false without the attr (No Guard)", async () => {
    const shadow = shadowOf(NO_GUARD, [0]);
    expect(await bypass(NO_GUARD, "user")).toBe(true);
    expect(await bypass(NO_GUARD, "target")).toBe(true);
    expect(await bypass(shadow, "user")).toBe(true);
    expect(await bypass(shadow, "target")).toBe(true);
    expect(await bypass(BALL_FETCH, "user")).toBe(false);
    expect(await bypass(BALL_FETCH, "target")).toBe(false);
  });

  it("AlwaysHitAbAttr: the four other users carry the same flag and rebuild to the same answer", async () => {
    for (const [id, index] of [
      [SIGHTING_SYSTEM, 0],
      [IRON_BARRAGE, 1],
      [BRAWLING_WYVERN, 0],
      [QIGONG, 1],
    ] as const) {
      const shadow = shadowOf(id, [index]);
      expect(await bypass(id, "user"), `ability ${id} as user`).toBe(true);
      expect(await bypass(shadow, "user"), `rebuilt ${id} as user`).toBe(true);
    }
  });
});
