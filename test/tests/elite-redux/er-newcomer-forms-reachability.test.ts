/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER newcomer FORMS reachability (live tester fix — Mega Xerneas / Xerneasite).
//
// Both the Pokedex form list (`f.preFormKey === currentFormKey`) and the reward
// generator (`fc.preFormKey === p.getFormKey()`) match a form-change edge on its
// preFormKey EXACTLY. The newcomer injector used to hardcode preFormKey "", which
// is only correct for FORMLESS bases. Xerneas's base forms are "neutral"/"active"
// (never ""), so its mega edge never matched -> Xerneasite never spawned and Mega
// Xerneas was unreachable in the dex.
//
// This asserts every ER_NEWCOMER_FORMS entry has a stone edge whose preFormKey is
// a LIVE non-mega form key of the base species (so both filters match), and pins
// the Xerneas case + the mega-z recognition fix.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormKey } from "#enums/species-form-key";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER newcomer forms reachability (dex + reward pool)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    void new GameManager(phaserGame);
  });

  it("every newcomer form has a stone edge whose preFormKey matches a live base form key", () => {
    const broken: string[] = [];
    for (const def of ER_NEWCOMER_FORMS) {
      if (def.item === undefined) {
        continue;
      }
      const species = getPokemonSpecies(def.baseSpecies);
      // The form keys a live/party base mon can actually be in (exclude injected megas).
      const baseKeys = new Set(species.forms.map(f => f.formKey ?? "").filter(k => !/mega|primal/.test(k)));
      if (baseKeys.size === 0) {
        baseKeys.add(""); // formless base -> seeded "" form
      }
      const edges = (pokemonFormChanges[def.baseSpecies] ?? []).filter(fc => fc.formKey === def.formKey);
      if (edges.length === 0) {
        broken.push(`${def.formName}: no stone edge registered`);
        continue;
      }
      // At least one edge must originate from a live base form key (so both the
      // Pokedex form list and the reward generator can match it).
      const matches = edges.some(fc => baseKeys.has(fc.preFormKey));
      if (!matches) {
        broken.push(
          `${def.formName}: edge preFormKeys [${edges.map(e => `"${e.preFormKey}"`).join(", ")}] `
            + `match no live base form key [${[...baseKeys].map(k => `"${k}"`).join(", ")}]`,
        );
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });

  it('Mega Xerneas edge originates from a named base form (neutral/active), not ""', () => {
    const xerneas = ER_NEWCOMER_FORMS.find(
      d => d.formKey === "mega" && getPokemonSpecies(d.baseSpecies).name === "Xerneas",
    );
    expect(xerneas, "Xerneas mega entry present").toBeDefined();
    if (!xerneas) {
      return;
    }
    const edges = (pokemonFormChanges[xerneas.baseSpecies] ?? []).filter(fc => fc.formKey === "mega");
    const preKeys = edges.map(e => e.preFormKey);
    expect(preKeys.length).toBeGreaterThan(0);
    // Xerneas's live base forms are "neutral"/"active"; the edge must match one.
    expect(preKeys.some(k => k === "neutral" || k === "active")).toBe(true);
  });

  it("mega-z is a recognized mega form key", () => {
    expect(SpeciesFormKey.MEGA_Z).toBe("mega-z");
    // Skarmory Z / Dragonite Z use it.
    const zForms = ER_NEWCOMER_FORMS.filter(d => d.formKey === "mega-z");
    expect(zForms.length).toBeGreaterThan(0);
  });

  // #287: every newcomer form must render a sprite on the DEX PAGE, which resolves
  // through the SPECIES-level `species.getSpriteAtlasPath/getSpriteKey(formIndex)`.
  // Without `installErSpeciesFormSpriteDispatch(species)`, bases in neither the
  // vendor-mega nor redux sweep (Minun, Plusle) built a vanilla `{id}-mega` path
  // that 404s -> spriteless. This asserts the species-level path is redirected to
  // the ER slug for ALL 12 forms.
  it("every newcomer form resolves its SPECIES-level sprite atlas to the ER slug (dex-page render path)", () => {
    const broken: string[] = [];
    for (const def of ER_NEWCOMER_FORMS) {
      const species = getPokemonSpecies(def.baseSpecies);
      const formIndex = species.forms.findIndex(f => f.formKey === def.formKey);
      if (formIndex < 0) {
        broken.push(`${def.formName}: form ${def.formKey} not injected onto ${species.name}`);
        continue;
      }
      // The dex page calls the SPECIES method (not the FORM method) with the mega
      // formIndex — this is exactly what was spriteless for Minun/Plusle.
      const atlas = species.getSpriteAtlasPath(false, formIndex, false, 0, false);
      const key = species.getSpriteKey(false, formIndex, false, 0, false);
      if (!atlas.includes(def.slug)) {
        broken.push(`${def.formName}: species atlas "${atlas}" does not reference slug "${def.slug}"`);
      }
      if (!key.includes(def.slug)) {
        broken.push(`${def.formName}: species sprite key "${key}" does not reference slug "${def.slug}"`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});
