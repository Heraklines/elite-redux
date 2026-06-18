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
import { StatusEffect } from "#enums/status-effect";
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
  /** Raw damage of the opponent's single best hit on this mon (the maximin reply). */
  worstIncomingDamage: number;
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
    return { incomingKO: false, outspeeds: true, worstIncomingDamage: 0 };
  }
  let worstIncoming = 0;
  let fastestOpponentSpd = 0;
  for (const opp of opponents) {
    fastestOpponentSpd = Math.max(fastestOpponentSpd, opp.getEffectiveStat(Stat.SPD, enemy));
    // Scan the opponent's FULL moveset (ER mons can carry 5-8 moves) for the
    // single hardest hit - that is the maximin reply the AI plans against.
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
    worstIncomingDamage: worstIncoming,
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
  // Experimental (Foul-Play depth-1) brain. Assigned via the A/B harness OR the
  // rollout %, AND - when er.ai.experimentalHell is on - to EVERY Hell trainer/boss
  // (Elite stays on the difficulty-tuned standard brain). It plays at maximum
  // sharpness + the most aggressive switching.
  const hellExperimental = hell && erBalanceNum("er.ai.experimentalHell") >= 1;
  if (resolveExperimental() || hellExperimental) {
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

// =============================================================================
// EXPERIMENTAL BRAIN - Foul-Play-style depth-1 position evaluation.
//
// Ported from pmariglia's hand-written Showdown AI (MIT):
//   - eval constants + evaluate_pokemon/evaluate:
//     showdown/engine/evaluate.py @375ae499ce543d3c124bec53cbba67c74848dad8
//   - depth-1 maximin ("pick_safest"): showdown/engine/select_best_move.py @same
//   - refined constants cross-checked vs poke-engine src/genx/evaluate.rs
//
// Instead of scoring a move by the damage IT deals (the greedy standard brain),
// the experimental brain looks ONE PLY ahead: it resolves my move + the
// opponent's best reply, then scores the WHOLE resulting board. Ranking moves by
// that score is the maximin pick. See
// docs/plans/2026-06-18-battle-ai-foulplay-depth1-design.md.
//
// ER-FORMAT NOTE: nothing here is tied to a 4-move / single-ability layout. The
// eval scores HP/faints/status/boosts/hazards/matchup, none of which depend on
// movepool size or ability count; the move loop (caller) and the opponent-reply
// scan (erAssessThreat) both iterate the FULL moveset, so 5-8 move mons and
// multi-innate mons are handled by the live damage sim unchanged.
// =============================================================================

/** Hand-tuned position-evaluation point values (Foul Play `Scoring`). */
export const ER_EVAL = {
  /** Flat points for an un-fainted mon. */
  ALIVE: 75,
  /** Points at full HP (linear with HP fraction). */
  HP: 100,
  /** Per-stage value of each stat boost (speed weighted higher). */
  BOOST: { atk: 15, def: 15, spa: 15, spd: 15, spe: 25 },
  /** Per-status point penalty. */
  STATUS: { poison: -10, toxic: -30, paralysis: -25, sleep: -25, freeze: -40, burn: -25 },
  /** Entry-hazard penalty on a side, multiplied by that side's alive reserve count. */
  HAZARD: { stealthRock: -10, spikes: -7, toxicSpikes: -7 },
  /** Sticky Web is counted once (not reserve-scaled). */
  STICKY_WEB: -25,
  /** Type-matchup bonus, multiplied by effectiveness, applied both directions. */
  MATCHUP: 20,
} as const;

/** Diminishing-returns multiplier for a stat-boost stage (Foul Play table). Pure. */
export function erBoostDiminishing(stage: number): number {
  const table: Record<number, number> = {
    [-6]: -3.3,
    [-5]: -3.15,
    [-4]: -3,
    [-3]: -2.5,
    [-2]: -2,
    [-1]: -1,
    0: 0,
    1: 1,
    2: 2,
    3: 2.5,
    4: 3,
    5: 3.15,
    6: 3.3,
  };
  return table[Math.max(-6, Math.min(6, Math.trunc(stage)))] ?? 0;
}

/** The five battle stats' current boost stages (-6..6). */
export interface ErBoostStages {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** Foul Play boost contribution: per-stat value * diminishing(stage). Pure. */
export function erBoostValue(b: ErBoostStages): number {
  return (
    erBoostDiminishing(b.atk) * ER_EVAL.BOOST.atk
    + erBoostDiminishing(b.def) * ER_EVAL.BOOST.def
    + erBoostDiminishing(b.spa) * ER_EVAL.BOOST.spa
    + erBoostDiminishing(b.spd) * ER_EVAL.BOOST.spd
    + erBoostDiminishing(b.spe) * ER_EVAL.BOOST.spe
  );
}

/** Per-status point penalty (Foul Play `POKEMON_STATIC_STATUSES`). Pure. */
export function erStatusValue(status: StatusEffect): number {
  switch (status) {
    case StatusEffect.POISON:
      return ER_EVAL.STATUS.poison;
    case StatusEffect.TOXIC:
      return ER_EVAL.STATUS.toxic;
    case StatusEffect.PARALYSIS:
      return ER_EVAL.STATUS.paralysis;
    case StatusEffect.SLEEP:
      return ER_EVAL.STATUS.sleep;
    case StatusEffect.FREEZE:
      return ER_EVAL.STATUS.freeze;
    case StatusEffect.BURN:
      return ER_EVAL.STATUS.burn;
    default:
      return 0;
  }
}

/** A single active mon's state for the position eval. */
export interface ErEvalMon {
  fainted: boolean;
  /** Post-turn HP fraction (0..1). */
  hpFraction: number;
  status: StatusEffect;
  boosts: ErBoostStages;
}

/**
 * Foul Play `evaluate_pokemon`: alive bonus + HP + boosts + status. The HP/boost/
 * status sum is clamped >= 0 BEFORE the alive bonus (poke-engine refinement) so a
 * near-dead, statused mon never reads as a liability the other side wants alive.
 * A fainted mon is worth 0. Pure.
 */
export function erEvalMon(m: ErEvalMon): number {
  if (m.fainted || m.hpFraction <= 0) {
    return 0;
  }
  const soft = ER_EVAL.HP * Math.max(0, Math.min(1, m.hpFraction)) + erBoostValue(m.boosts) + erStatusValue(m.status);
  return ER_EVAL.ALIVE + Math.max(0, soft);
}

/** Entry hazards on one side. */
export interface ErHazards {
  stealthRock: boolean;
  spikesLayers: number;
  toxicSpikesLayers: number;
  stickyWeb: boolean;
}

/** Hazard penalty for a side, reserve-scaled (more switch-ins = hazards hurt more). Pure. */
export function erHazardValue(h: ErHazards, aliveReserves: number): number {
  let v = 0;
  if (h.stealthRock) {
    v += ER_EVAL.HAZARD.stealthRock * aliveReserves;
  }
  v += ER_EVAL.HAZARD.spikes * Math.max(0, h.spikesLayers) * aliveReserves;
  v += ER_EVAL.HAZARD.toxicSpikes * Math.max(0, h.toxicSpikesLayers) * aliveReserves;
  if (h.stickyWeb) {
    v += ER_EVAL.STICKY_WEB;
  }
  return v;
}

/** A whole battle position from the scoring mon's perspective (zero-sum). */
export interface ErPosition {
  myActive: ErEvalMon;
  oppActive: ErEvalMon;
  /** Un-fainted benched mons (active excluded). */
  myReserveAlive: number;
  oppReserveAlive: number;
  /** Hazards on MY side (hurt me). */
  myHazards: ErHazards;
  /** Hazards on the OPPONENT's side (hurt them). */
  oppHazards: ErHazards;
  /** Precomputed ER_EVAL.MATCHUP * (myEffVsThem - theirEffVsMe). */
  matchup: number;
}

/** Foul Play `evaluate`: my side minus the opponent's side. >0 = good for me. Pure. */
export function erEvalPosition(p: ErPosition): number {
  let score = erEvalMon(p.myActive) - erEvalMon(p.oppActive);
  score += (Math.max(0, p.myReserveAlive) - Math.max(0, p.oppReserveAlive)) * ER_EVAL.ALIVE;
  // Hazards on my side subtract from my score; hazards on theirs add to it.
  score += erHazardValue(p.myHazards, p.myReserveAlive);
  score -= erHazardValue(p.oppHazards, p.oppReserveAlive);
  score += p.matchup;
  return score;
}

const clampStage = (s: number): number => Math.max(-6, Math.min(6, s));

function addBoosts(b: ErBoostStages, d: ErBoostStages): ErBoostStages {
  return {
    atk: clampStage(b.atk + d.atk),
    def: clampStage(b.def + d.def),
    spa: clampStage(b.spa + d.spa),
    spd: clampStage(b.spd + d.spd),
    spe: clampStage(b.spe + d.spe),
  };
}

/** Which entry hazard a move sets on the opponent's side (for board modelling). */
export type ErHazardKind = "stealthRock" | "spikes" | "toxicSpikes" | "stickyWeb";

function addHazardLayer(h: ErHazards, which: ErHazardKind): ErHazards {
  const n: ErHazards = { ...h };
  switch (which) {
    case "stealthRock":
      n.stealthRock = true;
      break;
    case "spikes":
      n.spikesLayers = Math.min(3, h.spikesLayers + 1);
      break;
    case "toxicSpikes":
      n.toxicSpikesLayers = Math.min(2, h.toxicSpikesLayers + 1);
      break;
    case "stickyWeb":
      n.stickyWeb = true;
      break;
  }
  return n;
}

/** The pre-turn board the depth-1 lookahead starts from (raw HP so faints are exact). */
export interface ErDepth1Before {
  myActive: ErEvalMon;
  oppActive: ErEvalMon;
  myHp: number;
  myMaxHp: number;
  oppHp: number;
  oppMaxHp: number;
  myReserveAlive: number;
  oppReserveAlive: number;
  myHazards: ErHazards;
  oppHazards: ErHazards;
  matchup: number;
}

/** One candidate move's modelled effect for the depth-1 lookahead. */
export interface ErDepth1Move {
  /** Raw damage my move deals to the opponent's active (0 for non-damaging). */
  myDamage: number;
  /** Raw damage the opponent's best reply deals to my active (its maximin hit). */
  oppReplyDamage: number;
  /** Do I act before the target this turn? (priority already folded in). */
  iMoveFirst: boolean;
  /** Setup: stat stages this move adds to my active (omit for non-setup). */
  myBoostDelta?: ErBoostStages | undefined;
  /** Hazard this move lays on the opponent's side (omit if none). */
  addsOppHazard?: ErHazardKind | undefined;
}

/**
 * Depth-1 maximin move score (the experimental brain's core). Resolves turn
 * order, faints and the "slow move that never executes" case, applies the move's
 * own modelled board change, then scores the resulting position. Pure - the
 * caller (getNextMove) supplies the live damage/speed numbers. Higher = better.
 */
export function erDepth1MoveScore(before: ErDepth1Before, move: ErDepth1Move): number {
  let myDmg = move.myDamage;
  let oppReply = move.oppReplyDamage;
  let oppFaints: boolean;
  let iFaint: boolean;

  if (move.iMoveFirst) {
    // I hit first: if it KOs, the opponent's active faints before it can reply.
    oppFaints = myDmg >= before.oppHp;
    if (oppFaints) {
      oppReply = 0;
    }
    iFaint = !oppFaints && oppReply >= before.myHp;
  } else {
    // Opponent hits first: if that KOs me, my move never executes (whiffs).
    iFaint = oppReply >= before.myHp;
    if (iFaint) {
      myDmg = 0;
    }
    oppFaints = myDmg >= before.oppHp;
  }
  // My move "executed" unless I was KO'd before acting (slow whiff).
  const moveExecuted = !(!move.iMoveFirst && iFaint);

  const oppHpAfter = Math.max(0, before.oppHp - myDmg) / Math.max(1, before.oppMaxHp);
  const myHpAfter = Math.max(0, before.myHp - oppReply) / Math.max(1, before.myMaxHp);

  const myBoosts =
    moveExecuted && move.myBoostDelta ? addBoosts(before.myActive.boosts, move.myBoostDelta) : before.myActive.boosts;
  const oppHazards =
    moveExecuted && move.addsOppHazard ? addHazardLayer(before.oppHazards, move.addsOppHazard) : before.oppHazards;

  return erEvalPosition({
    myActive: { fainted: iFaint, hpFraction: myHpAfter, status: before.myActive.status, boosts: myBoosts },
    oppActive: {
      fainted: oppFaints,
      hpFraction: oppHpAfter,
      status: before.oppActive.status,
      boosts: before.oppActive.boosts,
    },
    myReserveAlive: before.myReserveAlive,
    oppReserveAlive: before.oppReserveAlive,
    myHazards: before.myHazards,
    oppHazards,
    matchup: before.matchup,
  });
}
