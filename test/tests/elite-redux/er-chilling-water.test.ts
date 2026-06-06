/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Repro for "Chilling Water lowers Attack (vanilla) instead of inflicting
// Frostbite (ER)". ER move 847 shares the vanilla name, so the c-source
// name-remap pins it to vanilla CHILLING_WATER (guaranteed Attack drop). The
// vanilla-move-patch now drops that StatStageChangeAttr and grafts a 30%
// ER_FROSTBITE secondary. Gated behind ER_SCENARIO=1.

import { allMoves } from "#data/data-lists";
import { AddBattlerTagAttr } from "#data/moves/move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Chilling Water (Frostbite, not Attack drop)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Construct a GameManager once to trigger ER init side effects.
    void new GameManager(phaserGame);
  });

  it("inflicts 30% Frostbite and no longer drops Attack", () => {
    const move = allMoves[MoveId.CHILLING_WATER];
    const attrNames = move.attrs.map(a => a.constructor.name);
    // The vanilla guaranteed Attack drop is gone.
    expect(attrNames).not.toContain("StatStageChangeAttr");
    // A 30% ER_FROSTBITE secondary is grafted (gated by move.chance).
    expect(move.chance).toBe(30);
    const frostbiteAttr = move.attrs.find(
      a => a instanceof AddBattlerTagAttr && (a as AddBattlerTagAttr).tagType === BattlerTagType.ER_FROSTBITE,
    );
    expect(frostbiteAttr).toBeDefined();
  });
});
