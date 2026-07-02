/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Ghost Trainer Editor (P0) - end-to-end SPAWN integration. The pure resolver +
// sanitizer have unit coverage (er-ghost-profile.test.ts); THIS test proves the
// authored presentation actually surfaces on a REAL spawned ghost-trainer battle:
//   (1) the authored sprite/class + gender is the one built (createGhostTrainer),
//   (2) the custom name and "Title Name" reach getName (the battle-start banner),
//   (3) the three dialogue getters the encounter/victory/defeat phases display
//       return the authored lines with placeholder tokens resolved to the LOCAL
//       player's party (so the foreign player sees correct text, no raw {lead}).
//
// A SINGLE-element prefetch pool makes the drawn ghost deterministically OUR
// snapshot, so createGhostTrainer's sprite-type pick is assertable. The wave-5
// fixed Youngster/Lass battle is ghosted under the challenge (#436), giving a
// reliable spawn. ER_SCENARIO=1 gated.
// =============================================================================

import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import {
  type GhostTeamSnapshot,
  hasErGhostOverride,
  setPrefetchedGhostTeamsForTests,
} from "#data/elite-redux/er-ghost-teams";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const PRESENTATION: GhostTrainerProfile = {
  trainerType: TrainerType.ACE_TRAINER,
  female: true,
  displayName: "Revenant",
  title: "Champion",
  dialogue: {
    intro: "I have waited, {player}. Send out {lead}!",
    defeated: "Your {slayer} bested me.",
    defeatPlayer: "{lead} was never enough.",
  },
};

const SNAPSHOT: GhostTeamSnapshot = {
  id: "ghost-presentation-1",
  trainerName: "Uploader",
  difficulty: "hell",
  waveReached: 30,
  isVictory: true,
  timestamp: 1,
  presentation: PRESENTATION,
  party: [
    {
      speciesId: SpeciesId.SNORLAX,
      formIndex: 0,
      abilityIndex: 0,
      ivs: [31, 31, 31, 31, 31, 31],
      nature: 0,
      level: 20,
      gender: 0,
      shiny: false,
      variant: 0,
      passive: false,
      moves: [MoveId.TACKLE],
    },
  ],
};

describe.skipIf(!RUN)("ER Ghost Trainer Editor - authored presentation surfaces on a spawned ghost (#216)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingWave(5).startingLevel(10).ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    setPrefetchedGhostTeamsForTests([]);
    for (const c of game.scene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
  });

  it("uses the authored sprite/class + gender, name and 'Title Name', and resolves dialogue tokens to the local party", async () => {
    setPrefetchedGhostTeamsForTests([SNAPSHOT]);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    // Lead with Snorlax so {lead}/{slayer} resolve to a known, assertable name.
    await game.challengeMode.startBattle(SpeciesId.SNORLAX);

    const host = game.scene.currentBattle.trainer;
    expect(host, "wave-5 ghost-trainers battle should field a ghost").not.toBeNull();
    expect(hasErGhostOverride(host!)).toBe(true);

    // (1) Authored sprite/class + gender honored at construction (createGhostTrainer).
    expect(host!.config.trainerType).toBe(TrainerType.ACE_TRAINER);
    expect(host!.variant).toBe(TrainerVariant.FEMALE); // female:true honored (ACE_TRAINER hasGenders)
    expect(host!.getKey()).toContain("ace_trainer");

    // (2) Custom name + title. getName(_, true) is the battle-start "<name> would
    // like to battle!" banner; getName(_, false) is the bare name used elsewhere.
    expect(host!.name).toBe("Revenant");
    expect(host!.getName(TrainerSlot.TRAINER, true)).toBe("Champion Revenant");
    expect(host!.getName(TrainerSlot.TRAINER, false)).toBe("Revenant");

    // (3) Dialogue: the EXACT getters the encounter/victory/defeat phases call to
    // show the trainer's lines. Tokens must resolve to THIS client's party with no
    // raw {token} leaking through to the message UI.
    const intro = host!.getEncounterMessages()[0];
    expect(intro).toContain("Send out Snorlax!"); // {lead} -> local lead
    expect(intro).not.toMatch(/\{(player|lead|ace|slayer)\}/); // no raw token leaks

    const victory = host!.getVictoryMessages()[0]; // shown when the player beats the ghost
    expect(victory).toContain("Snorlax"); // {slayer} -> lead fallback -> Snorlax
    expect(victory).toContain("bested me");
    expect(victory).not.toMatch(/\{(player|lead|ace|slayer)\}/);

    const defeat = host!.getDefeatMessages()[0]; // shown when the ghost beats the player
    expect(defeat).toContain("Snorlax"); // {lead} -> Snorlax
    expect(defeat).toContain("was never enough");
    expect(defeat).not.toMatch(/\{(player|lead|ace|slayer)\}/);
  });
});
