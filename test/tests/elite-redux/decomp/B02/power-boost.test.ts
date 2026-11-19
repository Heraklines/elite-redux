/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3: what the shared L1 and L2 suites cannot see.
//  - The shared L1 grid evaluates only 16 moves, none of them punching, biting, pulse, reckless, throwing or sound moves, and
//    no state has fog. Here every bound closure of the eight classes is compared with its library form over a wide move list
//    (every property, priority, power, effect chance, the moves some closures name) and over the grid plus fog, sun and grass.
//  - Proof of the proof: a deliberately wrong binding must be caught by the same comparison.
//  - AddMoveFlagAbAttr is never dispatched, so userGrantsFlag is driven for the original and the rebuilt attr.
//  - The field, user-field and ally boosters are read with getAbilityAttrs or dispatched only in doubles, so their `apply`
//    is driven for the original and the rebuilt attr over the same moves.
//  - LowHpMoveTypePowerBoostAbAttr: the two-decimal rounding of the low-HP rule, and the clause order canApply / getCondition.
//  - Parameters read back from the live instances (type, multiplier, categories, properties).
import {
  AddMoveFlagAbAttr,
  type FieldMoveTypePowerBoostAbAttr,
  type LowHpMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { Gender } from "#data/gender";
import { TerrainType } from "#data/terrain";
import { adaptCondition, recomposeAttr, readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { WeatherType } from "#enums/weather-type";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { bindingCases, type BindingCase } from "#test/tests/elite-redux/decomp/harness/differential";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { applyGridState, buildStateGrid, GRID_MOVES, type GridState, type World } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const MY_CLASSES = [
  "MoveDamageBoostAbAttr",
  "AddMoveFlagAbAttr",
  "MovePowerBoostAbAttr",
  "MoveTypePowerBoostAbAttr",
  "LowHpMoveTypePowerBoostAbAttr",
  "FieldMoveTypePowerBoostAbAttr",
  "UserFieldMoveTypePowerBoostAbAttr",
  "AllyMoveCategoryPowerBoostAbAttr",
] as const;

function sitesOf(className: string) {
  return allAttrSites().filter(site => site.className === className);
}

/** The moves of the wide comparison: every property some closure reads, priority, power, chance, variable power, named moves. */
function wideMoves(): Move[] {
  const picked = new Map<number, Move>();
  const add = (move: Move | undefined): void => {
    if (move !== undefined) {
      picked.set(move.id, move);
    }
  };
  for (const id of GRID_MOVES) {
    add(allMoves[id]);
  }
  for (const id of [33, 40, 527, 450, 237, 290, 594, 560, 805] as const) {
    add(allMoves[id]);
  }
  const all = allMoves.filter((move): move is Move => move !== undefined && move.id !== MoveId.NONE);
  for (const flag of [1, 4, 32, 64, 128, 256, 512, 134217728, 536870912]) {
    all.filter(move => move.hasFlag(flag)).slice(0, 4).forEach(add);
    all.filter(move => !move.hasFlag(flag)).slice(0, 2).forEach(add);
  }
  all.filter(move => move.hasAttr("VariablePowerAttr")).slice(0, 4).forEach(add);
  all.filter(move => move.power > 0 && move.power <= 60 && !move.hasAttr("VariablePowerAttr")).slice(0, 4).forEach(add);
  all.filter(move => move.power > 60).slice(0, 3).forEach(add);
  all.filter(move => move.chance >= 1).slice(0, 4).forEach(add);
  all.filter(move => move.chance === 0).slice(0, 2).forEach(add);
  all.filter(move => move.priority > 0).slice(0, 3).forEach(add);
  all.filter(move => move.priority < 0).slice(0, 2).forEach(add);
  all.filter(move => move.category === 2).slice(0, 4).forEach(add);
  return [...picked.values()];
}

/** The shared grid plus the weather and terrain states no shared state has. */
function wideStates(): GridState[] {
  const grid = buildStateGrid();
  const base = grid[0];
  const extra: GridState[] = [];
  for (const [label, weather] of [
    ["fog", WeatherType.FOG],
    ["eerie fog", WeatherType.EERIE_FOG],
    ["harsh sun", WeatherType.HARSH_SUN],
    ["heavy rain", WeatherType.HEAVY_RAIN],
  ] as const) {
    extra.push({ ...base, name: `${label}`, weather });
  }
  extra.push({ ...base, name: "grassy terrain, full hp", terrain: TerrainType.GRASSY });
  extra.push({ ...base, name: "fog, foe Fire", weather: WeatherType.FOG, foeTypes: [9] });
  extra.push({ ...base, name: "female holder, female foe in sun", weather: WeatherType.SUNNY, holderGender: Gender.FEMALE, foeGender: Gender.FEMALE });
  return [...grid, ...extra];
}

function compare(world: World, cases: readonly BindingCase[], moves: readonly Move[], states: readonly GridState[]) {
  const mismatches: string[] = [];
  let evaluations = 0;
  for (const state of states) {
    applyGridState(world, state);
    for (const testCase of cases) {
      for (const move of moves) {
        const original = (testCase.original as unknown as (...a: unknown[]) => boolean)(world.holder, world.foe, move);
        const library = (testCase.library as unknown as (...a: unknown[]) => boolean)(world.holder, world.foe, move);
        evaluations++;
        if (original !== library) {
          mismatches.push(`${testCase.site.abilityName} attr ${testCase.site.attrIndex} ${testCase.slot} | ${state.name} | ${move.name}: original ${original}, library ${library}`);
        }
      }
    }
  }
  return { mismatches, evaluations };
}

describe("B02 chunk 3: power and damage boosts", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every bound closure equals its library form over a wide move list and the grid plus fog, sun and grass", async () => {
    const world = await startWorld(phaserGame);
    const sites = allAttrSites().filter(site => (MY_CLASSES as readonly string[]).includes(site.className));
    const { cases, problems } = bindingCases(sites, declRegistry);
    expect(problems).toEqual([]);
    // 57 bound MovePowerBoostAbAttr closures, 3 MoveDamageBoostAbAttr, 7 AddMoveFlagAbAttr.
    expect(cases.length).toBe(67);
    const moves = wideMoves();
    expect(moves.length).toBeGreaterThan(60);
    const { mismatches, evaluations } = compare(world, cases, moves, wideStates());
    console.log(`B02_C3 wide differential: ${cases.length} bindings, ${moves.length} moves, ${evaluations} evaluations`);
    expect(mismatches.slice(0, 10)).toEqual([]);
  }, 600000);

  it("the comparison catches a wrong binding (a Biting closure bound to the Punching property)", async () => {
    const world = await startWorld(phaserGame);
    const site = allAttrSites().find(s => s.abilityName === "Strong Jaw" && s.className === "MovePowerBoostAbAttr")!;
    const original = (site.attr as unknown as { condition: unknown }).condition;
    const wrong = {
      site,
      module: declRegistry.get("MovePowerBoostAbAttr")!,
      slot: "ctor:0",
      ctx: "attack" as const,
      spec: { block: "move.flag", params: { flag: "PUNCHING_MOVE" } },
      original: original as never,
      library: adaptCondition("attack", compileCondition({ block: "move.flag", params: { flag: "PUNCHING_MOVE" } })) as never,
    } satisfies BindingCase;
    const { mismatches } = compare(world, [wrong], wideMoves(), buildStateGrid().slice(0, 3));
    expect(mismatches.length).toBeGreaterThan(0);
    // and the right one passes
    const right = { ...wrong, library: adaptCondition("attack", compileCondition(getBinding(site.abilityId, site.attrIndex, "ctor:0")!.spec!)) as never };
    expect(compare(world, [right], wideMoves(), buildStateGrid().slice(0, 3)).mismatches).toEqual([]);
  });

  it("the bound and legacy counts add up to every attr of the classes", () => {
    const counts = (className: string, slot: string) => {
      const sites = sitesOf(className);
      const bound = sites.filter(s => getBinding(s.abilityId, s.attrIndex, slot)?.spec !== undefined).length;
      const legacy = sites.filter(s => getBinding(s.abilityId, s.attrIndex, slot)?.legacyClosure !== undefined).length;
      return { total: sites.length, bound, legacy };
    };
    console.log(`B02_C3 counts MovePowerBoost ${JSON.stringify(counts("MovePowerBoostAbAttr", "ctor:0"))}`);
    expect(counts("MovePowerBoostAbAttr", "ctor:0")).toEqual({ total: 109, bound: 57, legacy: 52 });
    expect(counts("MoveDamageBoostAbAttr", "ctor:1")).toEqual({ total: 4, bound: 3, legacy: 1 });
    expect(counts("AddMoveFlagAbAttr", "ctor:1")).toEqual({ total: 7, bound: 7, legacy: 0 });
    expect(counts("LowHpMoveTypePowerBoostAbAttr", "ctor:2")).toEqual({ total: 5, bound: 0, legacy: 5 });
  });

  it("the settings read back from the live attrs are the ones of the abilities", () => {
    const read = (className: string, abilityName: string, index?: number) => {
      const site = sitesOf(className).find(s => s.abilityName === abilityName && (index === undefined || s.attrIndex === index))!;
      expect(site, `${abilityName} ${className}`).toBeDefined();
      return readDeclParams(declRegistry.get(className)!, site.attr);
    };
    expect(read("MoveTypePowerBoostAbAttr", "Transistor")).toEqual({ type: "ELECTRIC", multiplier: 1.5 });
    expect(read("MoveTypePowerBoostAbAttr", "Water Bubble")).toEqual({ type: "WATER", multiplier: 2 });
    expect(read("LowHpMoveTypePowerBoostAbAttr", "Blaze")).toEqual({ type: "FIRE", multiplier: 1.5 });
    expect(read("LowHpMoveTypePowerBoostAbAttr", "Overgrow")).toEqual({ type: "GRASS", multiplier: 1.5 });
    expect(read("LowHpMoveTypePowerBoostAbAttr", "Torrent")).toEqual({ type: "WATER", multiplier: 1.5 });
    expect(read("LowHpMoveTypePowerBoostAbAttr", "Swarm")).toEqual({ type: "BUG", multiplier: 1.5 });
    expect(read("FieldMoveTypePowerBoostAbAttr", "Dark Aura")).toMatchObject({ type: "DARK" });
    expect(read("FieldMoveTypePowerBoostAbAttr", "Fairy Aura")).toMatchObject({ type: "FAIRY" });
    expect(read("UserFieldMoveTypePowerBoostAbAttr", "Steely Spirit")).toEqual({ type: "STEEL", multiplier: 1.3 });
    expect(read("AllyMoveCategoryPowerBoostAbAttr", "Battery")).toEqual({ categories: "SPECIAL", multiplier: 1.3 });
    expect(read("MoveDamageBoostAbAttr", "Parental Bond")).toEqual({ multiplier: 0.25 });
    expect(read("AddMoveFlagAbAttr", "Brawling Wyvern")).toEqual({ flags: "PUNCHING_MOVE" });
    expect(read("AddMoveFlagAbAttr", "Mixed Martial Arts")).toEqual({ flags: "PUNCHING_MOVE,KICKING_MOVE" });
    // every attr of every class yields every declared setting
    for (const className of MY_CLASSES) {
      const module = declRegistry.get(className)!;
      for (const site of sitesOf(className)) {
        const values = readDeclParams(module, site.attr);
        for (const param of module.decl.params) {
          expect(values[param.id], `${site.abilityName} ${className} ${param.id}`).toBeDefined();
        }
      }
    }
  });

  it("AddMoveFlagAbAttr: userGrantsFlag answers the same for the original and the rebuilt attr of every user", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("AddMoveFlagAbAttr")!;
    const moves = wideMoves();
    const flags = [1, 4, 32, 64, 128, 256, 512, 134217728, 536870912] as MoveFlags[];
    let granted = 0;
    for (const site of sitesOf("AddMoveFlagAbAttr")) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      for (const move of moves) {
        for (const flag of flags) {
          const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs");
          spy.mockReturnValue([site.attr]);
          const before = AddMoveFlagAbAttr.userGrantsFlag(holder, move, flag);
          spy.mockReturnValue([rebuilt]);
          const after = AddMoveFlagAbAttr.userGrantsFlag(holder, move, flag);
          spy.mockRestore();
          expect(after, `${site.abilityName} ${move.name} ${MoveFlags[flag]}`).toBe(before);
          if (before) {
            granted++;
          }
        }
      }
    }
    expect(foe).toBeDefined();
    console.log(`B02_C3 userGrantsFlag granted ${granted} (move, flag) pairs for the 7 users`);
    expect(granted).toBeGreaterThan(20);
  });

  it("the boosters that need a field scan or doubles: apply gives the same power for the original and the rebuilt attr", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const moves = wideMoves();
    let checked = 0;
    let boosted = 0;
    for (const className of [
      "FieldMoveTypePowerBoostAbAttr",
      "UserFieldMoveTypePowerBoostAbAttr",
      "AllyMoveCategoryPowerBoostAbAttr",
      "MoveTypePowerBoostAbAttr",
    ]) {
      const module = declRegistry.get(className)!;
      for (const site of sitesOf(className)) {
        const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as unknown as FieldMoveTypePowerBoostAbAttr;
        const original = site.attr as unknown as FieldMoveTypePowerBoostAbAttr;
        for (const move of moves) {
          const run = (attr: FieldMoveTypePowerBoostAbAttr) => {
            const power = new NumberHolder(move.power > 0 ? move.power : 50);
            const params = { pokemon: holder, opponent: foe, move, power, simulated: true };
            const can = attr.canApply(params);
            attr.apply(params);
            return { can, power: power.value };
          };
          const before = run(original);
          const after = run(rebuilt);
          expect(after, `${site.abilityName} (${className}) ${move.name}`).toEqual(before);
          checked++;
          if (before.power !== (move.power > 0 ? move.power : 50)) {
            boosted++;
          }
        }
        expect(readDeclParams(module, rebuilt as never)).toEqual(readDeclParams(module, original as never));
      }
    }
    console.log(`B02_C3 apply drive: ${checked} (attr, move) pairs, ${boosted} of them boosted`);
    expect(boosted).toBeGreaterThan(50);
    // ally categories: same list back
    // the closure of a rebuilt ally booster accepts exactly the categories of the original
    for (const site of sitesOf("AllyMoveCategoryPowerBoostAbAttr")) {
      const module = declRegistry.get("AllyMoveCategoryPowerBoostAbAttr")!;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      expect(readDeclParams(module, rebuilt)).toEqual(readDeclParams(module, site.attr));
      for (const category of [0, 1, 2]) {
        const accepts = (attr: unknown) => (attr as { condition: (...a: unknown[]) => boolean }).condition(undefined, undefined, { category });
        expect(accepts(rebuilt)).toBe(accepts(site.attr));
      }
    }
  });

  it("LowHpMoveTypePowerBoostAbAttr: the low-HP rule rounds the ratio to two decimals, and a rebuild keeps it", async () => {
    const world = await startWorld(phaserGame);
    const module = declRegistry.get("LowHpMoveTypePowerBoostAbAttr")!;
    const lines: string[] = [];
    for (const site of sitesOf("LowHpMoveTypePowerBoostAbAttr")) {
      const original = site.attr as unknown as LowHpMoveTypePowerBoostAbAttr;
      // the legacy closure rebuilds with the original closure passed through, so the setting wiring is what is proven
      const closure = (original as unknown as { lowHpCondition: unknown }).lowHpCondition;
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
        conds: { "ctor:2": closure as never },
      }) as unknown as LowHpMoveTypePowerBoostAbAttr;
      let atBoundary = 0;
      for (const maxHp of [100, 101, 297, 300, 1000]) {
        for (let hp = 1; hp <= maxHp; hp++) {
          world.holder.stats[0] = maxHp;
          world.holder.hp = hp;
          const reference = Math.round((hp / maxHp) * 100) / 100 <= 0.33;
          const before = original.getCondition()!(world.holder);
          const after = rebuilt.getCondition()!(world.holder);
          expect(before, `${site.abilityName} ${hp}/${maxHp}`).toBe(reference);
          expect(after).toBe(reference);
          if (hp * 200 === 67 * maxHp) {
            atBoundary++;
          }
        }
      }
      lines.push(`${site.abilityName}: exact ties at 33.5% seen ${atBoundary}`);
      const params = { pokemon: world.holder, opponent: world.foe, move: allMoves[MoveId.TACKLE], power: new NumberHolder(40), simulated: true };
      expect(rebuilt.canApply(params)).toBe(original.canApply(params));
    }
    console.log(`B02_C3 low hp: ${lines.join("; ")}`);
  }, 120000);

  it("the hit and the setting 33.4% versus 33.5%: 100 max HP, 33 HP is low and 34 HP is not", async () => {
    const world = await startWorld(phaserGame);
    const site = sitesOf("LowHpMoveTypePowerBoostAbAttr").find(s => s.abilityName === "Blaze")!;
    const condition = (site.attr as unknown as LowHpMoveTypePowerBoostAbAttr).getCondition()!;
    world.holder.stats[0] = 100;
    world.holder.hp = 33;
    expect(condition(world.holder)).toBe(true);
    world.holder.hp = 34;
    expect(condition(world.holder)).toBe(false);
    // 1000 max HP: 334 HP is 33.4% and still low (rounds to 0.33), 335 HP is 33.5% and is not (rounds to 0.34)
    world.holder.stats[0] = 1000;
    world.holder.hp = 334;
    expect(condition(world.holder)).toBe(true);
    world.holder.hp = 335;
    expect(condition(world.holder)).toBe(false);
  });
});
