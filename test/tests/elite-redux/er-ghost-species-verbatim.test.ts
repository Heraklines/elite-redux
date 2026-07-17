/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#419 follow-up) - a fielded GHOST team must preserve its uploader's
// roster VERBATIM. The reported bug: the universal #419 BST power gate (run from
// the EnemyPokemon constructor) devolved/SWAPPED a ghost's stored species to the
// wave's BST ceiling at an early ghost wave (e.g. a Snorlax/Dragonite ghost fielded
// at wave 5 came out as a different, weaker species with a different moveset).
//
// A ghost's fairness is enforced by WAVE ELIGIBILITY (the +40 ER_GHOST_WAVE_WINDOW
// at selection) and, on the early CHALLENGE waves only, by the module's own fairness
// re-level/devolve - NOT by mutating the species to the wave ceiling. This proves the
// summoned enemy species equals the snapshot species 1:1 even for high-BST evolved
// mons fielded far below their BST cap wave.
//
// ER_SCENARIO=1 gated (drives a real GameManager spawn).
// =============================================================================

import {
  type GhostMember,
  type GhostTeamSnapshot,
  hasErGhostOverride,
  setPrefetchedGhostTeamsForTests,
} from "#data/elite-redux/er-ghost-teams";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const member = (speciesId: number, moves: number[]): GhostMember => ({
  speciesId,
  formIndex: 0,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 20,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves,
});

// Fully-evolved, high-BST lines that the wave-5 BST ceiling would otherwise
// devolve/swap (Snorlax 540, Dragonite 600, Salamence 600).
const SNAPSHOT: GhostTeamSnapshot = {
  id: "ghost-verbatim-1",
  trainerName: "Uploader",
  difficulty: "hell",
  waveReached: 40,
  isVictory: true,
  timestamp: 1,
  party: [
    member(SpeciesId.SNORLAX, [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.EARTHQUAKE, MoveId.REST]),
    member(SpeciesId.DRAGONITE, [MoveId.OUTRAGE, MoveId.EARTHQUAKE, MoveId.FIRE_PUNCH, MoveId.ROOST]),
    member(SpeciesId.SALAMENCE, [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.FLY, MoveId.CRUNCH]),
  ],
};

describe.skipIf(!RUN)("ER ghost teams - roster preserved verbatim (no BST-cap species swap) (#419)", () => {
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

  it("summons every stored species unchanged at an early ghost wave (no devolve/swap to the BST ceiling)", async () => {
    setPrefetchedGhostTeamsForTests([SNAPSHOT]);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP);

    const host = game.scene.currentBattle.trainer;
    expect(host, "wave-5 ghost-trainers battle should field a ghost").not.toBeNull();
    expect(hasErGhostOverride(host!)).toBe(true);

    const enemyParty = game.scene.getEnemyParty();
    // Snapshot -> summoned species equality, member for member.
    const summoned = enemyParty.map(e => e.species.speciesId);
    const stored = SNAPSHOT.party.map(m => m.speciesId);
    expect(summoned).toStrictEqual(stored);

    // The lead keeps its stored moveset verbatim (species matched, so the stored
    // loadout is restored rather than a wave-appropriate generated one).
    const leadMoves = enemyParty[0].moveset.filter(Boolean).map(m => m!.moveId);
    expect(leadMoves).toStrictEqual(SNAPSHOT.party[0].moves);
  });
});
