/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
// B11 chunk 5: StabAddAbAttr, StabSuppressAuraAbAttr, StatBlendAbAttr, StatChangeOnAttackAbAttr.
// The shared L1 grid and the L2 twin cannot reach everything these classes read (a second holder of the same ability on the field,
// the holder's own types and the exact types of its moves, the real stat values, the chance roll boundary, what apply queues), and L1
// only counts random draws, not the threshold they are compared with. So each rule is driven here on the ORIGINAL attr, on its
// REBUILD (library bindings where they exist, the shipped closure handed in where a binding is a legacy closure) and on a REFERENCE
// written below from the code the classes had before chunk 5 (StabAdd and StabSuppressAura changed their constructors and moved
// code), and all must answer the same.
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { type CondInput, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { StabSuppressAuraAbAttr } from "#data/elite-redux/archetypes/stab-suppress-aura";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CLASSES = ["StabAddAbAttr", "StabSuppressAuraAbAttr", "StatBlendAbAttr", "StatChangeOnAttackAbAttr"] as const;

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);

/** The rebuild of one shipped attr; a slot with a legacy-closure binding gets the shipped closure (or the class gate) handed in. */
function rebuildSite(site: AttrSite): any {
  const module = declRegistry.get(site.className) as DeclModule;
  const conds: Record<string, CondInput> = {};
  for (const slot of module.decl.conditions) {
    if (getBinding(site.abilityId, site.attrIndex, slot.slot)?.legacyClosure !== undefined) {
      const attr = site.attr as any;
      conds[slot.slot] = slot.slot === "gate" ? (params: never) => attr.gate(params) : attr[slot.path ?? "condition"];
    }
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, { conds });
}

function siteOf(className: string, abilityName: string, attrIndex?: number): AttrSite {
  const site = sitesOf(className).find(
    candidate =>
      candidate.abilityName === abilityName && (attrIndex === undefined || candidate.attrIndex === attrIndex),
  );
  if (site === undefined) {
    throw new Error(`${abilityName} has no ${className}`);
  }
  return site;
}

/** The shipped attr of one user and its rebuild, run through the same check. */
function both<T>(
  className: string,
  abilityName: string,
  check: (attr: any, which: string) => T,
  attrIndex?: number,
): [T, T] {
  const site = siteOf(className, abilityName, attrIndex);
  return [check(site.attr, "original"), check(rebuildSite(site), "rebuild")];
}

describe("B11 chunk 5: the four classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user rebuilds to an identical attr and reads back the shipped settings", async () => {
    await startWorld(phaserGame);
    for (const className of CLASSES) {
      expect(sitesOf(className).length, className).toBeGreaterThan(0);
      for (const site of sitesOf(className)) {
        const rebuilt = rebuildSite(site);
        expect(
          JSON.parse(JSON.stringify(attrFingerprint(rebuilt as never))),
          `${site.abilityName} #${site.attrIndex} ${className}`,
        ).toEqual(JSON.parse(JSON.stringify(attrFingerprint(site.attr as never))));
      }
    }
    const read = (className: string, abilityName: string, attrIndex?: number) => {
      const site = siteOf(className, abilityName, attrIndex);
      return readDeclParams(declRegistry.get(className) as DeclModule, site.attr);
    };
    expect(sitesOf("StabAddAbAttr")).toHaveLength(59);
    expect(sitesOf("StabSuppressAuraAbAttr")).toHaveLength(2);
    expect(sitesOf("StatBlendAbAttr")).toHaveLength(2);
    expect(sitesOf("StatChangeOnAttackAbAttr")).toHaveLength(9);
    // every StabAdd user is 1.5; the type is the one the dump says
    for (const site of sitesOf("StabAddAbAttr")) {
      expect(read("StabAddAbAttr", site.abilityName, site.attrIndex).multiplier, site.abilityName).toBe(1.5);
    }
    expect(read("StabAddAbAttr", "Aurora Borealis")).toEqual({ multiplier: 1.5, targetType: "Ice" });
    expect(read("StabAddAbAttr", "Mystic Power")).toEqual({ multiplier: 1.5, targetType: "Any type" });
    expect(read("StabAddAbAttr", "Stellarize")).toEqual({ multiplier: 1.5, targetType: "Stellar" });
    expect(read("StabAddAbAttr", "Lunar Eclipse", 0).targetType).toBe("Fairy");
    expect(read("StabAddAbAttr", "Lunar Eclipse", 1).targetType).toBe("Dark");
    expect(read("StabSuppressAuraAbAttr", "Relic Stone")).toEqual({ suppression: 1 / 1.5 });
    expect(read("StatBlendAbAttr", "Best Offense")).toEqual({
      appliesTo: "Attack, Sp. Atk",
      source: "Sp. Def",
      fraction: 0.2,
    });
    expect(read("StatChangeOnAttackAbAttr", "Sinister Claws")).toEqual({
      stats: "Sp. Def",
      stages: -1,
      recipient: "The Pokemon I hit",
      chance: 100,
      flag: "SLICING_MOVE",
      type: "Any type",
    });
    expect(read("StatChangeOnAttackAbAttr", "Archmage", 8)).toEqual({
      stats: "Sp. Atk",
      stages: 1,
      recipient: "Myself",
      chance: 30,
      flag: "ANY",
      type: "Fighting",
    });
    expect(read("StatChangeOnAttackAbAttr", "Familiar", 12)).toEqual({
      stats: "Attack",
      stages: -1,
      recipient: "The Pokemon I hit",
      chance: 30,
      flag: "ANY",
      type: "Dragon",
    });
  });

  it("Same-type bonus add: the old single closure, the shipped attr and the rebuild answer the same for every type combination", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    // The closure the class had before chunk 5, verbatim, as the reference.
    const oldClosure = (targetType: PokemonType | null) => (pokemon: any, _defender: any, move: any) => {
      if (pokemon === null) {
        return false;
      }
      const moveType = pokemon.getMoveType(move);
      if (targetType !== null && moveType !== targetType) {
        return false;
      }
      const sourceTypes = pokemon.getTypes(false, false);
      return !sourceTypes.includes(moveType);
    };
    let moveType: PokemonType = PokemonType.NORMAL;
    let types: PokemonType[] = [PokemonType.NORMAL];
    vi.spyOn(holder, "getMoveType").mockImplementation((() => moveType) as never);
    vi.spyOn(holder, "getTypes").mockImplementation((() => types) as never);
    const tackle = allMoves[MoveId.TACKLE];
    const run = (attr: any) => {
      const answers: Record<string, boolean> = {};
      for (const [holderName, holderTypes] of [
        ["pure Normal", [PokemonType.NORMAL]],
        ["Water/Ice", [PokemonType.WATER, PokemonType.ICE]],
        ["Dark", [PokemonType.DARK]],
      ] as const) {
        for (const type of [
          PokemonType.NORMAL,
          PokemonType.WATER,
          PokemonType.ICE,
          PokemonType.DARK,
          PokemonType.STELLAR,
        ]) {
          types = [...holderTypes];
          moveType = type;
          answers[`${holderName} / ${PokemonType[type]}`] = attr.canApply({
            pokemon: holder,
            opponent: foe,
            move: tackle,
            simulated: false,
          });
        }
      }
      return answers;
    };
    for (const [abilityName, targetType] of [
      ["Aurora Borealis", PokemonType.ICE],
      ["Amphibious", PokemonType.WATER],
      ["Mystic Power", null],
      ["Moon Spirit", PokemonType.FAIRY],
      ["Stellarize", PokemonType.STELLAR],
    ] as const) {
      const [original, rebuilt] = both("StabAddAbAttr", abilityName, run);
      const reference: Record<string, boolean> = {};
      const referenceClosure = oldClosure(targetType);
      for (const key of Object.keys(original)) {
        const [holderName, typeName] = key.split(" / ");
        types =
          holderName === "pure Normal"
            ? [PokemonType.NORMAL]
            : holderName === "Water/Ice"
              ? [PokemonType.WATER, PokemonType.ICE]
              : [PokemonType.DARK];
        moveType = (PokemonType as unknown as Record<string, PokemonType>)[typeName];
        reference[key] = referenceClosure(holder, foe, tackle);
      }
      expect(original, abilityName).toEqual(reference);
      expect(rebuilt, abilityName).toEqual(original);
    }
    // spot checks of the rule itself
    const [aurora] = both("StabAddAbAttr", "Aurora Borealis", run);
    expect(aurora["pure Normal / ICE"]).toBe(true);
    expect(aurora["Water/Ice / ICE"]).toBe(false); // already my own type: no double bonus
    expect(aurora["pure Normal / WATER"]).toBe(false); // not the configured type
    const [mystic] = both("StabAddAbAttr", "Mystic Power", run);
    expect(mystic["pure Normal / DARK"]).toBe(true);
    expect(mystic["Dark / DARK"]).toBe(false);
    // a class built with no closures at all behaves as before, and with its own closures it uses them
    const plain = new StabAddAbAttr({ targetType: PokemonType.ICE });
    types = [PokemonType.NORMAL];
    moveType = PokemonType.ICE;
    expect(plain.canApply({ pokemon: holder, opponent: foe, move: tackle } as never)).toBe(true);
    const custom = new StabAddAbAttr({ targetType: PokemonType.ICE }, () => false);
    expect(custom.canApply({ pokemon: holder, opponent: foe, move: tackle } as never)).toBe(false);
    const power = new NumberHolder(40);
    plain.apply({ pokemon: holder, opponent: foe, move: tackle, power } as never);
    expect(power.value).toBe(60);
  });

  it("Same-type bonus cut: only with another holder on the field and a move of my own type; same power as the old apply", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    // The behaviour the class had before chunk 5, verbatim, as the reference (canApply was always true, the tests sat in apply).
    const oldApply = (pokemon: any, move: any, power: NumberHolder) => {
      const field = (globalScene as any).getField().filter((p: any) => p && !p.isFainted());
      const holderPresent = field.some(
        (p: any) =>
          p !== pokemon
          && (p.hasAbility(pokemon.getAbility().id) || p.getPassiveAbility().id === pokemon.getAbility().id),
      );
      if (!holderPresent) {
        return;
      }
      const userTypes = pokemon.getTypes(true);
      const moveType = pokemon.getMoveType(move);
      if (userTypes.includes(moveType)) {
        power.value *= 1 / 1.5;
      }
    };
    let moveType: PokemonType = PokemonType.NORMAL;
    vi.spyOn(holder, "getMoveType").mockImplementation((() => moveType) as never);
    vi.spyOn(holder, "getTypes").mockImplementation((() => [PokemonType.NORMAL, PokemonType.FLYING]) as never);
    const tackle = allMoves[MoveId.TACKLE];
    // the foe has the same ability as the holder (both Ball Fetch) unless a scenario says otherwise
    let foeHasAbility = true;
    let foePassive = false;
    let foeFainted = false;
    vi.spyOn(foe, "hasAbility").mockImplementation((() => foeHasAbility) as never);
    vi.spyOn(foe, "getPassiveAbility").mockImplementation((() => ({
      id: foePassive ? holder.getAbility().id : -1,
    })) as never);
    vi.spyOn(foe, "isFainted").mockImplementation((() => foeFainted) as never);
    const run = (attr: any, scenario: { type: PokemonType; ability: boolean; passive: boolean; fainted: boolean }) => {
      moveType = scenario.type;
      foeHasAbility = scenario.ability;
      foePassive = scenario.passive;
      foeFainted = scenario.fainted;
      const power = new NumberHolder(100);
      const params = { pokemon: holder, opponent: foe, move: tackle, power, simulated: false } as never;
      if (attr.canApply(params)) {
        attr.apply(params);
      }
      return power.value;
    };
    const scenarios = [
      { name: "other holder, my type", type: PokemonType.FLYING, ability: true, passive: false, fainted: false },
      { name: "other holder, not my type", type: PokemonType.FIRE, ability: true, passive: false, fainted: false },
      { name: "other holder as passive", type: PokemonType.NORMAL, ability: false, passive: true, fainted: false },
      { name: "no other holder", type: PokemonType.NORMAL, ability: false, passive: false, fainted: false },
      { name: "other holder fainted", type: PokemonType.NORMAL, ability: true, passive: false, fainted: true },
    ];
    for (const abilityName of ["Relic Stone", "Titan"]) {
      const [original, rebuilt] = both("StabSuppressAuraAbAttr", abilityName, attr =>
        scenarios.map(scenario => run(attr, scenario)),
      );
      const reference = scenarios.map(scenario => {
        moveType = scenario.type;
        foeHasAbility = scenario.ability;
        foePassive = scenario.passive;
        foeFainted = scenario.fainted;
        const power = new NumberHolder(100);
        oldApply(holder, tackle, power);
        return power.value;
      });
      expect(original, abilityName).toEqual(reference);
      expect(rebuilt, abilityName).toEqual(original);
      expect(original[0]).toBeCloseTo(66.6667, 3);
      expect(original[1]).toBe(100);
      expect(original[2]).toBeCloseTo(66.6667, 3);
      expect(original[3]).toBe(100);
      expect(original[4]).toBe(100);
    }
    // the multiplier setting and the closures are used by a rebuild
    const custom = new StabSuppressAuraAbAttr(
      () => true,
      () => true,
      0.5,
    );
    const power = new NumberHolder(100);
    expect(custom.canApply({ pokemon: holder, opponent: foe, move: tackle, power } as never)).toBe(true);
    custom.apply({ pokemon: holder, opponent: foe, move: tackle, power } as never);
    expect(power.value).toBe(50);
  });

  it("Stat blend: only the listed stats get floor(share) of the source stat, and a rebuild with the gate removed would add to every stat", async () => {
    const { holder } = await startWorld(phaserGame);
    const real: Record<number, number> = { [Stat.SPDEF]: 207, [Stat.ATK]: 150, [Stat.SPATK]: 130, [Stat.DEF]: 90 };
    vi.spyOn(holder, "getStat").mockImplementation(((stat: number) => real[stat] ?? 50) as never);
    const run = (attr: any, stat: number): number | undefined => {
      const statVal = new NumberHolder(100);
      const params = { pokemon: holder, stat, statVal, simulated: false, move: allMoves[MoveId.TACKLE] } as never;
      if (!attr.canApply(params)) {
        return;
      }
      attr.apply(params);
      return statVal.value;
    };
    for (const abilityName of ["Best Offense", "Magus Blades"]) {
      const [original, rebuilt] = both("StatBlendAbAttr", abilityName, attr =>
        [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD].map(stat => run(attr, stat)),
      );
      // floor(0.2 * 207) = 41
      expect(original, abilityName).toEqual([141, undefined, 141, undefined, undefined]);
      expect(rebuilt, abilityName).toEqual(original);
    }
    // the gate override replaces the stat test (what a staff condition does) and the share is still added
    const site = siteOf("StatBlendAbAttr", "Best Offense");
    const open = rebuildSite(site);
    open.gateOverride = () => true;
    expect(run(open, Stat.SPD)).toBe(141);
  });

  it("Stat change on attack: damaging, flag, type, target and the chance boundary (29 passes, 30 fails), and what apply queues", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queued: unknown[][] = [];
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      queued.push(args);
    }) as never);
    let roll = 0;
    let draws = 0;
    vi.spyOn(holder, "randBattleSeedInt").mockImplementation((() => {
      draws++;
      return roll;
    }) as never);
    const slash = allMoves[MoveId.SLASH];
    const tackle = allMoves[MoveId.TACKLE];
    const swords = allMoves[MoveId.SWORDS_DANCE];
    const closeCombat = allMoves[MoveId.CLOSE_COMBAT];
    const aerialAce = allMoves[MoveId.AERIAL_ACE];
    const ironHead = allMoves[MoveId.IRON_HEAD];
    const dragonClaw = allMoves[MoveId.DRAGON_CLAW];
    const params = (move: any, opponent: any = foe, simulated = false) =>
      ({ pokemon: holder, opponent, move, hitResult: 1, damage: 10, simulated }) as never;
    const answer = (attr: any, move: any, opponent: any = foe) => {
      draws = 0;
      const result = attr.canApply(params(move, opponent));
      return { result, draws };
    };
    // Sinister Claws: slicing moves only, chance 100 (never draws), changes the target
    const [sinister, sinisterRebuilt] = both("StatChangeOnAttackAbAttr", "Sinister Claws", attr => [
      answer(attr, slash),
      answer(attr, tackle),
      answer(attr, swords),
      answer(attr, slash, null),
      answer(attr, slash, holder),
    ]);
    expect(sinister).toEqual([
      { result: true, draws: 0 },
      { result: false, draws: 0 },
      { result: false, draws: 0 },
      { result: false, draws: 0 },
      { result: false, draws: 0 },
    ]);
    expect(sinisterRebuilt).toEqual(sinister);
    // Archmage and Familiar: one type each, 30%, the roll is drawn last and only for a damaging move of that type
    const casesByAttr: [string, number, any, any][] = [
      ["Archmage", 8, closeCombat, aerialAce],
      ["Archmage", 9, aerialAce, closeCombat],
      ["Archmage", 10, ironHead, tackle],
      ["Archmage", 11, dragonClaw, tackle],
      ["Familiar", 9, closeCombat, aerialAce],
      ["Familiar", 10, aerialAce, closeCombat],
      ["Familiar", 11, ironHead, tackle],
      ["Familiar", 12, dragonClaw, tackle],
    ];
    for (const [abilityName, attrIndex, right, wrong] of casesByAttr) {
      const [original, rebuilt] = both(
        "StatChangeOnAttackAbAttr",
        abilityName,
        attr => {
          const out: unknown[] = [];
          for (const value of [0, 29, 30, 31, 99]) {
            roll = value;
            out.push(answer(attr, right));
          }
          roll = 0;
          out.push(answer(attr, wrong)); // wrong type: no draw
          out.push(answer(attr, swords)); // status move: no draw
          // the holder itself is not a valid target, but a self change does not need one
          out.push(answer(attr, right, null));
          out.push(answer(attr, right, holder));
          return out;
        },
        attrIndex,
      );
      expect(rebuilt, `${abilityName} #${attrIndex}`).toEqual(original);
      expect(
        (original as any[]).slice(0, 5).map(item => item.result),
        `${abilityName} #${attrIndex}`,
      ).toEqual([true, true, false, false, false]);
      expect((original as any[]).slice(0, 5).map(item => item.draws)).toEqual([1, 1, 1, 1, 1]);
      expect((original as any[])[5]).toEqual({ result: false, draws: 0 });
      expect((original as any[])[6]).toEqual({ result: false, draws: 0 });
    }
    // Archmage attr 8 changes MYSELF (so a missing target is fine) and attr 11 changes the target (so it is not)
    const [selfOriginal, selfRebuilt] = both(
      "StatChangeOnAttackAbAttr",
      "Archmage",
      attr => {
        roll = 0;
        return [answer(attr, closeCombat, null).result, answer(attr, closeCombat, holder).result];
      },
      8,
    );
    expect(selfOriginal).toEqual([true, true]);
    expect(selfRebuilt).toEqual(selfOriginal);
    const [foeOriginal, foeRebuilt] = both(
      "StatChangeOnAttackAbAttr",
      "Archmage",
      attr => {
        roll = 0;
        return [answer(attr, dragonClaw, null).result, answer(attr, dragonClaw, holder).result];
      },
      11,
    );
    expect(foeOriginal).toEqual([false, false]);
    expect(foeRebuilt).toEqual(foeOriginal);
    // apply: nothing in a preview, otherwise one stat stage phase for the right Pokemon
    const applied = (attr: any, simulated: boolean) => {
      queued.length = 0;
      attr.apply(params(slash, foe, simulated));
      return queued.map(args => [args[0], args[1], args[2], args[3], args[4]]);
    };
    const [sinisterApply, sinisterApplyRebuilt] = both("StatChangeOnAttackAbAttr", "Sinister Claws", attr => [
      applied(attr, true),
      applied(attr, false),
    ]);
    expect(sinisterApply[0]).toEqual([]);
    expect(sinisterApply[1]).toEqual([["StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPDEF], -1]]);
    expect(sinisterApplyRebuilt).toEqual(sinisterApply);
    const [archApply, archApplyRebuilt] = both("StatChangeOnAttackAbAttr", "Archmage", attr => applied(attr, false), 8);
    expect(archApply).toEqual([["StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPATK], 1]]);
    expect(archApplyRebuilt).toEqual(archApply);
  });

  it("Stat change on attack: moving the chance setting moves the gate (the boundary follows the slider)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    let roll = 0;
    vi.spyOn(holder, "randBattleSeedInt").mockImplementation((() => roll) as never);
    const site = siteOf("StatChangeOnAttackAbAttr", "Archmage", 8);
    const module = declRegistry.get("StatChangeOnAttackAbAttr") as DeclModule;
    const closeCombat = allMoves[MoveId.CLOSE_COMBAT];
    const at = (attr: any, value: number) => {
      roll = value;
      return attr.canApply({
        pokemon: holder,
        opponent: foe,
        move: closeCombat,
        hitResult: 1,
        damage: 5,
        simulated: false,
      });
    };
    const fifty = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, { params: { chance: 50 } }) as any;
    expect([at(fifty, 49), at(fifty, 50)]).toEqual([true, false]);
    expect(fifty.chance).toBe(50);
    const original = site.attr as any;
    expect([at(original, 29), at(original, 30)]).toEqual([true, false]);
  });
});
