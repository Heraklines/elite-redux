/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Data layer for the fight-menu move-detail panel (er-move-details.ts). The
// panel only renders what this derives, so its correctness IS the feature's
// faithfulness. Verifies the derived rows against known moves' real wiring.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { getErMoveDetailPages } from "#data/elite-redux/er-move-details";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

function rowMap(moveId: MoveId): Record<string, string> {
  const pages = getErMoveDetailPages(allMoves[moveId]);
  const out: Record<string, string> = {};
  for (const page of pages) {
    for (const row of page.rows ?? []) {
      out[row.label] = row.value;
    }
  }
  return out;
}

describe("ER move-detail derivation", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Boot so allMoves is fully populated (incl. ER wiring).
    void new GameManager(phaserGame);
  });

  it("always returns 4 pages, the first being the description", () => {
    const pages = getErMoveDetailPages(allMoves[MoveId.TACKLE]);
    expect(pages).toHaveLength(4);
    expect(pages[0].description).toBeDefined();
    expect(pages[1].rows?.length).toBeGreaterThan(0);
  });

  it("a contact move with no secondary (Tackle)", () => {
    const r = rowMap(MoveId.TACKLE);
    expect(r.Contact).toBe("Yes");
    expect(r.Effect).toBe("—");
    expect(r.Chance).toBe("—");
    expect(r.Priority).toBe("0");
    expect(r["Sheer Force"]).toBe("No");
  });

  it("a flinch move reports its secondary + chance + Sheer Force (Air Slash)", () => {
    const r = rowMap(MoveId.AIR_SLASH);
    expect(r.Effect).toBe("Flinch");
    expect(r.Chance).toBe("30%");
    expect(r.Contact).toBe("No");
    expect(r["Sheer Force"]).toBe("Yes");
  });

  it("a priority move reports its REAL (ER-adjusted) priority (Quick Attack is +2 in ER)", () => {
    // Proves the panel reflects ground-truth wiring, not vanilla values: ER
    // rebalances Quick Attack from +1 to +2.
    expect(rowMap(MoveId.QUICK_ATTACK).Priority).toBe("+2");
  });

  it("a charging move is flagged Charged (Dig)", () => {
    expect(rowMap(MoveId.DIG).Charged).toBe("Yes");
  });

  it("a status move has no Critical value (Toxic)", () => {
    expect(rowMap(MoveId.TOXIC).Critical).toBe("—");
  });
});
