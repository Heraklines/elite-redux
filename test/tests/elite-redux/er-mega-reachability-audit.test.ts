/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Audit (#359): EVERY mega/primal must be reachable and mega-evolvable.
// For each ER_MEGA_FORMS entry (the full data-driven mega/primal table):
//   (a) the form exists on the (vanilla or custom) base species;
//   (b) a form-change edge with an ITEM trigger is registered for it
//       (so the stone appears in the reward pool and holding it transforms),
//       EXCEPT boss-only forms (Primal Cascoon) which are deliberately gated;
//   (c) that trigger's item is a real FormChangeItem (not NONE);
//   (d) dual-mega species (X + Y) have DISTINCT stones (#318: "Mega-X stone
//       never spawns" class).
// Prints a full failure list so any unreachable mega is identifiable at a
// glance.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { FormChangeItem } from "#enums/form-change-item";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Boss-only targets: deliberately NOT player-reachable (see #351). */
const BOSS_ONLY = new Set(["primal@Cascoon"]);

describe.skipIf(!RUN)("ER mega reachability audit (#359)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("every mega/primal form exists, has an item-triggered change with a real stone, and dual megas have distinct stones", () => {
    const speciesById = new Map(allSpecies.map(s => [s.speciesId as number, s]));
    const missingForm: string[] = [];
    const missingEdge: string[] = [];
    const noStone: string[] = [];
    const dupStones: string[] = [];
    const stonesBySpecies = new Map<number, Map<number, string[]>>();
    let checked = 0;

    for (const entry of ER_MEGA_FORMS) {
      const basePkrgId = ER_ID_MAP.species[entry.baseErId];
      if (basePkrgId === undefined) {
        continue; // unmapped base — out of scope (id-map drift tracked elsewhere)
      }
      const species = speciesById.get(basePkrgId);
      if (!species) {
        continue;
      }
      const label = `${entry.formKey}@${species.name}`;
      checked++;

      // (a) the form exists on the species
      if (!species.forms.some(f => f.formKey === entry.formKey)) {
        missingForm.push(label);
        continue;
      }
      if (BOSS_ONLY.has(label)) {
        continue; // deliberately unreachable by players
      }

      // (b) an item-triggered form change is registered
      const changes = pokemonFormChanges[basePkrgId] ?? [];
      const itemChange = changes.find(
        fc => fc.formKey === entry.formKey && fc.findTrigger(SpeciesFormChangeItemTrigger),
      );
      if (!itemChange) {
        missingEdge.push(label);
        continue;
      }

      // (c) the stone is a real item
      const trigger = itemChange.findTrigger(SpeciesFormChangeItemTrigger) as { item?: FormChangeItem } | undefined;
      const item = trigger?.item ?? FormChangeItem.NONE;
      if (item === FormChangeItem.NONE) {
        noStone.push(label);
        continue;
      }

      // (d) collect stones per species to detect X/Y sharing one stone
      if (!stonesBySpecies.has(basePkrgId)) {
        stonesBySpecies.set(basePkrgId, new Map());
      }
      const byItem = stonesBySpecies.get(basePkrgId) as Map<number, string[]>;
      if (!byItem.has(item)) {
        byItem.set(item, []);
      }
      (byItem.get(item) as string[]).push(entry.formKey);
    }

    for (const [speciesId, byItem] of stonesBySpecies) {
      for (const [item, formKeys] of byItem) {
        if (formKeys.length > 1) {
          dupStones.push(
            `${speciesById.get(speciesId)?.name}#${speciesId}: forms [${formKeys.join(", ")}] share stone ${FormChangeItem[item] ?? item}`,
          );
        }
      }
    }

    // biome-ignore lint/suspicious/noConsole: audit output
    console.log(
      `MEGA AUDIT: checked=${checked} missingForm=${missingForm.length} missingEdge=${missingEdge.length} noStone=${noStone.length} dupStones=${dupStones.length}`,
    );
    for (const [name, list] of [
      ["missingForm", missingForm],
      ["missingEdge", missingEdge],
      ["noStone", noStone],
      ["dupStones", dupStones],
    ] as const) {
      if (list.length > 0) {
        // biome-ignore lint/suspicious/noConsole: audit output
        console.log(`${name}: ${list.join(" | ")}`);
      }
    }
    // KNOWN EXCEPTIONS (#359 — fixed; floor must stay here):
    //  - primal@Terapagos: ER's target is SPECIES_TERAPAGOS_STELLAR, which
    //    vanilla pokerogue already models natively (Terastal/Stellar forms) —
    //    injecting a duplicate "primal" form would recreate the #296
    //    duplicate-form problem, so it is intentionally NOT injected.
    // Everything else: 0 missing edges / 0 stone collisions (was 51 missing).
    const KNOWN_MISSING_FORM = 1;
    const KNOWN_MISSING_EDGE = 0;
    expect(missingForm.length).toBeLessThanOrEqual(KNOWN_MISSING_FORM);
    expect(missingEdge.length).toBeLessThanOrEqual(KNOWN_MISSING_EDGE);
    expect(noStone).toEqual([]);
    expect(dupStones).toEqual([]);
  });
});
