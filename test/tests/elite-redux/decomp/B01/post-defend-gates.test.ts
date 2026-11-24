/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  PostDefendHpGatedStatStageChangeAbAttr,
  PostDefendTerrainChangeAbAttr,
  type PostMoveInteractionAbAttrParams,
  PreHitResistTypeChangeAbAttr,
} from "#abilities/ab-attrs";
// B01 chunk 3 proof that the Tier B canApply splits (gatedCanApply: gate, residual) are the OLD canApply formulas,
// clause for clause. The old formulas are copied here from the base commit (5485da5f6, ab-attrs.ts) and compared with the
// live attrs (Anger Shell, No Turning Back, Color Change, Prismatic Fur, Seed Sower) and with fresh instances, over the
// grid moves, HP states, damage values, hit results, max HP values (including 1) and the holder states each clause reads.
// It also records the one place where the library rounding would NOT be the old formula (max HP 1, R-B01-21).
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { hpCrossedBelowRounded } from "#data/elite-redux/ability-studio/vocabulary/hp-math";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { GRID_MOVES } from "#test/tests/elite-redux/decomp/harness/world";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ---- the OLD formulas, verbatim from the base commit --------------------------------------------------------------
const oldHpGated = (
  hpGate: number,
  guardTag: BattlerTagType | undefined,
  { pokemon, move, damage }: { pokemon: Pokemon; move: Move; damage: number },
): boolean => {
  if (move.category === MoveCategory.STATUS) {
    return false;
  }
  if (guardTag !== undefined && pokemon.getTag(guardTag) !== undefined) {
    return false;
  }
  const threshold = toDmgValue(pokemon.getMaxHp() * hpGate);
  return pokemon.hp <= threshold && pokemon.hp + damage > threshold;
};

const bestResist = (moveType: PokemonType, pokemon: Pokemon): PokemonType | null =>
  (
    PreHitResistTypeChangeAbAttr as unknown as {
      bestResistType: (type: PokemonType, mon: Pokemon) => PokemonType | null;
    }
  ).bestResistType(moveType, pokemon);

const oldPreHit = ({ pokemon, opponent, move }: { pokemon: Pokemon; opponent: Pokemon; move: Move }): boolean => {
  if (
    pokemon === opponent
    || pokemon.isTerastallized
    || move.category === MoveCategory.STATUS
    || move.hasAttr("TypelessAttr")
  ) {
    return false;
  }
  const moveType = opponent.getMoveType(move);
  return bestResist(moveType, pokemon) !== null;
};

const oldTerrain = (hitResult: HitResult, terrain: TerrainType): boolean =>
  hitResult < HitResult.NO_EFFECT && globalScene.arena.canSetTerrain(terrain);

const MOVES: MoveId[] = [...GRID_MOVES, MoveId.STRUGGLE];
const HIT_RESULTS = [
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
  HitResult.NO_EFFECT,
  HitResult.STATUS,
  HitResult.FAIL,
  HitResult.MISS,
  HitResult.IMMUNE,
];

function liveAttrs<T>(className: string, abilities: AbilityId[] | number[]): { name: string; attr: T }[] {
  const found: { name: string; attr: T }[] = [];
  for (const id of abilities) {
    const ability = allAbilities[id];
    for (const attr of ability?.attrs ?? []) {
      if (attr.constructor.name === className) {
        found.push({ name: ability.name, attr: attr as T });
      }
    }
  }
  return found;
}

describe("B01 chunk 3: Tier B splits equal the old canApply formulas", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Anger Shell and No Turning Back (PostDefendHpGatedStatStageChangeAbAttr): the gate is the whole old formula", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<PostDefendHpGatedStatStageChangeAbAttr>(
      "PostDefendHpGatedStatStageChangeAbAttr",
      [271, 5372],
    );
    expect(users.length).toBe(3);
    // Fresh instances: no guard, the guard battle effect, and another HP line.
    const targets = [
      ...users.map(({ name, attr }) => ({
        name,
        attr,
        hpGate: (attr as unknown as { hpGate: number }).hpGate,
        guardTag: (attr as unknown as { guardTag: BattlerTagType | undefined }).guardTag,
      })),
      {
        name: "fresh 0.5",
        attr: new PostDefendHpGatedStatStageChangeAbAttr(0.5, [Stat.ATK], 1),
        hpGate: 0.5,
        guardTag: undefined,
      },
      {
        name: "fresh 0.35 guarded",
        attr: new PostDefendHpGatedStatStageChangeAbAttr(0.35, [Stat.ATK], 1, true, BattlerTagType.NO_RETREAT),
        hpGate: 0.35,
        guardTag: BattlerTagType.NO_RETREAT,
      },
    ];
    const holder = world.holder;
    const realMax = holder.stats[Stat.HP];
    let compared = 0;
    let trueCount = 0;
    for (const maxHp of [1, 2, 3, 100, 101, realMax]) {
      holder.stats[Stat.HP] = maxHp;
      const half = Math.floor(maxHp / 2);
      const hps = [...new Set([maxHp, maxHp - 1, half + 1, half, half - 1, 1, 0].filter(hp => hp >= 0 && hp <= maxHp))];
      for (const hp of hps) {
        holder.hp = hp;
        for (const hasGuard of [false, true]) {
          vi.spyOn(holder, "getTag").mockImplementation(((type: BattlerTagType) =>
            hasGuard && type === BattlerTagType.NO_RETREAT ? ({} as never) : undefined) as never);
          for (const id of MOVES) {
            const move = allMoves[id];
            for (const damage of [0, 1, 2, 5, maxHp, maxHp * 3]) {
              for (const { name, attr, hpGate, guardTag } of targets) {
                const params = {
                  pokemon: holder,
                  opponent: world.foe,
                  move,
                  damage,
                  hitResult: HitResult.EFFECTIVE,
                  simulated: false,
                } as PostMoveInteractionAbAttrParams;
                const expected = oldHpGated(hpGate, guardTag, { pokemon: holder, move, damage });
                expect(
                  attr.canApply(params),
                  `${name} max ${maxHp} hp ${hp} guard ${hasGuard} ${move.name} dmg ${damage}`,
                ).toBe(expected);
                compared++;
                trueCount += expected ? 1 : 0;
              }
            }
          }
          vi.restoreAllMocks();
        }
      }
    }
    holder.stats[Stat.HP] = realMax;
    holder.hp = realMax;
    expect(compared).toBeGreaterThan(5000);
    expect(trueCount).toBeGreaterThan(50);
  });

  it("the library rounding floor-half is NOT the old HP line for a 1 max HP Pokemon (the reason for R-B01-21)", () => {
    // Old: t = toDmgValue(maxHp * 0.5), floor-half: t = floor(maxHp * 0.5). Same for every max HP above 1.
    const oldLine = (hp: number, maxHp: number, damage: number): boolean => {
      const t = toDmgValue(maxHp * 0.5);
      return hp <= t && hp + damage > t;
    };
    const libLine = (hp: number, maxHp: number, damage: number): boolean =>
      hpCrossedBelowRounded(hp, maxHp, damage, 0.5, "floor-half", 0);
    let differ = 0;
    for (const maxHp of [1, 2, 3, 4, 5, 100, 101, 700]) {
      for (let hp = 0; hp <= maxHp; hp++) {
        for (const damage of [0, 1, 2, maxHp]) {
          if (oldLine(hp, maxHp, damage) !== libLine(hp, maxHp, damage)) {
            expect(maxHp, `hp ${hp} damage ${damage}`).toBe(1);
            differ++;
          }
        }
      }
    }
    expect(differ).toBeGreaterThan(0);
  });

  it("Color Change and Prismatic Fur (PreHitResistTypeChangeAbAttr): gate, then residual, equal the old clauses", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<PreHitResistTypeChangeAbAttr>("PreHitResistTypeChangeAbAttr", [
      AbilityId.COLOR_CHANGE,
      5176,
    ]);
    expect(users.length).toBe(2);
    users.push({ name: "fresh", attr: new PreHitResistTypeChangeAbAttr() });
    const holder = world.holder;
    const originalTypes = holder.summonData.types;
    let compared = 0;
    let trueCount = 0;
    for (const types of [
      [PokemonType.NORMAL],
      [PokemonType.GHOST],
      [PokemonType.STEEL],
      [PokemonType.FAIRY],
      [PokemonType.FIRE, PokemonType.FLYING],
    ]) {
      holder.summonData.types = types;
      for (const tera of [false, true]) {
        holder.isTerastallized = tera;
        for (const id of MOVES) {
          const move = allMoves[id];
          for (const attacker of [world.foe, holder]) {
            for (const { name, attr } of users) {
              const params = { pokemon: holder, opponent: attacker, move, simulated: false };
              const expected = oldPreHit(params);
              expect(attr.canApply(params), `${name} types ${types} tera ${tera} ${move.name}`).toBe(expected);
              compared++;
              trueCount += expected ? 1 : 0;
            }
          }
        }
      }
    }
    holder.isTerastallized = false;
    holder.summonData.types = originalTypes;
    expect(compared).toBeGreaterThan(400);
    expect(trueCount).toBeGreaterThan(20);
  });

  it("Seed Sower (PostDefendTerrainChangeAbAttr): the hit result, then whether the terrain can be set", async () => {
    const world = await startWorld(phaserGame);
    const users = liveAttrs<PostDefendTerrainChangeAbAttr>("PostDefendTerrainChangeAbAttr", [269]);
    expect(users.length).toBe(1);
    const terrains = [
      TerrainType.MISTY,
      TerrainType.ELECTRIC,
      TerrainType.GRASSY,
      TerrainType.PSYCHIC,
      TerrainType.TOXIC,
    ];
    let compared = 0;
    for (const settable of [true, false]) {
      vi.spyOn(globalScene.arena, "canSetTerrain").mockImplementation(() => settable);
      for (const terrain of terrains) {
        for (const { name, attr } of [
          ...users,
          { name: `fresh ${terrain}`, attr: new PostDefendTerrainChangeAbAttr(terrain) },
        ]) {
          const own = (attr as unknown as { terrainType: TerrainType }).terrainType;
          for (const hitResult of HIT_RESULTS) {
            const params = {
              pokemon: world.holder,
              opponent: world.foe,
              move: allMoves[MoveId.TACKLE],
              damage: 5,
              hitResult,
              simulated: false,
            } as PostMoveInteractionAbAttrParams;
            expect(attr.canApply(params), `${name} settable ${settable} hit result ${HitResult[hitResult]}`).toBe(
              oldTerrain(hitResult, own),
            );
            compared++;
          }
        }
      }
      vi.restoreAllMocks();
    }
    expect(compared).toBeGreaterThan(100);
  });
});
