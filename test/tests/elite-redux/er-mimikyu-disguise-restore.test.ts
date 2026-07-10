/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Fix: the ER-custom Mimikyu tiers (Apex 10821, Rayquaza 10767) never healed
// their busted disguise. Vanilla DISGUISE resets to form 0 via
// PostBattleInitFormChangeAbAttr / PostFaintFormChangeAbAttr, both of which fire
// the ABILITY form-change trigger — but the ER tiers only registered the ONE-WAY
// intact -> busted edge, so the reset no-op'd and the busted form persisted.
//
// Two parts:
//   1. Both tiers now register the `busted -> ""` (revert) ability edge, so the
//      DISGUISE reset attrs can heal the busted form. (Also: registering the
//      previously-missing PostFaintFormChangeAbAttr in the ability-attr registry
//      is what makes the faint-reset resolvable at all.)
//   2. Patchwork (Rayquaza, ER 693) additionally restores the disguise in FOG
//      via FogRestoreDisguiseFormChangeAbAttr (fog set) +
//      PostSummonFogRestoreDisguiseAbAttr (switch-in during fog).
//
// This is a DATA-level test (form-change edge registry) — the injection runs at
// ER init, which the ER_SCENARIO GameManager boot performs.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { FogRestoreDisguiseFormChangeAbAttr } from "#abilities/ab-attrs";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import type { AbilityId } from "#enums/ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const MIMIKYU_APEX = 10821;
const MIMIKYU_RAYQUAZA = 10767;
const PATCHWORK = ER_ID_MAP.abilities[693] as AbilityId;

function hasEdge(speciesId: number, preFormKey: string, formKey: string): boolean {
  return (pokemonFormChanges[speciesId] ?? []).some(c => c.preFormKey === preFormKey && c.formKey === formKey);
}

describe.skipIf(!RUN)("ER Mimikyu disguise restore (busted -> intact edge)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // Booting a GameManager runs full ER init, which injects the custom forms.
    // eslint-disable-next-line no-new
    new GameManager(phaserGame);
  });

  test("Mimikyu Apex registers BOTH the break and the restore edges", () => {
    // Break edge (was already present) and the new restore edge.
    expect(hasEdge(MIMIKYU_APEX, "", "busted")).toBe(true);
    expect(hasEdge(MIMIKYU_APEX, "busted", "")).toBe(true);
  });

  test("Mimikyu Rayquaza registers BOTH the break and the restore edges", () => {
    expect(hasEdge(MIMIKYU_RAYQUAZA, "", "busted")).toBe(true);
    expect(hasEdge(MIMIKYU_RAYQUAZA, "busted", "")).toBe(true);
  });
});

describe.skipIf(!RUN)("ER Mimikyu disguise restore (behavior)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").ability(PATCHWORK).enemySpecies(SpeciesId.SNORLAX);
  });

  test("a busted Mimikyu Rayquaza heals via the ability form-change trigger", async () => {
    await game.classicMode.startBattle(ErSpeciesId.MIMIKYU_RAYQUAZA as unknown as SpeciesId);
    const player = game.field.getPlayerPokemon();

    // Simulate a broken disguise (the FormBlockDamage break path leaves the
    // holder in form index 1). Before the fix there was no busted -> "" edge, so
    // the ability form-change trigger found no matching change and no-op'd
    // (returned false), leaving the holder busted forever.
    player.formIndex = 1;
    // triggerPokemonFormChange returns true iff it found a matching form change
    // (correct trigger + preFormKey + canChange) and enqueued the standard quiet
    // form-change phase that sets formIndex. Pre-fix this returned FALSE (no
    // busted -> "" edge existed), so the disguise never healed.
    const matched = game.scene.triggerPokemonFormChange(player, SpeciesFormChangeAbilityTrigger);
    expect(matched).toBe(true);
  });

  test("Patchwork's fog-restore attr fires only when busted AND in fog", async () => {
    await game.classicMode.startBattle(ErSpeciesId.MIMIKYU_RAYQUAZA as unknown as SpeciesId);
    const pokemon = game.field.getPlayerPokemon();
    const attr = new FogRestoreDisguiseFormChangeAbAttr(1);
    const params = (weather: WeatherType) => ({ pokemon, weather, simulated: false, passive: false }) as never;

    pokemon.formIndex = 1; // busted
    expect(attr.canApply(params(WeatherType.FOG))).toBe(true);
    expect(attr.canApply(params(WeatherType.SUNNY))).toBe(false); // wrong weather
    pokemon.formIndex = 0; // intact
    expect(attr.canApply(params(WeatherType.FOG))).toBe(false); // must not break an intact disguise
  });
});
