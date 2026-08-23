/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { battleInfoTypeTextureKey } from "#ui/battle-info/type-tab-layout";
import { describe, expect, it } from "vitest";

const PLAYER = "pbinfo_player";

describe("N-type battle-info tab textures", () => {
  it("preserves the ordinary single- and dual-type textures", () => {
    expect(battleInfoTypeTextureKey(PLAYER, 0, 1)).toBe("pbinfo_player_type");
    expect([0, 1].map(index => battleInfoTypeTextureKey(PLAYER, index, 2))).toEqual([
      "pbinfo_player_type1",
      "pbinfo_player_type2",
    ]);
  });

  it("keeps an unpaired third type full-height", () => {
    expect([0, 1, 2].map(index => battleInfoTypeTextureKey(PLAYER, index, 3))).toEqual([
      "pbinfo_player_type1",
      "pbinfo_player_type2",
      "pbinfo_player_type",
    ]);
  });

  it("renders four types as two proper top/bottom pairs", () => {
    expect(Array.from({ length: 4 }, (_, index) => battleInfoTypeTextureKey(PLAYER, index, 4))).toEqual([
      "pbinfo_player_type1",
      "pbinfo_player_type2",
      "pbinfo_player_type1",
      "pbinfo_player_type2",
    ]);
  });

  it("continues pairing and leaves only the final odd type full-height", () => {
    expect(Array.from({ length: 7 }, (_, index) => battleInfoTypeTextureKey(PLAYER, index, 7))).toEqual([
      "pbinfo_player_type1",
      "pbinfo_player_type2",
      "pbinfo_player_type1",
      "pbinfo_player_type2",
      "pbinfo_player_type1",
      "pbinfo_player_type2",
      "pbinfo_player_type",
    ]);
  });
});
