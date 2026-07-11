/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expectedSurfaces } from "#test/tools/coop-soak-coverage";
import { describe, expect, it } from "vitest";

// Failure-first proof for the post-migration coverage hole: the soak's anti-silent-drop registry covered
// UI modes, relay kinds, seq bands, and battle situations, but none of the authoritative operation classes.
// Consequently a migrated operation could remain completely cold without making completeness RED.
describe("co-op soak authoritative-operation completeness", () => {
  it("requires every migrated authoritative operation class to be classified by the soak", () => {
    expect([...expectedSurfaces()]).toEqual(expect.arrayContaining([
      "operation:op:ability",
      "operation:op:bargain",
      "operation:op:biome",
      "operation:op:catchFull",
      "operation:op:colosseum",
      "operation:op:faintSwitch",
      "operation:op:learnMove",
      "operation:op:me",
      "operation:op:revival",
      "operation:op:reward",
      "operation:op:stormglass",
      "operation:op:wave",
    ]));
  });
});
