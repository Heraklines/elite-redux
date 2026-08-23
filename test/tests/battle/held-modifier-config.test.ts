/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Pokemon } from "#field/pokemon";
import { materializeHeldModifierConfig } from "#modifiers/held-modifier-config";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import { describe, expect, it } from "vitest";

describe("held modifier config", () => {
  it("ignores a missing runtime modifier", () => {
    const malformed = { modifier: null } as unknown as HeldModifierConfig;
    expect(materializeHeldModifierConfig(malformed, {} as Pokemon)).toBeNull();
  });

  it("ignores a value that is not a held-item modifier", () => {
    const malformed = { modifier: {} } as unknown as HeldModifierConfig;
    expect(materializeHeldModifierConfig(malformed, {} as Pokemon)).toBeNull();
  });
});
