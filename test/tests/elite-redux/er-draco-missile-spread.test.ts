/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): "Draco Missile's description says it hits both foes but it
// only targets one." The ER move (id 807) has a half-finished dex entry - its
// short description literally reads "Not done yet." and its `target` field is 0
// (single) - but the authoritative longDescription says "Hits both foes on the
// field." Per the dex-text-wins rule, it must be a both-foes spread move.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { MoveTarget } from "#enums/move-target";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

// ER move id 807 = Draco Missile (MOVE_DRAKE_MISSILE), resolved to its pokerogue id.
const DRACO_MISSILE_ER_ID = 807;

describe("ER Draco Missile — hits both foes", () => {
  beforeAll(() => {
    // Boots init (allMoves built with the ER custom-move riders). No battle.
    void new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
  });

  it("targets ALL_NEAR_ENEMIES, not a single foe", () => {
    const pkId = ER_ID_MAP.moves[DRACO_MISSILE_ER_ID];
    expect(pkId, "Draco Missile must be in the ER id map").toBeDefined();
    const move = allMoves[pkId];
    expect(move, "Draco Missile must exist in allMoves").toBeDefined();
    expect(move.moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });
});
