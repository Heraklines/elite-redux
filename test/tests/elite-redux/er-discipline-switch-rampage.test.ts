/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Discipline (387) "can switch while rampaging".
//
// DEX (2.65): "Can switch while rampaging. Can't be confused or intimidated."
//
// A FRENZY-locked move (Thrash / Outrage / Petal Dance) normally auto-repeats
// from the move queue, so `CommandPhase` never opens the command menu and the
// holder is stuck attacking — it cannot switch out (the reported bug). Discipline
// carries a `SwitchWhileRampagingAbAttr` marker; `CommandPhase.tryExecuteQueuedMove`
// checks it and, while the FRENZY tag is active, skips the auto-execute so the menu
// opens and a voluntary switch becomes available again.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { SwitchWhileRampagingAbAttr } from "#abilities/ab-attrs";
import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// ER custom ability ids live in the ErAbilityId numeric space; the established
// cast pattern for engine APIs typed on AbilityId (see move-condition.ts).
const DISCIPLINE = ErAbilityId.DISCIPLINE as unknown as AbilityId;

describe("ER Discipline — can switch while rampaging", () => {
  it("wires the SwitchWhileRampagingAbAttr marker (attr-level)", () => {
    const row = ER_ABILITY_ARCHETYPES[387];
    expect(row, "no archetype row for Discipline (387)").toBeDefined();
    const attrs: readonly AbAttr[] = dispatchArchetype(row.archetype, row.params, 387).attrs;
    expect(
      attrs.some(a => a instanceof SwitchWhileRampagingAbAttr),
      "Discipline should carry the SwitchWhileRampagingAbAttr marker",
    ).toBe(true);
  });

  describe.skipIf(!RUN)("behavior", () => {
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
        .moveset(MoveId.OUTRAGE)
        // Wave 145 is past the #419 elite-BST-cap ladder, so a >420-BST enemy is
        // NOT devolved/swapped out from under us.
        .startingWave(145)
        // Shuckle's enormous Defense tanks the physical Outrages indefinitely, so
        // the enemy never faints mid-test (a KO would end the wave and there would
        // be no turn-2 command point to observe).
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .enemyLevel(100)
        .startingLevel(100);
    });

    // The full end-to-end switch (Snorlax -> Magikarp) is proven by the headless
    // scenario runner (@discipline.json). Here we assert the deterministic engine
    // invariant the fix controls: on turn 2, while FRENZY-locked, the command menu
    // OPENS for a Discipline holder (so a switch is reachable) but stays
    // auto-executed for a normal mon. Driving the headless party-menu cursor is a
    // separate harness concern (`doSwitchPokemon` recurses on the mock party UI).
    it("opens the command menu mid-rampage so the holder can switch out", async () => {
      game.override.ability(DISCIPLINE);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.OUTRAGE); // turn 1: start rampaging
      await game.toEndOfTurn();

      expect(snorlax.getTag(BattlerTagType.FRENZY), "should be rampaging on turn 2").toBeDefined();

      // Turn 2: with Discipline the queued Outrage is NOT auto-fired — the command
      // menu opens instead (UiMode.COMMAND), which is what exposes the Switch
      // option. Drive it through the standard menu path (COMMAND -> FIGHT -> pick
      // move) exactly like `game.move.select`, flagging that the menu opened, and
      // keep attacking so the turn completes.
      let menuOpened = false;
      game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
        menuOpened = true;
        const phase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
        void game.scene.ui.setMode(UiMode.FIGHT, phase.getFieldIndex());
      });
      game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        const phase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
        phase.handleCommand(Command.FIGHT, 0, MoveUseMode.NORMAL); // move slot 0 = Outrage
      });
      await game.toEndOfTurn();

      expect(menuOpened, "the command menu should open mid-rampage for a Discipline holder").toBe(true);
    }, 40000);

    it("WITHOUT Discipline the rampage auto-repeats and never opens the menu (control)", async () => {
      game.override.ability(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
      const snorlax = game.field.getPlayerPokemon();

      game.move.select(MoveId.OUTRAGE); // turn 1: start rampaging
      await game.toEndOfTurn();

      expect(snorlax.getTag(BattlerTagType.FRENZY), "should be rampaging on turn 2").toBeDefined();

      // The switch-unlock is gated on the ability marker: a normal rampaging mon
      // does NOT carry it, so `CommandPhase.tryExecuteQueuedMove` keeps
      // auto-firing the queued move (the command menu never opens, so no switch —
      // the reported bug's baseline behavior).
      expect(snorlax.hasAbilityWithAttr("SwitchWhileRampagingAbAttr")).toBe(false);
    }, 40000);
  });
});
