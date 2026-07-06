/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Showdown 1v1 PvP (C3): the PURE opponent-manifest -> enemy identity-blob transform.
// Engine-free: asserts the blob shape buildCoopEnemy consumes matches the manifest, and
// the held-item mapping (whitelist -> key, MEGA_STONE/empty -> null).

import {
  manifestToSerializedMon,
  manifestToSerializedParty,
  showdownHeldItemKey,
} from "#data/elite-redux/showdown/showdown-enemy";
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { describe, expect, it } from "vitest";

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: 6,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 1,
  nature: 3,
  ivs: [31, 30, 29, 28, 27, 26],
  moveset: [53, 89, 63, 76],
  item: "LEFTOVERS",
  rootSpeciesId: 4,
  ...over,
});

describe("showdown enemy transform (C3)", () => {
  it("maps every identity field the enemy reconstructor reads", () => {
    const blob = manifestToSerializedMon(
      mon({ speciesId: 445, formIndex: 2, shiny: true, variant: 2, abilityIndex: 0, nature: 5 }),
    );
    expect(blob).toMatchObject({
      speciesId: 445,
      formIndex: 2,
      level: 100,
      abilityIndex: 0,
      nature: 5,
      shiny: true,
      variant: 2,
      ivs: [31, 30, 29, 28, 27, 26],
      moveset: [53, 89, 63, 76],
    });
  });

  it("copies ivs/moveset arrays (no shared reference with the manifest)", () => {
    const m = mon();
    const blob = manifestToSerializedMon(m);
    expect(blob.ivs).not.toBe(m.ivs);
    expect(blob.moveset).not.toBe(m.moveset);
    expect(blob.ivs).toEqual(m.ivs);
    expect(blob.moveset).toEqual(m.moveset);
  });

  it("does NOT put held items in the identity blob (attached to the live enemy separately)", () => {
    const blob = manifestToSerializedMon(mon({ item: "LEFTOVERS" }));
    expect(blob).not.toHaveProperty("item");
    expect(blob).not.toHaveProperty("heldItems");
  });

  it("maps a whitelist item to its modifier key", () => {
    expect(showdownHeldItemKey(mon({ item: "LEFTOVERS" }))).toBe("LEFTOVERS");
    expect(showdownHeldItemKey(mon({ item: "FOCUS_BAND" }))).toBe("FOCUS_BAND");
  });

  it("maps the MEGA_STONE sentinel + empty item to NO runtime modifier", () => {
    expect(showdownHeldItemKey(mon({ item: MEGA_STONE_ITEM, formIndex: 1 }))).toBeNull();
    expect(showdownHeldItemKey(mon({ item: "" }))).toBeNull();
  });

  it("maps a whole party in order", () => {
    const party = manifestToSerializedParty([
      mon({ speciesId: 3 }),
      mon({ speciesId: 9 }),
      mon({ speciesId: 6, formIndex: 1, item: MEGA_STONE_ITEM }),
    ]);
    expect(party.map(b => b.speciesId)).toEqual([3, 9, 6]);
    expect(party[2].formIndex).toBe(1);
  });
});
