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
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
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

  it("has the two live users and no params to read back", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf();
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Bone Zone", "Cranisphere"]);
    expect(module.decl.params).toHaveLength(0);
  });

  it("the rebuild equals the original for every multiplier and for bone and non-bone moves, and matches the documented rule", async () => {
    await startWorld(phaserGame);
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
      const rebuilt = buildAttr(module, {}) as unknown as BoneMoveTypeChartAbAttr;
      expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site.attr));
      const original = site.attr as unknown as BoneMoveTypeChartAbAttr;
      for (const id of [...boneMoves, ...otherMoves]) {
        for (const multiplier of [0, 0.25, 0.5, 1, 2, 4]) {
          const a = new NumberHolder(multiplier);
          const b = new NumberHolder(multiplier);
          original.fire(allMoves[id], a);
          rebuilt.fire(allMoves[id], b);
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
});
