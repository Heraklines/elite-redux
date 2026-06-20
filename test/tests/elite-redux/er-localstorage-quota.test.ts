/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// A bloated save (e.g. a huge egg inventory) can push `data_<user>` past the
// browser's ~5MB localStorage quota, and `setItem` then throws QuotaExceededError.
// Left uncaught inside saveSystem / saveAll, that rejected the save promise
// mid-flow: the saving icon spun forever (Save & Quit "froze"), the cloud push
// was skipped, and the player had to refresh (MDR's report). trySetLocalStorageItem
// must SWALLOW the error and return false instead of throwing, so the caller can
// warn the player and still attempt the cloud sync. This pins that contract.
// =============================================================================

import { trySetLocalStorageItem } from "#system/game-data";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("trySetLocalStorageItem - save quota safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes and returns true when storage has room", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {});
    expect(trySetLocalStorageItem("data_test", "hello")).toBe(true);
    expect(spy).toHaveBeenCalledWith("data_test", "hello");
  });

  it("returns false (does NOT throw) when setItem throws QuotaExceededError", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => trySetLocalStorageItem("data_MDR", "x".repeat(1000))).not.toThrow();
    expect(trySetLocalStorageItem("data_MDR", "x")).toBe(false);
  });

  it("also swallows non-quota setItem failures (never aborts the save flow)", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => trySetLocalStorageItem("sessionData_MDR", "x")).not.toThrow();
    expect(trySetLocalStorageItem("sessionData_MDR", "x")).toBe(false);
  });
});
