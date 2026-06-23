/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #629: live report - "Entered the boss, H-Zoroark just one-tapped me at nearly
// full health, and now it says that I can still attack even though the mon is
// fainted." The foe had the ER Forest `Ambush` flavor.
//
// ER Forest/Snowy-Forest ambush (turn-init-phase.ts `applyErForestAmbush`) gives a
// WILD foe a FREE turn-1 move when the player's lead is slower. That move is
// UNSHIFTED ahead of the player's already-queued CommandPhase. Before the fix, if
// the ambush KO'd the lead, FaintPhase only pushed its forced-switch SwitchPhase to
// the BACK of the queue, so the CommandPhase ran first and offered the Fight menu
// for the FAINTED lead. The fix interposes a modal faint-switch (per active player
// slot) right after the ambush move, so the replacement is summoned BEFORE the
// command - and that switch cleanly no-ops when the lead survives the ambush.
//
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-forest-ambush-faint-switch.test.ts

import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)(
  "ER Forest ambush must force a switch before the command, never command a fainted mon (#629)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .battleStyle("single")
        .startingBiome(BiomeId.FOREST) // ambushChance 20 (forced below)
        .startingWave(1)
        .ability(AbilityId.BALL_FETCH)
        .moveset([MoveId.TACKLE])
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.TACKLE])
        .enemyLevel(100)
        .criticalHits(false);
    });

    afterEach(() => vi.restoreAllMocks());

    // Force the 20% Forest ambush roll to fire deterministically. `applyErForestAmbush`
    // skips when `randBattleSeedInt(100) >= chance`; return 0 only for the 100-roll so
    // every other RNG draw keeps its real seeded value.
    const forceAmbush = () => {
      const realRand = game.scene.randBattleSeedInt.bind(game.scene);
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) =>
        range === 100 ? min : realRand(range, min),
      );
    };

    it("an ambush KO forces a switch first; the command is for the LIVE replacement, not the fainted lead", async () => {
      forceAmbush();
      game.override.startingLevel(5); // frail, slow L5 lead -> outsped + one-shot by the L100 foe

      // Get to the encounter FIRST (a prompt queued before runToSummon would sit at
      // the head of the prompt queue and block runToSummon's own TitlePhase prompt),
      // THEN queue the answer to the forced faint-switch: send out benched slot 1.
      await game.classicMode.runToSummon(SpeciesId.MAGIKARP, SpeciesId.PIKACHU);
      game.doSelectPartyPokemon(1, "SwitchPhase");
      await game.phaseInterceptor.to("CommandPhase");

      const party = game.scene.getPlayerParty();
      const magikarp = party.find(p => p.species.speciesId === SpeciesId.MAGIKARP)!;
      const pikachu = party.find(p => p.species.speciesId === SpeciesId.PIKACHU)!;
      const slot0 = game.scene.getPlayerField()[0];
      const log = game.phaseInterceptor.log;
      const switchIdx = log.indexOf("SwitchPhase");
      const cmdIdx = log.lastIndexOf("CommandPhase");

      console.log(
        `#629 KO fix: magikarpFainted=${magikarp.isFainted()} magikarpOnField=${magikarp.isOnField()} `
          + `slot0=${slot0?.species.name} slot0Fainted=${slot0?.isFainted()} switchIdx=${switchIdx} cmdIdx=${cmdIdx}`,
      );

      // The ambush one-shot the lead...
      expect(magikarp.isFainted(), "the ambush KO'd the frail lead").toBe(true);
      expect(magikarp.isOnField(), "the fainted lead left the field").toBe(false);
      // ...and a forced switch ran BEFORE the settled CommandPhase...
      expect(switchIdx, "a SwitchPhase ran").toBeGreaterThanOrEqual(0);
      expect(switchIdx, "the SwitchPhase ran BEFORE the command (not queued behind it)").toBeLessThan(cmdIdx);
      // ...so the command is presented for the LIVE replacement, never the fainted lead.
      expect(game.isCurrentPhase("CommandPhase"), "settled on a CommandPhase").toBe(true);
      expect(slot0, "the live replacement occupies the lead slot").toBe(pikachu);
      expect(slot0.isFainted(), "the commanding mon is NOT fainted").toBe(false);
      expect(slot0.isOnField()).toBe(true);
    }, 120_000);

    it("an ambush that does NOT KO leaves the lead active and presents a normal command (switch no-ops)", async () => {
      forceAmbush();
      game.override.startingLevel(100); // bulky, slow lead survives the ambush hit

      await game.classicMode.startBattle(SpeciesId.SHUCKLE, SpeciesId.PIKACHU);

      const lead = game.scene.getPlayerField()[0];
      const log = game.phaseInterceptor.log;
      const ambushMoveIdx = log.indexOf("MovePhase");
      const cmdIdx = log.lastIndexOf("CommandPhase");

      console.log(
        `#629 survive: lead=${lead?.species.name} fainted=${lead?.isFainted()} `
          + `hp=${lead?.hp}/${lead?.getMaxHp()} ambushMoveIdx=${ambushMoveIdx} cmdIdx=${cmdIdx}`,
      );

      // The ambush fired (a MovePhase ran before the player's command) but did not KO.
      expect(ambushMoveIdx, "the ambush move ran before the command").toBeGreaterThanOrEqual(0);
      expect(ambushMoveIdx).toBeLessThan(cmdIdx);
      expect(lead.species.speciesId, "the bulky lead is still the active mon").toBe(SpeciesId.SHUCKLE);
      expect(lead.isFainted(), "the bulky lead survived the ambush").toBe(false);
      expect(lead.hp, "the lead took the ambush hit").toBeLessThan(lead.getMaxHp());
      expect(game.isCurrentPhase("CommandPhase"), "a normal command is presented for the live lead").toBe(true);
    }, 120_000);
  },
);
