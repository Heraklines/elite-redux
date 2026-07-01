/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: "Queen's Mourning" (ER ability 410) raises the holder's Sp.Atk
// and Sp.Def by one stage ONCE PER STAT LOWERED on the HOLDER **and its ALLY**
// (2.65 dex: "triggers when the user or their ally has their stats lowered ...
// Does not activate from self drops"). Previously it only counted the holder's
// own drops (Defiant-style), and once per event instead of per stat.
//
// Bug-report scenario: a Fearmonger switch-in lowers ATK+Sp.Atk on both the
// holder and its ally = 4 stat drops. Queen's Mourning must end at +3 Sp.Atk
// (-1 from Fearmonger, +4 from the ability) and +4 Sp.Def.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const QUEENS_MOURNING = 5146 as AbilityId; // ER ability 410
const KINGS_WRATH = 5145 as AbilityId; // ER ability 409 (Atk/Def sibling)

describe.skipIf(!RUN)("ER Queen's Mourning counts holder + ally, per stat", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  /** Drop [ATK, SpAtk] by 1 on a field mon from a foreign source (one phase, 2 stats). */
  function foreignDrop(battlerIndex: number): void {
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", battlerIndex, false, [Stat.ATK, Stat.SPATK], -1);
  }

  it("Fearmonger drops (holder + ally, 2 stats each) => +3 Sp.Atk / +4 Sp.Def on the holder", async () => {
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .ability(QUEENS_MOURNING)
      .enemyAbility(AbilityId.BALL_FETCH);
    // NOTE: rest args (NOT an array) or the party silently collapses to one mon.
    await game.classicMode.startBattle(SpeciesId.GALLADE, SpeciesId.SNORLAX);

    const [lead, ally] = game.scene.getPlayerField();
    foreignDrop(lead.getBattlerIndex());
    foreignDrop(ally.getBattlerIndex());
    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    // +4 Sp.Def = 2 (holder's own [ATK,SpAtk]) + 2 (ally's [ATK,SpAtk]); proves
    // both per-stat counting AND ally-side observation.
    expect(lead.getStatStage(Stat.SPDEF)).toBe(4);
    // +3 Sp.Atk = -1 (Fearmonger) + 4 (Queen's Mourning).
    expect(lead.getStatStage(Stat.SPATK)).toBe(3);
    // Fearmonger's ATK drop is not undone by Queen's Mourning.
    expect(lead.getStatStage(Stat.ATK)).toBe(-1);
  });

  it("does NOT activate from the holder's OWN self-inflicted drop", async () => {
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .ability(QUEENS_MOURNING)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GALLADE, SpeciesId.SNORLAX);

    const [lead] = game.scene.getPlayerField();
    // selfTarget = true: a self-inflicted drop must NOT trigger the ability.
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", lead.getBattlerIndex(), true, [Stat.DEF], -1);
    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    expect(lead.getStatStage(Stat.SPDEF)).toBe(0);
    expect(lead.getStatStage(Stat.SPATK)).toBe(0);
  });

  it("King's Wrath (sibling) likewise counts holder + ally: +4 Atk / +4 Def", async () => {
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH])
      .ability(KINGS_WRATH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GALLADE, SpeciesId.SNORLAX);

    const [lead, ally] = game.scene.getPlayerField();
    // Drop only Sp.Def+Sp.Atk (stats King's Wrath does NOT raise) so its Atk/Def
    // boosts are isolated: +4 each from 2 (own) + 2 (ally) lowered stats.
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      lead.getBattlerIndex(),
      false,
      [Stat.SPDEF, Stat.SPATK],
      -1,
    );
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      ally.getBattlerIndex(),
      false,
      [Stat.SPDEF, Stat.SPATK],
      -1,
    );
    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    expect(lead.getStatStage(Stat.ATK)).toBe(4);
    expect(lead.getStatStage(Stat.DEF)).toBe(4);
  });
});
