/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Maintainer-dictated type-nativization corrections (2026-07-17).
//
// Seven authoritative fixes to the type-nativization replacement slots / ability
// data. Locks in the corrected state so it cannot silently regress:
//   1. Sneasler Mega: Free Climb ("Free Form") = Unburden + Mountaineer (was
//      Unburden + Hyper Aggressive); innate 3 = Hyper Aggressive (was Mountaineer).
//   2. Volcarona Redux: Serene Grace (was Flame Body).
//   3. Selenumbra: Lunar Affinity (was Serene Grace; Selenumbra carries Sheer Force).
//   4-7. Composite ability DISPLAY descriptions (resolved by ability NAME): Waterborne
//      -> Hydrate, Dragonfruit -> Draconize, Komodo -> Draconize, Ominous Shroud ->
//      Foggy Eye. The manual composites already invoke the correct constituents.
//
// Gated behind ER_SCENARIO=1 (boots init via GameManager).
// =============================================================================

import { allAbilities, allSpecies } from "#data/data-lists";
import { MANUAL_COMPOSITE_PARTS } from "#data/elite-redux/abilities/composite-newcomers";
import {
  ER_DRAGONFRUIT_ABILITY_ID,
  ER_FREE_CLIMB_ABILITY_ID,
  ER_KOMODO_NATIVIZE_ABILITY_ID,
  ER_OMINOUS_SHROUD_ABILITY_ID,
  ER_WATERBORNE_ABILITY_ID,
} from "#data/elite-redux/abilities/type-nativization-abilities";
import { getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { resolveErSpeciesConstId } from "#data/elite-redux/er-type-nativization";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function speciesById(id: number): PokemonSpecies | undefined {
  return allSpecies.find(s => s.speciesId === id);
}

/** Live ability NAMES a species (form 0) carries in its active slots + ER passives/innates. */
function abilityNamesOf(constName: string): string[] {
  const id = resolveErSpeciesConstId(constName);
  const sp = id === undefined ? undefined : speciesById(id);
  if (!sp) {
    return [];
  }
  const s = sp as unknown as PokemonSpeciesForm;
  const ids = [s.ability1, s.ability2, s.abilityHidden, ...sp.getPassiveAbilities(0)];
  return ids.map(a => allAbilities[a]?.name ?? `?${a}`);
}

describe.skipIf(!RUN)("ER type-nativization maintainer corrections (2026-07-17)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    void new GameManager(phaserGame);
  });

  it("1. Free Climb composite = Unburden + Mountaineer (not Hyper Aggressive)", () => {
    const def = MANUAL_COMPOSITE_PARTS[ER_FREE_CLIMB_ABILITY_ID];
    expect(def.constituents).toContain(AbilityId.UNBURDEN);
    expect(def.constituents).toContain(ErAbilityId.MOUNTAINEER);
    expect(def.constituents).not.toContain(ErAbilityId.HYPER_AGGRESSIVE);
    expect(def.description).toBe("Unburden + Mountaineer.");
  });

  it("1. Sneasler Mega: innate 3 = Hyper Aggressive, Mountaineer no longer a standalone innate", () => {
    const names = abilityNamesOf("SPECIES_SNEASLER_MEGA");
    expect(names).toContain("Free Climb");
    expect(names).toContain("Hyper Aggressive");
    // Mountaineer now lives ONLY inside the Free Climb composite, not as its own innate.
    expect(names).not.toContain("Mountaineer");
  });

  it("2. Volcarona Redux: Serene Grace, not Flame Body", () => {
    const names = abilityNamesOf("SPECIES_VOLCARONA_REDUX");
    expect(names).toContain("Serene Grace");
    expect(names).not.toContain("Flame Body");
  });

  it("3. Selenumbra: Lunar Affinity, not Serene Grace (keeps Sheer Force)", () => {
    const names = abilityNamesOf("SPECIES_SELENUMBRA");
    expect(names).toContain("Lunar Affinity");
    expect(names).not.toContain("Serene Grace");
    expect(names).toContain("Sheer Force");
  });

  it("4-7. Composite abilities invoke the nativized constituents (not the removed type-grants)", () => {
    expect(MANUAL_COMPOSITE_PARTS[ER_WATERBORNE_ABILITY_ID].constituents).toContain(ErAbilityId.HYDRATE);
    expect(MANUAL_COMPOSITE_PARTS[ER_DRAGONFRUIT_ABILITY_ID].constituents).toContain(ErAbilityId.DRACONIZE);
    expect(MANUAL_COMPOSITE_PARTS[ER_KOMODO_NATIVIZE_ABILITY_ID].constituents).toContain(ErAbilityId.DRACONIZE);
    expect(MANUAL_COMPOSITE_PARTS[ER_OMINOUS_SHROUD_ABILITY_ID].constituents).toContain(ErAbilityId.FOGGY_EYE);
    // None reintroduce a removed type-grant.
    for (const id of [
      ER_WATERBORNE_ABILITY_ID,
      ER_DRAGONFRUIT_ABILITY_ID,
      ER_KOMODO_NATIVIZE_ABILITY_ID,
      ER_OMINOUS_SHROUD_ABILITY_ID,
    ]) {
      const c = MANUAL_COMPOSITE_PARTS[id].constituents;
      expect(c).not.toContain(ErAbilityId.AQUATIC);
      expect(c).not.toContain(ErAbilityId.HALF_DRAKE);
      expect(c).not.toContain(ErAbilityId.PHANTOM);
    }
  });

  it("4-7. No displayed ability description mentions Aquatic / Half Drake / Phantom", () => {
    const disp = (name: string) => (getErAbilityRomDescription(name) ?? "").toLowerCase();

    const waterborne = disp("Waterborne");
    expect(waterborne).toContain("hydrate");
    expect(waterborne).not.toContain("aquatic");

    const dragonfruit = disp("Dragonfruit");
    expect(dragonfruit).toContain("draconize");
    expect(dragonfruit).not.toContain("half drake");

    const komodo = disp("Komodo");
    expect(komodo).not.toContain("half drake");
    expect(komodo).not.toContain("adds dragon");
    expect(komodo).toContain("dragon-type");

    const ominous = disp("Ominous Shroud");
    expect(ominous).not.toContain("phantom");
    expect(ominous).not.toContain("adds ghost");
    expect(ominous).toContain("fog");
  });
});
