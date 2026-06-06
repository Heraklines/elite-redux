/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DIAGNOSTIC: which "Redux" base-form custom species are MISSING from egg
// hatches (speciesEggTiers)? User report: Sneasel Redux (and others) never hatch.
// We enumerate every ER custom whose name contains "Redux" but is NOT a
// mega/primal/evolved form, map it to its pokerogue id, and check egg-tier
// membership — printing the reason for each miss (unmapped / form-change target /
// has prevolution / name-guard / not added).

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;

describe("ER Redux egg-hatch coverage diagnostic", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("lists Redux base forms missing from egg tiers + why", () => {
    const tiers = speciesEggTiers as Record<number, number | undefined>;
    const vanillaByName = new Map<string, number>();
    for (const sp of allSpecies) {
      if (sp.speciesId < VANILLA_ID_CUTOFF) {
        vanillaByName.set(sp.name.toLowerCase(), sp.speciesId);
      }
    }
    const formQualifier = /\s+(redux mega|redux b|redux c|redux|primal|mega|hisuian|alolan|galarian|paldean)$/i;

    let total = 0;
    let inEggs = 0;
    const missing: string[] = [];
    for (const draft of ER_SPECIES) {
      const name = draft.name ?? "";
      if (!/redux/i.test(name)) {
        continue;
      }
      // Skip clearly non-base forms (mega/primal/hangry) — those SHOULD be excluded.
      if (/\b(mega|primal|hangry)\b/i.test(name) || /(?:^|_)(MEGA|PRIMAL|HANGRY)(?:_|$)/.test(draft.speciesConst)) {
        continue;
      }
      const pkId = ER_ID_MAP.species[draft.id];
      if (pkId === undefined || pkId < VANILLA_ID_CUTOFF) {
        continue; // not a registered ER-custom species
      }
      total++;
      if (tiers[pkId] !== undefined) {
        inEggs++;
        continue;
      }
      // Diagnose the reason it's not in eggs.
      let reason = "NOT ADDED (unknown)";
      if (Object.hasOwn(pokemonPrevolutions, pkId as SpeciesId)) {
        reason = "has prevolution (evolved form)";
      } else {
        const base = name.replace(formQualifier, "").trim().toLowerCase();
        const vanillaId = vanillaByName.get(base);
        if (vanillaId !== undefined && Object.hasOwn(pokemonPrevolutions, vanillaId as SpeciesId)) {
          reason = `name-guard: base "${base}" (vanilla #${vanillaId}) is itself evolved`;
        }
      }
      missing.push(`${name} (er#${draft.id} -> pk#${pkId} "${getPokemonSpecies(pkId)?.name}") — ${reason}`);
    }

    console.log(
      `\n[redux-egg] Redux base forms (non-mega/primal): ${total}; in egg tiers: ${inEggs}; MISSING: ${missing.length}`,
    );
    for (const m of missing) {
      console.log(`   ${m}`);
    }

    // OBTAINABILITY: for each evolved Redux custom, walk its prevolution chain to
    // the root and check whether that root is egg-eligible. If the root is NOT a
    // hatchable Redux (e.g. it's a vanilla base, or nothing hatches into the
    // Redux line), the evolved Redux is UNOBTAINABLE — that's the real gap.
    const rootOf = (id: number): number => {
      let cur = id;
      let guard = 0;
      while (Object.hasOwn(pokemonPrevolutions, cur as SpeciesId) && guard++ < 10) {
        cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
      }
      return cur;
    };
    const unobtainable: string[] = [];
    for (const draft of ER_SPECIES) {
      const name = draft.name ?? "";
      if (!/redux/i.test(name) || /\b(mega|primal|hangry)\b/i.test(name)) {
        continue;
      }
      const pkId = ER_ID_MAP.species[draft.id];
      if (pkId === undefined || pkId < VANILLA_ID_CUTOFF) {
        continue;
      }
      // Only care about EVOLVED Reduxes (have a prevolution); base ones hatch.
      if (!Object.hasOwn(pokemonPrevolutions, pkId as SpeciesId)) {
        continue;
      }
      const root = rootOf(pkId);
      const rootEggEligible = tiers[root] !== undefined;
      const rootIsCustom = root >= VANILLA_ID_CUTOFF;
      if (!rootEggEligible) {
        unobtainable.push(
          `${name} (pk#${pkId}) — chain root pk#${root} "${getPokemonSpecies(root)?.name}" ${rootIsCustom ? "(custom)" : "(vanilla)"} NOT egg-eligible`,
        );
      }
    }
    console.log(
      `\n[redux-egg] evolved Reduxes whose chain ROOT is not egg-eligible (unobtainable): ${unobtainable.length}`,
    );
    for (const u of unobtainable.slice(0, 60)) {
      console.log(`   ${u}`);
    }

    // Custom-vs-vanilla root: an evolved Redux is only truly reachable AS a Redux
    // if its chain root is itself a Redux-custom base. A vanilla root means
    // evolving yields the VANILLA form, not the Redux one.
    let rootCustom = 0;
    const rootVanilla: string[] = [];
    for (const draft of ER_SPECIES) {
      const name = draft.name ?? "";
      if (!/redux/i.test(name) || /\b(mega|primal|hangry)\b/i.test(name)) {
        continue;
      }
      const pkId = ER_ID_MAP.species[draft.id];
      if (pkId === undefined || pkId < VANILLA_ID_CUTOFF || !Object.hasOwn(pokemonPrevolutions, pkId as SpeciesId)) {
        continue;
      }
      const root = rootOf(pkId);
      if (root >= VANILLA_ID_CUTOFF) {
        rootCustom++;
      } else {
        rootVanilla.push(`${name} (pk#${pkId}) — root is VANILLA "${getPokemonSpecies(root)?.name}" (pk#${root})`);
      }
    }
    console.log(
      `\n[redux-egg] evolved Reduxes with a Redux-custom root: ${rootCustom}; with a VANILLA root (Redux form unreachable by evolution): ${rootVanilla.length}`,
    );
    for (const r of rootVanilla.slice(0, 60)) {
      console.log(`   ${r}`);
    }
    expect(total).toBeGreaterThan(0);
  });
});
