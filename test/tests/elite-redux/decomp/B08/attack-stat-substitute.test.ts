/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 1, AttackStatSubstituteAbAttr (live declaration, trigger calc.attack-stat).
// The class is read by a duck-typed scan in the damage formula, so the shared L1 and L2 tests cannot see it. Here
// every one of its 15 live users is rebuilt from the live declaration (`buildAttr` with the params read back from
// the live instance) and compared with the original: the read-back values, the structural fingerprint and the answer
// of `resolveStat` for physical and special moves, with Attack above, equal to and below Sp. Atk.
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const module = declRegistry.get("AttackStatSubstituteAbAttr") as DeclModule;

describe("B08: attack stat substitution (AttackStatSubstituteAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const sitesOf = () => allAttrSites().filter(site => site.className === "AttackStatSubstituteAbAttr");

  it("covers the 15 live users", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf();
    expect(sites).toHaveLength(15);
  });

  it("every user reads back, rebuilds to an identical attr, and answers resolveStat like the original", async () => {
    const world = await startWorld(phaserGame);
    const sites = sitesOf();
    const probeMoves = new Set<MoveId>([
      MoveId.TACKLE,
      MoveId.BITE,
      MoveId.MACH_PUNCH,
      MoveId.HORN_ATTACK,
      MoveId.WATER_GUN,
      MoveId.SURF,
      MoveId.PSYCHIC,
      MoveId.SPLASH,
    ]);
    for (const site of sites) {
      const attr = site.attr as unknown as { flag?: number; moveIds?: readonly MoveId[] };
      for (const id of attr.moveIds ?? []) {
        probeMoves.add(id);
      }
      if (attr.flag !== undefined) {
        const withFlag = allMoves.filter(move => move !== undefined && move.hasFlag(attr.flag as number));
        for (const move of withFlag.slice(0, 3)) {
          probeMoves.add(move.id);
        }
      }
    }
    const statOrders: readonly (readonly [atk: number, spatk: number])[] = [
      [200, 100],
      [150, 150],
      [100, 200],
    ];
    let substitutions = 0;
    let none = 0;
    for (const site of sites) {
      const params = readDeclParams(module, site.attr);
      // Every declared param must be readable from the live instance, or the rebuild would silently use a default.
      expect(Object.keys(params).sort(), `${site.abilityName}: params read back`).toEqual(
        module.decl.params.map(param => param.id).sort(),
      );
      const rebuilt = buildAttr(module, params) as unknown as AttackStatSubstituteAbAttr;
      expect(attrFingerprint(rebuilt as never), `${site.abilityName}: fingerprint`).toEqual(attrFingerprint(site.attr));
      expect(readDeclParams(module, rebuilt as never), `${site.abilityName}: read back after the rebuild`).toEqual(
        params,
      );
      const original = site.attr as unknown as AttackStatSubstituteAbAttr;
      for (const [atk, spatk] of statOrders) {
        world.holder.stats[Stat.ATK] = atk;
        world.holder.stats[Stat.SPATK] = spatk;
        for (const id of probeMoves) {
          for (const isPhysical of [true, false]) {
            const a = original.resolveStat(allMoves[id], isPhysical, world.holder);
            const b = rebuilt.resolveStat(allMoves[id], isPhysical, world.holder);
            expect(b, `${site.abilityName}: ${MoveId[id]}, physical ${isPhysical}, Atk ${atk} / Sp. Atk ${spatk}`).toBe(
              a,
            );
            if (a === null) {
              none++;
            } else {
              substitutions++;
            }
          }
        }
      }
    }
    // Both answers (a stat and "no substitution") must have been seen, or the comparison would be vacuous.
    expect(substitutions).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
  });

  it("the settings reach the compiled attr: higher and lower offense cannot both be on", () => {
    expect(() => buildAttr(module, { useHigherOffense: true, useLowerOffense: true })).toThrow();
    const defender = buildAttr(module, {
      physicalStat: "DEF",
      specialStat: "SPDEF",
    }) as unknown as AttackStatSubstituteAbAttr;
    expect(defender).toBeDefined();
  });
});
