/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Sky Attack: "Raises its Attack on the first turn, then makes a brutal
// strike on the second." Vanilla PokeRogue's Sky Attack only charges + flinches
// (no charge-turn stat boost), so the ER Attack raise was missing. It is wired
// as a CHARGE-turn StatStageChangeAttr (like Skull Bash's Defense raise), so the
// boost applies during the charge (turn 1), not on the hit.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Sky Attack raises Attack on the charge turn", () => {
  it("has a charge-turn StatStageChangeAttr that raises the user's Attack by +1", () => {
    const move = allMoves[MoveId.SKY_ATTACK] as unknown as {
      chargeAttrs?: { constructor: { name: string }; stats?: Stat[]; stages?: number; selfTarget?: boolean }[];
    };
    const chargeAttrs = move.chargeAttrs ?? [];
    const statAttr = chargeAttrs.find(a => a.constructor.name === "StatStageChangeAttr");
    expect(statAttr, "Sky Attack must raise Attack on its charge turn").toBeDefined();
    expect(statAttr!.stats).toContain(Stat.ATK);
    expect(statAttr!.stages).toBe(1);
    expect(statAttr!.selfTarget).toBe(true); // raises the USER's Attack
  });

  it("still charges + flinches (the ER description reflects the raise)", () => {
    const move = allMoves[MoveId.SKY_ATTACK];
    expect(move.chance).toBe(30); // flinch chance
    expect(move.effect.toLowerCase()).toContain("attack on the first turn");
  });
});
