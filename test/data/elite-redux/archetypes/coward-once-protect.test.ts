/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Construction + behavior tests for CowardOnceProtectAbAttr — ER's 429 Coward.
//
// The bug we're guarding against: prior implementation used the EntryEffect
// scripted-move stub, which didn't actually fire Protect AND showed the
// ability flyout every time (because canApply was unconditionally true).
// Now: once-per-battle flag stored on `pokemon.battleData.cowardProtectUsed`
// (cleared by resetBattleAndWaveData each new battle so Coward re-arms per
// trainer); ability fires & shows the flyout exactly once per battle.
// =============================================================================

import { CowardOnceProtectAbAttr } from "#data/elite-redux/archetypes/coward-once-protect";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Pokemon } from "#field/pokemon";
import { describe, expect, it, vi } from "vitest";

function makePokemon(): Pokemon {
  const addTag = vi.fn();
  // Fresh per-battle data per holder (the once-flag lives here, like the real engine).
  return {
    addTag,
    battleData: { cowardProtectUsed: false },
  } as unknown as Pokemon;
}

describe("CowardOnceProtectAbAttr", () => {
  it("canApply returns true on first invocation", () => {
    const attr = new CowardOnceProtectAbAttr();
    const holder = makePokemon();
    expect(attr.canApply({ pokemon: holder, simulated: false } as any)).toBe(true);
  });

  it("canApply returns false after one apply", () => {
    const attr = new CowardOnceProtectAbAttr();
    const holder = makePokemon();
    attr.apply({ pokemon: holder, simulated: false } as any);
    expect(attr.canApply({ pokemon: holder, simulated: false } as any)).toBe(false);
  });

  it("apply adds the PROTECTED battler tag to the holder", () => {
    const attr = new CowardOnceProtectAbAttr();
    const holder = makePokemon();
    attr.apply({ pokemon: holder, simulated: false } as any);
    expect((holder as any).addTag).toHaveBeenCalledWith(BattlerTagType.PROTECTED, 1);
  });

  it("simulated apply does not consume the once-flag", () => {
    const attr = new CowardOnceProtectAbAttr();
    const holder = makePokemon();
    attr.apply({ pokemon: holder, simulated: true } as any);
    expect((holder as any).addTag).not.toHaveBeenCalled();
    expect(attr.canApply({ pokemon: holder, simulated: false } as any)).toBe(true);
  });

  it("different holders have independent once-flags", () => {
    const attr = new CowardOnceProtectAbAttr();
    const a = makePokemon();
    const b = makePokemon();
    attr.apply({ pokemon: a, simulated: false } as any);
    expect(attr.canApply({ pokemon: a, simulated: false } as any)).toBe(false);
    expect(attr.canApply({ pokemon: b, simulated: false } as any)).toBe(true);
  });
});
