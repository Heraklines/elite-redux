/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — a difficulty-gated, smarter enemy AI ("AI profile").
//
// See docs/plans/2026-06-17-battle-ai-elite-hell-design.md. The enhanced logic
// runs ONLY for trainer/boss enemies on the Elite and Hell difficulties; for
// everyone else (Youngster/Ace, wild) `getErAiProfile().active` is false and the
// core combat code takes its byte-for-byte vanilla path. The whole feature is
// reversible: flip the profile off and it's stock PokeRogue.
//
// SLICE 1 (this file's job today): real-damage / accuracy / KO-aware ATTACK move
// scoring + a determinism dial (Hell = always best move, Elite = rare misplays).
// Switching, field/strategy and doubles come in later slices.
//
// Sharpness + switch-threshold defaults live in the balance-knob registry
// (er-balance-knobs.ts, group "Battle AI") so they're editor-tunable; invalid
// overrides fall back to the defaults, so a bad edit can never break a build.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { EnemyPokemon } from "#field/pokemon";

/** Entry-hazard moves the strategic scorer recognizes (set vs a big bench). */
export const ER_HAZARD_MOVE_IDS: ReadonlySet<number> = new Set<number>([
  MoveId.STEALTH_ROCK,
  MoveId.SPIKES,
  MoveId.TOXIC_SPIKES,
  MoveId.STICKY_WEB,
]);

/** The enemy a profile is resolved for (structural - avoids importing Pokemon). */
interface ErAiPokemon {
  hasTrainer(): boolean;
  isBoss(): boolean;
}

/**
 * Which AI brain a mon uses. "standard" is the shipped heuristic AI; "experimental"
 * is the opt-in profile where deeper logic (the one-ply EV / Foul-Play-style reads)
 * is being trialled - it can be assigned to SPECIFIC trainers without touching the
 * rest, so the two can be played back-to-back and compared.
 */
export type ErAiKind = "standard" | "experimental";

export interface ErAiProfile {
  /** When false, every consumer takes the vanilla path unchanged. */
  active: boolean;
  /** Which brain (standard vs experimental). Experimental-only logic gates on this. */
  kind: ErAiKind;
  /** 0..1. 1 = always play the best evaluated move; <1 = some chance to slide to a worse one. */
  sharpness: number;
  /** Switch eagerness threshold (lower = switches to a counter more readily). Consumed in Slice 2. */
  switchThreshold: number;
}

const INACTIVE_PROFILE: ErAiProfile = { active: false, kind: "standard", sharpness: 0.5, switchThreshold: 3 };

// A/B HARNESS: how the experimental profile is assigned, so it can be trialled
// on specific trainers WITHOUT changing the rest.
//   - "off"       : nobody is experimental (the er.ai.experimentalPct knob may still opt some in).
//   - "all"       : every active mon is experimental.
//   - "alternate" : trainers on EVEN waves are experimental, odd are standard -
//                   so consecutive trainer battles alternate brains (back-to-back test).
export type ErAiExperimentalMode = "off" | "all" | "alternate";
let erAiExperimentalMode: ErAiExperimentalMode = "off";

/** Dev/test control: set how the experimental AI profile is handed out (reset between scenarios). */
export function setErAiExperimentalMode(mode: ErAiExperimentalMode): void {
  erAiExperimentalMode = mode;
}

/** Whether the mon being resolved should use the experimental brain. */
function resolveExperimental(): boolean {
  if (erAiExperimentalMode === "all") {
    return true;
  }
  const wave = globalScene?.currentBattle?.waveIndex ?? 0;
  if (erAiExperimentalMode === "alternate") {
    return wave % 2 === 0;
  }
  // Production rollout knob (default 0): a deterministic per-wave slice of trainers.
  return wave % 100 < erBalanceNum("er.ai.experimentalPct");
}

// MASTER GATE. The smarter AI is OFF in real play until it has been tested and
// the maintainer turns it on (the `er.ai.enabled` knob, default 0). Until then
// every consumer takes the vanilla path - so it does NOT affect actual Elite/
// Hell battles yet. The dev-test scenarios opt IN via setErSmartAiTestForced(),
// so the team can still validate it in a controlled, scenario-only way.
let smartAiTestForced = false;

/** Force the smarter AI on for the current dev-test scenario only (reset between scenarios). */
export function setErSmartAiTestForced(on: boolean): void {
  smartAiTestForced = on;
}

/** Master switch: smarter AI runs only if the knob is on OR a test scenario forced it. */
function erSmartAiMasterEnabled(): boolean {
  return smartAiTestForced || erBalanceNum("er.ai.enabled") >= 1;
}

/**
 * Calibration so a real-damage attack score lands on roughly the same scale as
 * the vanilla per-move benefit numbers (so attack-vs-status comparisons stay
 * sane until Slice 3 refines status/setup valuation): a hit doing ~40% of the
 * target's max HP scores ~30, matching a strong vanilla STAB attack.
 */
export const ER_DAMAGE_SCORE_SCALE = 75;
/** Added (accuracy-weighted) when a move would secure a KO this turn - dominates non-KO moves. */
export const ER_KO_BONUS = 1000;

/**
 * Multiplier applied to a SLOW (non-priority) move when the holder will be KO'd
 * this turn and is outsped: such a move probably won't even execute, so a
 * priority move should win instead (Phase A threat-awareness).
 */
export const ER_SLOW_DOOMED_PENALTY = 0.15;

/**
 * Threat-aware (Phase A): when the holder will be KO'd this turn AND it does NOT
 * outspeed the threat, a non-priority move likely won't land before it faints -
 * so it should be devalued in favor of a priority move (snipe before dying).
 * Pure (unit-tested).
 */
export function shouldDevalueSlowMove(incomingKO: boolean, outspeeds: boolean, movePriority: number): boolean {
  return incomingKO && !outspeeds && movePriority <= 0;
}

/** Multiplier on the switch threshold when the active mon is doomed - it pivots more eagerly. */
export const ER_DOOMED_SWITCH_THRESHOLD_MULT = 0.6;

export interface ErThreat {
  /** An opponent can KO this mon this turn (best simulated incoming hit >= its HP). */
  incomingKO: boolean;
  /** This mon is at least as fast as the fastest opponent. */
  outspeeds: boolean;
}

/**
 * Threat-awareness primitive (Phase A): does an opponent KO this mon THIS turn,
 * and does it outspeed? Uses the same damage sim + ability fog as the scorer
 * (the AI does NOT assume the player's unrevealed ability). Shared by the move
 * scorer (priority snipe) and the switch decision (pivot when doomed).
 */
export function erAssessThreat(enemy: EnemyPokemon): ErThreat {
  const opponents = enemy.getOpponents().filter(o => o.isActive(true));
  if (opponents.length === 0) {
    return { incomingKO: false, outspeeds: true };
  }
  let worstIncoming = 0;
  let fastestOpponentSpd = 0;
  for (const opp of opponents) {
    fastestOpponentSpd = Math.max(fastestOpponentSpd, opp.getEffectiveStat(Stat.SPD, enemy));
    for (const oppMove of opp.moveset) {
      const move = oppMove?.getMove();
      if (!move || move.category === MoveCategory.STATUS) {
        continue;
      }
      const { damage } = enemy.getAttackDamage({
        source: opp,
        move,
        ignoreAbility: false,
        ignoreSourceAbility: !opp.waveData.abilityRevealed,
        ignoreAllyAbility: false,
        ignoreSourceAllyAbility: !opp.getAlly()?.waveData.abilityRevealed,
        isCritical: false,
        simulated: true,
      });
      worstIncoming = Math.max(worstIncoming, damage);
    }
  }
  return {
    incomingKO: worstIncoming >= enemy.hp,
    outspeeds: enemy.getEffectiveStat(Stat.SPD, opponents[0]) >= fastestOpponentSpd,
  };
}

/**
 * Whether the smarter switching logic is on (Elite/Hell). Used at switch sites
 * that don't have an enemy handle (the forced/faint replacement resolver), where
 * the gate is the run difficulty - those paths only run in trainer battles.
 */
export function isErSmartSwitching(): boolean {
  if (!erSmartAiMasterEnabled()) {
    return false;
  }
  const difficulty = getErDifficulty();
  return difficulty === "elite" || difficulty === "hell";
}

/** Resolve the AI profile for a given enemy. Active only for Elite/Hell trainers & bosses. */
export function getErAiProfile(pokemon: ErAiPokemon): ErAiProfile {
  if (!erSmartAiMasterEnabled()) {
    return INACTIVE_PROFILE;
  }
  const difficulty = getErDifficulty();
  const hardMode = difficulty === "elite" || difficulty === "hell";
  if (!hardMode || !(pokemon.hasTrainer() || pokemon.isBoss())) {
    return INACTIVE_PROFILE;
  }
  const hell = difficulty === "hell";
  // Experimental brain (opt-in, per the A/B harness): for now it plays at maximum
  // sharpness + the most aggressive switching, so it's distinguishable back-to-back
  // from the difficulty-tuned standard brain. The one-ply EV / Foul-Play-style
  // reads will slot in here, gated on kind === "experimental".
  if (resolveExperimental()) {
    return {
      active: true,
      kind: "experimental",
      sharpness: 1,
      switchThreshold: erBalanceNum("er.ai.switchThresholdHell"),
    };
  }
  return {
    active: true,
    kind: "standard",
    sharpness: hell ? erBalanceNum("er.ai.sharpnessHell") : erBalanceNum("er.ai.sharpnessElite"),
    switchThreshold: hell ? erBalanceNum("er.ai.switchThresholdHell") : erBalanceNum("er.ai.switchThresholdElite"),
  };
}

/**
 * Convert a simulated damage roll into a move score. Pure (unit-tested):
 *   - base = (damage / maxHp) * SCALE, accuracy-weighted;
 *   - a guaranteed KO (damage >= current HP) adds the accuracy-weighted KO bonus,
 *     so the AI prefers a *reliable* KO over a bigger but less accurate hit.
 *
 * @param accuracy move base accuracy; <= 0 means "never misses" (treated as 100).
 */
export function damageToScore(damage: number, maxHp: number, hp: number, accuracy: number): number {
  if (damage <= 0) {
    return 0;
  }
  const accFactor = (accuracy <= 0 ? 100 : Math.min(accuracy, 100)) / 100;
  const pct = damage / Math.max(1, maxHp);
  let score = pct * ER_DAMAGE_SCORE_SCALE * accFactor;
  if (damage >= hp) {
    score += ER_KO_BONUS * accFactor;
  }
  return score;
}

/** Context for scoring a strategic (non-attack) move. */
export interface StrategicMoveContext {
  /** A self-targeting stat-boost ("setup") move. */
  isSetup: boolean;
  /** An entry-hazard move (Rocks/Spikes/etc.). */
  isHazard: boolean;
  /** The user's current HP fraction (0..1). */
  userHpRatio: number;
  /** How many opposing Pokemon are still unfainted (incl. the active one). */
  opponentBenchCount: number;
  /** Whether an entry hazard is already on the opponent's side. */
  hazardAlreadyUp: boolean;
}

/**
 * Adjust the score of a SETUP or HAZARD move (Elite/Hell). Pure (unit-tested).
 * Conservative by design - it fixes known AI blunders rather than chasing
 * aggressive setup:
 *   - setup: refuse to boost while frail (about to be KO'd); when healthy, make
 *     it competitive with a mediocre attack so a safe sweeper sets up turn 1;
 *   - hazard: worth it only when there's still a bench to punish AND nothing is
 *     up yet; otherwise near-worthless (don't waste a turn re-setting hazards).
 * Non-setup/non-hazard moves keep their incoming (vanilla) score.
 */
export function strategicMoveScore(baseScore: number, ctx: StrategicMoveContext): number {
  if (ctx.isHazard) {
    if (ctx.hazardAlreadyUp || ctx.opponentBenchCount <= 1) {
      return -10;
    }
    // Scales with how many switch-ins will eat the hazard (~22 at 2 reserves,
    // ~34 at 4) - competitive with a mid-strength attack early.
    return 10 + (ctx.opponentBenchCount - 1) * 12;
  }
  if (ctx.isSetup) {
    if (ctx.userHpRatio < 0.45) {
      return -20; // don't set up while frail / about to faint
    }
    const healthyBonus = ctx.userHpRatio > 0.7 ? 8 : 0;
    return Math.max(baseScore, 12) + healthyBonus;
  }
  return baseScore;
}

/**
 * Pick a move index from scores sorted DESCENDING, honoring `sharpness`. Pure
 * (unit-tested), RNG injected as `rand(n) -> 0..n-1`:
 *   - sharpness 1   -> always index 0 (the best move) - no misplays (Hell).
 *   - sharpness <1  -> may slide to the next move when scores are close, scaled
 *     by (1 - sharpness); sharpness 0.5 reproduces vanilla's slide chance.
 * Sliding stops at a sign change or a zero pivot (mirrors the vanilla guard).
 */
export function chooseMoveIndex(sortedScores: readonly number[], sharpness: number, rand: (n: number) => number): number {
  const factor = Math.max(0, (1 - sharpness) * 2);
  if (factor === 0 || sortedScores.length <= 1) {
    return 0;
  }
  let i = 0;
  while (i < sortedScores.length - 1) {
    const a = sortedScores[i];
    const b = sortedScores[i + 1];
    if (a === 0 || b / a < 0) {
      break;
    }
    const slideChance = Math.round((b / a) * 50 * factor);
    if (rand(100) < slideChance) {
      i++;
    } else {
      break;
    }
  }
  return i;
}
