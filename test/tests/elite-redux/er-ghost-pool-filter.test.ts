/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression — ghost-pool integrity:
//  1. BAN LIST: a snapshot containing any banned (hacked/impossible) mon —
//     Eternamax Eternatus, Fallen Kartana, Kecleong, Primal Victini, Mega
//     Yveltal, Crowned Zacian, Origin Dialga/Palkia, Primal Cascoon, Shadow
//     Rider Calyrex, Nightmare Darkrai — is excluded from the ghost pool, in
//     BOTH representations (standalone ER species id AND vanilla species +
//     form).
//  2. WAVE WINDOW: a ghost fielded at wave W must come from a run that ended
//     between W and W + ER_GHOST_WAVE_WINDOW (no endgame teams at wave 87).
//     Lost runs are fine — proximity is the only constraint.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import {
  ER_GHOST_WAVE_WINDOW,
  type GhostTeamSnapshot,
  isErGhostTeamLegal,
  resetErGhostRunState,
  setPrefetchedGhostTeamsForTests,
  takeGhostForWave,
} from "#data/elite-redux/er-ghost-teams";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const member = (speciesId: number, formIndex = 0) => ({
  speciesId,
  formIndex,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 80,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves: [],
});

const snapshot = (id: string, waveReached: number, party: ReturnType<typeof member>[]): GhostTeamSnapshot => ({
  id,
  trainerName: "PoolTest",
  difficulty: "hell",
  waveReached,
  isVictory: false,
  timestamp: 1,
  party,
});

/** formIndex of the first form whose key matches, or -1. */
const formIndexOf = (speciesId: number, pattern: RegExp): number =>
  getPokemonSpecies(speciesId)?.forms?.findIndex(f => pattern.test(f.formKey.toLowerCase())) ?? -1;

describe.skipIf(!RUN)("ER ghost pool integrity (ban list + wave window)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetErGhostRunState();
    setErDifficulty("hell");
  });
  afterEach(() => {
    resetErGhostRunState();
    setErDifficulty("ace");
  });

  it("bans every listed standalone ER species id", () => {
    const banned = [
      ErSpeciesId.ETERNATUS_ETERNAMAX,
      ErSpeciesId.KARTANA_FALLEN,
      ErSpeciesId.KECLEONG,
      ErSpeciesId.VICTINI_PRIMAL,
      ErSpeciesId.YVELTAL_MEGA,
      ErSpeciesId.ZACIAN_CROWNED_SWORD,
      ErSpeciesId.DIALGA_ORIGIN,
      ErSpeciesId.PALKIA_ORIGIN,
      ErSpeciesId.CASCOON_PRIMAL,
      ErSpeciesId.CALYREX_SHADOW_RIDER,
      ErSpeciesId.DARKRAI_NIGHTMARE,
    ];
    for (const id of banned) {
      expect(isErGhostTeamLegal(snapshot("s", 100, [member(SpeciesId.PIKACHU), member(id)])), `id ${id}`).toBe(false);
    }
    // A normal team stays legal.
    expect(isErGhostTeamLegal(snapshot("ok", 100, [member(SpeciesId.GARCHOMP), member(SpeciesId.MILOTIC)]))).toBe(true);
  });

  it("bans the vanilla-form representations (Eternamax / Crowned / Shadow / Origin / ER-injected forms)", () => {
    const formCases: [number, RegExp, string][] = [
      [SpeciesId.ETERNATUS, /eternamax/, "Eternamax Eternatus"],
      [SpeciesId.ZACIAN, /crowned/, "Crowned Zacian"],
      [SpeciesId.CALYREX, /shadow/, "Shadow Rider Calyrex"],
      [SpeciesId.DIALGA, /origin/, "Origin Dialga"],
      [SpeciesId.PALKIA, /origin/, "Origin Palkia"],
      [SpeciesId.YVELTAL, /mega/, "Mega Yveltal"],
      [SpeciesId.VICTINI, /primal/, "Primal Victini"],
      [SpeciesId.CASCOON, /primal/, "Primal Cascoon"],
    ];
    let found = 0;
    for (const [speciesId, pattern, label] of formCases) {
      const fi = formIndexOf(speciesId, pattern);
      if (fi < 0) {
        continue; // this build represents it as a standalone species instead
      }
      found++;
      expect(isErGhostTeamLegal(snapshot("s", 100, [member(speciesId, fi)])), label).toBe(false);
      // The base form of the same species stays legal.
      expect(isErGhostTeamLegal(snapshot("b", 100, [member(speciesId, 0)])), `${label} base form`).toBe(true);
    }
    // The big vanilla battle forms must exist as forms in every build.
    expect(found).toBeGreaterThanOrEqual(4);
  });

  it("takeGhostForWave skips banned teams even when injected directly into the pool", () => {
    const wave = 87; // hell ghost wave
    setPrefetchedGhostTeamsForTests([
      snapshot("hacked", wave + 5, [member(ErSpeciesId.KECLEONG)]),
      snapshot("clean", wave + 8, [member(SpeciesId.GARCHOMP)]),
    ]);
    expect(takeGhostForWave(wave)?.id).toBe("clean");
  });

  it(`wave window: only runs ending within +${ER_GHOST_WAVE_WINDOW} waves are eligible (losses included)`, () => {
    const early = 87; // hell ghost wave
    const late = 192; // hell ghost wave
    setPrefetchedGhostTeamsForTests([
      snapshot("endgame", 200, [member(SpeciesId.GARCHOMP)]), // 200 > 87+20 → not at 87
      snapshot("too-far", early + ER_GHOST_WAVE_WINDOW + 1, [member(SpeciesId.MILOTIC)]),
      snapshot("near-loss", early + 10, [member(SpeciesId.METAGROSS)]), // lost at 97 → fine at 87
    ]);
    expect(takeGhostForWave(early)?.id).toBe("near-loss");

    resetErGhostRunState();
    setPrefetchedGhostTeamsForTests([snapshot("endgame", 200, [member(SpeciesId.GARCHOMP)])]);
    expect(takeGhostForWave(early)).toBeNull(); // never an endgame team at wave 87
    expect(takeGhostForWave(late)?.id).toBe("endgame"); // 192 ≤ 200 ≤ 212 → fine late
  });
});
