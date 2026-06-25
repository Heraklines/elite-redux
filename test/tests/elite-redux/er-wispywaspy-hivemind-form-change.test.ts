/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Wispywaspy "Hivemind" form change (Locust Swarm, ability 884).
//
// ER's Locust Swarm (er id 884 -> ErAbilityId.LOCUST_SWARM): "Changes into
// Hivemind form until 1/4 HP or less" - Wishiwashi-style School. The holder is in
// Hivemind ABOVE 1/4 HP and reverts to base only once it drops to 1/4 or below.
// The HpThresholdFormChangeAbAttr (archetype-dispatcher case 884, formAboveThreshold
// :true) fires on being hit:
//   - ABOVE 1/4 HP and not yet Hivemind -> transform into "hivemind"
//   - dropped to <= 1/4 HP while Hivemind -> revert to the base form
// This requires the "hivemind" FORM injected on base Wispywaspy (pkrg 10065)
// plus the `<base> -> hivemind` / `hivemind -> ""` form-change edges, which
// init-elite-redux-er-custom-form-changes.ts registers.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { pokemonFormChanges, type SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** Pokerogue species id of base Wispywaspy (ER id 1093). ER customs aren't in
 * the SpeciesId enum, so this is a numeric id widened to the enum type. */
const WISPYWASPY_ID = 10065 as SpeciesId;

describe("ER - Wispywaspy Hivemind form change (Locust Swarm)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .ability(ErAbilityId.LOCUST_SWARM as unknown as AbilityId)
      .startingLevel(60)
      // Huge-HP enemy at a low level so (a) the player's turn doesn't KO it
      // before it can act and (b) its damaging hit is small enough that the
      // holder survives it at ~1/4 HP — the Hivemind transform is a PostDefend
      // trigger (fires only on a hit that LANDS). Water Gun is chosen because
      // Wispywaspy (Bug/Ghost) is immune to Normal damage and has a stat-drop-
      // blocking innate (so status moves like Growl don't land either).
      .enemyLevel(8)
      .enemySpecies(SpeciesId.BLISSEY)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.WATER_GUN);
  });

  it("injects the hivemind form + transform/revert edges on base Wispywaspy", () => {
    const wispy = allSpecies.find(s => s.speciesId === WISPYWASPY_ID);
    expect(wispy, "base Wispywaspy should be registered").toBeDefined();
    expect(
      wispy?.forms.map(f => f.formKey),
      "Wispywaspy should have a base + hivemind form",
    ).toEqual(expect.arrayContaining(["", "hivemind"]));

    const fcs = pokemonFormChanges[WISPYWASPY_ID] as SpeciesFormChange[] | undefined;
    expect(fcs, "Wispywaspy should have form changes registered").toBeDefined();
    const into = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "" && fc.formKey === "hivemind");
    expect(into, "Wispywaspy should have a base -> hivemind edge").toBeDefined();
    const out = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "hivemind" && fc.formKey === "");
    expect(out, "Wispywaspy should have a hivemind -> base revert edge").toBeDefined();
  });

  it("schools into Hivemind while ABOVE 1/4 HP, and reverts to base only below it", async () => {
    await game.classicMode.startBattle(WISPYWASPY_ID);

    const wispy = game.field.getPlayerPokemon();
    expect(wispy.getFormKey()).toBe("");

    // ABOVE 1/4 HP (full, minus the enemy's tiny Water Gun): a landed hit schools it
    // into Hivemind. The holder uses a Ghost move (Lick) the Normal-type enemy is
    // immune to, so the enemy survives to land its hit and fire the PostDefend trigger.
    game.move.use(MoveId.LICK);
    await game.toEndOfTurn();
    expect(wispy.getFormKey()).toBe("hivemind");

    // Drop BELOW 1/4 HP: the next landed hit reverts it to base (it stays Hivemind from
    // full HP all the way down to 1/4 - only crossing to 1/4-or-below reverts it).
    wispy.hp = Math.max(1, Math.floor(wispy.getMaxHp() * 0.25) - 1);
    game.move.use(MoveId.LICK);
    await game.toEndOfTurn();
    expect(wispy.getFormKey()).toBe("");
  });
});
