/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 — Ape Shift (734): "Transforms below 50% HP, curing status and always
// critting." HP-threshold form change + status cure (existing) PLUS the
// always-crit-while-below-50%-HP combat effect (ConditionalCritAbAttr).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function attrNames(erId: number): Promise<string[]> {
  const { ER_ID_MAP } = await import("#data/elite-redux/er-id-map");
  const { allAbilities } = await import("#data/data-lists");
  const pkrg = ER_ID_MAP.abilities[erId];
  if (pkrg === undefined || !allAbilities[pkrg]) {
    return [];
  }
  return allAbilities[pkrg].attrs.map(a => a.constructor.name);
}

describe.skipIf(!RUN)("ER Ape Shift (#103)", () => {
  it("wires the HP-threshold form change AND the always-crit-below-50% effect", async () => {
    const names = await attrNames(734);
    expect(names).toContain("HpThresholdFormChangeAbAttr");
    expect(names).toContain("ConditionalCritAbAttr");
  });
});
