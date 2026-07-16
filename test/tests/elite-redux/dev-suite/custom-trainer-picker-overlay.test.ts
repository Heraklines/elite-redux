/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression lock for the #937 Custom Trainers PICKER bug: selecting the "Custom
// Trainers" entry rendered its "select a custom trainer" header text but NEVER
// showed the trainer rows.
//
// ROOT CAUSE: the main Dev Scenarios list IS a UiMode.OPTION_SELECT, and
// `Ui.setModeInternal` early-returns when the requested mode already equals the
// active mode (`this.mode === mode && !forceTransition`). So opening the custom
// list with `setOverlayMode(OPTION_SELECT, …)` from INSIDE that OPTION_SELECT was
// a silent no-op. The working main list only opens because it comes from the
// TITLE mode (a different mode).
//
// FIX: openDevMenuOverlay collapses the active OPTION_SELECT to MESSAGE FIRST,
// then runs the opener (mirrors the proven main-list `openPickerClean`). This
// test locks the invocation ORDER (setMode(MESSAGE) BEFORE the opener runs). The
// interactive click path (Phaser OPTION_SELECT input) remains MANUAL-verify.
//
// Pure logic (the helper is free of globalScene/Phaser) - NOT gated behind
// ER_SCENARIO.
// =============================================================================

import {
  openDevMenuOverlay,
  pickErCustomTrainerGhost,
  planErCustomTrainerLaunch,
} from "#app/dev-tools/test-suite/custom-trainer-picker";
import {
  applyPreparedGhostChallenges,
  buildErCustomTrainerDevScenario,
  relevelPreparedGhostParty,
  resetDevOverrides,
} from "#app/dev-tools/test-suite/scenarios";
import Overrides from "#app/overrides";
import type { ErCustomTrainerResolved } from "#data/elite-redux/er-custom-trainers";
import { getErCustomTrainerDevForce, setErCustomTrainerDevForce } from "#data/elite-redux/er-custom-trainers";
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";
import { getLevelTotalExp } from "#data/exp";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import type { PlayerPokemon } from "#field/pokemon";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it, vi } from "vitest";

/** A stand-in for the MESSAGE UiMode number (the helper is mode-agnostic). */
const MESSAGE_MODE = 5;

describe("Custom Trainers picker — openDevMenuOverlay (regression lock)", () => {
  it("collapses to the message mode BEFORE running the opener (async)", async () => {
    const order: string[] = [];
    const ui = {
      setMode: vi.fn((mode: number) => {
        order.push(`setMode:${mode}`);
        return Promise.resolve();
      }),
    };
    const open = vi.fn(() => {
      order.push("open");
    });

    const p = openDevMenuOverlay(ui, MESSAGE_MODE, open);
    // setMode fires immediately; the opener is DEFERRED to after the mode settles
    // (the same async-open-after-`return true` shape the working flow relies on).
    expect(ui.setMode).toHaveBeenCalledWith(MESSAGE_MODE);
    expect(open).not.toHaveBeenCalled();

    await p;
    // The opener ran, and STRICTLY AFTER the collapse to MESSAGE.
    expect(open).toHaveBeenCalledTimes(1);
    expect(order).toEqual([`setMode:${MESSAGE_MODE}`, "open"]);
  });

  it("works when setMode returns void (synchronous UI) and still defers the opener", async () => {
    const order: string[] = [];
    const ui = {
      setMode: vi.fn((mode: number) => {
        order.push(`setMode:${mode}`);
        // no return value (void) — some UI paths resolve synchronously
      }),
    };
    const open = vi.fn(() => order.push("open"));

    await openDevMenuOverlay(ui, MESSAGE_MODE, open);
    expect(order).toEqual([`setMode:${MESSAGE_MODE}`, "open"]);
  });

  it("swallows an opener error so a failed re-open never rejects into the caller", async () => {
    const ui = { setMode: vi.fn(() => Promise.resolve()) };
    const open = vi.fn(() => {
      throw new Error("boom");
    });
    // Must resolve (not reject): the dev-menu handlers are fire-and-forget.
    await expect(openDevMenuOverlay(ui, MESSAGE_MODE, open)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

const trainer = {
  id: 7,
  key: "TESTER",
  name: "Tester",
  difficulties: ["elite"],
  minWave: 17,
  maxWave: 23,
  endless: false,
} as ErCustomTrainerResolved;

function ghost(
  id: string,
  waveReached: number,
  difficulty: GhostTeamSnapshot["difficulty"] = "elite",
): GhostTeamSnapshot {
  return {
    id,
    trainerName: id,
    difficulty,
    waveReached,
    isVictory: false,
    timestamp: 1,
    party: [
      {
        speciesId: 1,
        formIndex: 0,
        abilityIndex: 0,
        ivs: [31, 31, 31, 31, 31, 31],
        nature: 0,
        level: 20,
        gender: 0,
        shiny: false,
        variant: 0,
        passive: false,
        moves: [1],
      },
    ],
  };
}

describe("Custom Trainers picker - prepared fight selection", () => {
  it("samples across every eligible wave in the authored range", () => {
    const fixed = (wave: number) => wave === 18 || wave === 22;

    expect(planErCustomTrainerLaunch(trainer, fixed, () => 0)).toEqual({
      ok: true,
      plan: { difficulty: "elite", wave: 17 },
    });
    expect(planErCustomTrainerLaunch(trainer, fixed, () => 0.999)).toEqual({
      ok: true,
      plan: { difficulty: "elite", wave: 23 },
    });
    // Eligible list is [17, 19, 21, 23]: fixed waves and boss wave 20 are gone.
    expect(planErCustomTrainerLaunch(trainer, fixed, () => 0.5)).toEqual({
      ok: true,
      plan: { difficulty: "elite", wave: 21 },
    });
  });

  it("selects only ghosts proven viable in the target wave's fairness window", () => {
    const picked = pickErCustomTrainerGhost(
      [ghost("too-shallow", 20), ghost("left", 50), ghost("right", 80), ghost("too-deep", 81)],
      40,
      "elite",
      () => 0.999,
    );

    expect(picked?.ghost.id).toBe("right");
    expect(picked?.candidateCount).toBe(2);
  });

  it("prefers the selected difficulty but falls back for a sparse local pool", () => {
    const preferred = pickErCustomTrainerGhost(
      [ghost("ace", 45, "ace"), ghost("elite", 45, "elite")],
      40,
      "elite",
      () => 0,
    );
    expect(preferred?.ghost.id).toBe("elite");
    expect(preferred?.candidateCount).toBe(1);

    const fallback = pickErCustomTrainerGhost([ghost("ace", 45, "ace")], 40, "elite", () => 0);
    expect(fallback?.ghost.id).toBe("ace");
  });

  it("returns null instead of silently restoring the old static test party", () => {
    expect(pickErCustomTrainerGhost([ghost("shallow", 12), ghost("deep", 100)], 40, "elite", () => 0)).toBeNull();
  });

  it("rebuilds the same prepared fight on restart and restores stored challenges", () => {
    const snapshot = ghost("challenge-player", 45);
    snapshot.mode = "challenge";
    snapshot.challenges = [[Challenges.INVERSE_BATTLE, 1]];
    snapshot.party.push({
      ...snapshot.party[0],
      speciesId: 25,
      level: 17,
      moves: [85, 98],
    });
    const built = buildErCustomTrainerDevScenario(trainer, {
      plan: { difficulty: "elite", wave: 21 },
      ghost: snapshot,
      candidateCount: 4,
    });
    expect("error" in built).toBe(false);
    if ("error" in built) {
      return;
    }

    try {
      const first = built.scenario.setup();
      expect(first.map(starter => starter.speciesId)).toEqual([1, 25]);
      expect(first[1].moveset).toEqual([85, 98]);
      expect(Overrides.STARTING_WAVE_OVERRIDE).toBe(21);
      expect(Overrides.MYSTERY_ENCOUNTER_RATE_OVERRIDE).toBe(0);
      expect(getErCustomTrainerDevForce()).toBe("TESTER");

      // Banner Restart invokes setup on this same prepared scenario. It must
      // re-arm the force and reproduce the exact roster/wave, not reroll.
      setErCustomTrainerDevForce(null);
      const restarted = built.scenario.setup();
      expect(restarted).not.toBe(first);
      expect(restarted).toEqual(first);
      expect(Overrides.STARTING_WAVE_OVERRIDE).toBe(21);
      expect(getErCustomTrainerDevForce()).toBe("TESTER");

      expect(built.scenario.gameMode).toBe(GameModes.CHALLENGE);
      const setChallengeValue = vi.fn();
      applyPreparedGhostChallenges({ setChallengeValue }, snapshot.challenges ?? []);
      expect(setChallengeValue).toHaveBeenCalledWith(Challenges.INVERSE_BATTLE, 1);

      // Regression: starters are initially constructed at the source run's top
      // level. Re-leveling only `level` left source-level EXP behind, so the
      // first participant to gain EXP raced to the current level cap.
      const bulbasaur = getPokemonSpecies(1);
      const pikachu = getPokemonSpecies(25);
      const party = [
        {
          level: 20,
          exp: getLevelTotalExp(20, bulbasaur.growthRate),
          species: bulbasaur,
          hp: 1,
          calculateStats: vi.fn(),
          getMaxHp: vi.fn(() => 80),
          updateInfo: vi.fn(),
        },
        {
          level: 20,
          exp: getLevelTotalExp(20, pikachu.growthRate),
          species: pikachu,
          hp: 1,
          calculateStats: vi.fn(),
          getMaxHp: vi.fn(() => 70),
          updateInfo: vi.fn(),
        },
      ] as unknown as PlayerPokemon[];
      relevelPreparedGhostParty(party, snapshot.party, 20, 18);
      expect(party.map(mon => mon.level)).toEqual([18, 15]);
      expect(party.map(mon => mon.exp)).toEqual([
        getLevelTotalExp(18, bulbasaur.growthRate),
        getLevelTotalExp(15, pikachu.growthRate),
      ]);
      expect(party[0].exp).toBeLessThan(getLevelTotalExp(19, bulbasaur.growthRate));
      expect(party[1].exp).toBeLessThan(getLevelTotalExp(16, pikachu.growthRate));
      expect(party.map(mon => mon.hp)).toEqual([80, 70]);
    } finally {
      setErCustomTrainerDevForce(null);
      resetDevOverrides();
    }
  });
});
