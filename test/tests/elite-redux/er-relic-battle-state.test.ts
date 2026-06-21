/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER per-battle relic state: the persisted, per-mon-idempotent counters that
// stop per-battle relic effects (Cursed Idol's HP-halve, Pharaoh's Ankh's
// revive) from RE-FIRING when a run is reloaded mid-battle. Pure logic test (no
// game init): with no active battle, syncWave resolves the wave to -1, so the
// bag is stable across calls and the save/restore round-trip is exercised directly.
// =============================================================================

import {
  erBattleEntrantOrdinal,
  erBattleOnce,
  getErRelicBattleState,
  resetErRelicBattleState,
  restoreErRelicBattleState,
} from "#data/elite-redux/er-relic-battle-state";
import { beforeEach, describe, expect, it } from "vitest";

describe("ER per-battle relic state", () => {
  beforeEach(() => resetErRelicBattleState());

  it("erBattleEntrantOrdinal is idempotent per id (a reload re-summon does not advance the count)", () => {
    expect(erBattleEntrantOrdinal("cursedIdol", 111)).toEqual({ ordinal: 1, firstTime: true });
    expect(erBattleEntrantOrdinal("cursedIdol", 222)).toEqual({ ordinal: 2, firstTime: true });
    // Re-processing the same mons (what a reload's re-summon does) returns the
    // SAME ordinal with firstTime:false - so neither gets a fresh Sub/halve.
    expect(erBattleEntrantOrdinal("cursedIdol", 111)).toEqual({ ordinal: 1, firstTime: false });
    expect(erBattleEntrantOrdinal("cursedIdol", 222)).toEqual({ ordinal: 2, firstTime: false });
    // A genuinely new mon still advances.
    expect(erBattleEntrantOrdinal("cursedIdol", 333)).toEqual({ ordinal: 3, firstTime: true });
  });

  it("survives a save/restore round-trip so the halve does not re-fire on Continue", () => {
    erBattleEntrantOrdinal("cursedIdol", 111); // 1st -> free Substitute
    erBattleEntrantOrdinal("cursedIdol", 222); // 2nd -> HP halved
    const saved = getErRelicBattleState();
    resetErRelicBattleState(); // simulate the page reload wiping module memory
    restoreErRelicBattleState(saved); // session restore
    // The re-summon of the already-halved 2nd mon must be a no-op, not a fresh 2nd.
    expect(erBattleEntrantOrdinal("cursedIdol", 222)).toEqual({ ordinal: 2, firstTime: false });
    expect(erBattleEntrantOrdinal("cursedIdol", 111)).toEqual({ ordinal: 1, firstTime: false });
  });

  it("erBattleOnce fires once and stays consumed across a restore (Pharaoh's Ankh)", () => {
    expect(erBattleOnce("pharaohAnkh")).toBe(true);
    expect(erBattleOnce("pharaohAnkh")).toBe(false);
    const saved = getErRelicBattleState();
    resetErRelicBattleState();
    restoreErRelicBattleState(saved);
    expect(erBattleOnce("pharaohAnkh")).toBe(false); // still used after reload
  });

  it("re-arms cleanly when restoring an older save with no field", () => {
    erBattleOnce("pharaohAnkh");
    restoreErRelicBattleState(undefined);
    expect(erBattleOnce("pharaohAnkh")).toBe(true);
  });
});
