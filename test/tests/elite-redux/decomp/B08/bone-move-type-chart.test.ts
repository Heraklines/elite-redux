/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 1, BoneMoveTypeChartAbAttr (live declaration, trigger calc.my-attack-matchup).
// The class is read by a by-name scan in the type effectiveness calculation, so the shared L1 and L2 tests cannot see
// it. Both live users (Bone Zone, Cranisphere) are rebuilt from the live declaration and compared with the original
// on `fire(move, multiplier)` for bone and non-bone moves and the multipliers 0, 0.25, 0.5, 1, 2 and 4.
import { allMoves } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { normalizeBindingSpec } from "#data/elite-redux/ability-studio/bindings";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { BoneMoveTypeChartAbAttr } from "#data/elite-redux/archetypes/bone-move-type-chart";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const module = declRegistry.get("BoneMoveTypeChartAbAttr") as DeclModule;

describe("B08: bone moves and the type chart (BoneMoveTypeChartAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  const sitesOf = () => allAttrSites().filter(site => site.className === "BoneMoveTypeChartAbAttr");

  it("has the two live users and three editable params", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf();
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Bone Zone", "Cranisphere"]);
    expect(module.decl.params.map(param => param.id)).toEqual(["flag", "immuneBecomes", "resistedFactor"]);
  });

  it("the rebuild equals the original for every multiplier and for bone and non-bone moves, and matches the documented rule", async () => {
    const world = await startWorld(phaserGame);
    const sites = sitesOf();
    const boneMoves = [MoveId.BONEMERANG, MoveId.BONE_RUSH, MoveId.BONE_CLUB];
    const otherMoves = [MoveId.TACKLE, MoveId.EARTHQUAKE, MoveId.SHADOW_BALL, MoveId.WATER_GUN];
    for (const id of boneMoves) {
      expect(allMoves[id].hasFlag(MoveFlags.BONE_BASED), `${MoveId[id]} is a bone move`).toBe(true);
    }
    for (const id of otherMoves) {
      expect(allMoves[id].hasFlag(MoveFlags.BONE_BASED), `${MoveId[id]} is not a bone move`).toBe(false);
    }
    let changed = 0;
    let unchanged = 0;
    for (const site of sites) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as unknown as BoneMoveTypeChartAbAttr;
      expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site.attr));
      const original = site.attr as unknown as BoneMoveTypeChartAbAttr;
      for (const id of [...boneMoves, ...otherMoves]) {
        for (const multiplier of [0, 0.25, 0.5, 1, 2, 4]) {
          const a = new NumberHolder(multiplier);
          const b = new NumberHolder(multiplier);
          original.fire(allMoves[id], a, world.holder);
          rebuilt.fire(allMoves[id], b, world.holder);
          expect(b.value, `${site.abilityName}: ${MoveId[id]} at x${multiplier}`).toBe(a.value);
          const isBone = boneMoves.includes(id);
          const expected = isBone ? (multiplier === 0 ? 1 : multiplier < 1 ? multiplier * 2 : multiplier) : multiplier;
          expect(a.value).toBe(expected);
          if (a.value === multiplier) {
            unchanged++;
          } else {
            changed++;
          }
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(unchanged).toBeGreaterThan(0);
  });

  it("the bone property is an IF of the gate: another property moves it, an always-true gate drops it", async () => {
    const world = await startWorld(phaserGame);
    const site = sitesOf()[0];
    const fire = (attr: BoneMoveTypeChartAbAttr, move: MoveId, multiplier: number): number => {
      const holder = new NumberHolder(multiplier);
      attr.fire(allMoves[move], holder, world.holder);
      return holder.value;
    };
    // A different property through the param: the gate follows it (gateParams), so biting moves are rewritten and bone moves are not.
    const biting = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      params: { flag: "BITING_MOVE" },
    }) as unknown as BoneMoveTypeChartAbAttr;
    expect(fire(biting, MoveId.BITE, 0)).toBe(1);
    expect(fire(biting, MoveId.BONEMERANG, 0)).toBe(0);
    // The property IF removed: every move is rewritten (the class's own `flag` is replaced by the gate).
    const noFilter = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      conds: { gate: normalizeBindingSpec({ all: [] }) },
    }) as unknown as BoneMoveTypeChartAbAttr;
    expect(fire(noFilter, MoveId.TACKLE, 0.5)).toBe(1);
    // The numbers are the effect's params.
    const stronger = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      params: { resistedFactor: 4, immuneBecomes: 0.5 },
    }) as unknown as BoneMoveTypeChartAbAttr;
    expect(fire(stronger, MoveId.BONEMERANG, 0.25)).toBe(1);
    expect(fire(stronger, MoveId.BONEMERANG, 0)).toBe(0.5);
  });
});
