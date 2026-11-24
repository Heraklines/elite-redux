/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2 probes: what the shared L1 grid and the L2 twin cannot see. Every test drives the ORIGINAL attr of a real ability and its
// REBUILD (recomposeAttr from the declaration and the bindings) side by side.
//   - Confectious (defend) and Cyberkinetic: the contact gate really is the engine's contact test (same call, same arguments), the guards
//     stay in the class, the gate and the constructor condition are replaceable, the marker goes on the right Pokemon.
//   - Contaminated: no library atom for "anybody on the field is poisoned", so the attr is not rebuilt from bindings; the class is driven
//     against the OLD formula, the two new constructor arguments are live, and a battle twin keeps the original closure in the slot.
//   - Decay (entry and end of turn): the conditions live in `apply`; the library gate equals the class's own gate over every status and
//     marker state, `canApply` stays always true, simulated does nothing.
//   - Defeatist: the rounded-ratio threshold against the old `1 / 3` for EVERY HP of many max HP values, and a battle twin that keeps
//     the original gate in its slot.
//   - The Elite Redux weather abilities (entry and new area): the length patch for every one of the ten users, the Mystical Rock
//     extender, simulated, and the new-area half against a lasting weather (the suspected dead code is pinned, not fixed).
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { Weather } from "#data/weather";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { FieldEffectModifier } from "#modifiers/modifier";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import {
  type AttrOverride,
  rebuildAbility,
  registerShadow,
  unregisterShadows,
} from "#test/tests/elite-redux/decomp/harness/rebuild";
import { celebrate, TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import {
  allocateShadowId,
  liveAbility,
  type TwinScenario,
  twinById,
} from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { AbAttrBaseParams, PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const DEFEATIST = 129;
const CONFECTIOUS = 6034;
const CYBERKINETIC = 6040;
const CONTAMINATED = 6050;
const DECAY = 6051;
/** The ten weather users: id, weather and attr indices (entry 0, new area 1). */
const WEATHER_USERS: readonly [number, string, WeatherType][] = [
  [2, "Drizzle", WeatherType.RAIN],
  [70, "Drought", WeatherType.SUNNY],
  [45, "Sand Stream", WeatherType.SANDSTORM],
  [117, "Snow Warning", WeatherType.HAIL],
  [288, "Orichalcum Pulse", WeatherType.SUNNY],
  [5232, "Seaborne", WeatherType.RAIN],
  [5445, "Sand Bender", WeatherType.SANDSTORM],
  [5568, "Supercell", WeatherType.RAIN],
  [5632, "Sundae", WeatherType.HAIL],
  [6028, "Solar Panel", WeatherType.SUNNY],
];

function moduleOf(name: string): NonNullable<ReturnType<typeof declRegistry.get>> {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

function baseParams(holder: Pokemon, simulated = false): AbAttrBaseParams {
  return { pokemon: holder, simulated } as AbAttrBaseParams;
}

function hitParams(
  holder: Pokemon,
  foe: Pokemon,
  move: MoveId,
  damage: number,
  simulated = false,
): PostMoveInteractionAbAttrParams {
  return {
    pokemon: holder,
    opponent: foe,
    move: allMoves[move],
    damage,
    hitResult: HitResult.EFFECTIVE,
    simulated,
  } as PostMoveInteractionAbAttrParams;
}

describe("B16 chunk 2", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    unregisterShadows();
  });

  /** A battle twin of ability `id` whose rebuild keeps the ORIGINAL closure in the slots that are legacy (no library atom yet). */
  async function twinKeepingClosures(
    id: number,
    overrides: Readonly<Record<number, AttrOverride>>,
    scenario: TwinScenario,
  ): Promise<{ differences: readonly unknown[]; original: { messages: string[] }; rebuilt: readonly number[] }> {
    const original = liveAbility(id);
    const shadowId = allocateShadowId();
    const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry, overrides });
    registerShadow(shadowId, rebuilt.ability);
    const outcome = await twinById(phaserGame, id, shadowId, scenario);
    return { differences: outcome.differences, original: outcome.original as never, rebuilt: rebuilt.rebuilt };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Confectious (when I am hit)", () => {
    it("marks the attacker only for a contact hit that dealt damage, the gate is the engine's contact call, and the rebuild agrees", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(CONFECTIOUS).attrs[2];
      const module = moduleOf("ConfectiousDefendAbAttr");
      const rebuilt = recomposeAttr(module, original, CONFECTIOUS, 2);
      expect(rebuilt).not.toBe(original);
      expect(readDeclParams(module, original)).toEqual({});

      const cases: [MoveId, number, boolean][] = [
        [MoveId.TACKLE, 5, true],
        [MoveId.TACKLE, 0, false],
        [MoveId.WATER_GUN, 5, false],
        [MoveId.SWORDS_DANCE, 5, false],
      ];
      for (const [move, damage, expected] of cases) {
        const params = hitParams(holder, foe, move, damage);
        expect(original.canApply(params), `original ${MoveId[move]} ${damage}`).toBe(expected);
        expect(rebuilt.canApply(params), `rebuild ${MoveId[move]} ${damage}`).toBe(expected);
      }

      // The same engine call with the same arguments: user = the ATTACKER, target = me. A refusal makes both answer false.
      for (const attr of [original, rebuilt]) {
        const spy = vi.spyOn(allMoves[MoveId.TACKLE], "doesFlagEffectApply").mockReturnValue(false);
        expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, 5))).toBe(false);
        expect(spy).toHaveBeenCalledWith({ flag: MoveFlags.MAKES_CONTACT, user: foe, target: holder });
        spy.mockRestore();
      }

      // apply: the marker goes on the attacker, its source is the holder, nothing happens when simulated.
      for (const attr of [original, rebuilt]) {
        foe.removeTag(BattlerTagType.ER_CONFECTED);
        holder.removeTag(BattlerTagType.ER_CONFECTED);
        attr.apply(hitParams(holder, foe, MoveId.TACKLE, 5, true));
        expect(foe.getTag(BattlerTagType.ER_CONFECTED)).toBeUndefined();
        attr.apply(hitParams(holder, foe, MoveId.TACKLE, 5));
        expect(foe.getTag(BattlerTagType.ER_CONFECTED)).toBeDefined();
        expect(foe.getTag(BattlerTagType.ER_CONFECTED)?.sourceId).toBe(holder.id);
        expect(holder.getTag(BattlerTagType.ER_CONFECTED)).toBeUndefined();
      }

      // The gate is a real slot; the damage guard is not part of it and stays.
      const anyMove = recomposeAttr(module, original, CONFECTIOUS, 2, { conds: { gate: { all: [] } } });
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.WATER_GUN, 5))).toBe(true);
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.WATER_GUN, 0))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Cyberkinetic", () => {
    it("turns the foe pure Electric only for a damaging contact hit that dealt damage; both slots are replaceable", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(CYBERKINETIC).attrs[0];
      const module = moduleOf("CyberkineticAbAttr");
      const rebuilt = recomposeAttr(module, original, CYBERKINETIC, 0);
      expect(rebuilt).not.toBe(original);

      const cases: [MoveId, number, boolean][] = [
        [MoveId.TACKLE, 5, true],
        [MoveId.TACKLE, 0, false],
        [MoveId.WATER_GUN, 5, false],
        [MoveId.SWORDS_DANCE, 5, false],
      ];
      for (const [move, damage, expected] of cases) {
        const params = hitParams(holder, foe, move, damage);
        expect(original.canApply(params), `original ${MoveId[move]} ${damage}`).toBe(expected);
        expect(rebuilt.canApply(params), `rebuild ${MoveId[move]} ${damage}`).toBe(expected);
      }
      // Here the user is ME and the target is the foe.
      for (const attr of [original, rebuilt]) {
        const spy = vi.spyOn(allMoves[MoveId.TACKLE], "doesFlagEffectApply").mockReturnValue(false);
        expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, 5))).toBe(false);
        expect(spy).toHaveBeenCalledWith({ flag: MoveFlags.MAKES_CONTACT, user: holder, target: foe });
        spy.mockRestore();
      }
      for (const attr of [original, rebuilt]) {
        foe.removeTag(BattlerTagType.ER_BREACHED);
        foe.summonData.types = [];
        attr.apply(hitParams(holder, foe, MoveId.TACKLE, 5, true));
        expect(foe.getTag(BattlerTagType.ER_BREACHED)).toBeUndefined();
        attr.apply(hitParams(holder, foe, MoveId.TACKLE, 5));
        expect(foe.getTag(BattlerTagType.ER_BREACHED)?.sourceId).toBe(holder.id);
        expect(foe.summonData.types).toEqual([PokemonType.ELECTRIC]);
        expect(holder.getTag(BattlerTagType.ER_BREACHED)).toBeUndefined();
      }
      // Both slots: a status move passes when the constructor condition AND the gate are replaced; the damage guard stays.
      const open = recomposeAttr(module, original, CYBERKINETIC, 0, {
        conds: { "ctor:0": { all: [] }, gate: { all: [] } },
      });
      expect(open.canApply(hitParams(holder, foe, MoveId.SWORDS_DANCE, 5))).toBe(true);
      expect(open.canApply(hitParams(holder, foe, MoveId.SWORDS_DANCE, 0))).toBe(false);
      const onlyCondition = recomposeAttr(module, original, CYBERKINETIC, 0, { conds: { "ctor:0": { all: [] } } });
      expect(onlyCondition.canApply(hitParams(holder, foe, MoveId.SWORDS_DANCE, 5))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Contaminated", () => {
    const hitCountParams = (holder: Pokemon, foe: Pokemon, move: MoveId) =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        hitCount: new NumberHolder(1),
        simulated: false,
      }) as never;

    it("hits once more per poisoned Pokemon on the field exactly like the old formula; the new constructor arguments are live", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(CONTAMINATED).attrs[0] as AbAttr & {
        poisonedFieldCondition: (p: Pokemon) => boolean;
      };
      const module = moduleOf("ContaminatedHitMultiplierAbAttr");
      expect(readDeclParams(module, original)).toEqual({ extraHitsPerPoisoned: 1 });
      const statuses = [
        StatusEffect.NONE,
        StatusEffect.POISON,
        StatusEffect.TOXIC,
        StatusEffect.BURN,
        StatusEffect.SLEEP,
      ];
      for (const holderStatus of statuses) {
        for (const foeStatus of statuses) {
          setStatusOf(holder, holderStatus);
          setStatusOf(foe, foeStatus);
          const poisoned = [holderStatus, foeStatus].filter(
            s => s === StatusEffect.POISON || s === StatusEffect.TOXIC,
          ).length;
          for (const move of [MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.DOUBLE_SLAP]) {
            const params = hitCountParams(holder, foe, move);
            // The OLD canApply: the parent's test, then "somebody on the field is poisoned".
            const parentSays = allMoves[move].canBeMultiStrikeEnhanced(holder, true, foe);
            const expected = parentSays && poisoned > 0;
            expect(
              original.canApply(params),
              `${MoveId[move]} holder ${StatusEffect[holderStatus]} foe ${StatusEffect[foeStatus]}`,
            ).toBe(expected);
            if (expected) {
              original.apply(params);
              expect((params as { hitCount: NumberHolder }).hitCount.value).toBe(1 + poisoned);
            }
          }
        }
      }
      // Live arguments: two extra hits each, and a replaced "somebody is poisoned" closure.
      setStatusOf(holder, StatusEffect.POISON);
      setStatusOf(foe, StatusEffect.TOXIC);
      const twice = buildAttr(module, { extraHitsPerPoisoned: 2 }, { "ctor:1": () => true });
      const params = hitCountParams(holder, foe, MoveId.TACKLE);
      expect(twice.canApply(params)).toBe(true);
      twice.apply(params);
      expect((params as { hitCount: NumberHolder }).hitCount.value).toBe(1 + 2 * 2);
      const never = buildAttr(module, {}, { "ctor:1": () => false });
      expect(never.canApply(hitCountParams(holder, foe, MoveId.TACKLE))).toBe(false);
      // The ability-level binding is legacy, so the attr is not rebuilt from bindings (and says why).
      expect(() => recomposeAttr(module, original, CONTAMINATED, 0)).toThrow(/no library binding/);
    });

    it("battle twin with the original closure kept in the slot: poisoned and unpoisoned holders behave like the original", async () => {
      const original = liveAbility(CONTAMINATED).attrs[0] as unknown as {
        poisonedFieldCondition: (p: Pokemon) => boolean;
      };
      for (const status of ["NONE", "POISON", "TOXIC"]) {
        const scenario: TwinScenario = {
          template: {
            ...TEMPLATES["holder-hits-foe"],
            id: `b16-contaminated-${status}`,
            label: `holder attacks, holder ${status}`,
          },
          axes: { status },
          label: `holder ${status}`,
        };
        const outcome = await twinKeepingClosures(
          CONTAMINATED,
          { 0: { conds: { "ctor:1": original.poisonedFieldCondition as never } } },
          scenario,
        );
        expect(outcome.differences).toEqual([]);
        expect(outcome.rebuilt).toContain(0);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Decay", () => {
    it("entry: the marker first, then poison unless already poisoned, nothing when simulated; the rebuild makes the same calls", async () => {
      const { holder } = await startWorld(phaserGame);
      const original = liveAbility(DECAY).attrs[0];
      const rebuilt = recomposeAttr(moduleOf("DecayEntryAbAttr"), original, DECAY, 0);
      expect(rebuilt).not.toBe(original);
      const run = (attr: AbAttr, status: StatusEffect, simulated: boolean): unknown => {
        holder.removeTag(BattlerTagType.ER_DECAY_POISON);
        setStatusOf(holder, status);
        const calls: unknown[] = [];
        const spy = vi.spyOn(holder, "trySetStatus").mockImplementation(((effect: StatusEffect, source: Pokemon) => {
          calls.push({
            effect,
            source: source.id,
            markerAlready: holder.getTag(BattlerTagType.ER_DECAY_POISON) !== undefined,
          });
          return true;
        }) as never);
        attr.apply(baseParams(holder, simulated));
        spy.mockRestore();
        const tag = holder.getTag(BattlerTagType.ER_DECAY_POISON);
        return { calls, marker: tag !== undefined, source: tag?.sourceId };
      };
      for (const status of [StatusEffect.NONE, StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.BURN]) {
        for (const simulated of [false, true]) {
          expect(run(rebuilt, status, simulated), `${StatusEffect[status]} simulated ${simulated}`).toEqual(
            run(original, status, simulated),
          );
        }
      }
      // Pin the original: not poisoned -> marker, then one poisoning of myself; already poisoned -> marker only; simulated -> nothing.
      expect(run(original, StatusEffect.NONE, false)).toEqual({
        calls: [{ effect: StatusEffect.POISON, source: holder.id, markerAlready: true }],
        marker: true,
        source: holder.id,
      });
      expect(run(original, StatusEffect.POISON, false)).toEqual({ calls: [], marker: true, source: holder.id });
      expect(run(original, StatusEffect.BURN, false)).toMatchObject({ calls: [{ effect: StatusEffect.POISON }] });
      expect(run(original, StatusEffect.NONE, true)).toEqual({ calls: [], marker: false, source: undefined });
    });

    it("end of turn: canApply is always true (the pop-up quirk), the library gate equals the class gate in every status and marker state", async () => {
      const { holder } = await startWorld(phaserGame);
      const original = liveAbility(DECAY).attrs[1] as AbAttr & { gate: (p: AbAttrBaseParams) => boolean };
      const module = moduleOf("DecayRestoreAbAttr");
      const rebuilt = recomposeAttr(module, original, DECAY, 1) as AbAttr & {
        gate: (p: AbAttrBaseParams) => boolean;
        gateOverride: (p: AbAttrBaseParams) => boolean;
      };
      expect(rebuilt).not.toBe(original);
      expect(typeof rebuilt.gateOverride).toBe("function");
      const statuses = [
        StatusEffect.NONE,
        StatusEffect.POISON,
        StatusEffect.TOXIC,
        StatusEffect.BURN,
        StatusEffect.SLEEP,
        StatusEffect.PARALYSIS,
      ];
      const run = (attr: AbAttr, status: StatusEffect, marker: boolean, simulated: boolean): unknown => {
        holder.removeTag(BattlerTagType.ER_DECAY_POISON);
        if (marker) {
          holder.addTag(BattlerTagType.ER_DECAY_POISON, 0, MoveId.NONE, holder.id);
        }
        setStatusOf(holder, status);
        const calls: unknown[] = [];
        const spy = vi.spyOn(holder, "trySetStatus").mockImplementation(((effect: StatusEffect, source: Pokemon) => {
          calls.push({ effect, source: source.id });
          return true;
        }) as never);
        const can = attr.canApply(baseParams(holder, simulated));
        attr.apply(baseParams(holder, simulated));
        spy.mockRestore();
        return { can, calls };
      };
      for (const status of statuses) {
        for (const marker of [false, true]) {
          for (const simulated of [false, true]) {
            const label = `${StatusEffect[status]} marker ${marker} simulated ${simulated}`;
            const a = run(original, status, marker, simulated);
            expect(run(rebuilt, status, marker, simulated), label).toEqual(a);
            // The gate itself, original method against the compiled library form.
            holder.removeTag(BattlerTagType.ER_DECAY_POISON);
            if (marker) {
              holder.addTag(BattlerTagType.ER_DECAY_POISON, 0, MoveId.NONE, holder.id);
            }
            setStatusOf(holder, status);
            expect(rebuilt.gateOverride(baseParams(holder)), `gate ${label}`).toBe(original.gate(baseParams(holder)));
            // Pin the original: always can; poisons exactly when marked, not poisoned and not simulated.
            const shouldPoison = marker && status !== StatusEffect.POISON && !simulated;
            expect(a).toEqual({
              can: true,
              calls: shouldPoison ? [{ effect: StatusEffect.POISON, source: holder.id }] : [],
            });
          }
        }
      }
      // The gate is a real slot: an always-true gate poisons without the marker.
      const open = recomposeAttr(module, original, DECAY, 1, { conds: { gate: { all: [] } } });
      expect(run(open, StatusEffect.NONE, false, false)).toEqual({
        can: true,
        calls: [{ effect: StatusEffect.POISON, source: holder.id }],
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Defeatist", () => {
    const statParams = (holder: Pokemon, stat: Stat) =>
      ({
        pokemon: holder,
        move: allMoves[MoveId.TACKLE],
        stat,
        statVal: new NumberHolder(100),
        simulated: false,
      }) as never;

    it("the HP test is the old rounded getHpRatio() <= 1 / 3 for EVERY HP of many max HP values, per stat", async () => {
      const { holder } = await startWorld(phaserGame);
      const atk = liveAbility(DEFEATIST).attrs[0];
      const spatk = liveAbility(DEFEATIST).attrs[1];
      const module = moduleOf("ErDefeatistStatMultiplierAbAttr");
      expect(readDeclParams(module, atk)).toEqual({ stat: "ATK", multiplier: 0.5, hpPercent: 33 });
      expect(readDeclParams(module, spatk)).toEqual({ stat: "SPATK", multiplier: 0.5, hpPercent: 33 });
      const natural = holder.stats[Stat.HP];
      let checked = 0;
      try {
        for (const max of [
          1, 2, 3, 4, 5, 7, 9, 10, 50, 99, 100, 101, 199, 200, 201, 299, 300, 301, 500, 999, 1000, 1001, 1500, 2999,
        ]) {
          holder.stats[Stat.HP] = max;
          expect(holder.getMaxHp()).toBe(max);
          for (let hp = 1; hp <= max; hp++) {
            holder.hp = hp;
            const old = holder.getHpRatio() <= 1 / 3;
            checked++;
            if (
              atk.canApply(statParams(holder, Stat.ATK)) !== old
              || spatk.canApply(statParams(holder, Stat.SPATK)) !== old
            ) {
              throw new Error(`max ${max} hp ${hp}: the old test says ${old}`);
            }
            // The wrong stat never passes; the right one follows the HP.
            if (atk.canApply(statParams(holder, Stat.DEF)) || spatk.canApply(statParams(holder, Stat.ATK))) {
              throw new Error(`max ${max} hp ${hp}: another stat passed`);
            }
          }
        }
      } finally {
        holder.stats[Stat.HP] = natural;
        holder.hp = holder.getMaxHp();
      }
      expect(checked).toBeGreaterThan(9000);
    });

    it("pins the rounding: 33.4 percent passes, 33.5 percent does not; apply halves the stat; the threshold param is live", async () => {
      const { holder } = await startWorld(phaserGame);
      const atk = liveAbility(DEFEATIST).attrs[0];
      const natural = holder.stats[Stat.HP];
      try {
        holder.stats[Stat.HP] = 1000;
        holder.hp = 334;
        expect(holder.getHpRatio()).toBe(0.33);
        expect(atk.canApply(statParams(holder, Stat.ATK))).toBe(true);
        holder.hp = 335;
        expect(holder.getHpRatio()).toBe(0.34);
        expect(atk.canApply(statParams(holder, Stat.ATK))).toBe(false);
        holder.hp = 100;
        const params = statParams(holder, Stat.ATK) as { statVal: NumberHolder };
        atk.apply(params as never);
        expect(params.statVal.value).toBe(50);
        // hpPercent 50: the vanilla Defeatist threshold. Built from the declaration, with the gate left as a stand-in (the class's own).
        const module = moduleOf("ErDefeatistStatMultiplierAbAttr");
        const half = buildAttr(module, { stat: "ATK", multiplier: 0.5, hpPercent: 50 }, { gate: () => true });
        expect(readDeclParams(module, half)).toEqual({ stat: "ATK", multiplier: 0.5, hpPercent: 50 });
        const own = new (atk.constructor as new (...args: unknown[]) => AbAttr)(Stat.ATK, 0.5, undefined, 50);
        holder.hp = 500;
        expect(own.canApply(statParams(holder, Stat.ATK))).toBe(true);
        holder.hp = 506; // 50.6 percent rounds to a ratio of 0.51
        expect(own.canApply(statParams(holder, Stat.ATK))).toBe(false);
      } finally {
        holder.stats[Stat.HP] = natural;
        holder.hp = holder.getMaxHp();
      }
    });

    it("battle twin with the original gate kept in its slot: halved attacks at and under the one-third line match the original", async () => {
      const attrs = liveAbility(DEFEATIST).attrs as unknown as { gate: (p: unknown) => boolean }[];
      // Only HP values at or under the line: above it the ability-level condition of Defeatist stops the dispatch altogether, so the
      // twin would have nothing to compare (the failing side is proven directly in the tests above).
      for (const hp of ["33%", "33%-1", "20%"]) {
        const scenario: TwinScenario = {
          template: { ...TEMPLATES["holder-hits-foe"], id: `b16-defeatist-${hp}`, label: `holder attacks at ${hp} HP` },
          axes: { hp },
          label: `holder at ${hp}`,
        };
        const outcome = await twinKeepingClosures(
          DEFEATIST,
          {
            0: { conds: { gate: attrs[0].gate.bind(attrs[0]) as never } },
            1: { conds: { gate: attrs[1].gate.bind(attrs[1]) as never } },
          },
          scenario,
        );
        expect(outcome.differences).toEqual([]);
        expect(outcome.rebuilt).toEqual(expect.arrayContaining([0, 1]));
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Elite Redux weather abilities", () => {
    it("entry: every one of the ten users sets its weather for 8 turns, original and rebuild alike; simulated changes nothing", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = moduleOf("ErWeatherSummonAbAttr");
      for (const [id, name, weather] of WEATHER_USERS) {
        const original = liveAbility(id).attrs[0];
        expect(original.constructor.name, name).toBe("ErWeatherSummonAbAttr");
        const rebuilt = recomposeAttr(module, original, id, 0);
        expect(rebuilt, name).not.toBe(original);
        expect(readDeclParams(module, original), name).toEqual({ weather: WeatherType[weather], turns: 8 });
        for (const attr of [original, rebuilt]) {
          setWeatherOf(game, WeatherType.NONE);
          expect(attr.canApply(baseParams(holder)), `${name} can set the weather over clear skies`).toBe(true);
          attr.apply(baseParams(holder, true));
          expect(globalScene.arena.weather, `${name} simulated`).toBeNull();
          attr.apply(baseParams(holder));
          expect(globalScene.arena.weather?.weatherType, name).toBe(weather);
          expect(globalScene.arena.weather?.turnsLeft, name).toBe(8);
          expect(globalScene.arena.weather?.maxDuration, name).toBe(8);
          // The same weather is already up: nothing to do. A lasting weather cannot be replaced by an ordinary one.
          expect(attr.canApply(baseParams(holder)), `${name} same weather`).toBe(false);
          setWeatherOf(game, WeatherType.HARSH_SUN);
          expect(attr.canApply(baseParams(holder)), `${name} over a lasting weather`).toBe(false);
        }
      }
    });

    it("entry: the turns param is live and the Mystical Rock extender is kept on top of it", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = moduleOf("ErWeatherSummonAbAttr");
      const short = buildAttr(module, { weather: "SANDSTORM", turns: 3 });
      setWeatherOf(game, WeatherType.NONE);
      short.apply(baseParams(holder));
      expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.SANDSTORM);
      expect(globalScene.arena.weather?.turnsLeft).toBe(3);
      expect(globalScene.arena.weather?.maxDuration).toBe(3);
      // One Mystical Rock stack: +2 turns on top of the configured length (both the arena's own call and ER's overwrite).
      vi.spyOn(globalScene, "applyModifier").mockImplementation(((
        type: unknown,
        _player: unknown,
        _mon: unknown,
        holderValue: NumberHolder,
      ) => {
        if (type === FieldEffectModifier) {
          holderValue.value += 2;
          return true;
        }
        return false;
      }) as never);
      const original = liveAbility(2).attrs[0];
      const rebuilt = recomposeAttr(module, original, 2, 0);
      for (const attr of [original, rebuilt]) {
        setWeatherOf(game, WeatherType.NONE);
        attr.apply(baseParams(holder));
        expect(globalScene.arena.weather?.turnsLeft).toBe(10);
        expect(globalScene.arena.weather?.maxDuration).toBe(10);
      }
    });

    it("new area: ten users, agreement of original and rebuild; against a lasting weather the ordinary weather is refused (suspected dead code pinned)", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = moduleOf("ErBiomeChangeWeatherAbAttr");
      for (const [id, name, weather] of WEATHER_USERS) {
        const original = liveAbility(id).attrs[1];
        expect(original.constructor.name, name).toBe("ErBiomeChangeWeatherAbAttr");
        const rebuilt = recomposeAttr(module, original, id, 1);
        expect(rebuilt, name).not.toBe(original);
        expect(readDeclParams(module, original), name).toEqual({ weather: WeatherType[weather], turns: 8 });
        for (const attr of [original, rebuilt]) {
          // Clear skies and an ordinary weather: the class does not even ask (it wants a lasting weather).
          for (const ordinary of [WeatherType.NONE, WeatherType.RAIN, WeatherType.SNOW]) {
            setWeatherOf(game, ordinary);
            expect(attr.canApply(baseParams(holder)), `${name} ${WeatherType[ordinary]}`).toBe(false);
          }
          // A lasting weather is up: it asks, but the engine refuses to replace it with an ordinary weather, and a lasting weather has
          // no turns, so the ER length patch never runs.
          setWeatherOf(game, WeatherType.HEAVY_RAIN);
          expect(attr.canApply(baseParams(holder)), `${name} lasting weather`).toBe(true);
          attr.apply(baseParams(holder, true));
          expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.HEAVY_RAIN);
          attr.apply(baseParams(holder));
          expect(globalScene.arena.weather?.weatherType, `${name} stays`).toBe(WeatherType.HEAVY_RAIN);
          expect(globalScene.arena.weather?.turnsLeft, `${name} no turns`).toBe(0);
        }
      }
    });

    it("new area: when the engine does set the weather, both overwrite the length of whatever weather is active, simulated does not", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = moduleOf("ErBiomeChangeWeatherAbAttr");
      const original = liveAbility(70).attrs[1];
      const rebuilt = recomposeAttr(module, original, 70, 1);
      for (const attr of [original, rebuilt]) {
        setWeatherOf(game, WeatherType.HEAVY_RAIN);
        // Stand in for a successful trySetWeather (the real one refuses): an ordinary weather with the default 5 turns replaces it.
        const spy = vi.spyOn(globalScene.arena, "trySetWeather").mockImplementation(((weatherType: WeatherType) => {
          globalScene.arena.weather = new Weather(weatherType, 5, 5);
          return true;
        }) as never);
        attr.apply(baseParams(holder, true));
        expect(spy).not.toHaveBeenCalled();
        attr.apply(baseParams(holder));
        expect(spy).toHaveBeenCalledWith(WeatherType.SUNNY, holder);
        expect(globalScene.arena.weather?.weatherType).toBe(WeatherType.SUNNY);
        expect(globalScene.arena.weather?.turnsLeft).toBe(8);
        expect(globalScene.arena.weather?.maxDuration).toBe(8);
        spy.mockRestore();
      }
    });

    it("battle twin: the entry half of all ten users matches the original in a real battle (rain, sun, sand and hail)", async () => {
      // One representative per weather; the shared L2 run covers the signatures, this adds the weather types.
      for (const id of [2, 70, 45, 117]) {
        const original = liveAbility(id);
        const shadowId = allocateShadowId();
        const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
        registerShadow(shadowId, rebuilt.ability);
        const outcome = await twinById(phaserGame, id, shadowId, {
          template: { ...TEMPLATES.entry, id: `b16-weather-${id}`, turns: [celebrate(), celebrate(), celebrate()] },
          axes: {},
          label: `${original.name} entry`,
        });
        expect(outcome.differences).toEqual([]);
        expect(rebuilt.rebuilt).toContain(0);
        unregisterShadows();
      }
    });
  });
});
