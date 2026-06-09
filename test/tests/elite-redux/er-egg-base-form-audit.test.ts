/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression + audit (#352): ONLY the base form of any line may hatch from eggs
// (and appear in starter select — both share speciesEggTiers/speciesStarterCosts
// registration). A player hatched "Aegislash Blade Redux" — a fully-evolved
// Stance-Change BATTLE form — because the evolved-base guard resolved the
// vanilla base by exact name only, and middle form tokens ("Blade") made the
// lookup miss. The guard now falls back to the longest leading vanilla
// word-prefix, and battle-form name tokens are excluded outright.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allSpecies } from "#data/data-lists";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const VANILLA_ID_CUTOFF = 10000;

describe.skipIf(!RUN)("ER egg pool admits only base-of-line customs (#352)", () => {
  let phaserGame: Phaser.Game;
  // GameManager construction runs the full ER init (species, evolutions, egg tiers).
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const admittedCustoms = (): { id: number; name: string }[] => {
    const idToName = new Map<number, string>(allSpecies.map(s => [s.speciesId as number, s.name]));
    return Object.keys(speciesEggTiers)
      .map(Number)
      .filter(id => id >= VANILLA_ID_CUTOFF)
      .map(id => ({ id, name: idToName.get(id) ?? `<unregistered ${id}>` }));
  };

  it("no battle-form custom is hatchable (Blade/School/Zen/Noice/Crowned/Origin/Mega/…)", () => {
    const offenders = admittedCustoms().filter(({ name }) =>
      /\b(Mega|Primal|Hangry|Bond|Blunder|Blade|School|Zen|Noice|Crowned|Origin|Gigantamax|Eternamax|Aura)\b/i.test(
        name,
      ),
    );
    // biome-ignore lint/suspicious/noConsole: audit output
    console.log(`battle-form offenders: ${offenders.map(o => `${o.name}#${o.id}`).join(", ") || "none"}`);
    expect(offenders).toEqual([]);
  });

  it("no evolved custom with a hatchable lower stage is itself hatchable", () => {
    const vanillaByName = new Map<string, number>();
    const idToName = new Map<number, string>();
    for (const sp of allSpecies) {
      idToName.set(sp.speciesId as number, sp.name);
      if ((sp.speciesId as number) < VANILLA_ID_CUTOFF) {
        vanillaByName.set(sp.name.toLowerCase(), sp.speciesId as number);
      }
    }
    const admitted = admittedCustoms();
    const admittedNames = new Set(admitted.map(a => a.name.toLowerCase()));
    const qualifier = /\s+(redux mega|redux b|redux c|redux|primal|mega|hisuian|alolan|galarian|paldean)$/i;
    const leadingVanilla = (name: string): number | undefined => {
      const words = name.replace(qualifier, "").trim().toLowerCase().split(/\s+/);
      for (let n = words.length; n >= 1; n--) {
        const id = vanillaByName.get(words.slice(0, n).join(" "));
        if (id !== undefined) {
          return id;
        }
      }
      return;
    };
    const offenders: string[] = [];
    for (const { id, name } of admitted) {
      const suffix = name.match(qualifier)?.[1];
      let cur = leadingVanilla(name);
      if (cur === undefined || !suffix) {
        continue;
      }
      let guard = 0;
      while (cur !== undefined && Object.hasOwn(pokemonPrevolutions, cur as SpeciesId) && guard++ < 10) {
        cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
        const lower = idToName.get(cur);
        if (lower && admittedNames.has(`${lower} ${suffix}`.toLowerCase())) {
          offenders.push(`${name}#${id} (hatch ${lower} ${suffix} instead)`);
          break;
        }
      }
    }
    // biome-ignore lint/suspicious/noConsole: audit output
    console.log(`evolved-with-lower offenders: ${offenders.join(", ") || "none"}`);
    expect(offenders).toEqual([]);
  });

  it("Aegislash Blade Redux is NOT hatchable; the line stays reachable via Honedge Redux", () => {
    const admitted = admittedCustoms();
    expect(admitted.find(a => /aegislash/i.test(a.name))).toBeUndefined();
    expect(
      admitted.find(a => a.name.toLowerCase() === "honedge redux"),
      "Honedge Redux must remain hatchable",
    ).toBeDefined();
  });
});
