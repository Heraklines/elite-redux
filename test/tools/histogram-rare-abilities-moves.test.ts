/*
 * ANALYSIS - rarity histogram of abilities & learnable moves across the ER dex.
 *
 * For every species (allSpecies already includes ER mega/redux as separate species)
 * and each of its forms, tally:
 *   - ABILITIES: ability1 / ability2 / abilityHidden + the 3 ER innates (passives),
 *     counted as DISTINCT base species that can carry the ability (active slot OR innate).
 *   - MOVES: level-up (species + form tables) + egg (root-keyed) + TM/tutor, counted as
 *     distinct base species that can learn the move by ANY method.
 * All tables are the ER-patched runtime objects (ER init overwrites them in place at boot),
 * so this must run AFTER the game boots. Rarest = smallest count (>0) = least-tested.
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tools/histogram-rare-abilities-moves.test.ts
 * Writes dev-logs/histogram-abilities.json + dev-logs/histogram-moves.json (gitignored).
 */

import { speciesEggMoves } from "#data/balance/moves/egg-moves";
import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#data/balance/pokemon-level-moves";
import { speciesTmMoves } from "#data/balance/tms";
import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { mkdirSync, writeFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function abilityName(id: number): string {
  return allAbilities[id]?.name ?? `#${id}`;
}
function moveName(id: number): string {
  return allMoves[id]?.name ?? `#${id}`;
}

describe.skipIf(!RUN)("histogram: rarest abilities & moves", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("dumps ability & move rarity histograms", async () => {
    game = new GameManager(phaserGame);
    // Boot fully so every ER init (species/innates/movesets/tm/egg) has patched the tables.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // ability id -> set of base-species enum keys that can carry it (active slot OR innate)
    const abilityToSpecies = new Map<number, Set<string>>();
    const abilityActive = new Set<number>(); // appears as a real ability slot on someone
    const abilityInnate = new Set<number>(); // appears as an innate on someone
    // move id -> set of base-species enum keys that can learn it
    const moveToSpecies = new Map<number, Set<string>>();

    const addAbility = (id: number, sp: string, asInnate: boolean) => {
      if (!id || id === AbilityId.NONE) {
        return;
      }
      (abilityToSpecies.get(id) ?? abilityToSpecies.set(id, new Set()).get(id)!).add(sp);
      (asInnate ? abilityInnate : abilityActive).add(id);
    };
    const addMove = (id: number, sp: string) => {
      if (!id || id === MoveId.NONE) {
        return;
      }
      (moveToSpecies.get(id) ?? moveToSpecies.set(id, new Set()).get(id)!).add(sp);
    };

    // Readable label per species: enum key when defined, else the ER-custom display name.
    const labelOf = (species: (typeof allSpecies)[number]): string => {
      const enumKey = SpeciesId[species.speciesId];
      if (enumKey) {
        return enumKey;
      }
      const nm = species.name ? String(species.name).trim() : "";
      return nm ? `${nm}#${species.speciesId}` : `SP_${species.speciesId}`;
    };

    for (const species of allSpecies) {
      const spKey = labelOf(species);
      const formCount = species.forms.length || 1;

      // --- abilities (per form: mega/alt forms carry different innates) ---
      for (let f = 0; f < formCount; f++) {
        const form = species.forms.length > 0 ? species.forms[f] : species;
        addAbility(form.ability1, spKey, false);
        addAbility(form.ability2, spKey, false);
        addAbility(form.abilityHidden, spKey, false);
        const [i1, i2, i3] = species.getPassiveAbilities(f);
        addAbility(i1, spKey, true);
        addAbility(i2, spKey, true);
        addAbility(i3, spKey, true);
      }

      // --- learnable moves (union of every method) ---
      // level-up: base species table
      for (const [, mv] of pokemonSpeciesLevelMoves[species.speciesId] ?? []) {
        addMove(mv, spKey);
      }
      // level-up: per-form tables (if any)
      const formLevel = pokemonFormLevelMoves[species.speciesId];
      if (formLevel) {
        for (const fk of Object.keys(formLevel)) {
          for (const [, mv] of formLevel[fk] ?? []) {
            addMove(mv, spKey);
          }
        }
      }
      // egg moves: keyed by the evolution-line ROOT
      const rootId = species.getRootSpeciesId?.() ?? species.speciesId;
      for (const mv of speciesEggMoves[rootId] ?? []) {
        addMove(mv, spKey);
      }
      // TM / tutor moves (entries: MoveId | [formKey, MoveId])
      for (const entry of speciesTmMoves[species.speciesId] ?? []) {
        addMove(Array.isArray(entry) ? entry[1] : entry, spKey);
      }
    }

    // ---- build sorted tallies ----
    const abilityTallies = [...abilityToSpecies.entries()]
      .map(([id, set]) => ({
        id,
        key: AbilityId[id] ?? `#${id}`,
        name: abilityName(id),
        count: set.size,
        species: [...set].sort(),
        active: abilityActive.has(id),
        innate: abilityInnate.has(id),
      }))
      .sort((a, b) => a.count - b.count || a.key.localeCompare(b.key));

    const moveTallies = [...moveToSpecies.entries()]
      .map(([id, set]) => ({
        id,
        key: MoveId[id] ?? `#${id}`,
        name: moveName(id),
        count: set.size,
        species: [...set].sort(),
      }))
      .sort((a, b) => a.count - b.count || a.key.localeCompare(b.key));

    // ---- context: abilities/moves that exist in the registry but are on NOBODY ----
    const totalAbilities = allAbilities.filter((a, i) => i !== AbilityId.NONE && a?.name).length;
    const totalMoves = allMoves.filter((m, i) => i !== MoveId.NONE && m?.name).length;
    const abilitiesOnNobody = allAbilities
      .map((_, i) => i)
      .filter(i => i !== AbilityId.NONE && allAbilities[i]?.name && !abilityToSpecies.has(i));
    const movesOnNobody = allMoves
      .map((_, i) => i)
      .filter(i => i !== MoveId.NONE && allMoves[i]?.name && !moveToSpecies.has(i));

    mkdirSync("dev-logs", { recursive: true });
    writeFileSync(
      "dev-logs/histogram-abilities.json",
      JSON.stringify(
        {
          totalSpeciesScanned: allSpecies.length,
          totalAbilitiesInRegistry: totalAbilities,
          abilitiesCarriedByAtLeastOne: abilityToSpecies.size,
          abilitiesOnNobodyCount: abilitiesOnNobody.length,
          abilitiesOnNobody: abilitiesOnNobody.map(i => ({ id: i, key: AbilityId[i], name: abilityName(i) })),
          tallies: abilityTallies,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      "dev-logs/histogram-moves.json",
      JSON.stringify(
        {
          totalSpeciesScanned: allSpecies.length,
          totalMovesInRegistry: totalMoves,
          movesLearnableByAtLeastOne: moveToSpecies.size,
          movesOnNobodyCount: movesOnNobody.length,
          movesOnNobody: movesOnNobody.map(i => ({ id: i, key: MoveId[i], name: moveName(i) })),
          tallies: moveTallies,
        },
        null,
        2,
      ),
    );

    // ---- console summary ----
    const fmt = (t: {
      count: number;
      name: string;
      key: string;
      species: string[];
      active?: boolean;
      innate?: boolean;
    }) => {
      const hasSlot = t.active !== undefined || t.innate !== undefined;
      const slot = t.active && t.innate ? "act+inn" : t.active ? "active" : t.innate ? "innate" : "?";
      const who = t.count <= 4 ? `  [${t.species.join(", ")}]` : "";
      return `  ${String(t.count).padStart(3)}  ${t.name} (${t.key}${hasSlot ? `, ${slot}` : ""})${who}`;
    };

    console.log(`\n===== SCAN: ${allSpecies.length} species entries =====`);
    console.log(
      `ABILITIES: ${abilityToSpecies.size}/${totalAbilities} carried by >=1 species; ${abilitiesOnNobody.length} on NOBODY`,
    );
    console.log(
      `MOVES:     ${moveToSpecies.size}/${totalMoves} learnable by >=1 species; ${movesOnNobody.length} on NOBODY\n`,
    );

    console.log("===== 50 RAREST ABILITIES (count = distinct species carrying it) =====");
    for (const t of abilityTallies.slice(0, 50)) {
      console.log(fmt(t));
    }
    console.log("\n===== 50 RAREST MOVES (count = distinct species that can learn it) =====");
    for (const t of moveTallies.slice(0, 50)) {
      console.log(fmt(t));
    }
    console.log("\nFull data: dev-logs/histogram-abilities.json  dev-logs/histogram-moves.json\n");

    // sanity: a staple should be common, and both histograms are non-empty
    expect(abilityToSpecies.size).toBeGreaterThan(100);
    expect(moveToSpecies.size).toBeGreaterThan(300);
  }, 180_000);
});
