/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #130 — composite abilities must invoke ALL their constituent halves. These
// pin the free-text constituent that was previously dropped ("partial wire"):
//   • Qigong (762):  "Rampage + Always hits" → AlwaysHitAbAttr (no-miss).
//   • Stonecutter (881): "Fossilized + Rock moves ignore abilities" → a
//     Rock-type-gated MoveAbilityBypassAbAttr (type-gated Mold Breaker).
//
// Pure data assertions on the built ability's attrs — fast, no GameManager.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function attrsOf(erId: number, attrName: string): Promise<unknown[]> {
  const { ER_ID_MAP } = await import("#data/elite-redux/er-id-map");
  const { allAbilities } = await import("#data/data-lists");
  const pkrg = ER_ID_MAP.abilities[erId];
  if (pkrg === undefined || !allAbilities[pkrg]) {
    return [];
  }
  return allAbilities[pkrg].getAttrs(attrName as never);
}

describe.skipIf(!RUN)("ER composite constituents (#130)", () => {
  it("Qigong (762) wires its 'Always hits' half (AlwaysHitAbAttr)", async () => {
    expect((await attrsOf(762, "AlwaysHitAbAttr")).length).toBeGreaterThan(0);
  });

  it("Stonecutter (881) wires its 'Rock moves ignore abilities' half (MoveAbilityBypassAbAttr)", async () => {
    expect((await attrsOf(881, "MoveAbilityBypassAbAttr")).length).toBeGreaterThan(0);
  });
});
