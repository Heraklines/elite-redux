/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER type-nativization sweep (Pass A) — integrity + per-holder verification.
//
// Asserts, after the real init:
//   - every derived holder has its type-grant ability REMOVED, the replacement
//     installed in the freed slot/passive, and the granted type present natively;
//   - SWEEP INTEGRITY: no live species/form retains ANY of the 10 type-grant
//     abilities, with the single documented exception (Plundertow keeps Aquatic
//     as its maintainer-chosen replacement);
//   - the SMALL-CHANGES ability swaps applied.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import {
  ER_ABILITY_SWAPS,
  ER_TYPE_GRANT_ABILITY_IDS,
  ER_TYPE_NATIVIZATION,
  resolveErSpeciesConstId,
} from "#data/elite-redux/er-type-nativization";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function speciesById(id: number): PokemonSpecies | undefined {
  return allSpecies.find(s => s.speciesId === id);
}

/** All ability ids a species-or-form currently carries (slots + ER passives). */
function abilityIdsOf(target: PokemonSpeciesForm, passives: readonly number[]): number[] {
  return [target.ability1, target.ability2, target.abilityHidden, ...passives];
}

/** The concrete targets an entry was applied to (species and/or its mega form). */
function targetsOf(species: PokemonSpecies, isMega: boolean, baseConst: string): PokemonSpeciesForm[] {
  const out: PokemonSpeciesForm[] = [species as unknown as PokemonSpeciesForm];
  if (isMega) {
    const baseId = resolveErSpeciesConstId(baseConst.replace(/_(MEGA|PRIMAL)$/, ""));
    const base = baseId === undefined ? undefined : speciesById(baseId);
    for (const form of base?.forms ?? []) {
      const key = form.formKey ?? "";
      if (key.includes("mega") || key.includes("primal")) {
        out.push(form);
      }
    }
  }
  return out;
}

describe.skipIf(!RUN)("ER type-nativization sweep (Pass A)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // Boot init once per test (idempotent sweep).
    void new GameManager(phaserGame);
  });

  it("every holder: grant removed, replacement installed, granted type native", () => {
    const missing: string[] = [];
    for (const e of ER_TYPE_NATIVIZATION) {
      const id = resolveErSpeciesConstId(e.species);
      const sp = id === undefined ? undefined : speciesById(id);
      if (!sp) {
        missing.push(`${e.species} unresolved`);
        continue;
      }
      const targets = targetsOf(sp, e.isMega ?? false, e.species);
      // Find the target that actually holds the sweep result (species or mega form).
      const applied = targets.find(t => {
        const passives = sp.getPassiveAbilities(t === (sp as unknown as PokemonSpeciesForm) ? 0 : t.formIndex);
        return abilityIdsOf(t, passives).includes(e.replacement);
      });
      if (!applied) {
        missing.push(`${e.species}: replacement ${e.replacement} not installed`);
        continue;
      }
      const passives = sp.getPassiveAbilities(
        applied === (sp as unknown as PokemonSpeciesForm) ? 0 : applied.formIndex,
      );
      // Grant is gone from the applied target.
      expect(abilityIdsOf(applied, passives), `${e.species} still has grant ${e.grant}`).not.toContain(e.grant);
      // Granted type is present natively (base types OR extras).
      const nativeTypes = new Set<number>([
        applied.type1,
        ...(applied.type2 === null ? [] : [applied.type2]),
        ...applied.getExtraTypes(),
      ]);
      expect(nativeTypes, `${e.species} lacks native type ${e.grantedType}`).toContain(e.grantedType);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("SWEEP INTEGRITY: no species/form retains a type-grant ability (except intentional replacements)", () => {
    const grants = new Set<number>(ER_TYPE_GRANT_ABILITY_IDS);
    // A handful of maintainer-chosen REPLACEMENTS are themselves type-grant
    // abilities (Plundertow -> Aquatic, Dodrio -> Bruiser). Those are intentional:
    // allow the (speciesId, replacement) pairs derived from the table.
    const allowed = new Set<string>();
    for (const e of ER_TYPE_NATIVIZATION) {
      if (!grants.has(e.replacement)) {
        continue;
      }
      const id = resolveErSpeciesConstId(e.species);
      if (id !== undefined) {
        allowed.add(`${id}:${e.replacement}`);
        // Also the base species the form lives on (Dodrio's form-0 case).
        const baseId = resolveErSpeciesConstId(e.species.replace(/(_MEGA|_PRIMAL|_REDUX|_FUZZ)+$/, ""));
        if (baseId !== undefined) {
          allowed.add(`${baseId}:${e.replacement}`);
        }
      }
    }
    const residual: string[] = [];
    for (const sp of allSpecies) {
      // The species (form 0) and each of its forms.
      const shells: { target: PokemonSpeciesForm; formIndex: number }[] = [
        { target: sp as unknown as PokemonSpeciesForm, formIndex: 0 },
        ...sp.forms.map((f, i) => ({ target: f as unknown as PokemonSpeciesForm, formIndex: i })),
      ];
      for (const { target, formIndex } of shells) {
        const passives = sp.getPassiveAbilities(formIndex);
        for (const abilityId of abilityIdsOf(target, passives)) {
          if (!grants.has(abilityId)) {
            continue;
          }
          // Intentional: a maintainer-chosen replacement that is itself a type-grant.
          if (allowed.has(`${sp.speciesId}:${abilityId}`)) {
            continue;
          }
          residual.push(
            `speciesId ${sp.speciesId} form ${formIndex} name ${sp.name} still carries type-grant ${abilityId}`,
          );
        }
      }
    }
    expect(residual, `Unswept type-grant holders:\n${residual.join("\n")}`).toEqual([]);
  });

  it("SMALL CHANGES: pure ability swaps applied", () => {
    for (const swap of ER_ABILITY_SWAPS) {
      const id = resolveErSpeciesConstId(swap.species);
      const sp = id === undefined ? undefined : speciesById(id);
      expect(sp, `${swap.species} resolved`).toBeTruthy();
      if (!sp) {
        continue;
      }
      const all = abilityIdsOf(sp as unknown as PokemonSpeciesForm, sp.getPassiveAbilities(0));
      expect(all, `${swap.species} still has ${swap.from}`).not.toContain(swap.from);
      expect(all, `${swap.species} missing ${swap.to}`).toContain(swap.to);
    }
  });
});
