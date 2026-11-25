/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3 probes: what the shared L1 and L2 suites cannot see.
//  - AttackerTypeDamageReductionAbAttr / FullHpMoveTypeDamageReductionAbAttr (Tier B): the split canApply gives the old answer for
//    every attacker type, move and HP; a staff-moved setting moves the compiled gate; a dropped atom drops the rule.
//  - ReverseNegativeStatChangesAbAttr (Tier B, never dispatched by the game): guard / gate / residual give the old answer for every
//    change, source and cancel state; apply blocks the drop and queues the boost only when not simulated.
//  - PostDefendAddTagAbAttr (Tier B): the gate (not myself, damaging, type) and the residual (I do not have it) give the old answer.
//  - SameTypeStabOtherwiseBoostAbAttr (Tier B): the clause that moved from apply into the gate gives the same power for every holder
//    type and move type, in a real battle's power calculation too.
//  - HigherStatMultiplierAbAttr / AllyHigherStatMultiplierAbAttr (Tier B, legacy gate): guard + highest-stat gate give the old answer
//    for every stat, tie and ability-ignoring state; Flower Gift's real stat calculation.
//  - FaintedAllyStatMultiplierAbAttr (Tier C): the multiplier is 1 + 5% per fainted ally, never counting the holder.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import {
  type AllyHigherStatMultiplierAbAttr,
  type AttackerTypeDamageReductionAbAttr,
  type FaintedAllyStatMultiplierAbAttr,
  type FullHpMoveTypeDamageReductionAbAttr,
  type HigherStatMultiplierAbAttr,
  type PostDefendAddTagAbAttr,
  type ReverseNegativeStatChangesAbAttr,
  SameTypeStabOtherwiseBoostAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setTypesOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The live attr of `className` at (abilityId, attrIndex); fails the test when the game changed. */
function siteOf(className: string, abilityId: number, attrIndex: number): AbAttr {
  const site = allAttrSites().find(
    candidate =>
      candidate.className === className && candidate.abilityId === abilityId && candidate.attrIndex === attrIndex,
  );
  expect(site, `${className} at ${abilityId} attr ${attrIndex}`).toBeDefined();
  return (site as { attr: AbAttr }).attr;
}

function rebuild(className: string, attr: AbAttr, abilityId: number, attrIndex: number, overrides = {}): AbAttr {
  return recomposeAttr(declRegistry.get(className)!, attr, abilityId, attrIndex, overrides);
}

const TYPES = TYPE_OPTIONS.filter(name => name !== "STELLAR") as readonly (keyof typeof PokemonType)[];
const MOVES = {
  tackle: MoveId.TACKLE,
  growl: MoveId.GROWL,
  ember: MoveId.EMBER,
  waterGun: MoveId.WATER_GUN,
  dragonBreath: MoveId.DRAGON_BREATH,
  dragonClaw: MoveId.DRAGON_CLAW,
  thunderShock: MoveId.THUNDER_SHOCK,
  thunderbolt: MoveId.THUNDERBOLT,
  rockThrow: MoveId.ROCK_THROW,
  vineWhip: MoveId.VINE_WHIP,
  swordsDance: MoveId.SWORDS_DANCE,
} as const;

describe("B18 chunk 3", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AttackerTypeDamageReductionAbAttr (Marine Apex, King of the Jungle)", () => {
    const users = [
      { id: 5127, index: 2, type: PokemonType.WATER, name: "WATER" },
      { id: 5729, index: 2, type: PokemonType.GRASS, name: "GRASS" },
    ] as const;
    const oldCanApply = (type: PokemonType, attacker: Pokemon, moveId: MoveId): boolean =>
      allMoves[moveId].category !== MoveCategory.STATUS && attacker.isOfType(type);

    it("the split canApply, the rebuilt gate and the old closure agree for every attacker type and move", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      for (const user of users) {
        const original = siteOf(
          "AttackerTypeDamageReductionAbAttr",
          user.id,
          user.index,
        ) as AttackerTypeDamageReductionAbAttr;
        const rebuilt = rebuild("AttackerTypeDamageReductionAbAttr", original, user.id, user.index);
        expect(original.attackerType).toBe(user.type);
        for (const foeTypes of [
          undefined,
          ...TYPES.map(name => [PokemonType[name]]),
          [PokemonType.WATER, PokemonType.GRASS],
        ]) {
          setTypesOf(foe, foeTypes);
          for (const moveId of Object.values(MOVES)) {
            const params = {
              pokemon: holder,
              opponent: foe,
              move: allMoves[moveId],
              damage: new NumberHolder(100),
              simulated: false,
            };
            const expected = oldCanApply(user.type, foe, moveId);
            expect(
              original.canApply(params as never),
              `${user.name} original, foe ${String(foeTypes)}, ${MoveId[moveId]}`,
            ).toBe(expected);
            expect(
              rebuilt.canApply(params as never),
              `${user.name} rebuilt, foe ${String(foeTypes)}, ${MoveId[moveId]}`,
            ).toBe(expected);
          }
        }
      }
    });

    it("the effect halves the damage, and a staff-changed type moves the compiled gate", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf("AttackerTypeDamageReductionAbAttr", 5127, 2);
      const module = declRegistry.get("AttackerTypeDamageReductionAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ attackerType: "WATER", multiplier: 0.5 });
      const fire = rebuild("AttackerTypeDamageReductionAbAttr", original, 5127, 2, {
        params: { attackerType: "FIRE", multiplier: 0.25 },
      });
      const damage = new NumberHolder(101);
      const params = { pokemon: holder, opponent: foe, move: allMoves[MOVES.tackle], damage, simulated: false };
      setTypesOf(foe, [PokemonType.WATER]);
      expect(fire.canApply(params as never)).toBe(false);
      setTypesOf(foe, [PokemonType.FIRE]);
      expect(fire.canApply(params as never)).toBe(true);
      fire.apply(params as never);
      expect(damage.value).toBe(toDmgValue(101 * 0.25));
      // The staff drops the type test (an always-true gate keeps only the damaging check): a Grass attacker is reduced too.
      const anyAttacker = buildAttr(module, { attackerType: "WATER" }, { gate: { all: [{ block: "move.damaging" }] } });
      setTypesOf(foe, [PokemonType.GRASS]);
      expect(anyAttacker.canApply(params as never)).toBe(true);
      expect(anyAttacker.canApply({ ...params, move: allMoves[MOVES.swordsDance] } as never)).toBe(false);
    });
  });

  describe("FullHpMoveTypeDamageReductionAbAttr (Drakelp Head)", () => {
    const oldCanApply = (target: Pokemon, attacker: Pokemon, moveId: MoveId, type: PokemonType): boolean =>
      target.isFullHp()
      && allMoves[moveId].category !== MoveCategory.STATUS
      && attacker.getMoveType(allMoves[moveId]) === type;

    it("the split canApply and the rebuilt gate agree with the old closure at the full HP boundary, for every move", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf("FullHpMoveTypeDamageReductionAbAttr", 5690, 2) as FullHpMoveTypeDamageReductionAbAttr;
      const rebuilt = rebuild("FullHpMoveTypeDamageReductionAbAttr", original, 5690, 2);
      expect(original.moveType).toBe(PokemonType.DRAGON);
      const max = holder.getMaxHp();
      for (const hp of [max, max - 1, Math.floor(max / 2), 1]) {
        holder.hp = hp;
        for (const moveId of Object.values(MOVES)) {
          const params = {
            pokemon: holder,
            opponent: foe,
            move: allMoves[moveId],
            damage: new NumberHolder(100),
            simulated: false,
          };
          const expected = oldCanApply(holder, foe, moveId, PokemonType.DRAGON);
          expect(original.canApply(params as never), `original hp ${hp} ${MoveId[moveId]}`).toBe(expected);
          expect(rebuilt.canApply(params as never), `rebuilt hp ${hp} ${MoveId[moveId]}`).toBe(expected);
        }
      }
      // The reduction really needs a Dragon move at full HP: sanity that the grid above saw both answers.
      holder.hp = max;
      const dragon = {
        pokemon: holder,
        opponent: foe,
        move: allMoves[MOVES.dragonClaw],
        damage: new NumberHolder(100),
        simulated: false,
      };
      expect(original.canApply(dragon as never)).toBe(true);
      holder.hp = max - 1;
      expect(original.canApply(dragon as never)).toBe(false);
    });

    it("a staff-changed move type moves the compiled gate, and dropping the full HP test drops that rule", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf("FullHpMoveTypeDamageReductionAbAttr", 5690, 2);
      const module = declRegistry.get("FullHpMoveTypeDamageReductionAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ moveType: "DRAGON", multiplier: 0.5 });
      const fire = rebuild("FullHpMoveTypeDamageReductionAbAttr", original, 5690, 2, { params: { moveType: "FIRE" } });
      const ember = {
        pokemon: holder,
        opponent: foe,
        move: allMoves[MOVES.ember],
        damage: new NumberHolder(100),
        simulated: false,
      };
      const claw = { ...ember, move: allMoves[MOVES.dragonClaw] };
      holder.hp = holder.getMaxHp();
      expect(fire.canApply(ember as never)).toBe(true);
      expect(fire.canApply(claw as never)).toBe(false);
      holder.hp = holder.getMaxHp() - 1;
      expect(fire.canApply(ember as never)).toBe(false);
      const anyHp = buildAttr(
        module,
        { moveType: "FIRE" },
        { gate: { all: [{ block: "move.damaging" }, { block: "move.type", params: { type: "FIRE" } }] } },
      );
      expect(anyHp.canApply(ember as never)).toBe(true);
    });
  });

  describe("ReverseNegativeStatChangesAbAttr (Change of Heart)", () => {
    const oldCanApply = (p: {
      cancelled: BooleanHolder;
      source: Pokemon | null | undefined;
      stages: number;
    }): boolean => !p.cancelled.value && p.stages < 0 && p.source !== null;

    it("guard, gate and residual give the old answer for every change, source and cancel state; apply is safe when simulated", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = siteOf("ReverseNegativeStatChangesAbAttr", 5234, 1) as ReverseNegativeStatChangesAbAttr;
      const rebuilt = rebuild("ReverseNegativeStatChangesAbAttr", original, 5234, 1);
      const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      for (const stages of [-6, -2, -1, 0, 1, 2]) {
        for (const source of [foe, null, undefined, holder]) {
          for (const already of [false, true]) {
            const make = () => ({
              pokemon: holder,
              stat: Stat.SPD,
              stages,
              source,
              cancelled: new BooleanHolder(already),
              simulated: false,
            });
            const expected = oldCanApply(make());
            expect(
              original.canApply(make() as never),
              `original ${stages} ${source === null ? "null" : source === undefined ? "undefined" : "mon"} ${already}`,
            ).toBe(expected);
            expect(
              rebuilt.canApply(make() as never),
              `rebuilt ${stages} ${source === null ? "null" : source === undefined ? "undefined" : "mon"} ${already}`,
            ).toBe(expected);
          }
        }
      }
      // apply: the drop is cancelled either way; the boost (same stat, same number of stages) is queued only when not simulated.
      const real = {
        pokemon: holder,
        stat: Stat.SPD,
        stages: -2,
        source: foe,
        cancelled: new BooleanHolder(false),
        simulated: false,
      };
      rebuilt.apply(real as never);
      expect(real.cancelled.value).toBe(true);
      expect(queue).toHaveBeenCalledTimes(1);
      expect(queue).toHaveBeenCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 2);
      const preview = { ...real, cancelled: new BooleanHolder(false), simulated: true };
      rebuilt.apply(preview as never);
      expect(preview.cancelled.value).toBe(true);
      expect(queue).toHaveBeenCalledTimes(1);
    });

    it("a staff gate that is always true reverses boosts too (the gate is the swappable part), the guard still protects an already blocked drop", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("ReverseNegativeStatChangesAbAttr")!;
      const always = buildAttr(module, {}, { gate: { all: [] } });
      const make = (stages: number, already = false) =>
        ({
          pokemon: holder,
          stat: Stat.ATK,
          stages,
          source: foe,
          cancelled: new BooleanHolder(already),
          simulated: false,
        }) as never;
      expect(always.canApply(make(2))).toBe(true);
      expect(always.canApply(make(-1, true))).toBe(false);
      expect(always.canApply({ ...(make(-1) as object), source: null } as never)).toBe(false);
    });
  });

  describe("PostDefendAddTagAbAttr (Lightning Born)", () => {
    const oldCanApply = (holder: Pokemon, opponent: Pokemon, moveId: MoveId, type: PokemonType | undefined): boolean =>
      holder !== opponent
      && allMoves[moveId].category !== MoveCategory.STATUS
      && (type === undefined || opponent.getMoveType(allMoves[moveId]) === type)
      && !holder.getTag(BattlerTagType.CHARGED);

    it("the gate and the residual give the old answer for every attacker, move and charged state", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf("PostDefendAddTagAbAttr", 5548, 1) as PostDefendAddTagAbAttr;
      const rebuilt = rebuild("PostDefendAddTagAbAttr", original, 5548, 1);
      expect(original.tag).toBe(BattlerTagType.CHARGED);
      for (const charged of [false, true]) {
        if (charged) {
          holder.addTag(BattlerTagType.CHARGED);
        }
        for (const opponent of [foe, holder]) {
          for (const moveId of Object.values(MOVES)) {
            const params = {
              pokemon: holder,
              opponent,
              move: allMoves[moveId],
              damage: 10,
              hitResult: 0,
              simulated: false,
            };
            const expected = oldCanApply(holder, opponent, moveId, PokemonType.ELECTRIC);
            expect(original.canApply(params as never), `original charged ${charged} ${MoveId[moveId]}`).toBe(expected);
            expect(rebuilt.canApply(params as never), `rebuilt charged ${charged} ${MoveId[moveId]}`).toBe(expected);
          }
        }
      }
    });

    it("apply gives the effect unless simulated; a staff-changed type and a dropped type test move the gate", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf("PostDefendAddTagAbAttr", 5548, 1);
      const module = declRegistry.get("PostDefendAddTagAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ tag: "CHARGED", moveType: "ELECTRIC" });
      const params = (moveId: MoveId, simulated = false) =>
        ({ pokemon: holder, opponent: foe, move: allMoves[moveId], damage: 10, hitResult: 0, simulated }) as never;
      const water = rebuild("PostDefendAddTagAbAttr", original, 5548, 1, { params: { moveType: "WATER" } });
      expect(water.canApply(params(MOVES.thunderShock))).toBe(false);
      expect(water.canApply(params(MOVES.waterGun))).toBe(true);
      water.apply(params(MOVES.waterGun, true));
      expect(holder.getTag(BattlerTagType.CHARGED)).toBeUndefined();
      water.apply(params(MOVES.waterGun));
      expect(holder.getTag(BattlerTagType.CHARGED)).toBeDefined();
      // Already charged: the residual says no, whatever the gate says.
      expect(water.canApply(params(MOVES.waterGun))).toBe(false);
      holder.removeTag(BattlerTagType.CHARGED);
      const anyType = buildAttr(module, {}, { gate: { all: [{ block: "move.damaging" }] } });
      expect(anyType.canApply(params(MOVES.tackle))).toBe(true);
      expect(anyType.canApply(params(MOVES.swordsDance))).toBe(false);
    });
  });

  describe("SameTypeStabOtherwiseBoostAbAttr (Fossilized, Raw Wood)", () => {
    const users = [
      { id: 5041, type: PokemonType.ROCK, name: "ROCK" },
      { id: 5075, type: PokemonType.GRASS, name: "GRASS" },
    ] as const;

    it("the power is multiplied exactly when the old rule did (move of the type, holder not of the type), for every holder type", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      for (const user of users) {
        const original = siteOf("SameTypeStabOtherwiseBoostAbAttr", user.id, 0) as SameTypeStabOtherwiseBoostAbAttr;
        const rebuilt = rebuild("SameTypeStabOtherwiseBoostAbAttr", original, user.id, 0);
        for (const holderTypes of [
          undefined,
          ...TYPES.map(name => [PokemonType[name]]),
          [PokemonType.ROCK, PokemonType.GRASS],
          [PokemonType.WATER, PokemonType.ROCK],
        ]) {
          setTypesOf(holder, holderTypes);
          for (const moveId of Object.values(MOVES)) {
            const move = allMoves[moveId];
            // The OLD rule, written out: canApply was the move type test, apply multiplied only for a holder without the type.
            const oldPower = (() => {
              const power = new NumberHolder(move.power);
              if (holder.getMoveType(move) === user.type && !holder.isOfType(user.type)) {
                power.value *= 1.2;
              }
              return power.value;
            })();
            for (const attr of [original, rebuilt]) {
              const power = new NumberHolder(move.power);
              const params = { pokemon: holder, opponent: foe, move, power, simulated: false };
              if (attr.canApply(params as never)) {
                attr.apply(params as never);
              }
              expect(
                power.value,
                `${user.name} ${attr === original ? "original" : "rebuilt"} holder ${String(holderTypes)} ${MoveId[moveId]}`,
              ).toBe(oldPower);
            }
          }
        }
      }
    });

    it("in a real battle's power calculation, a Rock move is x1.2 for a non-Rock Fossilized holder and unchanged for a Rock holder", async () => {
      const game = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.ROCK_THROW])
        .ability(5041 as AbilityId)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(30)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      expect(holder.getAbility().attrs.some(attr => attr instanceof SameTypeStabOtherwiseBoostAbAttr)).toBe(true);
      const rock = allMoves[MOVES.rockThrow];
      const tackle = allMoves[MOVES.tackle];
      const base = rock.calculateBattlePower(holder, foe, true, true);
      expect(base).toBeGreaterThan(0);
      setTypesOf(holder, [PokemonType.NORMAL]);
      expect(rock.calculateBattlePower(holder, foe, true)).toBeCloseTo(base * 1.2, 5);
      expect(tackle.calculateBattlePower(holder, foe, true)).toBe(tackle.calculateBattlePower(holder, foe, true, true));
      setTypesOf(holder, [PokemonType.ROCK]);
      expect(rock.calculateBattlePower(holder, foe, true)).toBe(base);
      setTypesOf(holder, [PokemonType.WATER, PokemonType.ROCK]);
      expect(rock.calculateBattlePower(holder, foe, true)).toBe(base);
    });

    it("a staff-changed type and bonus move the compiled gate and the multiplier; dropping the 'not of that type' test boosts a Rock holder too", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf("SameTypeStabOtherwiseBoostAbAttr", 5041, 0);
      const module = declRegistry.get("SameTypeStabOtherwiseBoostAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ type: "ROCK", fallbackMultiplier: 1.2 });
      const fire = rebuild("SameTypeStabOtherwiseBoostAbAttr", original, 5041, 0, {
        params: { type: "FIRE", fallbackMultiplier: 2 },
      });
      setTypesOf(holder, [PokemonType.NORMAL]);
      const power = new NumberHolder(40);
      const ember = { pokemon: holder, opponent: foe, move: allMoves[MOVES.ember], power, simulated: false };
      expect(fire.canApply(ember as never)).toBe(true);
      fire.apply(ember as never);
      expect(power.value).toBe(80);
      expect(fire.canApply({ ...ember, move: allMoves[MOVES.rockThrow] } as never)).toBe(false);
      setTypesOf(holder, [PokemonType.FIRE]);
      expect(fire.canApply(ember as never)).toBe(false);
      const evenOwnType = buildAttr(
        module,
        { type: "FIRE" },
        { gate: { all: [{ block: "move.type", params: { type: "FIRE" } }] } },
      );
      expect(evenOwnType.canApply(ember as never)).toBe(true);
    });
  });

  describe("HigherStatMultiplierAbAttr and AllyHigherStatMultiplierAbAttr (Flower Gift)", () => {
    const ALL_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;
    // The OLD canApply of both classes, verbatim.
    const oldHigher = (candidates: readonly number[], mon: Pokemon, stat: number): boolean => {
      if (stat === Stat.ACC || stat === Stat.EVA || !candidates.includes(stat)) {
        return false;
      }
      let highest = candidates[0];
      for (const candidate of candidates.slice(1)) {
        if (mon.getStat(candidate as never, false) > mon.getStat(highest as never, false)) {
          highest = candidate;
        }
      }
      return stat === highest;
    };
    const oldAllyHigher = (
      candidates: readonly number[],
      mon: Pokemon,
      stat: number,
      ignoreAbility: boolean,
    ): boolean => {
      if (ignoreAbility || stat === Stat.ACC || stat === Stat.EVA || !candidates.includes(stat)) {
        return false;
      }
      let highest = candidates[0];
      for (const candidate of candidates.slice(1)) {
        if (mon.getStat(candidate as never, false) > mon.getStat(highest as never, false)) {
          highest = candidate;
        }
      }
      return stat === highest;
    };
    const statTables = [
      { [Stat.ATK]: 100, [Stat.DEF]: 100, [Stat.SPATK]: 100, [Stat.SPDEF]: 100, [Stat.SPD]: 100 }, // every tie
      { [Stat.ATK]: 101, [Stat.DEF]: 99, [Stat.SPATK]: 100, [Stat.SPDEF]: 100, [Stat.SPD]: 1 },
      { [Stat.ATK]: 100, [Stat.DEF]: 99, [Stat.SPATK]: 101, [Stat.SPDEF]: 100, [Stat.SPD]: 500 },
      { [Stat.ATK]: 5, [Stat.DEF]: 200, [Stat.SPATK]: 90, [Stat.SPDEF]: 201, [Stat.SPD]: 1 },
      { [Stat.ATK]: 5, [Stat.DEF]: 201, [Stat.SPATK]: 90, [Stat.SPDEF]: 200, [Stat.SPD]: 1 },
    ] as const;

    it("the holder class: guard plus highest-stat gate give the old answer for every stat, tie and stat table", async () => {
      const { holder } = await startWorld(phaserGame);
      for (const [index, expectedList] of [
        [3, [Stat.ATK, Stat.SPATK]],
        [4, [Stat.DEF, Stat.SPDEF]],
      ] as const) {
        const attr = siteOf("HigherStatMultiplierAbAttr", 122, index) as HigherStatMultiplierAbAttr;
        expect([...attr.candidates]).toEqual(expectedList);
        expect(readDeclParams(declRegistry.get("HigherStatMultiplierAbAttr")!, attr)).toEqual({
          candidates: index === 3 ? "Attack, Sp. Atk" : "Defense, Sp. Def",
          multiplier: 1.5,
        });
        for (const table of statTables) {
          vi.spyOn(holder, "getStat").mockImplementation(
            ((stat: number) => (table as Record<number, number>)[stat] ?? 0) as never,
          );
          for (const stat of ALL_STATS) {
            const params = {
              pokemon: holder,
              stat,
              statVal: new NumberHolder(100),
              move: allMoves[MOVES.tackle],
              simulated: false,
            };
            expect(
              attr.canApply(params as never),
              `attr ${index} stat ${Stat[stat]} table ${JSON.stringify(table)}`,
            ).toBe(oldHigher(attr.candidates, holder, stat));
          }
          vi.restoreAllMocks();
        }
      }
    });

    it("the ally class: the RECEIVING ally's stats are compared, and an ability-ignoring attacker switches it off", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      for (const [index, expectedList] of [
        [5, [Stat.ATK, Stat.SPATK]],
        [6, [Stat.DEF, Stat.SPDEF]],
      ] as const) {
        const attr = siteOf("AllyHigherStatMultiplierAbAttr", 122, index) as AllyHigherStatMultiplierAbAttr;
        expect([...attr.candidates]).toEqual(expectedList);
        for (const table of statTables) {
          // The holder's own table is the opposite of the target's, so comparing the wrong Pokemon would show.
          vi.spyOn(foe, "getStat").mockImplementation(
            ((stat: number) => (table as Record<number, number>)[stat] ?? 0) as never,
          );
          vi.spyOn(holder, "getStat").mockImplementation(
            ((stat: number) => 1000 - ((table as Record<number, number>)[stat] ?? 0)) as never,
          );
          for (const stat of ALL_STATS) {
            for (const ignoreAbility of [false, true]) {
              const params = {
                pokemon: holder,
                target: foe,
                stat,
                statVal: new NumberHolder(100),
                move: allMoves[MOVES.tackle],
                ignoreAbility,
                simulated: false,
              };
              expect(attr.canApply(params as never), `attr ${index} stat ${Stat[stat]} ignore ${ignoreAbility}`).toBe(
                oldAllyHigher(attr.candidates, foe, stat, ignoreAbility),
              );
            }
          }
          vi.restoreAllMocks();
        }
      }
    });

    it("Flower Gift in a real stat calculation: x1.5 on the better stat of each pair in sun only, and the attr-level sun condition is kept", async () => {
      const game = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.SPLASH])
        .ability(AbilityId.FLOWER_GIFT)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(30)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const natural = (stat: Stat.ATK | Stat.DEF | Stat.SPATK | Stat.SPDEF) => holder.getStat(stat, false);
      expect(natural(Stat.SPATK)).toBeGreaterThan(natural(Stat.ATK));
      expect(natural(Stat.SPDEF)).toBeGreaterThan(natural(Stat.DEF));
      setWeatherOf(game, WeatherType.NONE);
      const calm = ALL_STATS.slice(0, 4).map(stat => holder.getEffectiveStat(stat as never));
      setWeatherOf(game, WeatherType.SUNNY);
      const sun = ALL_STATS.slice(0, 4).map(stat => holder.getEffectiveStat(stat as never));
      // [Attack, Defense, Sp. Atk, Sp. Def]: only the better stat of each pair (Sp. Atk, Sp. Def) is boosted.
      expect(sun[0]).toBe(calm[0]);
      expect(sun[1]).toBe(calm[1]);
      expect(sun[2]).toBeGreaterThanOrEqual(Math.floor(calm[2] * 1.5) - 1);
      expect(sun[2]).toBeGreaterThan(calm[2]);
      expect(sun[3]).toBeGreaterThan(calm[3]);
      setWeatherOf(game, WeatherType.RAIN);
      expect(holder.getEffectiveStat(Stat.SPATK as never)).toBe(calm[2]);
    });
  });

  describe("FaintedAllyStatMultiplierAbAttr (Avenger)", () => {
    it("multiplies by 1 plus 5% per OTHER fainted party member, never counting the holder, for both offenses", async () => {
      const game = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.SPLASH])
        .ability(AbilityId.BALL_FETCH)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(30)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.PIKACHU, SpeciesId.EEVEE, SpeciesId.SNORLAX);
      const party = game.scene.getPlayerParty();
      expect(party.length).toBe(4);
      const holder = party[0];
      const module = declRegistry.get("FaintedAllyStatMultiplierAbAttr")!;
      for (const [index, stat, name] of [
        [3, Stat.ATK, "ATK"],
        [4, Stat.SPATK, "SPATK"],
      ] as const) {
        const original = siteOf("FaintedAllyStatMultiplierAbAttr", 5030, index) as FaintedAllyStatMultiplierAbAttr;
        const rebuilt = rebuild("FaintedAllyStatMultiplierAbAttr", original, 5030, index);
        expect(readDeclParams(module, original)).toEqual({ stat: name, perFaintedAlly: 5 });
        for (const faintedMask of [0b000, 0b001, 0b011, 0b111]) {
          party.slice(1).forEach((member, position) => {
            member.hp = (faintedMask & (1 << position)) === 0 ? member.getMaxHp() : 0;
          });
          const count = [0, 1, 2, 3][[0b000, 0b001, 0b011, 0b111].indexOf(faintedMask)];
          for (const holderFainted of [false, true]) {
            holder.hp = holderFainted ? 0 : holder.getMaxHp();
            for (const attr of [original, rebuilt]) {
              const statVal = new NumberHolder(100);
              const params = { pokemon: holder, stat, statVal, move: allMoves[MOVES.tackle], simulated: false };
              expect(attr.canApply(params as never)).toBe(true);
              expect(attr.canApply({ ...params, stat: stat === Stat.ATK ? Stat.SPATK : Stat.ATK } as never)).toBe(
                false,
              );
              attr.apply(params as never);
              expect(statVal.value, `${name} ${count} fainted, holder fainted ${holderFainted}`).toBeCloseTo(
                100 * (1 + count * 0.05),
                9,
              );
            }
          }
        }
      }
      // The settings are real: 10% per fainted ally on Sp. Atk, built from the declaration.
      const built = buildAttr(module, { stat: "SPATK", perFaintedAlly: 10 }) as FaintedAllyStatMultiplierAbAttr;
      expect(built.perFaintedAlly).toBe(0.1);
      const statVal = new NumberHolder(100);
      party.slice(1).forEach(member => {
        member.hp = 0;
      });
      holder.hp = holder.getMaxHp();
      expect(
        built.canApply({
          pokemon: holder,
          stat: Stat.SPATK,
          statVal,
          move: allMoves[MOVES.tackle],
          simulated: false,
        } as never),
      ).toBe(true);
      built.apply({
        pokemon: holder,
        stat: Stat.SPATK,
        statVal,
        move: allMoves[MOVES.tackle],
        simulated: false,
      } as never);
      expect(statVal.value).toBeCloseTo(130, 9);
    });
  });
});
