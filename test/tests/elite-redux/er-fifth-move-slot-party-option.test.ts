/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER "5th move slot" consumable + the party move-select menu (PP Up / PP Max,
// Ether, etc). The menu builds one option per move as `PartyOption.MOVE_1 + m`
// and derives the move index back as `option - PartyOption.MOVE_1`. With a 5th
// move, the option is `MOVE_1 + 4`; if no `MOVE_5` exists there it overflows
// into the next enum value, the option label hits the `default` branch and
// throws (`undefined.active`) while BUILDING the menu — freezing the game when
// a PP item is used on a Pokémon that has the bonus slot.
//
// These invariants keep MOVE_5 wired to move index 4 and clear of the other
// option ranges (ALL = 4000, ABILITY_SLOT_0 = 5000), so the menu can never
// overflow for the supported 5-move cap.
// =============================================================================

import { PartyOption } from "#ui/handlers/party-ui-handler";
import { describe, expect, it } from "vitest";

describe("Party move-select supports the ER 5th move slot", () => {
  it("MOVE_5 maps to move index 4 (option - MOVE_1)", () => {
    expect(PartyOption.MOVE_5 - PartyOption.MOVE_1).toBe(4);
  });

  it("the move-option block stays a contiguous run MOVE_1..MOVE_5", () => {
    expect(PartyOption.MOVE_2).toBe(PartyOption.MOVE_1 + 1);
    expect(PartyOption.MOVE_3).toBe(PartyOption.MOVE_1 + 2);
    expect(PartyOption.MOVE_4).toBe(PartyOption.MOVE_1 + 3);
    expect(PartyOption.MOVE_5).toBe(PartyOption.MOVE_1 + 4);
  });

  it("MOVE_5 does not collide with the ALL / ABILITY_SLOT option ranges", () => {
    expect(PartyOption.MOVE_5).toBeLessThan(PartyOption.ALL);
    expect(PartyOption.MOVE_5).toBeLessThan(PartyOption.ABILITY_SLOT_0);
  });
});
