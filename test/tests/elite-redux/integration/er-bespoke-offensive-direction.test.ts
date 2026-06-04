/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103/#131 — bespoke abilities whose "[holder's] X moves cause Y" effect was
// mis-wired defensively (PostDefend on-hit). Now offensive (PostAttack), filtered:
//   • Elemental Charge (434): Fire→burn / Ice→frostbite / Electric→paralyze (20%).
//   • Piercing Solo (639): SOUND moves bleed (100%).
//   • Grass Flute (831): SOUND moves fear (100%).
//
// Confirms the offensive attr is present (not the defensive variant).
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

describe.skipIf(!RUN)("ER bespoke offensive-direction fixes (#103)", () => {
  it("Elemental Charge (434) uses offensive ChanceStatus/ChanceBattlerTag on attack", async () => {
    const names = await attrNames(434);
    expect(names).toContain("ChanceStatusOnAttackAbAttr");
    expect(names).toContain("ChanceBattlerTagOnAttackAbAttr");
    expect(names).not.toContain("ChanceStatusOnHitAbAttr");
  });

  it("Piercing Solo (639) uses offensive ChanceBattlerTagOnAttackAbAttr", async () => {
    const names = await attrNames(639);
    expect(names).toContain("ChanceBattlerTagOnAttackAbAttr");
    expect(names).not.toContain("ChanceBattlerTagOnHitAbAttr");
  });

  it("Grass Flute (831) uses offensive ChanceBattlerTagOnAttackAbAttr", async () => {
    const names = await attrNames(831);
    expect(names).toContain("ChanceBattlerTagOnAttackAbAttr");
    expect(names).not.toContain("ChanceBattlerTagOnHitAbAttr");
  });
});
