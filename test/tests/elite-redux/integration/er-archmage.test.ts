/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 — Archmage (455): "30% chance of adding a type related effect to each
// move." Now maps each move type to its signature secondary (Fire→burn,
// Electric→paralysis, Poison→poison via ChanceStatusOnAttack; Ice→frostbite,
// Ghost→fear, Psychic→confusion, Dark→flinch, Grass→seed via
// ChanceBattlerTagOnAttack), instead of a flat 30% burn.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function attrCounts(erId: number): Promise<Record<string, number>> {
  const { ER_ID_MAP } = await import("#data/elite-redux/er-id-map");
  const { allAbilities } = await import("#data/data-lists");
  const pkrg = ER_ID_MAP.abilities[erId];
  const out: Record<string, number> = {};
  if (pkrg === undefined || !allAbilities[pkrg]) {
    return out;
  }
  for (const a of allAbilities[pkrg].attrs) {
    out[a.constructor.name] = (out[a.constructor.name] ?? 0) + 1;
  }
  return out;
}

describe.skipIf(!RUN)("ER Archmage (#103)", () => {
  it("wires per-type signature secondaries (status + tag procs)", async () => {
    const counts = await attrCounts(455);
    // 3 status types (fire/electric/poison) + 5 tag types (ice/ghost/psychic/dark/grass)
    expect(counts.ChanceStatusOnAttackAbAttr ?? 0).toBeGreaterThanOrEqual(3);
    expect(counts.ChanceBattlerTagOnAttackAbAttr ?? 0).toBeGreaterThanOrEqual(5);
  });
});
