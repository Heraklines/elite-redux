/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/data-lists";
import { REQUESTED_ABILITY_UPGRADES } from "#data/elite-redux/ability-upgrades/requested-ability-manifest";
import { getErAbilityDescription, getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

function runtimeIdFor(row: (typeof REQUESTED_ABILITY_UPGRADES)[number]): number | undefined {
  if (row.erDraftId !== undefined) {
    return ER_ID_MAP.abilities[row.erDraftId];
  }
  if (row.vanillaKey !== undefined) {
    const value = (AbilityId as unknown as Record<string, number | string>)[row.vanillaKey];
    return typeof value === "number" ? value : undefined;
  }
  return;
}

describe("requested ability descriptions on player-facing surfaces", () => {
  it("uses each upgraded live description in both the compact and Detail views", () => {
    for (const row of REQUESTED_ABILITY_UPGRADES) {
      const runtimeId = runtimeIdFor(row);
      expect(runtimeId, `${row.name} must resolve to a runtime ability`).toBeTypeOf("number");

      const ability = allAbilities[runtimeId as number];
      expect(ability, `${row.name} must have a live Ability`).toBeDefined();
      expect(ability.description.trim(), `${row.name} must have a description`).not.toBe("");
      expect(getErAbilityDescription(runtimeId as number), `${row.name} compact description is stale`).toBe(
        ability.description,
      );
      expect(getErAbilityRomDescription(ability.name), `${row.name} Detail description is stale`).toBe(
        ability.description,
      );
    }
  });

  it("describes overhaul effects that previously retained pre-overhaul text", () => {
    const expectedPhrases: Readonly<Record<string, readonly string[]>> = {
      "Ball Fetch": ["ball-named", "returns", "great balls"],
      Catastrophe: ["hail boosts rock", "sandstorm boosts ice"],
      Commander: ["below half hp", "half damage"],
      "Cosmic Daze": ["cannot be cured early"],
      "Flower Gift": ["higher attacking", "defensive"],
      "Good as Gold": ["money", "20%"],
      "Grass Flute": ["grass-type", "sound"],
      "Grip Pincer": ["every damaging move", "1/4"],
      "Liquid Ooze": ["predator-style", "shell bell"],
      "Lucky Wings": ["experience", "20%"],
      "Pure Love": ["fairy-type", "appear more often"],
      "Super Luck": ["experience", "20%"],
      "Suction Cups": ["forced switching", "steals"],
      Synchronize: ["nature"],
      Telekinetic: ["struggle", "one turn", "psychic", "dark"],
      Trace: ["disables", "two turns"],
      "Wandering Spirit": ["first innate", "additional biome"],
    };

    for (const [name, phrases] of Object.entries(expectedPhrases)) {
      const row = REQUESTED_ABILITY_UPGRADES.find(candidate => candidate.name === name);
      const description = allAbilities[runtimeIdFor(row!) as number].description.toLowerCase();
      for (const phrase of phrases) {
        expect(description, `${name} must mention ${phrase}`).toContain(phrase);
      }
    }
  });
});
