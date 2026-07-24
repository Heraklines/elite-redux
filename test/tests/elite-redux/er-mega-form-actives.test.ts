/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression guard for the "mega form inherits its BASE species' ACTIVE
// abilities" bug class (maintainer report, 2026-07).
//
// A hand-authored mega/Z form in ER_NEWCOMER_FORMS must carry its OWN active
// ability triple, NOT the base species' actives. This asserts, for the three
// forms called out in the report:
//   - Fidough Mega  — authoritative (maintainer-provided): Misty Surge,
//     Rising Dough, Pretty Privilege (exact triple locked here);
//   - Kingdra Mega Y and Lucario Mega Z — their active triple is DISJOINT from
//     the base species' actives (the "inherited base actives" guard). The exact
//     triple is intentionally NOT hard-locked: those forms are absent from the
//     ER 2.65 dex and their authoritative actives are pending a maintainer hand-
//     off, so we only assert the confirmed-correct property (own kit != base).
//
// Also verifies at RUNTIME that a mon spawned into the mega form resolves its
// FORM active (not the base species active) through the real getAbility path.
//
// Base actives (ER 2.65 dex, verified live):
//   Kingdra : Swift Swim / Skill Link / Raging Storm
//   Lucario : Fighting Spirit / Justified / Magical Fists
//   Fidough : Gluttony / Aroma Veil / Strong Jaw
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// ER-custom active ability ids (no vanilla AbilityId enum member).
const RISING_DOUGH = 5453; // ER draft 752
const PRETTY_PRIVILEGE = 5332; // ER draft 628

function baseActives(sp: SpeciesId): number[] {
  const s = getPokemonSpecies(sp);
  return [s.ability1, s.ability2, s.abilityHidden];
}

function formActives(sp: SpeciesId, formKey: string): number[] {
  const form = getPokemonSpecies(sp).forms.find(f => f.formKey === formKey)!;
  return [form.ability1, form.ability2, form.abilityHidden];
}

describe.skipIf(!RUN)("ER mega/Z form active abilities (own kit, not base)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(50).startingLevel(50);
  });

  it("Fidough Mega carries Misty Surge / Rising Dough / Pretty Privilege (exact) and differs from base", () => {
    const form = getPokemonSpecies(SpeciesId.FIDOUGH).forms.find(f => f.formKey === "mega");
    expect(form, "Fidough Mega form injected").toBeDefined();
    expect(formActives(SpeciesId.FIDOUGH, "mega")).toEqual([AbilityId.MISTY_SURGE, RISING_DOUGH, PRETTY_PRIVILEGE]);
    // Disjoint from base Fidough actives (Gluttony / Aroma Veil / Strong Jaw).
    const base = new Set(baseActives(SpeciesId.FIDOUGH));
    for (const a of formActives(SpeciesId.FIDOUGH, "mega")) {
      expect(base.has(a), `Fidough Mega active ${a} must not be a base active`).toBe(false);
    }
  });

  it("Kingdra Mega Y active kit is disjoint from base Kingdra actives", () => {
    const form = getPokemonSpecies(SpeciesId.KINGDRA).forms.find(f => f.formKey === "mega-y");
    expect(form, "Kingdra Mega Y form injected").toBeDefined();
    const base = new Set(baseActives(SpeciesId.KINGDRA));
    const actives = formActives(SpeciesId.KINGDRA, "mega-y");
    for (const a of actives) {
      expect(base.has(a), `Kingdra Mega Y active ${a} must not be a base active`).toBe(false);
    }
    expect(actives).not.toEqual(baseActives(SpeciesId.KINGDRA));
  });

  it("Lucario Mega Z active kit is disjoint from base Lucario actives", () => {
    const form = getPokemonSpecies(SpeciesId.LUCARIO).forms.find(f => f.formKey === "mega");
    expect(form, "Lucario Mega Z form injected").toBeDefined();
    expect(form!.formName).toBe("Mega Z");
    const base = new Set(baseActives(SpeciesId.LUCARIO));
    const actives = formActives(SpeciesId.LUCARIO, "mega");
    for (const a of actives) {
      expect(base.has(a), `Lucario Mega Z active ${a} must not be a base active`).toBe(false);
    }
    expect(actives).not.toEqual(baseActives(SpeciesId.LUCARIO));
  });

  it("RUNTIME: Fidough Mega resolves Misty Surge (form active), not base Gluttony", async () => {
    await game.classicMode.startBattle(SpeciesId.FIDOUGH);
    const mon = game.scene.getPlayerPokemon()!;
    mon.formIndex = mon.species.forms.findIndex(f => f.formKey === "mega");
    mon.abilityIndex = 0;
    expect(mon.getAbility().id).toBe(AbilityId.MISTY_SURGE);
    expect(mon.getAbility().id).not.toBe(getPokemonSpecies(SpeciesId.FIDOUGH).ability1);
  });

  it("RUNTIME: Kingdra Mega Y resolves its form active, not base Swift Swim", async () => {
    await game.classicMode.startBattle(SpeciesId.KINGDRA);
    const mon = game.scene.getPlayerPokemon()!;
    mon.formIndex = mon.species.forms.findIndex(f => f.formKey === "mega-y");
    const formA1 = formActives(SpeciesId.KINGDRA, "mega-y")[0];
    for (let ai = 0; ai < 3; ai++) {
      mon.abilityIndex = ai;
      expect(mon.getAbility().id).toBe(formActives(SpeciesId.KINGDRA, "mega-y")[ai]);
    }
    mon.abilityIndex = 0;
    expect(mon.getAbility().id).toBe(formA1);
    expect(mon.getAbility().id).not.toBe(getPokemonSpecies(SpeciesId.KINGDRA).ability1);
  });

  it("RUNTIME: Lucario Mega Z resolves its form active, not base Fighting Spirit", async () => {
    await game.classicMode.startBattle(SpeciesId.LUCARIO);
    const mon = game.scene.getPlayerPokemon()!;
    mon.formIndex = mon.species.forms.findIndex(f => f.formKey === "mega");
    for (let ai = 0; ai < 3; ai++) {
      mon.abilityIndex = ai;
      expect(mon.getAbility().id).toBe(formActives(SpeciesId.LUCARIO, "mega")[ai]);
    }
    mon.abilityIndex = 0;
    expect(mon.getAbility().id).not.toBe(getPokemonSpecies(SpeciesId.LUCARIO).ability1);
  });
});
