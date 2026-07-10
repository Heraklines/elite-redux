/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shouldReloadSceneOnSettingsExit } from "#ui/settings/settings-reload-policy";
import { describe, expect, it } from "vitest";

describe("Showdown/co-op settings reload policy", () => {
  it("defers a reload-required change while a network session is active", () => {
    expect(shouldReloadSceneOnSettingsExit(true, true)).toBe(false);
  });

  it("preserves the immediate reload for a solo session", () => {
    expect(shouldReloadSceneOnSettingsExit(true, false)).toBe(true);
  });

  it("does not reload when no changed setting requires one", () => {
    expect(shouldReloadSceneOnSettingsExit(false, false)).toBe(false);
    expect(shouldReloadSceneOnSettingsExit(false, true)).toBe(false);
  });
});
