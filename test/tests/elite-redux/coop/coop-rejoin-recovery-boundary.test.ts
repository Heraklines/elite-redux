/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { hasCoopBattleRecoverySurface } from "#data/elite-redux/coop/coop-runtime";
import { describe, expect, it } from "vitest";

describe("co-op hot-rejoin recovery boundary", () => {
  it("does not demand an impossible battle snapshot before gameplay starts", () => {
    expect(hasCoopBattleRecoverySurface({ currentBattle: null, gameMode: { isCoop: true } })).toBe(false);
    expect(hasCoopBattleRecoverySurface({ currentBattle: undefined, gameMode: { isShowdown: true } })).toBe(false);
  });

  it("keeps full authoritative recovery for live co-op and showdown battles", () => {
    const battle = {};
    expect(hasCoopBattleRecoverySurface({ currentBattle: battle, gameMode: { isCoop: true } })).toBe(true);
    expect(hasCoopBattleRecoverySurface({ currentBattle: battle, gameMode: { isShowdown: true } })).toBe(true);
    expect(hasCoopBattleRecoverySurface({ currentBattle: battle, gameMode: {} })).toBe(false);
  });
});
