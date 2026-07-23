/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  REQUESTED_ABILITY_UPGRADES,
  type RequestedAbilityUpgrade,
} from "#data/elite-redux/ability-upgrades/requested-ability-manifest";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { describe, expect, it } from "vitest";

function vanillaId(key: string): number | undefined {
  const value = (AbilityId as unknown as Record<string, number | string>)[key];
  return typeof value === "number" ? value : undefined;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

const REQUESTED_ROWS: readonly RequestedAbilityUpgrade[] = REQUESTED_ABILITY_UPGRADES;

const EXPECTED_REQUESTED_NAMES = [
  "Insomnia",
  "Liquid Ooze",
  "Healer",
  "Parroting",
  "Synchronize",
  "Trace",
  "Tummyache",
  "Cosmic Daze",
  "Suction Cups",
  "Imposter",
  "Intimidate",
  "Scare",
  "Terrify",
  "Gluttony",
  "Avenger",
  "Shed Skin",
  "Mummy",
  "Lingering Aroma",
  "Wandering Spirit",
  "Defeatist",
  "Oblivious",
  "Klutz",
  "Ice Body",
  "Telepathy",
  "Aroma Veil",
  "Sweet Veil",
  "Aura Break",
  "Tangling Hair",
  "Gulp Missile",
  "Mimicry",
  "Pastel Veil",
  "Magical Dust",
  "Energy Tap",
  "Neutralizing Fog",
  "Grass Flute",
  "Energy Horns",
  "Color Spectrum",
  "Stench",
  "Toxic Spill",
  "Higher Rank",
  "Anticipation",
  "Flourish",
  "Celestial Blessing",
  "Readied Action",
  "Demolitionist",
  "Haunted Spirit",
  "Juggernaut",
  "Berserk",
  "Delta Stream",
  "Heavy Metal",
  "Flower Gift",
  "Marvel Scale",
  "Rain Dish",
  "Coward",
  "Wimp Out",
  "Rattled",
  "Tactical Retreat",
  "Emergency Exit",
  "Forewarn",
  "Dazzling",
  "Perish Body",
  "Screen Cleaner",
  "Quick Draw",
  "Antarctic Bird",
  "Fighting Spirit",
  "Hyper Aggressive",
  "Good as Gold",
  "Precise Fist",
  "Low Blow",
  "Cheap Tactics",
  "Monkey Business",
  "Jungle's Guard",
  "Moon Spirit",
  "Marine Apex",
  "Soothing Aroma",
  "Suppress",
  "Change of Heart",
  "Pure Love",
  "Telekinetic",
  "Spiteful",
  "Powder Burst",
  "Super Luck",
  "Lucky Wings",
  "Salt Circle",
  "Guard Dog",
  "Guilt Trip",
  "Commander",
  "Ill Will",
  "Catastrophe",
  "Radio Jam",
  "Entrance",
  "Rhythmic",
  "Venoblaze Pincers",
  "Sugar Rush",
  "Vitality Strike",
  "Wildfire",
  "Deep Fried",
  "Razor Sharp",
  "To the Bone",
  "Gunman",
  "Frost Dragon",
  "Poseidon's Dominion",
  "Two-Faced",
  "Malodor",
  "Reverberate",
  "Overrule",
  "Lightning Born",
  "Superheavy",
  "Chilling Pellets",
  "Warmonger",
  "Crispy Cream",
  "Brain Mass",
  "Break it Down",
  "Drakelp Head",
  "Electro Booster",
  "King of the Jungle",
  "Lunar Affinity",
  "White Smoke",
  "Olé!",
  "Kunoichi's Blade",
  "Raw Wood",
  "Fossilized",
  "Steadfast",
  "Grip Pincer",
  "Snow Cloak",
  "Ball Fetch",
  "Unburden",
  "Bad Company",
  "Dust Cloud",
  "Grappler",
  "Voodoo Power",
  "Chokehold",
  "Rain Shroud",
  "Blistering Sun",
  "Funeral Pyre",
] as const;

describe("requested Elite Redux ability-overhaul manifest", () => {
  it("contains every requested ability exactly once", () => {
    const names = REQUESTED_ROWS.map(row => row.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...EXPECTED_REQUESTED_NAMES].sort());
    expect(REQUESTED_ROWS.every(row => row.requestedEffect.trim().length > 0)).toBe(true);
  });

  it("matches each ER draft id to the requested ability name", () => {
    const draftsById = new Map(ER_ABILITIES.map(ability => [ability.id, ability]));

    for (const row of REQUESTED_ROWS) {
      if (row.erDraftId == null) {
        continue;
      }

      const draft = draftsById.get(row.erDraftId);
      expect(draft, `${row.name} has no ER draft ${row.erDraftId}`).toBeDefined();
      expect(normalizeName(draft?.name ?? ""), `${row.name} points at ${draft?.name}`).toBe(normalizeName(row.name));
    }
  });

  it("resolves every row to a live vanilla or ER runtime ability id", () => {
    for (const row of REQUESTED_ROWS) {
      const vanilla = row.vanillaKey ? vanillaId(row.vanillaKey) : undefined;
      const erRuntime = row.erDraftId == null ? undefined : ER_ID_MAP.abilities[row.erDraftId];

      expect(vanilla ?? erRuntime, `${row.name} has no runtime id`).toBeTypeOf("number");
      if (row.vanillaKey) {
        expect(vanilla, `${row.name} has invalid AbilityId key ${row.vanillaKey}`).toBeTypeOf("number");
      }
      if (row.erDraftId != null) {
        expect(erRuntime, `${row.name} has no ER_ID_MAP entry for draft ${row.erDraftId}`).toBeTypeOf("number");
      }
      if (vanilla != null && erRuntime != null) {
        expect(erRuntime, `${row.name} ER and vanilla ids diverge`).toBe(vanilla);
      }
    }
  });

  it("keeps replacements, nerfs, and the rename explicitly classified", () => {
    const byName = new Map(REQUESTED_ROWS.map(row => [row.name, row]));
    for (const name of [
      "Snow Cloak",
      "Ball Fetch",
      "Unburden",
      "Bad Company",
      "Dust Cloud",
      "Grappler",
      "Voodoo Power",
      "Chokehold",
      "Rain Shroud",
    ]) {
      expect(byName.get(name)?.operation, name).toBe("replace");
    }
    expect(byName.get("Blistering Sun")?.operation).toBe("nerf");
    expect(byName.get("Funeral Pyre")?.operation).toBe("nerf");
    expect(byName.get("Kunoichi's Blade")?.operation).toBe("rename");
    expect((byName.get("Kunoichi's Blade") as { newName?: string } | undefined)?.newName).toBe("Ninja's Blade");
  });
});
