/*
 * Elite Redux - PURE helpers for the in-game Dev Scenarios "Custom Trainers"
 * picker (see index.ts). Kept free of globalScene / DOM / Phaser imports so the
 * label-building + launch-planning logic is cheaply unit-testable in isolation.
 * TRACKED, dev-tools only (index.ts is loaded behind the registry gate).
 */

import type { ErCustomTrainerResolved } from "#data/elite-redux/er-custom-trainers";
import { ER_GHOST_WAVE_WINDOW } from "#data/elite-redux/er-ghost-constants";
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";

/** How many species names a picker row lists before eliding with a trailing dot. */
const MAX_TEAM_SUMMARY_SPECIES = 3;

/** The minimal `globalScene.ui` surface {@linkcode openDevMenuOverlay} touches. */
export interface DevMenuOverlayUi {
  /** Collapse the ACTIVE ui handler to a plain mode (dev menu passes MESSAGE). */
  setMode(mode: number): Promise<void> | void;
}

/**
 * Open a NESTED dev-menu OPTION_SELECT overlay cleanly.
 *
 * ROOT CAUSE this guards (the #937 staging bug: the Custom Trainers picker's
 * "select a custom trainer" text renders but the trainer ROWS never appear):
 * `Ui.setModeInternal` early-returns when the requested mode already equals the
 * ACTIVE mode (`this.mode === mode && !forceTransition`). The main scenario list
 * IS an OPTION_SELECT, so selecting its "Custom Trainers" entry and then calling
 * `setOverlayMode(OPTION_SELECT, …)` is a silent no-op - the new option list is
 * never shown. The main list itself works only because it is opened from the
 * TITLE mode (a DIFFERENT mode).
 *
 * The fix mirrors the working main-list opener (`openPickerClean`): collapse the
 * active OPTION_SELECT to `messageMode` (MESSAGE) FIRST, then run `open` (which
 * does `showText` + `setOverlayMode(OPTION_SELECT, …)`) so the subsequent overlay
 * sees a different active mode and actually opens. The `open` runs AFTER the mode
 * settles (a microtask), matching the proven async-open-after-`return true`
 * pattern the title "Dev Scenarios" handler already relies on.
 *
 * Pure + injectable (no globalScene/Phaser import) so the invocation ordering is
 * unit-testable. Returns a promise that resolves once `open` has run.
 */
export function openDevMenuOverlay(ui: DevMenuOverlayUi, messageMode: number, open: () => void): Promise<void> {
  return Promise.resolve(ui.setMode(messageMode))
    .then(() => {
      open();
    })
    .catch(() => {});
}

/**
 * A one-line staff-facing summary of a custom trainer for the picker list:
 * `Name #id: Sp1, Sp2, Sp3…`. The species come from the REPRESENTATIVE members
 * (variant 0 of each slot) so the row is stable regardless of the per-run rolls.
 * `speciesName` resolves a speciesId to a display name (injected so this stays
 * pure). No em dash (staff-facing text rule).
 */
export function summarizeErCustomTrainer(
  trainer: ErCustomTrainerResolved,
  speciesName: (speciesId: number) => string,
): string {
  const names = trainer.members.slice(0, MAX_TEAM_SUMMARY_SPECIES).map(m => speciesName(m.speciesId));
  const more = trainer.members.length > MAX_TEAM_SUMMARY_SPECIES ? "…" : "";
  const team = names.length > 0 ? `: ${names.join(", ")}${more}` : "";
  return `${trainer.name} #${trainer.id}${team}`;
}

/** A resolved launch plan: the run difficulty + starting wave to force the trainer at. */
export interface ErCustomTrainerLaunchPlan {
  /** A difficulty the trainer allows (its first authored one). */
  difficulty: ErDifficulty;
  /** A wave inside the trainer's range that is NOT a boss (%10) or fixed battle. */
  wave: number;
}

/** Either a usable launch plan, or a readable reason it cannot be launched. */
export type ErCustomTrainerLaunchResult = { ok: true; plan: ErCustomTrainerLaunchPlan } | { ok: false; reason: string };

/** Waves past `minWave` scanned for an endless trainer's launch wave (no maxWave). */
const ENDLESS_SCAN_SPAN = 40;

/** Clamp an injectable random roll to a valid array index. */
function randomIndex(length: number, random: () => number): number {
  const roll = random();
  const normalized = Number.isFinite(roll) ? Math.max(0, Math.min(0.9999999999999999, roll)) : 0;
  return Math.floor(normalized * length);
}

/**
 * Plan a forced launch for one custom trainer: pick a run DIFFICULTY the trainer
 * allows (force-adjust) and a starting WAVE inside its floor range that the
 * install seam will actually accept - custom trainers never install on the
 * canonical boss waves (`% 10 === 0`) or on fixed-battle waves, so those are
 * skipped. The dev force bypasses the challenge-exclusivity gate, so a
 * challenge-gated trainer still plans cleanly here.
 *
 * Returns a readable `reason` (surfaced to the tester instead of a silent wild
 * battle) when the trainer authored NO valid difficulty, or when its whole floor
 * range is boss/fixed waves so no wave can field it.
 *
 * `isFixedBattle` is injected (the caller passes the CLASSIC game mode's check) so
 * this function stays pure and testable.
 */
export function planErCustomTrainerLaunch(
  trainer: ErCustomTrainerResolved,
  isFixedBattle: (wave: number) => boolean,
  random: () => number = Math.random,
): ErCustomTrainerLaunchResult {
  // Resolved difficulties are validated against the ErDifficulty value set at
  // load time (VALID_DIFFICULTIES in er-custom-trainers), so this narrowing is safe.
  const difficulty = trainer.difficulties[0] as ErDifficulty | undefined;
  if (!difficulty) {
    return { ok: false, reason: "no valid difficulty authored (cannot pick a run difficulty)" };
  }
  const min = Math.max(1, trainer.minWave);
  const max = trainer.endless ? min + ENDLESS_SCAN_SPAN : Math.max(min, trainer.maxWave);
  const eligibleWaves: number[] = [];
  for (let wave = min; wave <= max; wave++) {
    if (wave % 10 === 0 || isFixedBattle(wave)) {
      continue;
    }
    eligibleWaves.push(wave);
  }
  if (eligibleWaves.length > 0) {
    return {
      ok: true,
      plan: { difficulty, wave: eligibleWaves[randomIndex(eligibleWaves.length, random)] },
    };
  }
  return { ok: false, reason: `no non-boss / non-fixed wave in range ${min}-${max}` };
}

/** A ghost snapshot selected for the player side of a prepared custom fight. */
export interface ErCustomTrainerGhostPick {
  ghost: GhostTeamSnapshot;
  /** Number of wave-compatible snapshots in the final random pool. */
  candidateCount: number;
}

/**
 * Pick a real run snapshot suitable for testing a custom trainer on `wave`.
 *
 * This mirrors the normal ghost fairness window: the source run must have
 * reached the target wave, but cannot be more than 40 waves deeper. Prefer the
 * custom trainer's selected difficulty when that pool is populated; sparse
 * offline pools may fall back to another difficulty instead of a fake trio.
 */
export function pickErCustomTrainerGhost(
  snapshots: readonly GhostTeamSnapshot[],
  wave: number,
  difficulty: ErDifficulty,
  random: () => number = Math.random,
): ErCustomTrainerGhostPick | null {
  const compatible = snapshots.filter(
    snapshot =>
      Array.isArray(snapshot.party)
      && snapshot.party.length > 0
      && snapshot.waveReached >= wave
      && snapshot.waveReached <= wave + ER_GHOST_WAVE_WINDOW,
  );
  const matchingDifficulty = compatible.filter(snapshot => snapshot.difficulty === difficulty);
  const pool = matchingDifficulty.length > 0 ? matchingDifficulty : compatible;
  if (pool.length === 0) {
    return null;
  }
  return {
    ghost: pool[randomIndex(pool.length, random)],
    candidateCount: pool.length,
  };
}
