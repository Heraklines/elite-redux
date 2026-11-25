/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4 probes: what the shared L1 and L2 suites cannot see.
//  - OnceLowHpStatRaiseAbAttr (Defeatist, Tier B): gate (once per wave, damaging, from a foe) then residual (the HP line, with a minimum of 1)
//    give the old answer for every max HP, HP, damage, move and memory state; the memory only fills when the rule applies; a staff-moved
//    setting moves the compiled gate or the residual.
//  - TypeImmunityHigherDefenseStatRaiseAbAttr (Rain Dish, Tier A): the immunity, the tie rule (Defense wins) and the preview flag.
//  - MoveFlagImmunityAbAttr (Ball Fetch, Tier A): the property test, the second reader in the move matchup, a staff-edited list.
//  - OnDirectFaintRetaliationAbAttr (Ill Will, Tummyache, Tier B): guard / gate / residual give the old answer for every attacker and move
//    (the shared L2 faint scenario cannot reach the trigger); both effects.
//  - ChancePostAttackStealHeldItemAbAttr (Gluttony, Low Blow, Cheap Tactics, Tier B, RNG in canApply): the two draws in order, the filters.
//  - PostSummonSnowCloakAuroraVeilAbAttr / PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr (Snow Cloak, Glacial Ghost): the weather gate for
//    every weather, the lasting veil, and the removal of only the veil the holder made.
//  - AbilityStudioRuntimeCapabilityAbAttr (23 users): the role list matches the game, and a rebuild answers the same capability question.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  FIELD_EFFECT_OPTIONS,
  fieldEffectCodec,
  MOVE_PROPERTY_OPTIONS,
  moveNameListCodec,
  movePropertyListCodec,
  statListCodec,
} from "#data/elite-redux/ability-studio/decl/B18/b18-chunk4-codecs";
import { ROLE_PICKS } from "#data/elite-redux/ability-studio/decl/B18/b18-chunk4-roles";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  ABILITY_STUDIO_RUNTIME_CAPABILITIES,
  abilityStudioAbilityHasCapability,
} from "#data/elite-redux/ability-studio/runtime-capabilities";
import type { AbilityStudioRuntimeCapabilityAbAttr } from "#data/elite-redux/ability-studio/runtime-components";
import type {
  ChancePostAttackStealHeldItemAbAttr,
  MoveFlagImmunityAbAttr,
  OnceLowHpStatRaiseAbAttr,
  OnDirectFaintRetaliationAbAttr,
  TypeImmunityHigherDefenseStatRaiseAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import type {
  PostSummonSnowCloakAuroraVeilAbAttr,
  PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/snow-cloak-aurora-veil";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The live attr of `className` at (abilityId, attrIndex); fails the test when the game changed. */
function siteOf<T extends AbAttr>(className: string, abilityId: number, attrIndex: number): T {
  const site = allAttrSites().find(
    candidate =>
      candidate.className === className && candidate.abilityId === abilityId && candidate.attrIndex === attrIndex,
  );
  expect(site, `${className} at ${abilityId} attr ${attrIndex}`).toBeDefined();
  return (site as { attr: AbAttr }).attr as T;
}

function rebuild<T extends AbAttr>(
  className: string,
  attr: AbAttr,
  abilityId: number,
  attrIndex: number,
  overrides = {},
): T {
  return recomposeAttr(declRegistry.get(className)!, attr, abilityId, attrIndex, overrides) as T;
}

type World = Awaited<ReturnType<typeof startWorld>>;

/** A battle where the foe holds the given items (the world's foe holds none). */
async function startWithFoeItems(phaserGame: Phaser.Game, items: { name: string; type?: BerryType }[]): Promise<World> {
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
    .enemyHeldItems(items as never)
    .criticalHits(false);
  await game.classicMode.startBattle(SpeciesId.BLISSEY);
  return { game, holder: game.field.getPlayerPokemon(), foe: game.field.getEnemyPokemon() };
}

describe("B18 chunk 4", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------------------------------
  describe("OnceLowHpStatRaiseAbAttr (Defeatist)", () => {
    const KEY = "requested:defeatist:ten-percent-comeback";
    /** The old canApply, copied from the source before the split. */
    const oldCanApply = (
      attr: { threshold: number },
      holder: Pokemon,
      opponent: Pokemon,
      moveId: MoveId,
      damage: number,
      key: string,
    ): boolean => {
      if (holder.waveData.entryEffectsFired.has(key) || allMoves[moveId].category === MoveCategory.STATUS) {
        return false;
      }
      const hpThreshold = Math.max(1, Math.floor(holder.getMaxHp() * attr.threshold));
      return holder.isOpponent(opponent) && holder.hp <= hpThreshold && holder.hp + damage > hpThreshold;
    };

    it("the split canApply, the rebuilt gate plus residual and the old test agree for every max HP, HP, damage, move and memory state", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<OnceLowHpStatRaiseAbAttr>("OnceLowHpStatRaiseAbAttr", 129, 2);
      const rebuilt = rebuild<OnceLowHpStatRaiseAbAttr>("OnceLowHpStatRaiseAbAttr", original, 129, 2);
      expect(original.threshold).toBe(0.1);
      let checked = 0;
      let trues = 0;
      // Max HP 1 to 9 are where "max(1, floor(maxHp * 0.1))" differs from a plain floor (0 versus 1).
      for (const maxHp of [1, 2, 5, 9, 10, 11, 19, 20, 29, 100, 101, 333]) {
        vi.spyOn(holder, "getMaxHp").mockReturnValue(maxHp);
        const line = Math.max(1, Math.floor(maxHp * 0.1));
        for (const hp of new Set([1, Math.max(1, line - 1), line, line + 1, maxHp])) {
          for (const damage of [0, 1, 5, 50]) {
            for (const moveId of [MoveId.TACKLE, MoveId.SWORDS_DANCE]) {
              for (const attacker of [foe, holder]) {
                for (const memory of [false, true]) {
                  holder.hp = Math.min(hp, maxHp);
                  holder.waveData.entryEffectsFired.delete(KEY);
                  if (memory) {
                    holder.waveData.entryEffectsFired.add(KEY);
                  }
                  const params = {
                    pokemon: holder,
                    opponent: attacker,
                    move: allMoves[moveId],
                    damage,
                    hitResult: HitResult.EFFECTIVE,
                    simulated: false,
                  };
                  const expected = oldCanApply(original, holder, attacker, moveId, damage, KEY);
                  const label = `maxHp ${maxHp} hp ${holder.hp} damage ${damage} ${MoveId[moveId]} ${attacker === foe ? "foe" : "self"} memory ${memory}`;
                  expect(original.canApply(params as never), `original, ${label}`).toBe(expected);
                  expect(rebuilt.canApply(params as never), `rebuilt, ${label}`).toBe(expected);
                  checked++;
                  trues += expected ? 1 : 0;
                }
              }
            }
          }
        }
      }
      holder.waveData.entryEffectsFired.delete(KEY);
      expect(trues, "the grid must contain crossings that apply").toBeGreaterThan(20);
      expect(checked).toBeGreaterThan(1000);
    });

    it("applying raises the listed stats in ONE phase and fills the wave memory; a preview does neither; a failing line does not use the memory up", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = siteOf<OnceLowHpStatRaiseAbAttr>("OnceLowHpStatRaiseAbAttr", 129, 2);
      const rebuilt = rebuild<OnceLowHpStatRaiseAbAttr>("OnceLowHpStatRaiseAbAttr", original, 129, 2);
      for (const attr of [original, rebuilt]) {
        const params = (simulated: boolean) =>
          ({
            pokemon: holder,
            opponent: foe,
            move: allMoves[MoveId.TACKLE],
            damage: 40,
            hitResult: HitResult.EFFECTIVE,
            simulated,
          }) as never;
        holder.waveData.entryEffectsFired.delete(KEY);
        const spy = vi.spyOn(game.scene.phaseManager, "unshiftNew");
        // Above the line: the rule does not hold, and the failed check leaves the memory alone.
        holder.hp = holder.getMaxHp();
        expect(attr.canApply(params(false))).toBe(false);
        expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(false);
        // On the line, hit by 40: the rule holds.
        holder.hp = Math.floor(holder.getMaxHp() * 0.1);
        expect(attr.canApply(params(false))).toBe(true);
        // A preview asks and applies as a preview: nothing is queued and nothing is remembered.
        expect(attr.canApply(params(true))).toBe(true);
        attr.apply(params(true));
        expect(spy).not.toHaveBeenCalled();
        expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(false);
        expect(attr.canApply(params(false))).toBe(true);
        attr.apply(params(false));
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(
          "StatStageChangePhase",
          holder.getBattlerIndex(),
          true,
          [Stat.ATK, Stat.SPATK, Stat.SPD],
          2,
        );
        expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(true);
        // Used up: the same hit no longer qualifies.
        expect(attr.canApply(params(false))).toBe(false);
        holder.waveData.entryEffectsFired.delete(KEY);
        spy.mockRestore();
      }
    });

    it("the settings round-trip and a staff change moves the compiled gate (record name) and the HP line (percent)", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<OnceLowHpStatRaiseAbAttr>("OnceLowHpStatRaiseAbAttr", 129, 2);
      const module = declRegistry.get("OnceLowHpStatRaiseAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({
        key: KEY,
        threshold: 10,
        stats: "Attack, Sp. Atk, Speed",
        stages: 2,
      });
      const params = {
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage: 50,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never;
      const quarter = rebuild<OnceLowHpStatRaiseAbAttr>("OnceLowHpStatRaiseAbAttr", original, 129, 2, {
        params: { threshold: 25, key: "staff:quarter", stats: "Defense", stages: 1 },
      });
      expect(quarter.threshold).toBe(0.25);
      expect(quarter.stats).toEqual([Stat.DEF]);
      expect(quarter.stages).toBe(1);
      holder.hp = Math.floor(holder.getMaxHp() * 0.25);
      holder.waveData.entryEffectsFired.delete("staff:quarter");
      expect(quarter.canApply(params)).toBe(true);
      holder.hp = Math.floor(holder.getMaxHp() * 0.25) + 1;
      expect(quarter.canApply(params), "already above the line after the hit").toBe(false);
      holder.hp = Math.floor(holder.getMaxHp() * 0.25) + 60;
      expect(quarter.canApply(params), "far above the line after the hit").toBe(false);
      // The memory name moved with the setting: the old name no longer blocks, the new one does.
      holder.hp = Math.floor(holder.getMaxHp() * 0.25);
      holder.waveData.entryEffectsFired.add(KEY);
      expect(quarter.canApply(params)).toBe(true);
      holder.waveData.entryEffectsFired.add("staff:quarter");
      expect(quarter.canApply(params)).toBe(false);
      holder.waveData.entryEffectsFired.delete(KEY);
      holder.waveData.entryEffectsFired.delete("staff:quarter");
    });

    it("the stat list codec reads and writes player words and refuses a word it does not know", () => {
      expect(statListCodec.toCtor("Attack, sp atk, SPD")).toEqual([Stat.ATK, Stat.SPATK, Stat.SPD]);
      expect(statListCodec.fromInstance([Stat.EVA, Stat.ACC])).toBe("Evasion, Accuracy");
      expect(() => statListCodec.toCtor("Attack, Luck")).toThrow(/not a stat/);
      expect(() => statListCodec.toCtor("")).toThrow(/at least one stat/);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("TypeImmunityHigherDefenseStatRaiseAbAttr (Rain Dish)", () => {
    const make = (holder: Pokemon, foe: Pokemon, moveId: MoveId, simulated = false) => ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[moveId],
      typeMultiplier: new NumberHolder(1),
      cancelled: new BooleanHolder(false),
      simulated,
    });

    it("the rebuilt attr answers like the original for every kind of move, and absorbs Water only", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<TypeImmunityHigherDefenseStatRaiseAbAttr>(
        "TypeImmunityHigherDefenseStatRaiseAbAttr",
        44,
        1,
      );
      const rebuilt = rebuild<TypeImmunityHigherDefenseStatRaiseAbAttr>(
        "TypeImmunityHigherDefenseStatRaiseAbAttr",
        original,
        44,
        1,
      );
      const expectations: [MoveId, boolean][] = [
        [MoveId.WATER_GUN, true],
        [MoveId.TACKLE, false],
        [MoveId.EMBER, false],
        [MoveId.RAIN_DANCE, false], // hits both sides: never absorbed
        [MoveId.SOAK, true], // a Water STATUS move is absorbed too (documented oddity)
      ];
      for (const [moveId, expected] of expectations) {
        expect(original.canApply(make(holder, foe, moveId) as never), `original ${MoveId[moveId]}`).toBe(expected);
        expect(rebuilt.canApply(make(holder, foe, moveId) as never), `rebuilt ${MoveId[moveId]}`).toBe(expected);
      }
      expect(original.canApply(make(holder, holder, MoveId.WATER_GUN) as never), "my own move").toBe(false);
      expect(rebuilt.canApply(make(holder, holder, MoveId.WATER_GUN) as never), "my own move, rebuilt").toBe(false);
    });

    it("raises Sp. Def when it is higher, Defense when it is equal or higher, and nothing when simulated", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = siteOf<TypeImmunityHigherDefenseStatRaiseAbAttr>(
        "TypeImmunityHigherDefenseStatRaiseAbAttr",
        44,
        1,
      );
      const rebuilt = rebuild<TypeImmunityHigherDefenseStatRaiseAbAttr>(
        "TypeImmunityHigherDefenseStatRaiseAbAttr",
        original,
        44,
        1,
        { params: { stages: 2 } },
      );
      const cases: [number, number, Stat][] = [
        [100, 200, Stat.SPDEF],
        [200, 100, Stat.DEF],
        [150, 150, Stat.DEF],
      ];
      for (const attr of [original, rebuilt]) {
        const stages = attr === original ? 1 : 2;
        for (const [def, spdef, expected] of cases) {
          vi.spyOn(holder, "getStat").mockImplementation(((stat: Stat) => (stat === Stat.DEF ? def : spdef)) as never);
          const spy = vi.spyOn(game.scene.phaseManager, "unshiftNew");
          const run = make(holder, foe, MoveId.WATER_GUN);
          attr.apply(run as never);
          expect(run.typeMultiplier.value).toBe(0);
          expect(run.cancelled.value).toBe(true);
          expect(spy).toHaveBeenCalledTimes(1);
          expect(spy).toHaveBeenCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [expected], stages);
          spy.mockRestore();
        }
        const spy = vi.spyOn(game.scene.phaseManager, "unshiftNew");
        const preview = make(holder, foe, MoveId.WATER_GUN, true);
        attr.apply(preview as never);
        expect(preview.typeMultiplier.value).toBe(0);
        expect(preview.cancelled.value).toBe(true);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      }
    });

    it("a staff-chosen type moves the immunity", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<TypeImmunityHigherDefenseStatRaiseAbAttr>(
        "TypeImmunityHigherDefenseStatRaiseAbAttr",
        44,
        1,
      );
      const fire = rebuild<TypeImmunityHigherDefenseStatRaiseAbAttr>(
        "TypeImmunityHigherDefenseStatRaiseAbAttr",
        original,
        44,
        1,
        {
          params: { type: "FIRE" },
        },
      );
      expect(fire.canApply(make(holder, foe, MoveId.EMBER) as never)).toBe(true);
      expect(fire.canApply(make(holder, foe, MoveId.WATER_GUN) as never)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("MoveFlagImmunityAbAttr (Ball Fetch)", () => {
    const make = (holder: Pokemon, foe: Pokemon, moveId: MoveId, blocked = false) => ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[moveId],
      typeMultiplier: new NumberHolder(1),
      cancelled: new BooleanHolder(blocked),
      simulated: false,
    });
    const MOVES = [
      MoveId.SHADOW_BALL,
      MoveId.ENERGY_BALL,
      MoveId.SLUDGE_BOMB,
      MoveId.ROCK_THROW,
      MoveId.TACKLE,
      MoveId.SCREECH,
      MoveId.SWORDS_DANCE,
    ];

    it("blocks exactly the moves that carry one of the listed properties, never one that is already blocked", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<MoveFlagImmunityAbAttr>("MoveFlagImmunityAbAttr", 237, 0);
      const rebuilt = rebuild<MoveFlagImmunityAbAttr>("MoveFlagImmunityAbAttr", original, 237, 0);
      const module = declRegistry.get("MoveFlagImmunityAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ flags: "Ball and bomb moves, Throwing moves" });
      let blockedCount = 0;
      for (const moveId of MOVES) {
        const expected = [MoveFlags.BALLBOMB_MOVE, MoveFlags.THROW_BASED].some(flag => allMoves[moveId].hasFlag(flag));
        blockedCount += expected ? 1 : 0;
        expect(original.canApply(make(holder, foe, moveId) as never), `original ${MoveId[moveId]}`).toBe(expected);
        expect(rebuilt.canApply(make(holder, foe, moveId) as never), `rebuilt ${MoveId[moveId]}`).toBe(expected);
        expect(original.canApply(make(holder, foe, moveId, true) as never), `already blocked ${MoveId[moveId]}`).toBe(
          false,
        );
        expect(
          rebuilt.canApply(make(holder, foe, moveId, true) as never),
          `already blocked, rebuilt ${MoveId[moveId]}`,
        ).toBe(false);
      }
      expect(blockedCount, "the probe moves must contain blocked and unblocked ones").toBeGreaterThan(0);
      expect(blockedCount).toBeLessThan(MOVES.length);
      const run = make(holder, foe, MoveId.SHADOW_BALL);
      rebuilt.apply(run as never);
      expect(run.typeMultiplier.value).toBe(0);
      expect(run.cancelled.value).toBe(true);
    });

    it("the game's own matchup check reads the same list (the second reader), so a Ball Fetch holder takes no ball move", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const ball = allMoves[MoveId.SHADOW_BALL];
      const plain = allMoves[MoveId.TACKLE];
      expect(ball.hasFlag(MoveFlags.BALLBOMB_MOVE)).toBe(true);
      expect(holder.getMoveEffectiveness(foe, ball)).toBe(0);
      expect(holder.getMoveEffectiveness(foe, plain)).not.toBe(0);
    });

    it("a staff-edited list blocks other properties, and the codec reads and writes every property word", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<MoveFlagImmunityAbAttr>("MoveFlagImmunityAbAttr", 237, 0);
      const sound = rebuild<MoveFlagImmunityAbAttr>("MoveFlagImmunityAbAttr", original, 237, 0, {
        params: { flags: "Sound moves" },
      });
      expect(sound.canApply(make(holder, foe, MoveId.SCREECH) as never)).toBe(true);
      expect(sound.canApply(make(holder, foe, MoveId.SHADOW_BALL) as never)).toBe(false);
      for (const word of MOVE_PROPERTY_OPTIONS) {
        const bits = movePropertyListCodec.toCtor(word) as number[];
        expect(bits).toHaveLength(1);
        expect(movePropertyListCodec.fromInstance(bits)).toBe(word);
      }
      expect(movePropertyListCodec.toCtor("ball and bomb moves, THROW_BASED")).toEqual([
        MoveFlags.BALLBOMB_MOVE,
        MoveFlags.THROW_BASED,
      ]);
      expect(() => movePropertyListCodec.toCtor("Spicy moves")).toThrow(/not a move property/);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("OnDirectFaintRetaliationAbAttr (Ill Will, Tummyache)", () => {
    const users = [
      { id: 5285, index: 1, name: "Ill Will", moveId: MoveId.TORMENT },
      { id: 5653, index: 4, name: "Tummyache", moveId: MoveId.GASTRO_ACID },
    ] as const;
    /** The old canApply, copied from the source before the split. */
    const oldCanApply = (holder: Pokemon, attacker: Pokemon | undefined, moveId: MoveId | undefined): boolean => {
      const move = moveId === undefined ? undefined : allMoves[moveId];
      return (
        !!attacker && !!move && move.category !== MoveCategory.STATUS && attacker !== holder && !attacker.isFainted()
      );
    };

    it("guard, gate and residual give the old answer for every attacker and move, original and rebuild", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      for (const user of users) {
        const original = siteOf<OnDirectFaintRetaliationAbAttr>("OnDirectFaintRetaliationAbAttr", user.id, user.index);
        const rebuilt = rebuild<OnDirectFaintRetaliationAbAttr>(
          "OnDirectFaintRetaliationAbAttr",
          original,
          user.id,
          user.index,
        );
        expect(original.moveId).toBe(user.moveId);
        const trueLabels: string[] = [];
        for (const fainted of [false, true]) {
          vi.spyOn(foe, "isFainted").mockReturnValue(fainted);
          for (const attacker of [undefined, holder, foe]) {
            for (const moveId of [undefined, MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.WATER_GUN]) {
              const params = {
                pokemon: holder,
                attacker,
                move: moveId === undefined ? undefined : allMoves[moveId],
                simulated: false,
              };
              const expected = oldCanApply(holder, attacker, moveId);
              const label = `${user.name}: attacker ${attacker === undefined ? "none" : attacker === holder ? "self" : "foe"}, ${
                moveId === undefined ? "no move" : MoveId[moveId]
              }, foe fainted ${fainted}`;
              expect(original.canApply(params as never), `original, ${label}`).toBe(expected);
              expect(rebuilt.canApply(params as never), `rebuilt, ${label}`).toBe(expected);
              if (expected) {
                trueLabels.push(label);
              }
            }
          }
        }
        expect(trueLabels).toEqual([
          `${user.name}: attacker foe, TACKLE, foe fainted false`,
          `${user.name}: attacker foe, WATER_GUN, foe fainted false`,
        ]);
        vi.restoreAllMocks();
      }
    });

    it("Torment is added with turn count 1, Gastro Acid switches the ability off and refreshes weather forms, and a preview does nothing", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const torment = siteOf<OnDirectFaintRetaliationAbAttr>("OnDirectFaintRetaliationAbAttr", 5285, 1);
      const acid = siteOf<OnDirectFaintRetaliationAbAttr>("OnDirectFaintRetaliationAbAttr", 5653, 4);
      for (const make of [
        (attr: OnDirectFaintRetaliationAbAttr, _id: number, _index: number) => attr,
        (attr: OnDirectFaintRetaliationAbAttr, id: number, index: number) =>
          rebuild<OnDirectFaintRetaliationAbAttr>("OnDirectFaintRetaliationAbAttr", attr, id, index),
      ]) {
        const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true);
        const suppress = vi.spyOn(foe, "suppressAbility").mockImplementation(() => {});
        const refresh = vi
          .spyOn(game.scene.arena, "triggerWeatherBasedFormChangesToNormal")
          .mockImplementation(() => {});
        const params = (simulated: boolean) =>
          ({ pokemon: holder, attacker: foe, move: allMoves[MoveId.TACKLE], simulated }) as never;
        make(torment, 5285, 1).apply(params(true));
        make(acid, 5653, 4).apply(params(true));
        expect(addTag).not.toHaveBeenCalled();
        expect(suppress).not.toHaveBeenCalled();
        make(torment, 5285, 1).apply(params(false));
        expect(addTag).toHaveBeenCalledWith(BattlerTagType.TORMENT, 1);
        expect(suppress).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        make(acid, 5653, 4).apply(params(false));
        expect(suppress).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(addTag).toHaveBeenCalledTimes(1);
        // No attacker: nothing to affect, and no error.
        expect(() => make(acid, 5653, 4).apply({ pokemon: holder, simulated: false } as never)).not.toThrow();
        vi.restoreAllMocks();
      }
    });

    it("the setting reads back as a player sentence and a staff change swaps the effect", async () => {
      const original = siteOf<OnDirectFaintRetaliationAbAttr>("OnDirectFaintRetaliationAbAttr", 5285, 1);
      const module = declRegistry.get("OnDirectFaintRetaliationAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ retaliation: "Stop it using the same move twice in a row" });
      const acid = rebuild<OnDirectFaintRetaliationAbAttr>("OnDirectFaintRetaliationAbAttr", original, 5285, 1, {
        params: { retaliation: "Switch off its ability" },
      });
      expect(acid.moveId).toBe(MoveId.GASTRO_ACID);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("ChancePostAttackStealHeldItemAbAttr (Gluttony, Low Blow, Cheap Tactics)", () => {
    const users = [
      { id: 82, index: 2, name: "Gluttony" },
      { id: 5121, index: 1, name: "Low Blow" },
      { id: 5164, index: 1, name: "Cheap Tactics" },
    ] as const;
    const params = (
      holder: Pokemon,
      foe: Pokemon,
      moveId: MoveId,
      simulated = false,
      hitResult = HitResult.EFFECTIVE,
    ) => ({ pokemon: holder, opponent: foe, move: allMoves[moveId], hitResult, damage: 20, simulated }) as never;

    /** Runs canApply with a pinned roll and records the ranges that were drawn, in order. */
    const run = (
      game: World["game"],
      attr: ChancePostAttackStealHeldItemAbAttr,
      holder: Pokemon,
      foe: Pokemon,
      moveId: MoveId,
      roll: number,
      simulated = false,
      hitResult = HitResult.EFFECTIVE,
    ): [boolean, number[]] => {
      const log: number[] = [];
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number) => {
        log.push(range);
        return Math.min(roll, range - 1);
      });
      const result = attr.canApply(params(holder, foe, moveId, simulated, hitResult));
      vi.restoreAllMocks();
      return [result, log];
    };

    it("draws the chance first and the item second, in this order, and the rebuild draws the same numbers", async () => {
      const { game, holder, foe } = await startWithFoeItems(phaserGame, [{ name: "BERRY", type: BerryType.SITRUS }]);
      expect(foe.getHeldItems().length).toBeGreaterThan(0);
      const cases: {
        label: string;
        move: MoveId;
        roll: number;
        simulated?: boolean;
        hit?: HitResult;
        gluttony: [boolean, number[]];
        lowBlow: [boolean, number[]];
      }[] = [
        // Gluttony: berries, contact. Low Blow: Feint Attack only (any item).
        {
          label: "contact move, roll 29",
          move: MoveId.TACKLE,
          roll: 29,
          gluttony: [true, [100, 1]],
          lowBlow: [false, [100]],
        },
        {
          label: "contact move, roll 30",
          move: MoveId.TACKLE,
          roll: 30,
          gluttony: [false, [100]],
          lowBlow: [false, [100]],
        },
        {
          label: "move without contact",
          move: MoveId.WATER_GUN,
          roll: 0,
          gluttony: [false, [100]],
          lowBlow: [false, [100]],
        },
        {
          label: "status move: the roll is still drawn",
          move: MoveId.SWORDS_DANCE,
          roll: 0,
          gluttony: [false, [100]],
          lowBlow: [false, [100]],
        },
        {
          label: "Feint Attack",
          move: MoveId.FEINT_ATTACK,
          roll: 0,
          gluttony: [true, [100, 1]],
          lowBlow: [true, [100, 1]],
        },
        {
          label: "simulated: no draw, no steal",
          move: MoveId.TACKLE,
          roll: 0,
          simulated: true,
          gluttony: [false, []],
          lowBlow: [false, []],
        },
        {
          label: "the hit did nothing",
          move: MoveId.TACKLE,
          roll: 0,
          hit: HitResult.NO_EFFECT,
          gluttony: [false, [100]],
          lowBlow: [false, [100]],
        },
      ];
      for (const user of users.slice(0, 2)) {
        const original = siteOf<ChancePostAttackStealHeldItemAbAttr>(
          "ChancePostAttackStealHeldItemAbAttr",
          user.id,
          user.index,
        );
        const rebuilt = rebuild<ChancePostAttackStealHeldItemAbAttr>(
          "ChancePostAttackStealHeldItemAbAttr",
          original,
          user.id,
          user.index,
        );
        for (const testCase of cases) {
          const expected = user.name === "Gluttony" ? testCase.gluttony : testCase.lowBlow;
          const a = run(game, original, holder, foe, testCase.move, testCase.roll, testCase.simulated, testCase.hit);
          const b = run(game, rebuilt, holder, foe, testCase.move, testCase.roll, testCase.simulated, testCase.hit);
          expect(a, `${user.name} original, ${testCase.label}`).toEqual(expected);
          expect(b, `${user.name} rebuilt, ${testCase.label}`).toEqual(a);
        }
      }
    });

    it("berries only: a foe that holds another item is never robbed, but the chance roll is still spent", async () => {
      const { game, holder, foe } = await startWithFoeItems(phaserGame, [{ name: "FLAME_ORB" }]);
      expect(foe.getHeldItems().length).toBeGreaterThan(0);
      const original = siteOf<ChancePostAttackStealHeldItemAbAttr>("ChancePostAttackStealHeldItemAbAttr", 82, 2);
      const rebuilt = rebuild<ChancePostAttackStealHeldItemAbAttr>(
        "ChancePostAttackStealHeldItemAbAttr",
        original,
        82,
        2,
      );
      expect(run(game, original, holder, foe, MoveId.TACKLE, 0)).toEqual([false, [100]]);
      expect(run(game, rebuilt, holder, foe, MoveId.TACKLE, 0)).toEqual([false, [100]]);
      // Cheap Tactics takes anything: with Scratch and the same item both draws happen.
      const cheap = siteOf<ChancePostAttackStealHeldItemAbAttr>("ChancePostAttackStealHeldItemAbAttr", 5164, 1);
      expect(run(game, cheap, holder, foe, MoveId.SCRATCH, 0)).toEqual([true, [100, 1]]);
      expect(run(game, cheap, holder, foe, MoveId.TACKLE, 0)).toEqual([false, [100]]);
    });

    it("the settings round-trip, and a staff-chosen chance or filter moves the behaviour", async () => {
      const { game, holder, foe } = await startWithFoeItems(phaserGame, [{ name: "BERRY", type: BerryType.SITRUS }]);
      const module = declRegistry.get("ChancePostAttackStealHeldItemAbAttr")!;
      expect(readDeclParams(module, siteOf("ChancePostAttackStealHeldItemAbAttr", 82, 2))).toEqual({
        chance: 30,
        berryOnly: true,
        contactRequired: true,
        moveIds: "",
      });
      expect(readDeclParams(module, siteOf("ChancePostAttackStealHeldItemAbAttr", 5121, 1))).toEqual({
        chance: 30,
        berryOnly: false,
        contactRequired: false,
        moveIds: "Feint attack",
      });
      expect(readDeclParams(module, siteOf("ChancePostAttackStealHeldItemAbAttr", 5164, 1))).toEqual({
        chance: 30,
        berryOnly: false,
        contactRequired: false,
        moveIds: "Scratch",
      });
      const lowBlow = siteOf<ChancePostAttackStealHeldItemAbAttr>("ChancePostAttackStealHeldItemAbAttr", 5121, 1);
      const sixty = rebuild<ChancePostAttackStealHeldItemAbAttr>(
        "ChancePostAttackStealHeldItemAbAttr",
        lowBlow,
        5121,
        1,
        {
          params: { chance: 60, moveIds: "Tackle, Scratch" },
        },
      );
      expect(run(game, sixty, holder, foe, MoveId.TACKLE, 59)).toEqual([true, [100, 1]]);
      expect(run(game, sixty, holder, foe, MoveId.TACKLE, 60)).toEqual([false, [100]]);
      expect(run(game, sixty, holder, foe, MoveId.FEINT_ATTACK, 0)).toEqual([false, [100]]);
      // Dropping the move list means every damaging move can steal.
      const anyMove = rebuild<ChancePostAttackStealHeldItemAbAttr>(
        "ChancePostAttackStealHeldItemAbAttr",
        lowBlow,
        5121,
        1,
        {
          params: { moveIds: "" },
        },
      );
      expect(run(game, anyMove, holder, foe, MoveId.WATER_GUN, 0)).toEqual([true, [100, 1]]);
      expect(moveNameListCodec.toCtor("Feint attack, scratch")).toEqual([MoveId.FEINT_ATTACK, MoveId.SCRATCH]);
      expect(moveNameListCodec.toCtor("")).toBeUndefined();
      expect(() => moveNameListCodec.toCtor("Splashy")).toThrow(/not the name of a move/);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("Snow Cloak (PostSummonSnowCloakAuroraVeilAbAttr, PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr)", () => {
    const WEATHERS = [
      WeatherType.NONE,
      WeatherType.SUNNY,
      WeatherType.RAIN,
      WeatherType.SANDSTORM,
      WeatherType.HAIL,
      WeatherType.SNOW,
      WeatherType.FOG,
      WeatherType.HEAVY_RAIN,
      WeatherType.HARSH_SUN,
      WeatherType.STRONG_WINDS,
    ] as const;
    const sideOf = (holder: Pokemon) => (holder.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY);

    it("the summon gate is hail or snow in every weather, for both users, original and rebuild", async () => {
      const { game, holder } = await startWorld(phaserGame);
      for (const [id, index] of [
        [81, 0],
        [5526, 2],
      ] as const) {
        const original = siteOf<PostSummonSnowCloakAuroraVeilAbAttr>("PostSummonSnowCloakAuroraVeilAbAttr", id, index);
        const rebuilt = rebuild<PostSummonSnowCloakAuroraVeilAbAttr>(
          "PostSummonSnowCloakAuroraVeilAbAttr",
          original,
          id,
          index,
        );
        for (const weather of WEATHERS) {
          setWeatherOf(game, weather);
          const expected = weather === WeatherType.HAIL || weather === WeatherType.SNOW;
          expect(
            original.canApply({ pokemon: holder, simulated: false } as never),
            `${id} original, ${WeatherType[weather]}`,
          ).toBe(expected);
          expect(
            rebuilt.canApply({ pokemon: holder, simulated: false } as never),
            `${id} rebuilt, ${WeatherType[weather]}`,
          ).toBe(expected);
        }
        setWeatherOf(game, WeatherType.NONE);
      }
    });

    it("entering sets a lasting, owned Aurora Veil on my side and replaces one that was there; a preview sets nothing", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const original = siteOf<PostSummonSnowCloakAuroraVeilAbAttr>("PostSummonSnowCloakAuroraVeilAbAttr", 81, 0);
      const rebuilt = rebuild<PostSummonSnowCloakAuroraVeilAbAttr>(
        "PostSummonSnowCloakAuroraVeilAbAttr",
        original,
        81,
        0,
      );
      const side = sideOf(holder);
      for (const attr of [original, rebuilt]) {
        game.scene.arena.removeTagOnSide(ArenaTagType.AURORA_VEIL, side, true);
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side)).toBeUndefined();
        // A veil from a move (5 turns, somebody else's) is replaced by the lasting one that the holder owns.
        game.scene.arena.addTag(ArenaTagType.AURORA_VEIL, 5, MoveId.AURORA_VEIL, foeId(game), side, true);
        attr.apply({ pokemon: holder, simulated: false } as never);
        const veil = game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side)!;
        expect(veil).toBeDefined();
        expect(veil.turnCount).toBeLessThanOrEqual(0);
        expect(veil.sourceId).toBe(holder.id);
        game.scene.arena.removeTagOnSide(ArenaTagType.AURORA_VEIL, side, true);
      }
    });

    it("leaving removes only the lasting veil the holder made, in every state, original and rebuild", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const side = sideOf(holder);
      const states: { label: string; setup: () => void; expected: boolean }[] = [
        { label: "no veil", setup: () => {}, expected: false },
        {
          label: "my lasting veil",
          setup: () => game.scene.arena.addTag(ArenaTagType.AURORA_VEIL, 0, undefined, holder.id, side, true),
          expected: true,
        },
        {
          label: "a veil from a move with turns left, mine",
          setup: () => game.scene.arena.addTag(ArenaTagType.AURORA_VEIL, 5, MoveId.AURORA_VEIL, holder.id, side, true),
          expected: false,
        },
        {
          label: "a lasting veil that another Pokemon made",
          setup: () => game.scene.arena.addTag(ArenaTagType.AURORA_VEIL, 0, undefined, foeId(game), side, true),
          expected: false,
        },
      ];
      for (const [id, index] of [
        [81, 1],
        [5526, 3],
      ] as const) {
        const original = siteOf<PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr>(
          "PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr",
          id,
          index,
        );
        const rebuilt = rebuild<PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr>(
          "PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr",
          original,
          id,
          index,
        );
        for (const attr of [original, rebuilt]) {
          for (const state of states) {
            game.scene.arena.removeTagOnSide(ArenaTagType.AURORA_VEIL, side, true);
            state.setup();
            expect(attr.canApply({ pokemon: holder, simulated: false } as never), `${id} ${state.label}`).toBe(
              state.expected,
            );
            attr.apply({ pokemon: holder, simulated: true } as never);
            expect(
              game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side) !== undefined,
              `${id} ${state.label}: a preview removes nothing`,
            ).toBe(state.label !== "no veil");
            if (state.expected) {
              attr.apply({ pokemon: holder, simulated: false } as never);
              expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side)).toBeUndefined();
            }
          }
        }
        game.scene.arena.removeTagOnSide(ArenaTagType.AURORA_VEIL, side, true);
      }
    });

    it("the weather gate can be swapped, and the field effect setting reads back and refuses an unknown name", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const original = siteOf<PostSummonSnowCloakAuroraVeilAbAttr>("PostSummonSnowCloakAuroraVeilAbAttr", 81, 0);
      const rain = rebuild<PostSummonSnowCloakAuroraVeilAbAttr>(
        "PostSummonSnowCloakAuroraVeilAbAttr",
        original,
        81,
        0,
        {
          conds: { gate: { block: "field.weather", params: { weather: "RAIN" } } },
        },
      );
      setWeatherOf(game, WeatherType.RAIN);
      expect(rain.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
      setWeatherOf(game, WeatherType.HAIL);
      expect(rain.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
      setWeatherOf(game, WeatherType.NONE);
      const module = declRegistry.get("PostSummonSnowCloakAuroraVeilAbAttr")!;
      expect(readDeclParams(module, original)).toEqual({ tag: "AURORA_VEIL" });
      expect(fieldEffectCodec.toCtor("TAILWIND")).toBe(ArenaTagType.TAILWIND);
      expect(() => fieldEffectCodec.toCtor("SPIKES")).toThrow(/not a field effect/);
      expect(FIELD_EFFECT_OPTIONS).toContain("AURORA_VEIL");
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("AbilityStudioRuntimeCapabilityAbAttr (23 users)", () => {
    it("the role list is exactly the game's list of runtime capabilities, each with a unique sentence", () => {
      const gameIds = Object.values(ABILITY_STUDIO_RUNTIME_CAPABILITIES).sort();
      expect(ROLE_PICKS.map(pick => pick.id).sort()).toEqual(gameIds);
      expect(new Set(ROLE_PICKS.map(pick => pick.word)).size).toBe(ROLE_PICKS.length);
      expect(ROLE_PICKS).toHaveLength(62);
    });

    it("every role sentence builds the attr the constructor expects and reads back", () => {
      const module = declRegistry.get("AbilityStudioRuntimeCapabilityAbAttr")!;
      for (const pick of ROLE_PICKS) {
        const attr = buildAttr(module, { capability: pick.word }) as AbilityStudioRuntimeCapabilityAbAttr;
        expect(attr.abilityStudioCapability).toBe(pick.id);
        expect(readDeclParams(module, attr).capability).toBe(pick.word);
      }
    });

    it("a rebuild of each of the 23 users carries the same role and texts and answers the same capability question", async () => {
      await startWorld(phaserGame);
      const sites = allAttrSites().filter(site => site.className === "AbilityStudioRuntimeCapabilityAbAttr");
      expect(sites).toHaveLength(23);
      for (const site of sites) {
        const original = site.attr as AbilityStudioRuntimeCapabilityAbAttr;
        const rebuilt = rebuild<AbilityStudioRuntimeCapabilityAbAttr>(
          "AbilityStudioRuntimeCapabilityAbAttr",
          original,
          site.abilityId,
          site.attrIndex,
        );
        expect(rebuilt.abilityStudioCapability, site.abilityName).toBe(original.abilityStudioCapability);
        expect(rebuilt.componentLabel).toBe(original.componentLabel);
        expect(rebuilt.componentHookId).toBe(original.componentHookId);
        expect(rebuilt.componentHookLabel).toBe(original.componentHookLabel);
        expect(rebuilt.isActiveFor(undefined)).toBe(original.isActiveFor(undefined));
        const ability = { attrs: [rebuilt] } as never;
        expect(abilityStudioAbilityHasCapability(ability, original.abilityStudioCapability)).toBe(true);
        expect(abilityStudioAbilityHasCapability(ability, "levitate-float")).toBe(false);
      }
    });

    it("a trigger-restricted marker counts only for the Pokemon the trigger marked, original and rebuild alike", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = siteOf<AbilityStudioRuntimeCapabilityAbAttr>("AbilityStudioRuntimeCapabilityAbAttr", 5205, 1);
      const rebuilt = rebuild<AbilityStudioRuntimeCapabilityAbAttr>(
        "AbilityStudioRuntimeCapabilityAbAttr",
        original,
        5205,
        1,
      );
      for (const attr of [original, rebuilt]) {
        // Work on a fresh copy so the shared live attr stays unrestricted for the other tests.
        const copy = rebuild<AbilityStudioRuntimeCapabilityAbAttr>(
          "AbilityStudioRuntimeCapabilityAbAttr",
          attr,
          5205,
          1,
        );
        expect(copy.isActiveFor(holder)).toBe(true);
        copy.restrictToTriggeredActivation();
        expect(copy.isActiveFor(holder)).toBe(false);
        expect(copy.isActiveFor(undefined)).toBe(false);
        copy.activateFor(holder);
        expect(copy.isActiveFor(holder)).toBe(true);
        expect(copy.isActiveFor(foe)).toBe(false);
      }
    });
  });
});

/** The id of the enemy Pokemon, for veils that "another Pokemon" made. */
function foeId(game: World["game"]): number {
  return game.field.getEnemyPokemon().id;
}
