/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ErSpeciesId } from "#enums/er-species-id";
import { getRibbonOwnerSpeciesId } from "#system/ribbons/ribbon-methods";
import { describe, expect, it } from "vitest";

describe("ER custom Mega ribbon ownership", () => {
  it("shows Mega Luxray Redux ribbons from Luxray Redux's collection", () => {
    expect(getRibbonOwnerSpeciesId(ErSpeciesId.LUXRAY_REDUX_MEGA)).toBe(ErSpeciesId.LUXRAY_REDUX);
  });
});
