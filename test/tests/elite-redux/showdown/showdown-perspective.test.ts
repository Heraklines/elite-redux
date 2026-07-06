/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 guest PERSPECTIVE FLIP (C5). Pure presentation mapping: for the versus
// guest the two sides swap on-screen (its own authoritative-enemy team renders on the
// bottom); for everyone else the mapping is identity (solo/co-op/host byte-identical).

import {
  isPlayerSide,
  presentationBattlerIndex,
  presentationSideIsPlayer,
} from "#data/elite-redux/showdown/showdown-perspective";
import { BattlerIndex } from "#enums/battler-index";
import { describe, expect, it } from "vitest";

describe("showdown perspective flip (C5)", () => {
  it("flip=false is identity (solo / co-op / the host)", () => {
    for (const bi of [BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]) {
      expect(presentationBattlerIndex(bi, false)).toBe(bi);
    }
    expect(presentationSideIsPlayer(true, false)).toBe(true);
    expect(presentationSideIsPlayer(false, false)).toBe(false);
  });

  it("flip=true swaps sides but keeps the slot (versus guest)", () => {
    expect(presentationBattlerIndex(BattlerIndex.PLAYER, true)).toBe(BattlerIndex.ENEMY);
    expect(presentationBattlerIndex(BattlerIndex.ENEMY, true)).toBe(BattlerIndex.PLAYER);
    expect(presentationBattlerIndex(BattlerIndex.PLAYER_2, true)).toBe(BattlerIndex.ENEMY_2);
    expect(presentationBattlerIndex(BattlerIndex.ENEMY_2, true)).toBe(BattlerIndex.PLAYER_2);
  });

  it("the flip is an involution (applying it twice returns the original)", () => {
    for (const bi of [BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]) {
      expect(presentationBattlerIndex(presentationBattlerIndex(bi, true), true)).toBe(bi);
    }
  });

  it("ATTACKER (-1) and negatives pass through unchanged even when flipping", () => {
    expect(presentationBattlerIndex(BattlerIndex.ATTACKER, true)).toBe(BattlerIndex.ATTACKER);
  });

  it("presentationSideIsPlayer inverts only for the versus guest", () => {
    // The guest's own team is authoritatively the ENEMY side -> renders on the PLAYER (bottom) side.
    expect(presentationSideIsPlayer(false, true)).toBe(true);
    // The host's team is authoritatively the PLAYER side -> renders on the ENEMY (top) side.
    expect(presentationSideIsPlayer(true, true)).toBe(false);
  });

  it("isPlayerSide identifies the authoritative player side", () => {
    expect(isPlayerSide(BattlerIndex.PLAYER)).toBe(true);
    expect(isPlayerSide(BattlerIndex.PLAYER_2)).toBe(true);
    expect(isPlayerSide(BattlerIndex.ENEMY)).toBe(false);
    expect(isPlayerSide(BattlerIndex.ENEMY_2)).toBe(false);
  });
});
