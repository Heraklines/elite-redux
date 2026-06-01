/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Verifies that the ER move-flag patch layer actually applies the flags that
// flag-gated abilities depend on (Bone Zone→BONE_BASED, Sand Song/Festivities→
// SOUND_BASED, Roundhouse→KICKING_MOVE, Sweeping Edge→SLICING_MOVE, Artillery→
// PULSE_MOVE) at runtime, after the full ER bootstrap.
import { allMoves } from "#data/data-lists";
import { getTerrainColor } from "#data/terrain";
import { MoveFlags } from "#enums/move-flags";
import { TerrainType } from "#enums/terrain-type";
import { describe, expect, it } from "vitest";

describe("ER move-flag coverage (abilities depend on these)", () => {
  const countWithFlag = (flag: MoveFlags) => allMoves.filter(m => m && m.hasFlag(flag)).length;

  it.each([
    ["BONE_BASED (Bone Zone)", MoveFlags.BONE_BASED],
    ["SOUND_BASED (Sand Song / Festivities / Grass Flute)", MoveFlags.SOUND_BASED],
    ["KICKING_MOVE (Roundhouse)", MoveFlags.KICKING_MOVE],
    ["SLICING_MOVE (Sweeping Edge)", MoveFlags.SLICING_MOVE],
    ["PULSE_MOVE (Artillery / Mega Launcher)", MoveFlags.PULSE_MOVE],
    ["DANCE_MOVE (Dancer / Taekkyeon)", MoveFlags.DANCE_MOVE],
  ])("at least one move carries %s", (_label, flag) => {
    expect(countWithFlag(flag)).toBeGreaterThan(0);
  });

  it("TOXIC terrain (the ER custom) is registered with a render color", () => {
    expect(TerrainType.TOXIC).toBeDefined();
    // getTerrainColor returns an [r,g,b]-ish tuple; TOXIC must not be the
    // empty/NONE fallback.
    const toxic = getTerrainColor(TerrainType.TOXIC);
    const none = getTerrainColor(TerrainType.NONE);
    expect(toxic).not.toEqual(none);
  });
});
