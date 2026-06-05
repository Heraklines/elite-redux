/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// ER Air Blower (320) casts a self-side Tailwind on entry. The bug: the
// scripted-move primitive's canApply required an opponent on the field, so a
// self-side buff cast by a lead (no opponent yet) never fired. `targetsSelf`
// makes it fire regardless. Unit-tested directly (ER ability ids can't go
// through the .ability() battle override).
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { describe, expect, it } from "vitest";

function stub(noOpponents: boolean): Pokemon {
  return { getOpponents: () => (noOpponents ? [] : [{ isFainted: () => false }]) } as unknown as Pokemon;
}
function canApply(attr: PostSummonScriptedMoveAbAttr, pokemon: Pokemon): boolean {
  return attr.canApply({ pokemon, simulated: false } as never);
}

describe("ER PostSummonScriptedMove — targetsSelf (Air Blower / Tailwind)", () => {
  it("self-side move fires on entry even with NO opponent on the field", () => {
    const airBlower = new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TAILWIND, targetsSelf: true });
    expect(canApply(airBlower, stub(true))).toBe(true); // the bug: was false → never triggered
  });

  it("offensive on-entry move still requires an opponent", () => {
    const offensive = new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SCRATCH });
    expect(canApply(offensive, stub(true))).toBe(false); // no opponent → no fire
    expect(canApply(offensive, stub(false))).toBe(true); // opponent present → fires
  });
});
