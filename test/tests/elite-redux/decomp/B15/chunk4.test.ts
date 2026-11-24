/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4 probes: what the shared L1 and L2 suites cannot see.
//   - the constructor arguments added for the typed params keep the old literals as defaults, every param round-trips through the declaration
//     (read from the live attr, rebuilt with a new value) and the engine seams really read the value from the holder's attr;
//   - Puppet Strings: the guards / gate / residual split gives the same answer as the ORIGINAL clause order over every combination of its inputs, and a
//     swapped gate cannot bypass the safety rules or the once-per-switch-in residual;
//   - Pressure Vessel: the scale over the PP share, the stat gate, the two scale ends;
//   - Rain Pump: the weather gate (including the suppressed-weather case that is the reason the gate stays a legacy closure), the residual, the PP amount;
//   - Relativity: the turn-order test of both halves (offence marker and damage reduction) and the substitute stat;
//   - Rendezvous: the power factor and the heal share are read from the holder's attr, the heal happens once per pair per turn, the partner pick draws only
//     when there is a real choice;
//   - Quickening Grace: the seam (damaging charge move, once per turn per holder);
//   - set a field effect when hit: the guard, the contact gate, every user's own values and the three sides.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { PressureVesselAbAttr } from "#data/elite-redux/abilities/pressure-vessel";
import { PuppetStringsAbAttr } from "#data/elite-redux/abilities/puppet-strings";
import {
  erQuickeningGraceUsedTurn,
  erTryQuickeningGrace,
  QuickeningGraceAbAttr,
} from "#data/elite-redux/abilities/quickening-grace";
import { RainPumpAbAttr } from "#data/elite-redux/abilities/rain-pump";
import { RelativityAbAttr, RelativityDefenseReductionAbAttr } from "#data/elite-redux/abilities/relativity";
import {
  erRendezvousOnHit,
  erRendezvousPowerMultiplier,
  RendezvousAbAttr,
} from "#data/elite-redux/abilities/rendezvous";
import { SetArenaTagOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { recordTurnAttack, resetTurnAttackLedger } from "#data/elite-redux/abilities/turn-attack-ledger";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const SCRAPYARD = 5137;
const LOOSE_QUILLS = 5138;
const LOOSE_ROCKS = 5141;
const DROP_BLOCKS = 5607;
const LOOSE_THORNS = 5611;
const SHATTERED_ARMOR = 5698;
const PUPPET_STRINGS = 5901;
const RELATIVITY = 5911;
const QUICKENING_GRACE = 5913;
const PRESSURE_VESSEL = 5914;
const RAIN_PUMP = 5915;
const RENDEZVOUS = 5919;

function declared(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return module!;
}

/** Makes `holder` carry `attr` as its only active ability attr (the seams find it by constructor name). */
function carry(holder: Pokemon, attr: unknown): void {
  vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([attr] as never);
  vi.spyOn(holder, "isActive").mockReturnValue(true);
}

describe("B15 chunk 4", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetTurnAttackLedger();
  });

  describe("the constructor arguments keep the old numbers by default and every declaration reads and rebuilds its params", () => {
    it("defaults equal the old literals and the class names are unchanged (the engine seams find them by name)", () => {
      const pressure = new PressureVesselAbAttr();
      expect([pressure.minMultiplier, pressure.maxMultiplier]).toEqual([1.0, 1.5]);
      expect(pressure.showAbility).toBe(false);
      const rain = new RainPumpAbAttr();
      expect(rain.ppRestored).toBe(1);
      expect(rain.showAbility).toBe(true);
      expect(new RelativityAbAttr().substituteStat).toBe(Stat.SPD);
      expect(new RelativityAbAttr().showAbility).toBe(false);
      const rendezvous = new RendezvousAbAttr();
      expect([rendezvous.powerMultiplier, rendezvous.healFraction]).toEqual([1.2, 0.05]);
      expect(rendezvous.showAbility).toBe(false);
      const defense = new RelativityDefenseReductionAbAttr() as unknown as {
        damageMultiplier: number;
        showAbility: boolean;
      };
      expect(defense.damageMultiplier).toBe(0.75);
      expect(defense.showAbility).toBe(false);
      expect(
        [
          pressure,
          rain,
          new RelativityAbAttr(),
          rendezvous,
          new RelativityDefenseReductionAbAttr(),
          new QuickeningGraceAbAttr(),
          new PuppetStringsAbAttr(),
        ].map(attr => attr.constructor.name),
      ).toEqual([
        "PressureVesselAbAttr",
        "RainPumpAbAttr",
        "RelativityAbAttr",
        "RendezvousAbAttr",
        "RelativityDefenseReductionAbAttr",
        "QuickeningGraceAbAttr",
        "PuppetStringsAbAttr",
      ]);
    });

    it("every live attr reads back its params; a rebuild with other values carries them", async () => {
      await startWorld(phaserGame);
      // The three classes with a legacy binding cannot rebuild on their own binding; the original closure is given as the override (what a staff rule keeping the closure does).
      const keepGate = (attr: unknown) => (params: never) => (attr as { gate: (p: never) => boolean }).gate(params);
      const cases: [
        string,
        number,
        number,
        Record<string, string | number | boolean>,
        Record<string, unknown>,
        boolean,
      ][] = [
        [
          "PressureVesselAbAttr",
          PRESSURE_VESSEL,
          0,
          { minMultiplier: 0.5, maxMultiplier: 2 },
          { minMultiplier: 0.5, maxMultiplier: 2 },
          true,
        ],
        ["RainPumpAbAttr", RAIN_PUMP, 0, { ppRestored: 3 }, { ppRestored: 3 }, true],
        ["RelativityAbAttr", RELATIVITY, 0, { substituteStat: "SPATK" }, { substituteStat: Stat.SPATK }, false],
        ["RelativityDefenseReductionAbAttr", RELATIVITY, 1, { multiplier: 0.5 }, { damageMultiplier: 0.5 }, false],
        [
          "RendezvousAbAttr",
          RENDEZVOUS,
          0,
          { powerMultiplier: 1.5, healPercent: 10 },
          { powerMultiplier: 1.5, healFraction: 0.1 },
          false,
        ],
      ];
      for (const [className, abilityId, index, params, expected, gateNeedsOverride] of cases) {
        const original = liveAbility(abilityId).attrs[index];
        expect(original.constructor.name).toBe(className);
        const read = readDeclParams(declared(className), original);
        // The live values are the defaults of the declaration (a param without a default would be a dead slider).
        for (const param of declared(className).decl.params) {
          expect(read[param.id], `${className}.${param.id} is read from the live attr`).toBe(param.default);
        }
        const conds: Record<string, unknown> = {};
        if (gateNeedsOverride) {
          conds.gate = keepGate(original);
        }
        if (className === "RelativityDefenseReductionAbAttr") {
          conds["ctor:0"] = (original as unknown as { condition: unknown }).condition;
        }
        const rebuilt = recomposeAttr(declared(className), original, abilityId, index, {
          params,
          conds: conds as never,
        }) as unknown as Record<string, unknown>;
        expect(rebuilt.constructor.name).toBe(className);
        for (const [field, value] of Object.entries(expected)) {
          expect(rebuilt[field], `${className}.${field}`).toBe(value);
        }
      }
      // Puppet Strings and Quickening Grace have no param.
      expect(declared("PuppetStringsAbAttr").decl.params).toEqual([]);
      expect(declared("QuickeningGraceAbAttr").decl.params).toEqual([]);
    });

    it("the six users of the set-a-field-effect class keep their own tag, turns, side and contact switch after a rebuild", async () => {
      await startWorld(phaserGame);
      const module = declared("SetArenaTagOnHitAbAttr");
      const users: [number, number, string, string, boolean][] = [
        [SCRAPYARD, 0, "SPIKES", "ATTACKER_SIDE", true],
        [LOOSE_QUILLS, 0, "SPIKES", "ATTACKER_SIDE", true],
        [LOOSE_ROCKS, 0, "STEALTH_ROCK", "ATTACKER_SIDE", true],
        [DROP_BLOCKS, 0, "SPIKES", "ATTACKER_SIDE", false],
        [LOOSE_THORNS, 0, "CREEPING_THORNS", "ATTACKER_SIDE", true],
        [SHATTERED_ARMOR, 2, "SPIKES", "ATTACKER_SIDE", true],
      ];
      for (const [id, index, tag, side, contact] of users) {
        const original = liveAbility(id).attrs[index] as SetArenaTagOnHitAbAttr;
        expect(original.constructor.name).toBe("SetArenaTagOnHitAbAttr");
        const read = readDeclParams(module, original);
        expect([read.tagType, read.turns, read.side, read.contactRequired], `${id} live values`).toEqual([
          tag,
          0,
          side,
          contact,
        ]);
        const rebuilt = recomposeAttr(module, original, id, index) as SetArenaTagOnHitAbAttr;
        expect([rebuilt.getTagType(), rebuilt.getTurns(), rebuilt.getSide(), rebuilt.requiresContact()]).toEqual([
          ArenaTagType[tag as keyof typeof ArenaTagType] ?? tag,
          0,
          "attacker",
          contact,
        ]);
      }
      // Other values go through the codec: the side words staff see ("MY_SIDE") become the constructor words ("self").
      const original = liveAbility(SCRAPYARD).attrs[0] as SetArenaTagOnHitAbAttr;
      const changed = recomposeAttr(module, original, SCRAPYARD, 0, {
        params: { tagType: "STEALTH_ROCK", turns: 3, side: "MY_SIDE" },
      }) as SetArenaTagOnHitAbAttr;
      expect([changed.getTagType(), changed.getTurns(), changed.getSide(), changed.requiresContact()]).toEqual([
        ArenaTagType.STEALTH_ROCK,
        3,
        "self",
        true,
      ]);
    });
  });

  describe("set a field effect when hit: guard, contact gate, effect", () => {
    function hitParams(
      holder: Pokemon,
      foe: Pokemon,
      move: MoveId,
      hitResult = HitResult.EFFECTIVE,
      simulated = false,
    ) {
      return { pokemon: holder, opponent: foe, move: allMoves[move], hitResult, damage: 10, simulated } as never;
    }

    it("clause order: the hit must connect, then a contact move is needed (unless the user needs none); a rebuilt rule follows its own gate", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declared("SetArenaTagOnHitAbAttr");
      for (const [id, index, needsContact] of [
        [SCRAPYARD, 0, true],
        [DROP_BLOCKS, 0, false],
        [SHATTERED_ARMOR, 2, true],
      ] as const) {
        const original = liveAbility(id).attrs[index] as SetArenaTagOnHitAbAttr;
        const rebuilt = recomposeAttr(module, original, id, index) as SetArenaTagOnHitAbAttr;
        for (const attr of [original, rebuilt]) {
          expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE)), `${id} contact move`).toBe(true);
          expect(attr.canApply(hitParams(holder, foe, MoveId.WATER_GUN)), `${id} non-contact move`).toBe(!needsContact);
          // A hit that did not connect never counts, whatever the gate says.
          expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.NO_EFFECT))).toBe(false);
          expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, HitResult.MISS))).toBe(false);
        }
      }
      // The contact gate swapped for "any move" fires on a water move, but the guard (the hit must connect) is still locked.
      const scrapyard = liveAbility(SCRAPYARD).attrs[0] as SetArenaTagOnHitAbAttr;
      const anyMove = recomposeAttr(module, scrapyard, SCRAPYARD, 0, {
        conds: { gate: { all: [] } },
      }) as SetArenaTagOnHitAbAttr;
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.WATER_GUN))).toBe(true);
      expect(anyMove.canApply(hitParams(holder, foe, MoveId.WATER_GUN, HitResult.NO_EFFECT))).toBe(false);
      // ... and the gate swapped for "sound move" follows the new gate.
      const sound = recomposeAttr(module, scrapyard, SCRAPYARD, 0, {
        conds: { gate: { block: "move.flag", params: { flag: "SOUND_BASED" } } },
      }) as SetArenaTagOnHitAbAttr;
      expect(sound.canApply(hitParams(holder, foe, MoveId.HYPER_VOICE))).toBe(true);
      expect(sound.canApply(hitParams(holder, foe, MoveId.TACKLE))).toBe(false);
    });

    it("apply puts the tag on the attacker's side, my side or both, with the turns it has, and never in a preview", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const addTag = vi.spyOn(globalScene.arena, "addTag").mockReturnValue(true as never);
      const holderSide = holder.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
      const otherSide = holder.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
      const cases: [Record<string, unknown>, ArenaTagSide][] = [
        [{ tagType: ArenaTagType.SPIKES }, otherSide],
        [{ tagType: ArenaTagType.STEALTH_ROCK, turns: 3, side: "self" }, holderSide],
        [{ tagType: ArenaTagType.MIST, turns: 5, side: "both" }, ArenaTagSide.BOTH],
      ];
      for (const [options, side] of cases) {
        const attr = new SetArenaTagOnHitAbAttr(options as never);
        addTag.mockClear();
        attr.apply(hitParams(holder, foe, MoveId.TACKLE, HitResult.EFFECTIVE, true));
        expect(addTag).not.toHaveBeenCalled();
        attr.apply(hitParams(holder, foe, MoveId.TACKLE));
        expect(addTag).toHaveBeenCalledTimes(1);
        expect(addTag).toHaveBeenCalledWith(
          options.tagType,
          (options.turns as number | undefined) ?? 0,
          undefined,
          holder.id,
          side,
        );
      }
    });
  });

  describe("Puppet Strings: guards, gate and residual equal the original clause order", () => {
    // The ORIGINAL canApply, copied from the source before the split (clause order: damaging move, other / standing / damaged, Psychic, poisoned, Shield Dust, already Commanded).
    function originalCanApply(params: { pokemon: any; opponent: any; move: any; damage: number }): boolean {
      const { pokemon, opponent: target, move, damage } = params;
      if (!(move.category !== MoveCategory.STATUS)) {
        return false;
      }
      if (pokemon === target || target.isFainted() || damage <= 0) {
        return false;
      }
      if (pokemon.getMoveType(move) !== PokemonType.PSYCHIC) {
        return false;
      }
      const status = target.status?.effect;
      if (status !== StatusEffect.POISON && status !== StatusEffect.TOXIC) {
        return false;
      }
      if (target.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")) {
        return false;
      }
      if (target.summonData.erCommandedUsedThisSwitchIn || target.getTag(BattlerTagType.ER_COMMANDED)) {
        return false;
      }
      return true;
    }

    interface Inputs {
      category: MoveCategory;
      self: boolean;
      fainted: boolean;
      damage: number;
      moveType: PokemonType;
      status: StatusEffect | undefined;
      shieldDust: boolean;
      usedBefore: boolean;
      commanded: boolean;
    }

    function* everyCombination(): Generator<Inputs> {
      for (const category of [MoveCategory.STATUS, MoveCategory.PHYSICAL]) {
        for (const self of [false, true]) {
          for (const fainted of [false, true]) {
            for (const damage of [0, 1, 30]) {
              for (const moveType of [PokemonType.PSYCHIC, PokemonType.FIRE]) {
                for (const status of [undefined, StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.BURN]) {
                  for (const shieldDust of [false, true]) {
                    for (const usedBefore of [false, true]) {
                      for (const commanded of [false, true]) {
                        yield { category, self, fainted, damage, moveType, status, shieldDust, usedBefore, commanded };
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    function stage(input: Inputs) {
      const target: any = {
        id: 2,
        isFainted: () => input.fainted,
        status: input.status === undefined ? undefined : { effect: input.status },
        hasAbilityWithAttr: (name: string) => input.shieldDust && name === "IgnoreMoveEffectsAbAttr",
        summonData: { erCommandedUsedThisSwitchIn: input.usedBefore },
        getTag: (tag: BattlerTagType) => (input.commanded && tag === BattlerTagType.ER_COMMANDED ? {} : undefined),
        addTag: vi.fn(),
      };
      const holder: any = { id: 1, getMoveType: () => input.moveType };
      return {
        holder,
        target,
        params: {
          pokemon: holder,
          opponent: input.self ? holder : target,
          move: { category: input.category },
          damage: input.damage,
          hitResult: HitResult.EFFECTIVE,
          simulated: false,
        } as never,
      };
    }

    it("the split answers exactly like the original over every combination of its inputs, for the live attr and a rebuilt one", async () => {
      await startWorld(phaserGame);
      const live = liveAbility(PUPPET_STRINGS).attrs[0] as PuppetStringsAbAttr;
      const rebuilt = recomposeAttr(declared("PuppetStringsAbAttr"), live, PUPPET_STRINGS, 0) as PuppetStringsAbAttr;
      let count = 0;
      let trues = 0;
      for (const input of everyCombination()) {
        const { params } = stage(input);
        const expected = originalCanApply(params as never);
        expect(live.canApply(params), JSON.stringify(input)).toBe(expected);
        expect(rebuilt.canApply(params), `rebuilt ${JSON.stringify(input)}`).toBe(expected);
        count++;
        trues += expected ? 1 : 0;
      }
      // 1536 combinations; only damaging, Psychic, poisoned or badly poisoned (x2), damaging for 1 or 30 (x2), unprotected, not yet Commanded hits on another standing target fire: 4.
      expect(count).toBe(1536);
      expect(trues).toBe(4);
    });

    it("a swapped gate cannot bypass the safety rules or the once-per-switch-in memory; an always-true gate fires on any other hit", async () => {
      await startWorld(phaserGame);
      const live = liveAbility(PUPPET_STRINGS).attrs[0] as PuppetStringsAbAttr;
      const anyHit = recomposeAttr(declared("PuppetStringsAbAttr"), live, PUPPET_STRINGS, 0, {
        conds: { gate: { all: [] } },
      }) as PuppetStringsAbAttr;
      const base: Inputs = {
        category: MoveCategory.STATUS,
        self: false,
        fainted: false,
        damage: 10,
        moveType: PokemonType.FIRE,
        status: undefined,
        shieldDust: false,
        usedBefore: false,
        commanded: false,
      };
      // No design condition holds (a status move, Fire, no status) yet the rebuilt rule fires: those three were the gate.
      expect(anyHit.canApply(stage(base).params)).toBe(true);
      expect(live.canApply(stage(base).params)).toBe(false);
      // The guards and the residual are still there.
      expect(anyHit.canApply(stage({ ...base, self: true }).params)).toBe(false);
      expect(anyHit.canApply(stage({ ...base, fainted: true }).params)).toBe(false);
      expect(anyHit.canApply(stage({ ...base, damage: 0 }).params)).toBe(false);
      expect(anyHit.canApply(stage({ ...base, shieldDust: true }).params)).toBe(false);
      expect(anyHit.canApply(stage({ ...base, usedBefore: true }).params)).toBe(false);
      expect(anyHit.canApply(stage({ ...base, commanded: true }).params)).toBe(false);
    });

    it("the gate swapped for a library condition follows it: a Fire move on a burned target (move type and status swapped)", async () => {
      await startWorld(phaserGame);
      const live = liveAbility(PUPPET_STRINGS).attrs[0] as PuppetStringsAbAttr;
      const fireOnBurned = recomposeAttr(declared("PuppetStringsAbAttr"), live, PUPPET_STRINGS, 0, {
        conds: {
          gate: {
            all: [
              { block: "move.damaging", params: {} },
              { block: "move.type", params: { type: "FIRE", effective: true } },
              { block: "status.has", params: { who: "other", status: "BURN" } },
            ],
          },
        },
      }) as PuppetStringsAbAttr;
      const hit = {
        category: MoveCategory.SPECIAL,
        self: false,
        fainted: false,
        damage: 10,
        moveType: PokemonType.FIRE,
        status: StatusEffect.BURN,
        shieldDust: false,
        usedBefore: false,
        commanded: false,
      };
      expect(fireOnBurned.canApply(stage(hit).params)).toBe(true);
      expect(fireOnBurned.canApply(stage({ ...hit, moveType: PokemonType.PSYCHIC }).params)).toBe(false);
      expect(fireOnBurned.canApply(stage({ ...hit, status: StatusEffect.POISON }).params)).toBe(false);
      expect(live.canApply(stage(hit).params)).toBe(false);
    });

    it("apply adds the Commanded tag with the holder as source, and never in a preview", () => {
      const attr = new PuppetStringsAbAttr();
      const { holder, target, params } = stage({
        category: MoveCategory.SPECIAL,
        self: false,
        fainted: false,
        damage: 10,
        moveType: PokemonType.PSYCHIC,
        status: StatusEffect.POISON,
        shieldDust: false,
        usedBefore: false,
        commanded: false,
      });
      attr.apply({ ...(params as object), simulated: true } as never);
      expect(target.addTag).not.toHaveBeenCalled();
      attr.apply(params);
      expect(target.addTag).toHaveBeenCalledTimes(1);
      expect(target.addTag).toHaveBeenCalledWith(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, holder.id);
    });
  });

  describe("Pressure Vessel: the scale over the PP share and the stat gate", () => {
    const move = (maxPp: number, ppUsed: number, resolved = true) => ({
      getMove: () => (resolved ? {} : undefined),
      getMovePp: () => maxPp,
      ppUsed,
    });
    const mon = (moves: unknown[]) => ({ getMoveset: () => moves }) as unknown as Pokemon;
    const OLD = (fraction: number) => 1.0 + (1.5 - 1.0) * fraction;

    it("the factor equals the old formula (1.0 with no PP left, 1.5 with all, 1.25 at half) and skips unlimited-PP and unresolved moves", () => {
      const attr = new PressureVesselAbAttr();
      expect(attr.multiplierFor(mon([move(10, 0), move(20, 0)]))).toBe(1.5);
      expect(attr.multiplierFor(mon([move(10, 10), move(20, 20)]))).toBe(1.0);
      expect(attr.multiplierFor(mon([move(10, 5), move(20, 10)]))).toBe(1.25);
      for (const used of [3, 7, 29]) {
        // 30 PP in total, `used` of it spent on the second move.
        expect(attr.multiplierFor(mon([move(10, 0), move(20, used)]))).toBe(OLD((10 + 20 - used) / 30));
      }
      // Unlimited PP (-1 or 0) and an unresolved move are left out of both sums.
      expect(attr.multiplierFor(mon([move(10, 5), move(-1, 0), move(0, 0), move(40, 40, false)]))).toBe(1.25);
      // No PP-bearing move at all counts as full.
      expect(attr.multiplierFor(mon([move(-1, 0)]))).toBe(1.5);
      expect(attr.multiplierFor(mon([]))).toBe(1.5);
      // Another scale: the straight line between the new ends.
      const wide = new PressureVesselAbAttr(0.5, 2);
      expect(wide.multiplierFor(mon([move(10, 5)]))).toBe(0.5 + 1.5 * 0.5);
    });

    it("the gate is Defense or Sp. Def; apply multiplies the stat; a swapped gate changes which stat is hit and nothing else", () => {
      const attr = new PressureVesselAbAttr();
      const holder = mon([move(10, 5)]);
      const params = (stat: Stat) =>
        ({ pokemon: holder, stat, statVal: new NumberHolder(100), simulated: false }) as never;
      for (const [stat, expected] of [
        [Stat.ATK, false],
        [Stat.DEF, true],
        [Stat.SPATK, false],
        [Stat.SPDEF, true],
        [Stat.SPD, false],
      ] as const) {
        expect(attr.canApply(params(stat)), Stat[stat]).toBe(expected);
      }
      const defParams = params(Stat.DEF) as unknown as { statVal: NumberHolder<number> };
      attr.apply(defParams as never);
      expect(defParams.statVal.value).toBe(100 * 1.25);
      // A rebuilt rule that applies to Speed too (an always-true gate) multiplies Attack as well.
      attr.gateOverride = () => true;
      expect(attr.canApply(params(Stat.ATK))).toBe(true);
    });
  });

  describe("Rain Pump: the weather gate, the residual and the PP amount", () => {
    const params = (holder: Pokemon, simulated = false) => ({ pokemon: holder, simulated }) as never;

    it("rain and heavy rain open the gate; a spent move is still needed; sun, clear and a suppressed rain do not (the reason the gate is a legacy closure)", async () => {
      const { game, holder } = await startWorld(phaserGame);
      game.move.changeMoveset(holder, [MoveId.SPLASH, MoveId.TACKLE]);
      const attr = liveAbility(RAIN_PUMP).attrs[0] as RainPumpAbAttr;
      holder.moveset[1].ppUsed = 2;
      for (const [weather, expected] of [
        [WeatherType.NONE, false],
        [WeatherType.SUNNY, false],
        [WeatherType.RAIN, true],
        [WeatherType.HEAVY_RAIN, true],
        [WeatherType.SANDSTORM, false],
      ] as const) {
        setWeatherOf(game, weather);
        expect(attr.canApply(params(holder)), WeatherType[weather]).toBe(expected);
      }
      // Rain, but no move has spent PP: the residual says no.
      setWeatherOf(game, WeatherType.RAIN);
      holder.moveset[1].ppUsed = 0;
      expect(attr.gate(params(holder))).toBe(true);
      expect(attr.residual(params(holder))).toBe(false);
      expect(attr.canApply(params(holder))).toBe(false);
      // Removing the gate cannot make it fire: the residual is still tested.
      const anyWeather = new RainPumpAbAttr();
      anyWeather.gateOverride = () => true;
      expect(anyWeather.canApply(params(holder))).toBe(false);
      holder.moveset[1].ppUsed = 1;
      expect(anyWeather.canApply(params(holder))).toBe(true);
      // Suppressed weather (Cloud Nine): the class says no while the library atom field.weather still says yes.
      vi.spyOn(globalScene.arena.weather!, "isEffectSuppressed").mockReturnValue(true);
      expect(attr.canApply(params(holder))).toBe(false);
      const libraryGate = recomposeAttr(declared("RainPumpAbAttr"), attr, RAIN_PUMP, 0, {
        conds: { gate: { block: "field.weather", params: { weather: "RAIN" } } },
      }) as RainPumpAbAttr;
      expect(libraryGate.canApply(params(holder))).toBe(true);
    });

    it("apply gives back the attr amount to every resolved move, never below zero, never in a preview", async () => {
      const { holder, game } = await startWorld(phaserGame);
      game.move.changeMoveset(holder, [MoveId.SPLASH, MoveId.TACKLE, MoveId.WATER_GUN]);
      holder.moveset[0].ppUsed = 0;
      holder.moveset[1].ppUsed = 1;
      holder.moveset[2].ppUsed = 5;
      const attr = liveAbility(RAIN_PUMP).attrs[0] as RainPumpAbAttr;
      attr.apply(params(holder, true));
      expect(holder.moveset.map(m => m.ppUsed)).toEqual([0, 1, 5]);
      attr.apply(params(holder));
      expect(holder.moveset.map(m => m.ppUsed)).toEqual([0, 0, 4]);
      const double = recomposeAttr(declared("RainPumpAbAttr"), attr, RAIN_PUMP, 0, {
        params: { ppRestored: 2 },
        conds: { gate: () => true },
      }) as RainPumpAbAttr;
      double.apply(params(holder));
      expect(holder.moveset.map(m => m.ppUsed)).toEqual([0, 0, 2]);
    });
  });

  describe("Relativity: the turn-order test of both halves and the substitute stat", () => {
    function setOrder(order: unknown[]) {
      vi.spyOn(globalScene.phaseManager.dynamicQueueManager, "getLastTurnOrder").mockReturnValue(order as never);
    }

    it("offence: Speed replaces the attack stat only when the holder is in the order and the target is absent or later; another stat can be set", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const attr = liveAbility(RELATIVITY).attrs[0] as RelativityAbAttr;
      setOrder([]);
      expect(attr.resolveOffenseStat(holder, foe)).toBeNull();
      setOrder([holder]);
      expect(attr.resolveOffenseStat(holder, foe)).toBe(Stat.SPD);
      setOrder([holder, foe]);
      expect(attr.resolveOffenseStat(holder, foe)).toBe(Stat.SPD);
      setOrder([foe, holder]);
      expect(attr.resolveOffenseStat(holder, foe)).toBeNull();
      setOrder([foe]);
      expect(attr.resolveOffenseStat(holder, foe)).toBeNull();
      const special = new RelativityAbAttr(Stat.SPDEF);
      setOrder([holder, foe]);
      expect(special.resolveOffenseStat(holder, foe)).toBe(Stat.SPDEF);
    });

    it("defence: x0.75 only from an attacker that moved before the holder; a rebuilt rule follows its multiplier and its own condition", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const live = liveAbility(RELATIVITY).attrs[1] as RelativityDefenseReductionAbAttr;
      const move = allMoves[MoveId.TACKLE];
      const hit = { pokemon: holder, opponent: foe, move, damage: new NumberHolder(100), simulated: false } as never;
      for (const [order, expected] of [
        [[], false],
        [[foe], true],
        [[foe, holder], true],
        [[holder, foe], false],
        [[holder], false],
      ] as const) {
        setOrder([...order]);
        expect(live.canApply(hit), `order of ${order.length}`).toBe(expected);
      }
      const halved = recomposeAttr(declared("RelativityDefenseReductionAbAttr"), live, RELATIVITY, 1, {
        params: { multiplier: 0.5 },
        conds: { "ctor:0": (live as unknown as { condition: never }).condition },
      }) as RelativityDefenseReductionAbAttr;
      setOrder([foe]);
      const damage = new NumberHolder(100);
      live.apply({ pokemon: holder, opponent: foe, move, damage, simulated: false } as never);
      expect(damage.value).toBe(75);
      const damage2 = new NumberHolder(100);
      halved.apply({ pokemon: holder, opponent: foe, move, damage: damage2, simulated: false } as never);
      expect(damage2.value).toBe(50);
      // A rule that keeps the closure but swaps in an always-true one reduces every hit.
      const always = recomposeAttr(declared("RelativityDefenseReductionAbAttr"), live, RELATIVITY, 1, {
        conds: { "ctor:0": () => true },
      }) as RelativityDefenseReductionAbAttr;
      setOrder([holder, foe]);
      expect(live.canApply(hit)).toBe(false);
      expect(always.canApply(hit)).toBe(true);
    });
  });

  describe("Rendezvous: numbers read from the attr, heal once per pair per turn, the partner pick", () => {
    /** A holder and an ally linked by the real link table, with healing stand-ins. */
    async function pair() {
      const { holder, foe } = await startWorld(phaserGame);
      const ally = Object.create(foe) as Pokemon & Record<string, unknown>;
      Object.assign(ally, {
        isActive: () => true,
        isFainted: () => false,
        isFullHp: () => false,
        getMaxHp: () => 200,
        getAllActiveAbilityAttrs: () => [],
        heal: vi.fn(),
      });
      Object.assign(holder, { isFullHp: () => false, getMaxHp: () => 100, heal: vi.fn() });
      vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([ally] as never);
      return { holder, foe, ally };
    }

    it("the power factor and the heal share come from the carrier's attr; the heal fires once per pair per turn and skips a full-HP partner", async () => {
      const { holder, foe, ally } = await pair();
      const attr = new RendezvousAbAttr(1.5, 0.1);
      carry(holder, attr);
      attr.apply({ pokemon: holder, simulated: false } as never);
      // Nobody hit the target yet: no boost, no heal.
      expect(erRendezvousPowerMultiplier(holder, foe)).toBe(1);
      erRendezvousOnHit(holder, foe);
      expect(holder.heal).not.toHaveBeenCalled();
      // The partner hit it first: the second attacker is boosted by the attr factor, whichever end carries the ability.
      recordTurnAttack(ally, foe, true);
      expect(erRendezvousPowerMultiplier(holder, foe)).toBe(1.5);
      recordTurnAttack(holder, foe, true);
      expect(erRendezvousPowerMultiplier(ally, foe)).toBe(1.5);
      erRendezvousOnHit(holder, foe);
      expect(holder.heal).toHaveBeenCalledTimes(1);
      expect(holder.heal).toHaveBeenCalledWith(10);
      expect(ally.heal).toHaveBeenCalledWith(20);
      // Once per pair per turn, even for a second target hit.
      erRendezvousOnHit(holder, foe);
      expect(holder.heal).toHaveBeenCalledTimes(1);
      // A partner at full HP is skipped on the next turn.
      globalScene.currentBattle.turn += 1;
      (ally as Record<string, unknown>).isFullHp = () => true;
      recordTurnAttack(ally, foe, true);
      erRendezvousOnHit(holder, foe);
      expect(holder.heal).toHaveBeenCalledTimes(2);
      expect(ally.heal).toHaveBeenCalledTimes(1);
    });

    it("the old numbers are still used by the live attr: x1.2 and 5 percent", async () => {
      const { holder, foe, ally } = await pair();
      const attr = liveAbility(RENDEZVOUS).attrs[0] as RendezvousAbAttr;
      carry(holder, attr);
      attr.apply({ pokemon: holder, simulated: false } as never);
      recordTurnAttack(ally, foe, true);
      expect(erRendezvousPowerMultiplier(holder, foe)).toBe(1.2);
      erRendezvousOnHit(holder, foe);
      expect(holder.heal).toHaveBeenCalledWith(5);
      expect(ally.heal).toHaveBeenCalledWith(10);
    });

    it("entry: no link in a preview; with one candidate no draw; with two candidates exactly one seeded draw", async () => {
      const { holder, foe } = await pair();
      const attr = new RendezvousAbAttr();
      const draw = vi.spyOn(globalScene, "randBattleSeedInt");
      const adjacent = holder.getAdjacentAllies as unknown as ReturnType<typeof vi.fn>;
      attr.apply({ pokemon: holder, simulated: true } as never);
      expect(adjacent).not.toHaveBeenCalled();
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(draw).not.toHaveBeenCalled();
      // A fresh holder with two candidates draws once, with the candidate count.
      const first = Object.create(foe) as Pokemon & Record<string, unknown>;
      const second = Object.create(foe) as Pokemon & Record<string, unknown>;
      const other = Object.create(foe) as Pokemon & Record<string, unknown>;
      Object.assign(first, { isActive: () => true });
      Object.assign(second, { isActive: () => true });
      Object.assign(other, { isActive: () => true, getAdjacentAllies: () => [first, second] });
      draw.mockClear();
      attr.apply({ pokemon: other, simulated: false } as never);
      expect(draw).toHaveBeenCalledTimes(1);
      expect(draw).toHaveBeenCalledWith(2);
    });
  });

  describe("Quickening Grace: the seam hastens the first damaging charge move per turn per holder", () => {
    it("a status charge move never qualifies; the first damaging one does, once per turn; the next turn it works again", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const attr = liveAbility(QUICKENING_GRACE).attrs[0] as QuickeningGraceAbAttr;
      carry(holder, attr);
      vi.spyOn(foe, "getAllies").mockReturnValue([holder] as never);
      const message = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => {}) as never);
      expect(erTryQuickeningGrace(undefined, allMoves[MoveId.SOLAR_BEAM])).toBe(false);
      expect(erTryQuickeningGrace(foe, allMoves[MoveId.GEOMANCY])).toBe(false);
      expect(erQuickeningGraceUsedTurn(holder)).toBeUndefined();
      expect(erTryQuickeningGrace(foe, allMoves[MoveId.SOLAR_BEAM])).toBe(true);
      expect(message).toHaveBeenCalledTimes(1);
      const used = erQuickeningGraceUsedTurn(holder);
      expect(used).toBe(`${globalScene.currentBattle.waveIndex}:${globalScene.currentBattle.turn}`);
      // Second charge move in the same turn: spent.
      expect(erTryQuickeningGrace(foe, allMoves[MoveId.FLY])).toBe(false);
      expect(message).toHaveBeenCalledTimes(1);
      globalScene.currentBattle.turn += 1;
      expect(erTryQuickeningGrace(foe, allMoves[MoveId.FLY])).toBe(true);
      // Nobody carries it any more (or the ally is not active): nothing is hastened.
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      globalScene.currentBattle.turn += 1;
      expect(erTryQuickeningGrace(foe, allMoves[MoveId.SOLAR_BEAM])).toBe(false);
    });
  });
});
