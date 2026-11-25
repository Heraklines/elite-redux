/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { FoeStrongestStatSelfBoostAbAttr } from "#data/elite-redux/archetypes/foe-strongest-stat-self-boost";
import type { ForceFoeOutOnInactivityAbAttr } from "#data/elite-redux/archetypes/force-foe-out-on-inactivity";
import type { HealStatusOnMoveTypeAbAttr } from "#data/elite-redux/archetypes/heal-status-on-move-type";
import { HitMultiplierAbAttr, type HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import type { HpScalingStatMultiplierAbAttr } from "#data/elite-redux/archetypes/hp-scaling-stat-multiplier";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

// B09 chunk 3 probes for what the shared L1 and L2 cannot see:
//   1. Vital Spirit (HealStatusOnMoveType): original and rebuild agree over (move, status); the type setting moves the gate.
//   2. HitMultiplier / HitMultiplierPower: every user rebuilds (or is legacy-closure with a reason) and agrees with the original
//      for a move of every property; the strike number (turnData.hitCount - hitsLeft) is driven by hand for the power class.
//   3. HpScalingStatMultiplier: the rebuild keeps the formula; Last Stand reads back its three settings.
//   4. Spyware, Strikeout, the Flare Boost weather clause and Tectonize: the settings read back and the rebuild keeps them.

const VITAL_SPIRIT = 72;
const FLARE_BOOST = 138;
const TECTONIZE = 5046;
const LAST_STAND = 5338;
const SPYWARE = 5597;
const STRIKEOUT = 5614;
const RAGING_BOXER = 5057;
const HYPER_AGGRESSIVE = 5096;
const RAGING_MOTH = 5184;
const FLURRY = 6091;
const DUAL_WIELD = 5169;

/** The first damaging move that carries each property AND can take extra hits (so the class's own guard passes). */
function movesFor(holder: Pokemon, foe: Pokemon, ...flags: MoveFlags[]) {
  return flags.map(flag => {
    const move = allMoves.find(
      m =>
        m != null
        && m.id !== MoveId.NONE
        && m.hasFlag(flag)
        && m.power > 0
        && m.category !== MoveCategory.STATUS
        && m.canBeMultiStrikeEnhanced(holder, true, foe),
    );
    expect(move, `a ${MoveFlags[flag]} move exists`).toBeDefined();
    return move!;
  });
}

const propertyMoves = (holder: Pokemon, foe: Pokemon): ReturnType<typeof movesFor> => [
  ...movesFor(
    holder,
    foe,
    MoveFlags.PUNCHING_MOVE,
    MoveFlags.BITING_MOVE,
    MoveFlags.SLICING_MOVE,
    MoveFlags.PULSE_MOVE,
    MoveFlags.HAMMER_BASED,
    MoveFlags.HORN_BASED,
    MoveFlags.KICKING_MOVE,
    MoveFlags.ARROW_BASED,
  ),
  allMoves[MoveId.TACKLE],
  allMoves[MoveId.EMBER],
  allMoves[MoveId.ICE_BEAM],
  allMoves[MoveId.WATER_GUN],
  allMoves[MoveId.SWORDS_DANCE],
  allMoves[MoveId.DOUBLE_SLAP],
  allMoves[MoveId.SOLAR_BEAM],
  allMoves[MoveId.FLING],
];

describe("B09 chunk 3 (hit multiplier, heal status on move type, HP scaling stat, Spyware, Strikeout, Flare Boost fog, Tectonize)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const hitParams = (holder: Pokemon, foe: Pokemon, move: ReturnType<typeof movesFor>[number]) => ({
    pokemon: holder,
    opponent: foe,
    move,
    damage: 10,
    hitResult: HitResult.EFFECTIVE,
    simulated: false,
  });

  it("Vital Spirit: cures after a damaging Fighting move only while a status is there; the rebuild agrees for every move and status", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(VITAL_SPIRIT).attrs[3] as HealStatusOnMoveTypeAbAttr;
    expect(original.constructor.name).toBe("HealStatusOnMoveTypeAbAttr");
    const module = declRegistry.get("HealStatusOnMoveTypeAbAttr")!;
    const rebuilt = recomposeAttr(module, original, VITAL_SPIRIT, 3) as HealStatusOnMoveTypeAbAttr;
    expect(readDeclParams(module, original)).toEqual({ moveType: "FIGHTING" });
    const fighting = allMoves.find(
      m =>
        m != null
        && m.id !== MoveId.NONE
        && m.type === PokemonType.FIGHTING
        && m.power > 0
        && m.category !== MoveCategory.STATUS,
    );
    const statusFighting = allMoves[MoveId.BULK_UP];
    expect(fighting, "a damaging Fighting move that is not a status move").toBeDefined();
    const moves = [
      fighting!,
      statusFighting,
      allMoves[MoveId.TACKLE],
      allMoves[MoveId.EMBER],
      allMoves[MoveId.SWORDS_DANCE],
    ];
    for (const move of moves) {
      for (const status of [StatusEffect.NONE, StatusEffect.BURN, StatusEffect.POISON, StatusEffect.SLEEP]) {
        setStatusOf(holder, status);
        const params = hitParams(holder, foe, move);
        expect(rebuilt.canApply(params), `${move.name} with ${StatusEffect[status]}`).toBe(original.canApply(params));
      }
    }
    // Truth table of the original, so the agreement is not vacuous.
    setStatusOf(holder, StatusEffect.BURN);
    expect(original.canApply(hitParams(holder, foe, fighting!))).toBe(true);
    expect(original.canApply(hitParams(holder, foe, statusFighting))).toBe(false); // a status move
    expect(original.canApply(hitParams(holder, foe, allMoves[MoveId.TACKLE]))).toBe(false); // wrong type
    setStatusOf(holder, StatusEffect.NONE);
    expect(original.canApply(hitParams(holder, foe, fighting!))).toBe(false); // nothing to cure
    // The type setting moves the gate (gateParams writes it into the bound move.type atom).
    const fire = recomposeAttr(module, original, VITAL_SPIRIT, 3, {
      params: { moveType: "FIRE" },
    }) as HealStatusOnMoveTypeAbAttr;
    setStatusOf(holder, StatusEffect.BURN);
    expect(fire.canApply(hitParams(holder, foe, allMoves[MoveId.EMBER]))).toBe(true);
    expect(fire.canApply(hitParams(holder, foe, fighting!))).toBe(false);
    // The rebuilt apply cures like the original.
    rebuilt.apply(hitParams(holder, foe, fighting!));
    expect(holder.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
  });

  it("HitMultiplier: every user is rebuilt from its gate (or is legacy-closure) and agrees with the original for a move of every property", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("HitMultiplierAbAttr")!;
    const sites = allAttrSites().filter(site => site.className === "HitMultiplierAbAttr");
    expect(sites.length).toBe(31);
    let rebuiltCount = 0;
    let legacyCount = 0;
    for (const site of sites) {
      const original = site.attr as HitMultiplierAbAttr;
      if (site.abilityId === DUAL_WIELD || site.abilityId === 5996 || site.abilityId === 6086) {
        legacyCount++;
        expect(() => recomposeAttr(module, original, site.abilityId, site.attrIndex), site.abilityName).toThrow(
          /no library binding for gate/,
        );
        continue;
      }
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as HitMultiplierAbAttr;
      rebuiltCount++;
      expect(rebuilt.getExtraStrikes(), site.abilityName).toBe(original.getExtraStrikes());
      expect(rebuilt.getFilter(), site.abilityName).toEqual(original.getFilter());
      let applied = 0;
      for (const move of propertyMoves(holder, foe)) {
        const params = { pokemon: holder, opponent: foe, move, hitCount: new NumberHolder(1) };
        const expected = original.canApply(params);
        expect(rebuilt.canApply({ ...params, hitCount: new NumberHolder(1) }), `${site.abilityName} ${move.name}`).toBe(
          expected,
        );
        applied += expected ? 1 : 0;
      }
      // The agreement is not vacuous for the filtered users: at least one move of the list passes and one does not.
      if (Object.keys(original.getFilter()).length > 0) {
        expect(applied, `${site.abilityName} passes some move`).toBeGreaterThan(0);
        expect(applied, `${site.abilityName} blocks some move`).toBeLessThan(propertyMoves(holder, foe).length);
      }
    }
    expect([rebuiltCount, legacyCount]).toEqual([28, 3]);
  });

  it("HitMultiplier: the filter text round-trips for every shape (none, type, one property, a combined mask, a list)", async () => {
    await startWorld(phaserGame);
    const module = declRegistry.get("HitMultiplierAbAttr")!;
    const expectations: [number, number, string][] = [
      [HYPER_AGGRESSIVE, 0, "any move"],
      [RAGING_MOTH, 0, "type=FIRE"],
      [RAGING_BOXER, 0, "flag=PUNCHING_MOVE"],
      [DUAL_WIELD, 0, "flag=PULSE_MOVE|SLICING_MOVE"],
      [FLURRY, 0, "flagsAny=KICKING_MOVE|ARROW_BASED"],
    ];
    for (const [abilityId, index, text] of expectations) {
      const attr = liveAbility(abilityId).attrs[index] as HitMultiplierAbAttr;
      expect(readDeclParams(module, attr).filter, `${abilityId}`).toBe(text);
    }
    // The Dual Wield filter keeps the single combined mask (not two flags) through a rebuild of the instance.
    const dual = liveAbility(DUAL_WIELD).attrs[0] as HitMultiplierAbAttr;
    expect(dual.getFilter().flag).toBe(MoveFlags.PULSE_MOVE | MoveFlags.SLICING_MOVE);
  });

  it("HitMultiplier: the guard (can the move take extra hits) runs before the filter, so a status or a charging move never gets one", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = liveAbility(HYPER_AGGRESSIVE).attrs[0] as HitMultiplierAbAttr; // no filter: only the guard decides
    for (const [id, expected] of [
      [MoveId.TACKLE, true],
      [MoveId.SWORDS_DANCE, false], // a status move
      [MoveId.FLING, false], // listed exception
      [MoveId.DOUBLE_SLAP, false], // already a multi-hit move
    ] as const) {
      expect(
        attr.canApply({ pokemon: holder, opponent: foe, move: allMoves[id], hitCount: new NumberHolder(1) }),
        MoveId[id],
      ).toBe(expected);
    }
    const hits = new NumberHolder(1);
    attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitCount: hits });
    expect(hits.value).toBe(2);
  });

  it("HitMultiplierPower: gate and strike residual agree with the original for every user, strike number and move", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("HitMultiplierPowerAbAttr")!;
    const sites = allAttrSites().filter(site => site.className === "HitMultiplierPowerAbAttr");
    expect(sites.length).toBe(25);
    let onlyExtra = 0;
    let everyHit = 0;
    for (const site of sites) {
      const original = site.attr as HitMultiplierPowerAbAttr;
      if (site.abilityId === DUAL_WIELD || site.abilityId === 5996 || site.abilityId === 6086) {
        expect(() => recomposeAttr(module, original, site.abilityId, site.attrIndex), site.abilityName).toThrow(
          /no library binding for gate/,
        );
        continue;
      }
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as HitMultiplierPowerAbAttr;
      expect(rebuilt.getMultiplier(), site.abilityName).toBe(original.getMultiplier());
      expect(rebuilt.isExtraStrikesOnly(), site.abilityName).toBe(original.isExtraStrikesOnly());
      expect(rebuilt.getFilter(), site.abilityName).toEqual(original.getFilter());
      if (original.isExtraStrikesOnly()) {
        onlyExtra++;
      } else {
        everyHit++;
      }
      for (const move of propertyMoves(holder, foe)) {
        for (const [hitCount, hitsLeft] of [
          [2, 2], // the first of two strikes
          [2, 1], // the second
          [3, 1], // the third
          [1, 1], // a single hit
          [-1, -1], // a move that has not started
        ] as const) {
          holder.turnData.hitCount = hitCount;
          holder.turnData.hitsLeft = hitsLeft;
          const params = { pokemon: holder, opponent: foe, move, damage: new NumberHolder(100) };
          expect(rebuilt.canApply(params), `${site.abilityName} ${move.name} ${hitCount}/${hitsLeft}`).toBe(
            original.canApply(params),
          );
        }
      }
    }
    expect([onlyExtra, everyHit]).toEqual([16, 6]);
    // Truth table of the original for Raging Boxer (second hit only) and Raging Moth (every hit), so the agreement is not vacuous.
    const boxer = liveAbility(RAGING_BOXER).attrs[1] as HitMultiplierPowerAbAttr;
    const moth = liveAbility(RAGING_MOTH).attrs[1] as HitMultiplierPowerAbAttr;
    const punch = movesFor(holder, foe, MoveFlags.PUNCHING_MOVE)[0];
    const fireMove = allMoves[MoveId.EMBER];
    const at = (attr: HitMultiplierPowerAbAttr, move: typeof punch, hitCount: number, hitsLeft: number): boolean => {
      holder.turnData.hitCount = hitCount;
      holder.turnData.hitsLeft = hitsLeft;
      return attr.canApply({ pokemon: holder, opponent: foe, move, damage: new NumberHolder(100) });
    };
    expect(at(boxer, punch, 2, 2)).toBe(false);
    expect(at(boxer, punch, 2, 1)).toBe(true);
    expect(at(boxer, fireMove, 2, 1)).toBe(false);
    expect(at(moth, fireMove, 2, 2)).toBe(true);
    expect(at(moth, fireMove, 2, 1)).toBe(true);
    expect(at(moth, punch, 2, 1)).toBe(false);
    // The "extra hits only" setting follows the rebuild (residual reads the live field).
    const boxerModule = declRegistry.get("HitMultiplierPowerAbAttr")!;
    const everyHitBoxer = recomposeAttr(boxerModule, boxer, RAGING_BOXER, 1, {
      params: { extraStrikesOnly: false },
    }) as HitMultiplierPowerAbAttr;
    expect(at(everyHitBoxer, punch, 2, 2)).toBe(true);
    // apply multiplies the damage by the multiplier with the engine rounding.
    const damage = new NumberHolder(100);
    boxer.apply({ pokemon: holder, opponent: foe, move: punch, damage });
    expect(damage.value).toBe(40);
  });

  it("HpScalingStatMultiplier: Last Stand reads back its settings, and the rebuild scales exactly like the original at every HP", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("HpScalingStatMultiplierAbAttr")!;
    for (const [index, stat] of [
      [0, "DEF"],
      [1, "SPDEF"],
    ] as const) {
      const original = liveAbility(LAST_STAND).attrs[index] as HpScalingStatMultiplierAbAttr;
      expect(readDeclParams(module, original)).toEqual({ stat, minMultiplier: 1, maxMultiplier: 1.6 });
      const rebuilt = recomposeAttr(module, original, LAST_STAND, index) as HpScalingStatMultiplierAbAttr;
      const max = holder.getMaxHp();
      for (const hp of [
        max,
        max - 1,
        Math.floor(max / 2) + 1,
        Math.floor(max / 2),
        Math.ceil(max / 2),
        Math.floor(max / 4),
        1,
        0,
      ]) {
        holder.hp = hp;
        for (const asked of [Stat.DEF, Stat.SPDEF, Stat.ATK]) {
          const a = new NumberHolder(100);
          const b = new NumberHolder(100);
          const params = (value: NumberHolder) => ({
            pokemon: holder,
            stat: asked as BattleStat,
            statVal: value,
            move: allMoves[MoveId.TACKLE],
          });
          expect(rebuilt.canApply(params(b)), `hp ${hp} stat ${Stat[asked]}`).toBe(original.canApply(params(a)));
          if (original.canApply(params(a))) {
            original.apply(params(a));
            rebuilt.apply(params(b));
            expect(b.value, `hp ${hp}`).toBe(a.value);
          }
        }
      }
      // The dex points: x1.3 at half HP and x1.45 at a quarter (max HP of the holder is even or odd, so use the formula directly).
      expect(original.multiplierAt(50, 100)).toBeCloseTo(1.3, 10);
      expect(original.multiplierAt(25, 100)).toBeCloseTo(1.45, 10);
      expect(original.multiplierAt(0, 100)).toBeCloseTo(1.6, 10);
      expect(original.multiplierAt(100, 100)).toBe(1);
    }
  });

  it("Spyware, Strikeout, Flare Boost (fog) and Tectonize: the settings read back and the rebuild keeps them", async () => {
    await startWorld(phaserGame);
    const spyware = liveAbility(SPYWARE).attrs[0] as FoeStrongestStatSelfBoostAbAttr;
    const spyModule = declRegistry.get("FoeStrongestStatSelfBoostAbAttr")!;
    expect(readDeclParams(spyModule, spyware)).toEqual({ stages: 2, physicalCounter: "DEF", specialCounter: "SPDEF" });
    const spyRebuilt = recomposeAttr(spyModule, spyware, SPYWARE, 0, {
      params: { stages: 1, physicalCounter: "ATK", specialCounter: "SPATK" },
    });
    expect(readDeclParams(spyModule, spyRebuilt)).toEqual({
      stages: 1,
      physicalCounter: "ATK",
      specialCounter: "SPATK",
    });

    const strikeout = liveAbility(STRIKEOUT).attrs[0] as ForceFoeOutOnInactivityAbAttr;
    const strikeModule = declRegistry.get("ForceFoeOutOnInactivityAbAttr")!;
    expect(readDeclParams(strikeModule, strikeout)).toEqual({ turns: 3 });
    const five = recomposeAttr(strikeModule, strikeout, STRIKEOUT, 0, { params: { turns: 5 } });
    expect(readDeclParams(strikeModule, five)).toEqual({ turns: 5 });

    // Flare Boost's fog clause and Tectonize have no settings; both rebuild as the same class with the same showAbility.
    for (const [abilityId, index, className] of [
      [FLARE_BOOST, 3, "FlareBoostSelfBurnOnWeatherChangeAbAttr"],
      [TECTONIZE, 2, "GroundEntryHazardImmunityAbAttr"],
    ] as const) {
      const original = liveAbility(abilityId).attrs[index];
      expect(original.constructor.name).toBe(className);
      const module = declRegistry.get(className)!;
      const rebuilt = recomposeAttr(module, original, abilityId, index);
      expect(rebuilt.constructor.name).toBe(className);
      expect(rebuilt.showAbility).toBe(original.showAbility);
    }
  });

  it("HitMultiplier keeps its static filter reader: matchesFilter is the single source of the move test", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const punch = movesFor(holder, foe, MoveFlags.PUNCHING_MOVE)[0];
    expect(HitMultiplierAbAttr.matchesFilter({}, holder, punch)).toBe(true);
    expect(HitMultiplierAbAttr.matchesFilter({ flag: MoveFlags.PUNCHING_MOVE }, holder, punch)).toBe(true);
    expect(HitMultiplierAbAttr.matchesFilter({ flag: MoveFlags.BITING_MOVE }, holder, punch)).toBe(false);
  });
});
