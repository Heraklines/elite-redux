/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_REWARD_ACTION_STRIDE,
  COOP_REWARD_SURFACE_ACTION_STRIDE,
  coopRewardOperationActionSlot,
  isValidCoopRewardSurfaceIdentity,
} from "#data/elite-redux/coop/coop-reward-operation";
import { describe, expect, it } from "vitest";

describe("ordered Mystery reward surface identity", () => {
  const first = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
  const second = { surfaceId: "modifier:me:graves:1", ordinal: 1 } as const;

  it("partitions action ids by stable surface ordinal without changing the interaction pin", () => {
    const firstSlot = coopRewardOperationActionSlot(7, 0, first);
    const secondSlot = coopRewardOperationActionSlot(7, 0, second);
    const ambientSlot = coopRewardOperationActionSlot(7, 0);

    expect(firstSlot).toBe(7 * COOP_REWARD_ACTION_STRIDE + COOP_REWARD_SURFACE_ACTION_STRIDE);
    expect(secondSlot).toBe(7 * COOP_REWARD_ACTION_STRIDE + 2 * COOP_REWARD_SURFACE_ACTION_STRIDE);
    expect(firstSlot).not.toBe(secondSlot);
    expect(ambientSlot).not.toBe(firstSlot);
    expect(Math.floor((firstSlot ?? -1) / COOP_REWARD_ACTION_STRIDE)).toBe(7);
    expect(Math.floor((secondSlot ?? -1) / COOP_REWARD_ACTION_STRIDE)).toBe(7);
  });

  it("fails closed on malformed, out-of-plan, or overflowing addresses", () => {
    expect(isValidCoopRewardSurfaceIdentity(first)).toBe(true);
    expect(isValidCoopRewardSurfaceIdentity(null)).toBe(false);
    expect(isValidCoopRewardSurfaceIdentity({ surfaceId: "Modifier 0", ordinal: 0 })).toBe(false);
    expect(isValidCoopRewardSurfaceIdentity({ surfaceId: "modifier:17", ordinal: 16 })).toBe(false);
    expect(coopRewardOperationActionSlot(7, COOP_REWARD_SURFACE_ACTION_STRIDE, first)).toBeNull();
    expect(coopRewardOperationActionSlot(7, 0, { surfaceId: "modifier:17", ordinal: 16 })).toBeNull();
  });
});
