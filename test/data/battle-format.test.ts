/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Pure unit test for the multi-format battle ARRANGEMENT model. No game boot - runs
// in normal CI. Locks the two invariants the whole migration depends on:
//   (1) single/double reproduce TODAY's exact flat indices (enemy base == 2), and
//       in binary every pair is mutually adjacent (targeting identical to legacy).
//   (2) triple positional adjacency is a non-mirrored face-off: the center reaches
//       all 3 foes; a wing reaches the foe IN FRONT of it + center but NOT the far
//       diagonal; allied wings are not adjacent to each other.

import {
  createArrangement,
  DOUBLE_FORMAT,
  fieldSpriteOffset,
  formatById,
  legacyFormat,
  SINGLE_FORMAT,
  SideKind,
  TRIPLE_BATTLE_GHOST_RARITY,
  TRIPLE_BATTLE_RARITY,
  TRIPLE_FORMAT,
} from "#data/battle-format";
import { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";
import { describe, expect, it } from "vitest";

const arrFor = (f: typeof SINGLE_FORMAT) => createArrangement(f);
/** adjacency by flat index pair */
const adj = (a: ReturnType<typeof arrFor>, x: number, y: number) => a.isAdjacent(a.locate(x), a.locate(y));

describe("battle-format: legacy single/double are byte-identical to today", () => {
  it("single: player@0, enemy@2 (== BattlerIndex.ENEMY)", () => {
    const a = arrFor(SINGLE_FORMAT);
    expect(a.sideOffset(0)).toBe(0);
    expect(a.sideOffset(1)).toBe(BattlerIndex.ENEMY);
    expect(a.activeIndices()).toEqual([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    expect(a.ownerOf(BattlerIndex.PLAYER)).toBe(SideKind.PLAYER);
    expect(a.ownerOf(BattlerIndex.ENEMY)).toBe(SideKind.ENEMY);
    expect(a.playerCapacity).toBe(1);
    expect(a.enemyCapacity).toBe(1);
  });

  it("double: player@0,1 enemy@2,3 - identical legacy indices", () => {
    const a = arrFor(DOUBLE_FORMAT);
    expect(a.activeIndices()).toEqual([
      BattlerIndex.PLAYER,
      BattlerIndex.PLAYER_2,
      BattlerIndex.ENEMY,
      BattlerIndex.ENEMY_2,
    ]);
    expect(a.indexOf({ side: 1, position: 0 })).toBe(BattlerIndex.ENEMY);
    expect(a.indexOf({ side: 1, position: 1 })).toBe(BattlerIndex.ENEMY_2);
    expect(a.locate(BattlerIndex.ENEMY_2)).toEqual({ side: 1, position: 1 });
    expect(a.playerCapacity).toBe(2);
  });

  it("double: allies + adjacency match legacy (everyone mutually adjacent)", () => {
    const a = arrFor(DOUBLE_FORMAT);
    expect(a.areAllies(BattlerIndex.PLAYER, BattlerIndex.PLAYER_2)).toBe(true);
    expect(a.areAllies(BattlerIndex.ENEMY, BattlerIndex.ENEMY_2)).toBe(true);
    expect(a.areAllies(BattlerIndex.PLAYER, BattlerIndex.ENEMY)).toBe(false);
    expect(a.areAllies(BattlerIndex.ATTACKER, BattlerIndex.PLAYER)).toBe(false);
    // every cross + same-side pair is adjacent in doubles (no positional restriction)
    for (const x of [0, 1, 2, 3]) {
      for (const y of [0, 1, 2, 3]) {
        if (x !== y) {
          expect(adj(a, x, y), `double ${x}<->${y} should be adjacent`).toBe(true);
        }
      }
    }
  });

  it("single: the lone pair is adjacent", () => {
    const a = arrFor(SINGLE_FORMAT);
    expect(adj(a, BattlerIndex.PLAYER, BattlerIndex.ENEMY)).toBe(true);
  });
});

describe("battle-format: triple positional adjacency (mainline rule)", () => {
  const a = arrFor(TRIPLE_FORMAT);
  // layout: player 0,1,2 (base 0); enemy 3,4,5 (base 3). pos0=left,1=center,2=right.

  it("indices: player@0-2, enemy@3-5", () => {
    expect(a.activeIndices()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(a.sideOffset(1)).toBe(BattlerIndex.ENEMY + 1); // enemy base shifts to 3
    expect(a.locate(3)).toEqual({ side: 1, position: 0 });
    expect(a.ownerOf(5)).toBe(SideKind.ENEMY);
    expect(a.enemyCapacity).toBe(3);
  });

  it("allies: same side allied, cross side not", () => {
    expect(a.areAllies(0, 1)).toBe(true);
    expect(a.areAllies(0, 2)).toBe(true);
    expect(a.areAllies(3, 5)).toBe(true);
    expect(a.areAllies(0, 3)).toBe(false);
  });

  it("center reaches all three foes", () => {
    expect(adj(a, 1, 3)).toBe(true);
    expect(adj(a, 1, 4)).toBe(true);
    expect(adj(a, 1, 5)).toBe(true);
  });

  it("player-left (0) reaches the foe IN FRONT (enemy-left @3) + center, NOT the far diagonal (@5)", () => {
    expect(adj(a, 0, 3)).toBe(true); // enemy-left - the foe directly in front (non-mirrored face-off)
    expect(adj(a, 0, 4)).toBe(true); // enemy center
    expect(adj(a, 0, 5)).toBe(false); // far diagonal - unreachable
  });

  it("player-right (2) reaches the foe IN FRONT (enemy-right @5) + center, NOT the far diagonal (@3)", () => {
    expect(adj(a, 2, 5)).toBe(true); // enemy-right - the foe directly in front
    expect(adj(a, 2, 4)).toBe(true);
    expect(adj(a, 2, 3)).toBe(false); // far diagonal - unreachable
  });

  it("enemy center (4) reaches all three player mons", () => {
    expect(adj(a, 4, 0)).toBe(true);
    expect(adj(a, 4, 1)).toBe(true);
    expect(adj(a, 4, 2)).toBe(true);
  });

  it("allied wings are NOT adjacent to each other; neighbours are", () => {
    expect(adj(a, 0, 2)).toBe(false); // left + right ally
    expect(adj(a, 0, 1)).toBe(true); // left + center ally
    expect(adj(a, 1, 2)).toBe(true); // center + right ally
  });
});

describe("battle-format: lookups", () => {
  it("legacyFormat maps the double boolean", () => {
    expect(legacyFormat(false)).toBe(SINGLE_FORMAT);
    expect(legacyFormat(true)).toBe(DOUBLE_FORMAT);
  });
  it("formatById resolves known ids, null otherwise", () => {
    expect(formatById("single")).toBe(SINGLE_FORMAT);
    expect(formatById("double")).toBe(DOUBLE_FORMAT);
    expect(formatById("triple")).toBe(TRIPLE_FORMAT);
    expect(formatById("quad")).toBeNull();
    expect(formatById(null)).toBeNull();
  });

  it("pins natural triples to 20% of ghosts and 5% of wild/trainer battles", () => {
    expect(1 / TRIPLE_BATTLE_GHOST_RARITY).toBe(0.2);
    expect(1 / TRIPLE_BATTLE_RARITY).toBe(0.05);
  });
});

describe("battle-format sprite offsets", () => {
  it("raises the left triple lane without moving the right or center lanes", () => {
    expect(fieldSpriteOffset(FieldPosition.LEFT, 3, true)).toEqual([-58, -4]);
    expect(fieldSpriteOffset(FieldPosition.RIGHT, 3, true)).toEqual([58, 4]);

    expect(fieldSpriteOffset(FieldPosition.LEFT, 3, false)).toEqual([-58, 2]);
    expect(fieldSpriteOffset(FieldPosition.RIGHT, 3, false)).toEqual([58, 10]);
    expect(fieldSpriteOffset(FieldPosition.CENTER, 3, true)).toEqual([0, -8]);
    expect(fieldSpriteOffset(FieldPosition.CENTER, 3, false)).toEqual([0, -8]);
  });

  it("leaves the legacy single/double layout side-independent", () => {
    for (const playerSide of [false, true]) {
      expect(fieldSpriteOffset(FieldPosition.CENTER, 1, playerSide)).toEqual([0, 0]);
      expect(fieldSpriteOffset(FieldPosition.LEFT, 2, playerSide)).toEqual([-32, -8]);
      expect(fieldSpriteOffset(FieldPosition.RIGHT, 2, playerSide)).toEqual([32, 0]);
    }
  });
});
