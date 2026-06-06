/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Infernape Redux fixes (0.0.3.5).
//
// Three user-reported bugs are regression-pinned here:
//
//  (a) SPRITE: Infernape Redux was showing an unrelated sprite (its own
//      upstream `infernape_redux/` art directory ships wrong frames). The
//      registration now overrides its sprite slug to the correct `infernape`
//      art. We assert the live species resolves its sprite atlas path to
//      `elite-redux/infernape/...`.
//
//  (b) JUNK "Infernape Redux B": ER's dump ships a degenerate placeholder
//      (`SPECIES_INFERNAPE_REDUX_B`, all-zero stats, no abilities). It must NOT
//      be registered as an obtainable species at all. We assert it is absent
//      from `allSpecies` (and therefore from the egg pool).
//
//  (c) LONG REACH vs FLAME BODY: Infernape Redux's ER kit is Long Reach
//      (innate — physical moves don't make contact) + Water Veil (a possible
//      active ability — burn-immune). When a Long-Reach attacker hits a
//      Flame-Body holder with a *contact* move, contact is suppressed, so the
//      attacker must NOT be burned. The control (no Long Reach) IS burned —
//      proving the gate, not a dead assertion. We also pin the species' actual
//      ability/innate wiring (Long Reach + Water Veil present).
//
// The Long-Reach behavioral cases are gated behind ER_SCENARIO=1 (they boot a
// real battle); the data-wiring cases run unconditionally.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

/** Force every chance roll to its minimum so a 30% Flame Body proc always fires. */
function mockRngMin(): () => void {
  const saved = BattleScene.prototype.randBattleSeedInt;
  BattleScene.prototype.randBattleSeedInt = (_range, min = 0) => min;
  return () => {
    BattleScene.prototype.randBattleSeedInt = saved;
  };
}

const findByName = (name: string) => allSpecies.find(s => s.name.toLowerCase() === name.toLowerCase());

describe("ER Infernape Redux — species data wiring", () => {
  it("(b) the junk 'Infernape Redux B' is NOT registered as a species", () => {
    expect(findByName("Infernape Redux B"), "degenerate stub must not be an obtainable species").toBeUndefined();
  });

  it("(a) Infernape Redux resolves to the correct 'infernape' sprite atlas", () => {
    const infernapeRedux = findByName("Infernape Redux");
    expect(infernapeRedux, "Infernape Redux should exist").toBeDefined();
    // getSpriteAtlasPath(female, formIndex, shiny, variant, back) → "elite-redux/<slug>/front"
    const frontPath = infernapeRedux!.getSpriteAtlasPath(false, 0, false, 0, false);
    expect(frontPath).toBe("elite-redux/infernape/front");
    const backPath = infernapeRedux!.getSpriteAtlasPath(false, 0, false, 0, true);
    expect(backPath).toBe("elite-redux/infernape/back");
  });

  it("(c) Infernape Redux's kit carries Long Reach (innate) + Water Veil (ability)", () => {
    const infernapeRedux = findByName("Infernape Redux");
    expect(infernapeRedux, "Infernape Redux should exist").toBeDefined();

    // Active-ability slots (ability1/ability2/abilityHidden). Water Veil is the
    // burn-immune ability in the ER kit.
    const abilityIds = [infernapeRedux!.ability1, infernapeRedux!.ability2, infernapeRedux!.abilityHidden];
    expect(abilityIds, "Water Veil must be one of the active abilities").toContain(AbilityId.WATER_VEIL);

    // Innates (ER 3-passive triple). Long Reach is the contact-suppressing innate.
    const passiveIds = infernapeRedux!.getPassiveAbilities(0);
    expect(passiveIds, "Long Reach must be an innate").toContain(AbilityId.LONG_REACH);
  });
});

describe.skipIf(!RUN_SCENARIOS)("ER Infernape Redux — Long Reach suppresses enemy Flame Body contact-burn", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("(c) a Long Reach attacker is NOT burned when its CONTACT move hits a Flame Body holder", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.LONG_REACH) // attacker ignores contact
      .enemyAbility(AbilityId.FLAME_BODY) // would burn an attacker that makes contact
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]) // Tackle is a physical contact move
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    // SNORLAX (Normal) attacker — not Fire-typed, so burn isn't blocked by typing;
    // ability is overridden to Long Reach so Water Veil isn't masking the result.
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();

    // Long Reach suppressed contact → Flame Body never procs on the attacker.
    expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
  });

  it("(c control) WITHOUT Long Reach, the same CONTACT move DOES get the attacker burned", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH) // no contact suppression, no burn immunity
      .enemyAbility(AbilityId.FLAME_BODY)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();

    // Proves the gate is meaningful: contact makes Flame Body burn the attacker.
    expect(player.status?.effect).toBe(StatusEffect.BURN);
  });
});
