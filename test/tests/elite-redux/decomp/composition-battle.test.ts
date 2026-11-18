/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Real-battle checks of the V2 composition path (a miniature of the L2 twin test and the L3 golden
// recipes): the staff-built "half damage at full HP" must take exactly the damage Multiscale takes,
// and "after taking damage, HP crossed below the line" must fire on the crossing hit only.
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  type AbilityStudioBlueprintV1,
  validateAbilityStudioBlueprints,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HALF_AT_FULL_ID = 20993;
const CROSS_HALF_ID = 20994;
const CROSS_35_ID = 20995;

function blueprintFor(id: number, name: string, rule: CompositionRuleV2): AbilityStudioBlueprintV1 {
  return {
    version: 2,
    id,
    name,
    description: "Test only.",
    generation: 9,
    includes: [],
    modifiers: [],
    rules: [],
    composition: [rule],
  };
}

const halfAtFullHp: CompositionRuleV2 = {
  key: "half-at-full-hp",
  when: { block: "calc.damage-taken" },
  if: [{ block: "hp.full", params: { who: "holder" } }],
  do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
  chance: 100,
};

const boostWhenCrossed = (ratio: number): CompositionRuleV2 => ({
  key: "boost-when-crossed",
  when: { block: "event.after-taking-damage" },
  if: [{ block: "hp.crossed-below", params: { who: "holder", ratio, rounding: "exact" } }],
  do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 2 } }],
  chance: 100,
});

describe("composition in a real battle", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const mutableAbilities = allAbilities as Ability[];
  const previous = new Map<number, Ability | undefined>();

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    for (const [id, name, rule] of [
      [HALF_AT_FULL_ID, "Half At Full", halfAtFullHp],
      [CROSS_HALF_ID, "Cross Half", boostWhenCrossed(0.5)],
      [CROSS_35_ID, "Cross 35", boostWhenCrossed(0.35)],
    ] as const) {
      const validated = validateAbilityStudioBlueprints({ [`t-${id}`]: blueprintFor(id, name, rule) });
      expect(validated.errors).toEqual([]);
      previous.set(id, allAbilities[id]);
      mutableAbilities[id] = compileAbilityStudioBlueprint(validated.blueprints[`t-${id}`], i => allAbilities[i]);
    }
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset(MoveId.CELEBRATE)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .criticalHits(false);
  });

  afterEach(() => {
    for (const [id, ability] of previous) {
      if (ability === undefined) {
        delete mutableAbilities[id];
      } else {
        mutableAbilities[id] = ability;
      }
    }
    previous.clear();
  });

  /** HP lost in each of two turns of an enemy Tackle against a full-HP Blissey. */
  async function lossesWith(ability: number): Promise<[number, number]> {
    game.override.ability(ability as AbilityId);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();
    const max = player.getMaxHp();
    expect(player.hp).toBe(max);
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    const afterOne = player.hp;
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    return [max - afterOne, afterOne - player.hp];
  }

  const losses = new Map<string, [number, number]>();

  it("baseline: an ability that does nothing takes the full hit", async () => {
    const result = await lossesWith(AbilityId.BALL_FETCH);
    losses.set("none", result);
    expect(result[0]).toBeGreaterThan(1);
    expect(result[1]).toBe(result[0]);
  });

  it("Multiscale halves the hit at full HP only", async () => {
    const result = await lossesWith(AbilityId.MULTISCALE);
    losses.set("multiscale", result);
    const none = losses.get("none")!;
    expect(result[0]).toBeLessThan(none[0]);
    expect(result[1]).toBe(none[1]);
  });

  it("the staff-built 'half damage at full HP' takes exactly the damage Multiscale takes, turn by turn", async () => {
    const result = await lossesWith(HALF_AT_FULL_ID);
    const multiscale = losses.get("multiscale")!;
    expect(result).toEqual(multiscale);
  });

  it("'after taking damage, HP crossed below 50%' fires on the crossing hit and not on a hit that stays above it", async () => {
    game.override.ability(CROSS_HALF_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();
    const max = player.getMaxHp();
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    expect(player.hp).toBeLessThan(max);
    expect(player.hp).toBeGreaterThan(max / 2);
    expect(player.getStatStage(Stat.ATK)).toBe(0);

    // Put the holder exactly on the line; the next Tackle crosses it.
    player.hp = Math.ceil(max / 2);
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    expect(player.hp).toBeLessThan(max / 2);
    expect(player.getStatStage(Stat.ATK)).toBe(2);

    // Already below the line: further hits do not cross it again.
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    expect(player.getStatStage(Stat.ATK)).toBe(2);
  });

  it("the ratio parameter moves the boundary: the same hit does not cross 35% from 50%", async () => {
    game.override.ability(CROSS_35_ID as AbilityId);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const player = game.field.getPlayerPokemon();
    const max = player.getMaxHp();
    player.hp = Math.ceil(max / 2);
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    expect(player.hp).toBeLessThan(max / 2);
    expect(player.hp).toBeGreaterThan(max * 0.35);
    expect(player.getStatStage(Stat.ATK)).toBe(0);

    player.hp = Math.ceil(max * 0.35);
    game.move.select(MoveId.CELEBRATE);
    await game.toNextTurn();
    expect(player.hp).toBeLessThan(max * 0.35);
    expect(player.getStatStage(Stat.ATK)).toBe(2);
  });
});
