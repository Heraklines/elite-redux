/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 1, OffensiveTypeChartOverrideAbAttr (trigger calc.my-type-chart-override).
// The class is read by a by-name scan in Pokemon.getAttackTypeEffectiveness, so the shared L1 and L2 tests cannot see its
// behaviour. Every live user is rebuilt from the live declaration and compared with the original on `fire()` for every attack
// type against every single and dual defender typing (including the same type twice), and the rule is checked against the
// documented numbers (Ground Shock, Molten Down, Corrosion, the Psychic breaker with three rules).
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { getTypeDamageMultiplier } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const module = declRegistry.get("OffensiveTypeChartOverrideAbAttr") as DeclModule;
const REAL_TYPES = (Object.values(PokemonType) as unknown[]).filter(
  (value): value is PokemonType => typeof value === "number" && value >= 0 && value !== PokemonType.STELLAR,
);

/** What the engine hands `fire`: the natural product over the defender's types, immunities included. */
function natural(moveType: PokemonType, defenders: readonly PokemonType[]): number {
  let multi = 1;
  for (const defender of defenders) {
    multi *= getTypeDamageMultiplier(moveType, defender);
  }
  return multi;
}

function typings(): PokemonType[][] {
  const list: PokemonType[][] = REAL_TYPES.map(type => [type]);
  for (let i = 0; i < REAL_TYPES.length; i++) {
    for (let j = i; j < REAL_TYPES.length; j++) {
      list.push([REAL_TYPES[i], REAL_TYPES[j]]);
    }
  }
  return list;
}

function fireOn(
  attr: OffensiveTypeChartOverrideAbAttr,
  moveType: PokemonType,
  defenders: readonly PokemonType[],
): number {
  const multi = new NumberHolder(natural(moveType, defenders));
  attr.fire(moveType, defenders, multi);
  return multi.value;
}

describe("B10: offensive type chart override (OffensiveTypeChartOverrideAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  const sitesOf = () => allAttrSites().filter(site => site.className === "OffensiveTypeChartOverrideAbAttr");

  it("has the live users and separate settings for my type, the target types and the multiplier", async () => {
    await startWorld(phaserGame);
    const names = new Set(sitesOf().map(site => site.abilityName));
    for (const name of ["Ground Shock", "Molten Down", "Corrosion", "Draconic Might", "Draconize", "Trash Heap"]) {
      expect(names.has(name), `${name} is a live user`).toBe(true);
    }
    expect(module.decl.params.map(param => param.id)).toEqual([
      "attackType",
      "targetType",
      "targetType2",
      "targetType3",
      "multiplier",
    ]);
    expect(module.decl.params.some(param => param.control === "text")).toBe(false);
  });

  it("the rebuild equals the original for every attack type against every single and dual typing", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf();
    expect(sites.length).toBeGreaterThanOrEqual(17);
    const grid = typings();
    let changed = 0;
    for (const site of sites) {
      const original = site.attr as unknown as OffensiveTypeChartOverrideAbAttr;
      const rebuilt = recomposeAttr(
        module,
        site.attr,
        site.abilityId,
        site.attrIndex,
      ) as unknown as OffensiveTypeChartOverrideAbAttr;
      expect(rebuilt).not.toBe(original);
      expect(attrFingerprint(rebuilt as never), `${site.abilityName}: fingerprint`).toEqual(
        attrFingerprint(original as never),
      );
      for (const moveType of REAL_TYPES) {
        for (const defenders of grid) {
          const a = fireOn(original, moveType, defenders);
          const b = fireOn(rebuilt, moveType, defenders);
          expect(
            b,
            `${site.abilityName}: ${PokemonType[moveType]} vs ${defenders.map(t => PokemonType[t]).join("/")}`,
          ).toBe(a);
          if (a !== natural(moveType, defenders)) {
            changed++;
          }
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("matches the documented rule: only the matched type's part is replaced, an immunity is recomputed", async () => {
    await startWorld(phaserGame);
    const attrOf = (name: string): OffensiveTypeChartOverrideAbAttr => {
      const site = sitesOf().find(candidate => candidate.abilityName === name);
      expect(site, name).toBeDefined();
      return site!.attr as unknown as OffensiveTypeChartOverrideAbAttr;
    };
    // Ground Shock: Electric vs Ground goes from immune (0) to 0.5
    expect(fireOn(attrOf("Ground Shock"), PokemonType.ELECTRIC, [PokemonType.GROUND])).toBe(0.5);
    // and a second type still counts: Electric vs Ground/Water = 0.5 * 2
    expect(fireOn(attrOf("Ground Shock"), PokemonType.ELECTRIC, [PokemonType.GROUND, PokemonType.WATER])).toBe(1);
    // Molten Down: Fire vs Rock 0.5 -> 2, but Water/Rock stays neutral (0.5 x 2)
    expect(fireOn(attrOf("Molten Down"), PokemonType.FIRE, [PokemonType.ROCK])).toBe(2);
    expect(fireOn(attrOf("Molten Down"), PokemonType.FIRE, [PokemonType.WATER, PokemonType.ROCK])).toBe(1);
    // a move of another type is left alone
    expect(fireOn(attrOf("Molten Down"), PokemonType.WATER, [PokemonType.ROCK])).toBe(2);
    // Corrosion: Poison vs Steel goes from immune to 2
    expect(fireOn(attrOf("Corrosion"), PokemonType.POISON, [PokemonType.STEEL])).toBe(2);
  });

  it("the settings read back from every live rule list, build the same rules, and refuse an empty target", async () => {
    await startWorld(phaserGame);
    for (const site of sitesOf()) {
      const rules = (site.attr as unknown as { getRules(): unknown }).getRules();
      const params = readDeclParams(module, site.attr);
      expect(Object.keys(params).sort(), site.abilityName).toEqual(
        ["attackType", "multiplier", "targetType", "targetType2", "targetType3"].sort(),
      );
      const rebuilt = buildAttr(module, params) as unknown as OffensiveTypeChartOverrideAbAttr;
      expect(rebuilt.getRules(), site.abilityName).toEqual(rules);
    }
    const corrupted = sitesOf().find(site => site.abilityName === "Corrupted Mind") as never as { attr: never };
    expect(readDeclParams(module, corrupted.attr)).toMatchObject({
      attackType: "PSYCHIC",
      targetType: "STEEL",
      targetType2: "PSYCHIC",
      targetType3: "DARK",
      multiplier: 1,
    });
    const built = buildAttr(module, {
      attackType: "FIRE",
      targetType: "ROCK",
      multiplier: 0.5,
    }) as unknown as OffensiveTypeChartOverrideAbAttr;
    expect(built.getRules()).toEqual([
      { attackType: PokemonType.FIRE, defenderType: PokemonType.ROCK, newMultiplier: 0.5 },
    ]);
    expect(() => buildAttr(module, { attackType: "FIRE", targetType: "NONE", multiplier: 2 })).toThrow();
    expect(() => buildAttr(module, { attackType: "FIRE", targetType: "ROCK", multiplier: 9 })).toThrow();
  });
});
