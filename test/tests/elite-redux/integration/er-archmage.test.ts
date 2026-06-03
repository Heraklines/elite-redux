/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #173 — Archmage (455): "30% chance to add a type-based effect to each
// move." Each effect is keyed to the MOVE'S TYPE (FULL desc). Wired faithfully
// (30% each) for the status / battler-tag / stat sub-effects via existing
// offense-by-type primitives:
//   Status (ChanceStatusOnAttack):     Poison→Toxic, Fire→Burn                (2)
//   Tags   (ChanceBattlerTagOnAttack): Ice→Frostbite, Water→Confuse,
//                                      Dark→Bleed, Ground→Trap, Normal→Encore,
//                                      Ghost→Disable                          (6)
//   Stat   (StatChangeOnAttack):       Fighting→+SpAtk, Flying→+Spd,
//                                      Steel→+Def (self), Dragon→-Atk (foe)   (4)
// Deferred (need offense-side terrain/hazard-by-type primitives): Electric/
// Psychic/Fairy/Grass→set terrain, Rock→Stealth Rock.
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
  it("wires per-type secondaries (status + tag + stat procs)", async () => {
    const counts = await attrCounts(455);
    // Poison→Toxic, Fire→Burn
    expect(counts.ChanceStatusOnAttackAbAttr ?? 0).toBeGreaterThanOrEqual(2);
    // Ice/Water/Dark/Ground/Normal/Ghost tags
    expect(counts.ChanceBattlerTagOnAttackAbAttr ?? 0).toBeGreaterThanOrEqual(6);
    // Fighting/Flying/Steel (self) + Dragon (foe)
    expect(counts.StatChangeOnAttackAbAttr ?? 0).toBeGreaterThanOrEqual(4);
    // Electric/Psychic/Grass/Fairy → terrain (one map-driven attr).
    expect(counts.PostAttackSetTerrainByMoveTypeAbAttr ?? 0).toBeGreaterThanOrEqual(1);
    // Rock → Stealth Rock.
    expect(counts.PostAttackSetHazardByMoveTypeAbAttr ?? 0).toBeGreaterThanOrEqual(1);
    // The old single generic-CONFUSED approximation (ChanceBattlerTagOnHit) is gone.
    expect(counts.ChanceBattlerTagOnHitAbAttr ?? 0).toBe(0);
  });
});
