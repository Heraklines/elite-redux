/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Terapagos "Primal permanent" model.
//
// Vanilla pokerogue gives Terapagos a transient Stellar chain: ""→"terastal"
// (driven by AbilityId.TERA_SHIFT's PostSummon trigger) → "stellar" (Tera) →
// "terastal" (lapse on each fight). ER overwrote Terapagos's ability kit, so
// TERA_SHIFT is gone and the ""→"terastal" edge can never fire — NONE of the
// vanilla form changes happen.
//
// The maintainer's model: Terapagos spawns in its base "" Normal form, and the
// moment the player TERASTALLIZES it (the Tera mechanic), it morphs PERMANENTLY
// into its "primal" resting form (ER id 1850, injected by injectAllErMegaForms),
// exactly like an ER mega/primal — it does NOT revert when Tera ends.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { SpeciesFormChangeLapseTeraTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Terapagos — Terastallize morphs it into permanent Primal", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("the 'primal' form is injected onto Terapagos and there is ONE coherent base-form edge", async () => {
    await game.classicMode.startBattle(SpeciesId.TERAPAGOS);
    const terapagos = game.field.getPlayerPokemon();

    const formKeys = terapagos.species.forms.map(f => f.formKey);
    console.log("[terapagos] forms:", JSON.stringify(formKeys), "spawn formIndex:", terapagos.formIndex);

    const edges = (pokemonFormChanges[SpeciesId.TERAPAGOS] ?? []).map(
      fc => `${fc.preFormKey || "<base>"}->${fc.formKey} [${fc.trigger.constructor.name}]`,
    );
    console.log("[terapagos] form-change edges:", JSON.stringify(edges));

    // Spawns BASE.
    expect(terapagos.getFormKey()).toBe("");
    // The permanent Primal resting form exists.
    expect(formKeys).toContain("primal");
    // ONE coherent base-form ("") edge — exactly one outgoing edge from base.
    const baseEdges = (pokemonFormChanges[SpeciesId.TERAPAGOS] ?? []).filter(fc => fc.preFormKey === "");
    expect(baseEdges).toHaveLength(1);
    expect(baseEdges[0].formKey).toBe("primal");
  });

  it("terastallizing Terapagos permanently changes it into Primal (formKey 'primal')", async () => {
    await game.classicMode.startBattle(SpeciesId.TERAPAGOS);
    const terapagos = game.field.getPlayerPokemon();
    expect(terapagos.getFormKey()).toBe("");

    // Terastallize via the real Tera command path (Command.TERA → TeraPhase).
    game.move.use(MoveId.SPLASH, undefined, undefined, true);
    await game.toEndOfTurn();

    expect(terapagos.isTerastallized).toBe(true);
    expect(terapagos.getFormKey()).toBe("primal");
    // Sanity: the Primal form data resolved (no __MISSING) — it carries a real
    // species form with a positive BST.
    expect(terapagos.getSpeciesForm().getBaseStatTotal()).toBeGreaterThan(0);
  });

  it("the Primal form is PERMANENT — a Tera-lapse (start of next fight) does NOT revert it", async () => {
    await game.classicMode.startBattle(SpeciesId.TERAPAGOS);
    const terapagos = game.field.getPlayerPokemon();

    game.move.use(MoveId.SPLASH, undefined, undefined, true);
    await game.toEndOfTurn();
    expect(terapagos.getFormKey()).toBe("primal");

    // Simulate the start-of-fight reset (battle-scene.ts calls resetTera on every
    // party member, which fires SpeciesFormChangeLapseTeraTrigger). There is no
    // "primal"→ lapse edge, so nothing reverts.
    terapagos.resetTera();
    expect(terapagos.isTerastallized).toBe(false);
    expect(terapagos.getFormKey()).toBe("primal");

    // And an explicit lapse trigger likewise finds nothing to do.
    const reverted = game.scene.triggerPokemonFormChange(terapagos, SpeciesFormChangeLapseTeraTrigger);
    expect(reverted).toBe(false);
    expect(terapagos.getFormKey()).toBe("primal");
  });

  it("a NON-Terapagos Tera form (Ogerpon) still terastallizes AND reverts on lapse (general mechanic intact)", async () => {
    await game.classicMode.startBattle(SpeciesId.OGERPON);
    const ogerpon = game.field.getPlayerPokemon();
    expect(ogerpon.getFormKey()).toBe("teal-mask");

    game.move.use(MoveId.SPLASH, undefined, undefined, true);
    await game.toEndOfTurn();
    expect(ogerpon.getFormKey()).toBe("teal-mask-tera");

    // Ogerpon's tera form is TRANSIENT: the lapse trigger reverts it.
    ogerpon.resetTera();
    await game.phaseInterceptor.to("QuietFormChangePhase").catch(() => {});
    expect(ogerpon.getFormKey()).toBe("teal-mask");
  });
});
