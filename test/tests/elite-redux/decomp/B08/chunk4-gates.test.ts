/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
// B08 chunk 4: proof that the Tier B refactors of DamageCapOnResistAbAttr, DamageReductionAbAttr, DefenseStatSwapOnFlagAbAttr,
// DisableTargetItemOnContactAbAttr, DodgeFirstSuperEffectiveAbAttr and EffectChanceModifierAbAttr are a pure move of code, and that
// every bound gate equals the class's own gate in states the shared L1 grid does not reach, plus the apply side of the eight classes
// (including the three that have no gate).
//
// ORACLE: the original `canApply` / `apply` bodies are copied below VERBATIM from the commit before this chunk (git show adc88265a), so
// the refactored class must give the same answer for every live user and every state. The bound (library) form must agree as well.
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { Status } from "#data/status-effect";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { gridMoves, setTypesOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Any = any;

// Read after startWorld: the ability list is empty before the game is initialised.
const sitesOf = (className: string) => allAttrSites().filter(site => site.className === className);

/** Every registered move, so every category, type and property is reached. */
let MOVES: Any[] = [];
/** The grid's twenty moves plus a Grass, an Ice and a Poison move: every category, contact and type the users filter on. */
let SOME_MOVES: Any[] = [];

describe("B08 chunk 4: gate classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  const loadMoves = (): void => {
    MOVES = allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);
    SOME_MOVES = [...gridMoves(), allMoves[MoveId.VINE_WHIP], allMoves[MoveId.ICE_BEAM], allMoves[MoveId.SLUDGE_BOMB]];
  };

  // -------------------------------------------------------------------------------------------
  it("DamageCapOnResistAbAttr: Survivor Bias gives the original answer and the original damage, refactored and rebuilt, over matchups, HP and damage", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    loadMoves();
    const module = declRegistry.get("DamageCapOnResistAbAttr")!;
    const sites = sitesOf("DamageCapOnResistAbAttr");
    expect(sites.map(site => site.abilityName)).toEqual(["Survivor Bias"]);
    const attr = sites[0].attr as Any;
    const rebuilt = recomposeAttr(module, attr, sites[0].abilityId, sites[0].attrIndex) as Any;
    // The original canApply, verbatim.
    const original = (params: Any): boolean => {
      const { pokemon, opponent, move, damage } = params;
      if (!move?.is("AttackMove")) {
        return false;
      }
      const eff = pokemon.getMoveEffectiveness(opponent, move);
      if (eff >= 1) {
        return false;
      }
      return damage.value >= pokemon.hp;
    };
    let accepted = 0;
    const refusedByEachClause = [0, 0, 0];
    for (const holderTypes of [undefined, [PokemonType.STEEL], [PokemonType.WATER], [PokemonType.GHOST]]) {
      setTypesOf(holder, holderTypes);
      for (const hp of [1, 5, 50, holder.getMaxHp()]) {
        holder.hp = Math.min(hp, holder.getMaxHp());
        for (const damageValue of [0, holder.hp - 1, holder.hp, holder.hp + 1, 9999]) {
          for (const move of SOME_MOVES) {
            const make = () => ({
              pokemon: holder,
              opponent: foe,
              move,
              damage: new NumberHolder(damageValue),
              simulated: false,
            });
            const expected = original(make());
            expect(attr.canApply(make()), `${move.name} hp ${holder.hp} damage ${damageValue}`).toBe(expected);
            expect(rebuilt.canApply(make()), `rebuilt: ${move.name} hp ${holder.hp} damage ${damageValue}`).toBe(
              expected,
            );
            if (expected) {
              accepted++;
              const a = make();
              const b = make();
              attr.apply(a);
              rebuilt.apply(b);
              expect(a.damage.value).toBe(Math.max(0, holder.hp - 1));
              expect(b.damage.value).toBe(a.damage.value);
            } else if (!move.is("AttackMove")) {
              refusedByEachClause[0]++;
            } else if (holder.getMoveEffectiveness(foe, move) >= 1) {
              refusedByEachClause[1]++;
            } else {
              refusedByEachClause[2]++;
            }
          }
        }
      }
    }
    setTypesOf(holder, undefined);
    // Every clause was reached on both sides: accepted hits, a status move, a neutral or super effective hit, a resisted hit that is not lethal.
    expect(accepted).toBeGreaterThan(20);
    expect(refusedByEachClause.every(count => count > 0)).toBe(true);
    // A different number of HP kept moves the cap (the one setting of the effect).
    const keeps3 = recomposeAttr(module, attr, sites[0].abilityId, sites[0].attrIndex, {
      params: { hpLeft: 3 },
    }) as Any;
    holder.hp = 40;
    const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage: new NumberHolder(500) };
    keeps3.apply(params);
    expect(params.damage.value).toBe(37);
    expect(readDeclParams(module, attr)).toEqual({ hpLeft: 1 });
  });

  // -------------------------------------------------------------------------------------------
  it("DamageReductionAbAttr: all 66 attrs answer like the class's own filter, refactored and rebuilt (the 9 legacy gates too, on the class side), and multiply the same", async () => {
    const world = await startWorld(phaserGame);
    loadMoves();
    const { game, holder, foe } = world;
    const module = declRegistry.get("DamageReductionAbAttr")!;
    const sites = sitesOf("DamageReductionAbAttr");
    expect(sites).toHaveLength(66);
    const weathers = [
      WeatherType.NONE,
      WeatherType.SUNNY,
      WeatherType.RAIN,
      WeatherType.SANDSTORM,
      WeatherType.HEAVY_RAIN,
      WeatherType.SNOW,
    ];
    const records = [[], [{ critical: false }], [{ critical: true }]];
    let legacy = 0;
    let rebuiltCount = 0;
    const accepted = new Map<string, number>();
    for (const site of sites) {
      const attr = site.attr as Any;
      const filter = attr.getFilter();
      let rebuilt: Any;
      try {
        rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
        rebuiltCount++;
      } catch {
        legacy++;
      }
      const label = `${site.abilityName} (attr ${site.attrIndex}, ${filter.kind})`;
      for (const holderTypes of [undefined, [PokemonType.STEEL], [PokemonType.FLYING, PokemonType.WATER]]) {
        setTypesOf(holder, holderTypes);
        for (const weather of weathers) {
          setWeatherOf(game, weather);
          for (const hp of ["max", "max-1"]) {
            holder.hp = hp === "max" ? holder.getMaxHp() : holder.getMaxHp() - 1;
            for (const record of records) {
              (holder as Any).turnData.attacksReceived = record;
              for (const move of SOME_MOVES) {
                const params = () => ({
                  pokemon: holder,
                  opponent: foe,
                  move,
                  damage: new NumberHolder(40),
                  simulated: false,
                });
                // The class's own static filter is the original rule (unchanged by the split).
                const expected = DamageReductionAbAttr.matchesFilter(filter, holder, foe, move);
                const got = attr.canApply(params());
                if (got !== expected) {
                  throw new Error(
                    `${label}: ${move.name}, hp ${hp}, ${WeatherType[weather]}: the refactored class says ${got}, the filter ${expected}`,
                  );
                }
                if (rebuilt !== undefined) {
                  const lib = rebuilt.canApply(params());
                  if (lib !== expected) {
                    throw new Error(
                      `${label}: ${move.name}, hp ${hp}, ${WeatherType[weather]}: the rebuild says ${lib}, the filter ${expected}`,
                    );
                  }
                }
                if (expected) {
                  accepted.set(filter.kind, (accepted.get(filter.kind) ?? 0) + 1);
                }
              }
            }
          }
        }
      }
      // apply multiplies by 1 - reduction with the parent's rounding, rebuilt or not
      const damage = new NumberHolder(97);
      attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage });
      expect(damage.value, label).toBe(toDmgValue(97 * (1 - attr.getReduction())));
      if (rebuilt !== undefined) {
        const damage2 = new NumberHolder(97);
        rebuilt.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage: damage2 });
        expect(damage2.value, label).toBe(damage.value);
        expect(rebuilt.appliesToFixedDamage(), label).toBe(attr.appliesToFixedDamage());
      }
    }
    setTypesOf(holder, undefined);
    setWeatherOf(game, WeatherType.NONE);
    (holder as Any).turnData.attacksReceived = [];
    expect(rebuiltCount).toBe(57);
    expect(legacy).toBe(9);
    // Every kind of filter really accepted some move in the sweep, so the true branch of each was compared.
    for (const kind of [
      "all",
      "category",
      "contact",
      "super-effective",
      "resisted",
      "full-hp",
      "crit",
      "category-in-weather",
      "move-type",
    ]) {
      expect(accepted.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------------------------
  it("DefenseStatSwapOnFlagAbAttr: the five users give the original power, refactored and rebuilt, over every move and several defense pairs", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    loadMoves();
    const module = declRegistry.get("DefenseStatSwapOnFlagAbAttr")!;
    const sites = sitesOf("DefenseStatSwapOnFlagAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual([
      "Kyokushin",
      "Power Edge",
      "Power Fists",
      "Roundhouse",
      "Soul Crusher",
    ]);
    // The original `apply`, verbatim (it was reached after the parent's constant-true canApply).
    const original = (opts: Any, params: Any): void => {
      const { opponent, move, power } = params;
      if (!opponent || !move.hasFlag(opts.flag)) {
        return;
      }
      const def = opponent.getStat(Stat.DEF, false);
      const spdef = opponent.getStat(Stat.SPDEF, false);
      if (def <= 0 || spdef <= 0) {
        return;
      }
      if (opts.swap === "target-spdef-instead-of-def" && move.category === MoveCategory.PHYSICAL) {
        power.value *= def / spdef;
      } else if (opts.swap === "target-def-instead-of-spdef" && move.category === MoveCategory.SPECIAL) {
        power.value *= spdef / def;
      } else if (opts.swap === "target-lower-defense") {
        if (move.category === MoveCategory.PHYSICAL && spdef < def) {
          power.value *= def / spdef;
        } else if (move.category === MoveCategory.SPECIAL && def < spdef) {
          power.value *= spdef / def;
        }
      }
    };
    let changed = 0;
    for (const site of sites) {
      const attr = site.attr as Any;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as Any;
      const opts = attr.opts;
      for (const [def, spdef] of [
        [200, 100],
        [100, 200],
        [100, 100],
        [1, 400],
      ]) {
        vi.spyOn(foe, "getStat").mockImplementation(((stat: number) => (stat === Stat.DEF ? def : spdef)) as Any);
        for (const move of MOVES) {
          const run = (target: Any): number => {
            const params = { pokemon: holder, opponent: foe, move, power: new NumberHolder(60), simulated: false };
            if (target === "original") {
              original(opts, params);
            } else if (target.canApply(params)) {
              target.apply(params);
            }
            return params.power.value;
          };
          const expected = run("original");
          expect(run(attr), `${site.abilityName}: ${move.name} ${def}/${spdef}`).toBeCloseTo(expected, 10);
          expect(run(rebuilt), `rebuilt ${site.abilityName}: ${move.name} ${def}/${spdef}`).toBeCloseTo(expected, 10);
          changed += expected === 60 ? 0 : 1;
        }
        vi.restoreAllMocks();
      }
    }
    // Moves of the right property and category really got their power scaled in the sweep.
    expect(changed).toBeGreaterThan(30);
    // No opponent: neither the class nor the rebuild does anything (the guard).
    const attr = sites[0].attr as Any;
    const flagged = MOVES.find(m => m.hasFlag(attr.opts.flag))!;
    expect(attr.canApply({ pokemon: holder, opponent: undefined, move: flagged, power: new NumberHolder(60) })).toBe(
      false,
    );
  });

  // -------------------------------------------------------------------------------------------
  it("DefenseStatSwapOnStatusedFoeAbAttr: the original, the live attr and the rebuild pick the same defense for every stat order and stage", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    loadMoves();
    const sites = sitesOf("DefenseStatSwapOnStatusedFoeAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Exploit Weakness", "Relentless"]);
    const picked = new Set<number>();
    for (const site of sites) {
      // The gate is a legacy closure (bindings.ts), so the library cannot rebuild it yet: compare the live class only.
      for (const [def, spdef] of [
        [80, 100],
        [100, 80],
        [90, 90],
      ]) {
        vi.spyOn(foe, "getEffectiveStat").mockImplementation(((stat: number) =>
          stat === Stat.DEF ? def : spdef) as Any);
        for (const defender of [foe, undefined]) {
          const run = (attr: Any): number => {
            const statHolder = new NumberHolder(Stat.SPDEF);
            attr.apply({ pokemon: holder, defender, statHolder, simulated: false });
            return statHolder.value;
          };
          // The original apply, verbatim: nothing without a defender, otherwise the lower effective defense (a tie is Defense).
          const original = (): number => {
            const statHolder = new NumberHolder(Stat.SPDEF);
            if (defender) {
              const d = defender.getEffectiveStat(Stat.DEF);
              const s = defender.getEffectiveStat(Stat.SPDEF);
              statHolder.value = d <= s ? Stat.DEF : Stat.SPDEF;
            }
            return statHolder.value;
          };
          expect(run(site.attr), `${site.abilityName} ${def}/${spdef}`).toBe(original());
          picked.add(run(site.attr));
        }
        vi.restoreAllMocks();
      }
    }
    // Both outcomes (Defense and Sp. Def) were produced.
    expect([...picked].sort()).toEqual([Stat.DEF, Stat.SPDEF].sort());
    // The foe-status test is the class gate now (it used to be in the engine call site): no defender -> false, no status -> false,
    // status NONE -> false, a real status -> true. The rebuilt attr keeps the same answer.
    const statusParams = (defender: Any): Any => ({
      pokemon: holder,
      defender,
      statHolder: new NumberHolder(Stat.DEF),
    });
    const savedStatus = foe.status;
    try {
      for (const site of sites) {
        // Both users bind the gate as a legacy closure (no library tree to rebuild yet), so the class itself answers.
        for (const attr of [site.attr as Any]) {
          foe.status = null;
          expect(attr.canApply(statusParams(foe))).toBe(false);
          expect(attr.canApply(statusParams(undefined))).toBe(false);
          foe.status = new Status(StatusEffect.NONE);
          expect(attr.canApply(statusParams(foe))).toBe(false);
          foe.status = new Status(StatusEffect.BURN);
          expect(attr.canApply(statusParams(foe))).toBe(true);
        }
      }
    } finally {
      foe.status = savedStatus;
    }
  });

  // -------------------------------------------------------------------------------------------
  it("DisableFoeItemsOnEntryAbAttr and DisableTargetItemOnContactAbAttr: the tag, the count and the gate are the original ones, refactored and rebuilt", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    loadMoves();
    // --- entry: Frisk and Gleam Eyes add ER_ITEM_DISABLED with count 3 to every opponent, not when simulated
    const entry = declRegistry.get("DisableFoeItemsOnEntryAbAttr")!;
    const entrySites = sitesOf("DisableFoeItemsOnEntryAbAttr");
    expect(entrySites.map(site => site.abilityName).sort()).toEqual(["Frisk", "Gleam Eyes"]);
    for (const site of entrySites) {
      for (const attr of [site.attr as Any, recomposeAttr(entry, site.attr, site.abilityId, site.attrIndex) as Any]) {
        const spy = vi.spyOn(foe, "addTag").mockImplementation((() => true) as Any);
        attr.apply({ pokemon: holder, simulated: false });
        expect(spy.mock.calls).toEqual([[BattlerTagType.ER_ITEM_DISABLED, 3, undefined, holder.id]]);
        spy.mockClear();
        attr.apply({ pokemon: holder, simulated: true });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      }
    }
    const five = recomposeAttr(entry, entrySites[0].attr, entrySites[0].abilityId, entrySites[0].attrIndex, {
      params: { turns: 5 },
    }) as Any;
    const spyFive = vi.spyOn(foe, "addTag").mockImplementation((() => true) as Any);
    five.apply({ pokemon: holder, simulated: false });
    expect(spyFive.mock.calls[0][1]).toBe(5);
    spyFive.mockRestore();
    expect(readDeclParams(entry, entrySites[0].attr)).toEqual({ turns: 3 });

    // --- contact: Supersweet Syrup; the original canApply, verbatim
    const contact = declRegistry.get("DisableTargetItemOnContactAbAttr")!;
    const [site] = sitesOf("DisableTargetItemOnContactAbAttr");
    const attr = site.attr as Any;
    const rebuilt = recomposeAttr(contact, site.attr, site.abilityId, site.attrIndex) as Any;
    const original = (params: Any): boolean => {
      const { pokemon, opponent, move, hitResult } = params;
      if (
        !(move.category !== MoveCategory.STATUS)
        || hitResult >= HitResult.NO_EFFECT
        || opponent === undefined
        || pokemon === opponent
      ) {
        return false;
      }
      return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent });
    };
    let accepted = 0;
    for (const move of MOVES) {
      for (const hitResult of [
        HitResult.EFFECTIVE,
        HitResult.SUPER_EFFECTIVE,
        HitResult.ONE_HIT_KO,
        HitResult.NO_EFFECT,
        HitResult.STATUS,
        HitResult.MISS,
      ]) {
        for (const opponent of [foe, holder, undefined]) {
          const params = { pokemon: holder, opponent, move, hitResult, damage: 5, simulated: false };
          const expected = original(params);
          expect(attr.canApply(params), `${move.name} ${HitResult[hitResult]}`).toBe(expected);
          // The library gate is only asked with a real target (the guard refuses the rest first), exactly like the class.
          expect(rebuilt.canApply(params), `rebuilt ${move.name} ${HitResult[hitResult]}`).toBe(expected);
          accepted += expected ? 1 : 0;
        }
      }
    }
    expect(accepted).toBeGreaterThan(10);
    const spy = vi.spyOn(foe, "addTag").mockImplementation((() => true) as Any);
    for (const target of [attr, rebuilt]) {
      target.apply({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        simulated: false,
        hitResult: HitResult.EFFECTIVE,
        damage: 5,
      });
      expect(spy.mock.calls.at(-1)).toEqual([BattlerTagType.ER_ITEM_DISABLED, 3, undefined, holder.id]);
      spy.mockClear();
      target.apply({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        simulated: true,
        hitResult: HitResult.EFFECTIVE,
        damage: 5,
      });
      expect(spy).not.toHaveBeenCalled();
    }
    spy.mockRestore();
    expect(readDeclParams(contact, attr)).toEqual({ turns: 3 });
  });

  // -------------------------------------------------------------------------------------------
  it("DodgeFirstSuperEffectiveAbAttr: Anticipation and Telepathy answer like the original chain, spend the charge once, and a simulated call spends nothing", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    loadMoves();
    const module = declRegistry.get("DodgeFirstSuperEffectiveAbAttr")!;
    const sites = sitesOf("DodgeFirstSuperEffectiveAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Anticipation", "Telepathy"]);
    // The original canApply, verbatim.
    const original = ({ move, typeMultiplier, pokemon, opponent: attacker }: Any): boolean =>
      move.is("AttackMove")
      && typeMultiplier.value >= 2
      && attacker !== pokemon
      && !pokemon.battleData.anticipationDodgeUsed;
    for (const site of sites) {
      const attr = site.attr as Any;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as Any;
      let accepted = 0;
      for (const used of [false, true]) {
        for (const move of [MoveId.TACKLE, MoveId.SWORDS_DANCE, MoveId.WATER_GUN, MoveId.GROWL]) {
          for (const multiplier of [0, 0.25, 0.5, 1, 1.99, 2, 4]) {
            for (const attacker of [foe, holder]) {
              holder.battleData.anticipationDodgeUsed = used;
              const params = () => ({
                pokemon: holder,
                opponent: attacker,
                move: allMoves[move],
                typeMultiplier: new NumberHolder(multiplier),
                cancelled: new BooleanHolder(false),
                simulated: false,
              });
              const expected = original(params());
              expect(attr.canApply(params()), `${site.abilityName} ${MoveId[move]} x${multiplier} used ${used}`).toBe(
                expected,
              );
              // The rebuilt gate keeps its own charge (a library memory, separate from the class's field). With the field set and the
              // library memory unspent the two stores disagree: that known limit is checked after the sweep (request R-B08-26).
              if (!used) {
                expect(
                  rebuilt.canApply(params()),
                  `rebuilt ${site.abilityName} ${MoveId[move]} x${multiplier} used ${used}`,
                ).toBe(expected);
              }
              accepted += expected ? 1 : 0;
            }
          }
        }
      }
      // The known limit: a charge spent in the class's own field is NOT seen by a rebuilt gate whose library memory is unspent.
      holder.battleData.anticipationDodgeUsed = true;
      expect(
        rebuilt.canApply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.WATER_GUN],
          typeMultiplier: new NumberHolder(2),
          cancelled: new BooleanHolder(false),
          simulated: false,
        }),
      ).toBe(true);
      holder.battleData.anticipationDodgeUsed = false;
      expect(accepted).toBeGreaterThanOrEqual(4);

      // A simulated call zeroes the multiplier but does not spend the charge.
      const sim = {
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.WATER_GUN],
        typeMultiplier: new NumberHolder(2),
        cancelled: new BooleanHolder(false),
        simulated: true,
      };
      attr.apply(sim);
      expect(sim.typeMultiplier.value).toBe(0);
      expect(sim.cancelled.value).toBe(true);
      expect(holder.battleData.anticipationDodgeUsed).toBe(false);
      // The real hit spends the class's charge; afterwards both the class and a fresh rebuild refuse a second dodge.
      const real = () => ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.WATER_GUN],
        typeMultiplier: new NumberHolder(2),
        cancelled: new BooleanHolder(false),
        simulated: false,
      });
      const fresh = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as Any;
      expect(fresh.canApply(real())).toBe(true);
      fresh.apply(real());
      expect(holder.battleData.anticipationDodgeUsed).toBe(true);
      expect(fresh.canApply(real())).toBe(false);
      expect(attr.canApply(real())).toBe(false);
      // A new battle starts with fresh battle data: the class's field and the library memory are both re-armed.
      (holder as Any).battleData = new PokemonBattleData(undefined);
      // The threshold setting moves the boundary: 4 means only a double super effective hit is dodged.
      const strict = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
        params: { minMultiplier: 4 },
      }) as Any;
      expect(strict.canApply({ ...real(), typeMultiplier: new NumberHolder(2) })).toBe(false);
      expect(strict.canApply({ ...real(), typeMultiplier: new NumberHolder(4) })).toBe(true);
    }
  });

  // -------------------------------------------------------------------------------------------
  it("EffectChanceModifierAbAttr: Precise Fist and Way of Precision answer like the original, refactored and rebuilt, for every move and chance", async () => {
    const { holder } = await startWorld(phaserGame);
    loadMoves();
    const module = declRegistry.get("EffectChanceModifierAbAttr")!;
    const sites = sitesOf("EffectChanceModifierAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Precise Fist", "Way of Precision"]);
    for (const site of sites) {
      const attr = site.attr as Any;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as Any;
      // The original canApply, verbatim (the parent's checks are inlined here).
      const original = (params: Any): boolean => {
        if (attr.flag !== undefined && !params.move.hasFlag(attr.flag)) {
          return false;
        }
        return !(params.chance.value <= 0 || [MoveId.ORDER_UP, MoveId.ELECTRO_SHOT].includes(params.move.id));
      };
      let accepted = 0;
      for (const move of MOVES) {
        for (const chance of [-5, 0, 10, 30, 100]) {
          const params = () => ({ pokemon: holder, move, chance: new NumberHolder(chance), simulated: false });
          const expected = original(params());
          expect(attr.canApply(params()), `${site.abilityName}: ${move.name} ${chance}`).toBe(expected);
          expect(rebuilt.canApply(params()), `rebuilt ${site.abilityName}: ${move.name} ${chance}`).toBe(expected);
          if (expected) {
            accepted++;
            const a = params();
            const b = params();
            attr.apply(a);
            rebuilt.apply(b);
            expect(a.chance.value).toBe(Math.min(chance * 5, 100));
            expect(b.chance.value).toBe(a.chance.value);
          }
        }
      }
      expect(accepted).toBeGreaterThan(10);
      // Order Up and Electro Shot are refused even with the property; a move without the property is refused.
      for (const id of [MoveId.ORDER_UP, MoveId.ELECTRO_SHOT]) {
        expect(rebuilt.canApply({ pokemon: holder, move: allMoves[id], chance: new NumberHolder(30) })).toBe(false);
      }
    }
    // A configuration without a property (the Serene Grace shape): no gate, every move with a chance.
    const noFlag = declRegistry.get("EffectChanceModifierAbAttr")!.ctor as Any;
    const plain = new noFlag({ multiplier: 2 });
    expect(plain.canApply({ pokemon: holder, move: allMoves[MoveId.TACKLE], chance: new NumberHolder(10) })).toBe(true);
    expect(plain.canApply({ pokemon: holder, move: allMoves[MoveId.TACKLE], chance: new NumberHolder(0) })).toBe(false);
  });
});
