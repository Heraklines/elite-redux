/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 — Clueless (426): "Negates Weather, Rooms and Terrains." Cloud Nine
// weather suppression + on-entry terrain clear. (Room suppression needs a
// continuous field-effect hook pokerogue lacks; documented limit.)
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

describe.skipIf(!RUN)("ER Clueless (#103)", () => {
  it("suppresses weather (Cloud Nine) and clears terrain on entry", async () => {
    const names = await attrNames(426);
    expect(names).toContain("SuppressWeatherEffectAbAttr");
    expect(names).toContain("PostSummonClearTerrainAbAttr");
  });
});
