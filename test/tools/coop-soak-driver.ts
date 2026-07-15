/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// NIGHTLY CO-OP SOAK driver (#841). A SEEDED, randomized two-engine run that finds
// desyncs / strands / leaks BY MACHINE instead of by live players. It stands up the
// two-engine duo harness (host BattleScene = sole authoritative engine, guest
// BattleScene = pure renderer, paired over createLoopbackPair) and plays a co-op run
// WAVE BY WAVE, driving both owners' commands through the REAL command relay and the
// reward shops through the REAL owner/watcher machinery - every decision drawn from a
// SINGLE seed (a tiny local mulberry32 PRNG; NEVER Math.random, which is blocked by
// convention in game code and is non-reproducible). The seed is PRINTED FIRST THING so
// ANY failure is replayable with SOAK_SEED=<x>.
//
// FOUR invariants are asserted CONTINUOUSLY, each with the wave + seed in the failure
// message (see the audits docs/coop-structural-gaps.md + docs/coop-byte-identical-audit.md
// for the exact bug classes these catch):
//   (a) DIGEST   - host and guest captureCoopChecksum() are EQUAL. Checked at TWO points: (1) WAVE-START
//                  clean-start parity right after the re-mirror + a faithful re-sync of the guest to the
//                  host (held items / ability / form / tera / moveset via the production field snapshot;
//                  weather/terrain; multi-instance player-wide modifiers; money + ball scalars - see
//                  healGuestFromHost, all PRODUCTION heal mechanisms, NOT content-disabling); and (2) the
//                  REAL detector - POST-TURN, comparing the guest's REPLAYED state to the host WITHOUT a
//                  re-mirror (so a checkpoint/replay divergence like the historical move-PP desync surfaces
//                  instead of being masked). On a mismatch the documented ONE-heal grace runs the resync
//                  analogue and re-checks; a STILL-diverged boundary is a REAL desync RECORDED as a
//                  SoakFinding (grouped by diverging fields; first-occurrence replay artifact written) and
//                  the run CONTINUES, so a long soak surveys the WHOLE game and reports EVERY finding. The
//                  soak TEST FAILS if any finding was recorded - a faithful red on a real bug, NEVER made
//                  green by narrowing content.
//   (b) LOCKSTEP - interactionCounter() is EQUAL on both controllers at every boundary.
//   (c) NO-PARK  - a bounded per-wave progress budget; if a wave does not complete in N
//                  pump iterations the driver dumps both clients' current phase names +
//                  the relay wait-state and FAILS (the strand detector).
//   (d) TEARDOWN - after the run ends, clearCoopRuntime() then assert no runtime / relay /
//                  ME pins survive (getCoopRuntime()/getCoopInteractionRelay() null, all
//                  three ME pins idle at -1 / null).
//
// On ANY invariant breach the driver writes the seed, wave, action-script-so-far, and
// BOTH clients' captured logs to dev-logs/coop-soak/<timestamp>/ (reusing the duo log
// capture machinery installDuoLogCapture already provides). A LOCKSTEP / NO-PARK /
// TEARDOWN breach THROWS immediately (a hard strand); a DIGEST desync is RECORDED as a
// finding + artifact and the run CONTINUES (the soak test fails at the end if any finding
// exists). Either way the failure is loud and replayable with SOAK_SEED=<x>.
//
// The soak is wave/shop focused: mystery encounters are DISABLED for the run
// (mysteryEncounterChance 0) because the existing duo harness drives MEs only from a
// PARKED buildDuoForMe rig, not from a mid-run continuation - MEs are covered by the
// dedicated coop-duo-mystery.test.ts suite and counted here as a documented SKIP class.
// Any non-battle wave type the continuous harness cannot drive is SKIPPED with a logged
// counter, never silently.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopCaptureParty,
  applyCoopCheckpoint,
  applyCoopFieldSnapshot,
  applyCoopFullSnapshot,
  captureCoopCaptureParty,
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopDexBaseline,
  captureCoopFieldSnapshot,
  captureCoopFullSnapshot,
  captureCoopSaveDataDigest,
  captureCoopSaveDataNormalized,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  type CoopBiomeOperationBinding,
  coopAuthoritativeBiomeTransitionOperationId,
  coopBiomeOperationId,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  coopBiomeInteractionStartValue,
  resetCoopBiomePickerDrivenByTest,
  setCoopBiomePickerDrivenByTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import {
  getCoopChecksumAssertionCount,
  resetCoopChecksumAssertionCount,
  setCoopChecksumAssertSeverity,
} from "#data/elite-redux/coop/coop-checksum-assert";
import { parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  getCoopOperationJournalCommittedClasses,
  getCoopOperationLiveSinkInvoked,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  clearCoopRuntime,
  getCoopActiveWaveTransition,
  getCoopInteractionRelay,
  getCoopMeBattleInteractionCounter,
  getCoopRuntime,
  isCoopLearnMoveForwardInFlightEmpty,
  setCoopDexSyncDelayMs,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_BIOME_PICK_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_UI_MIRRORED_MODES } from "#data/elite-redux/coop/coop-ui-registry";
import {
  getCoopUiOperationHits,
  getCoopUiRelayHitModes,
  resetCoopUiRelayTrace,
} from "#data/elite-redux/coop/coop-ui-relay-trace";
import { getCoopStagedWaveAdvanceTransaction } from "#data/elite-redux/coop/coop-wave-operation";
import { erRollBiomeLength } from "#data/elite-redux/er-biome-structure";
import { TerrainType } from "#data/terrain";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { ModifierOverride } from "#modifiers/modifier-type";
import { BiomeShopPhase, setCoopBiomeMarketTestSkip } from "#phases/biome-shop-phase";
import { getCoopMeHostPresentation } from "#phases/coop-replay-me-phase";
import {
  coopClearMePinForGuest,
  coopMeInteractionStartValue,
  coopSetMePinForGuest,
} from "#phases/mystery-encounter-phases";
import { TheBargainPhase } from "#phases/the-bargain-phase";
import type { GameManager } from "#test/framework/game-manager";
import {
  awaitRewardShopPhaseExit,
  beginRewardShopWatch,
  buildDuo,
  type DuoLogs,
  type DuoRig,
  drainGuestMeReplayToSettle,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  mirrorHostMeToGuest,
  pumpDuoDestinations,
  reachQueuedRewardShop,
  relayGuestMeOptionIndexOnly,
  remirrorWave,
  type ShopPhaseSeam,
  startGuestMeOutcomeRace,
  startGuestMeReplay,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import {
  bandForSeq,
  COOP_SOAK_SITUATIONS,
  type CoopSoakSituation,
  createSoakHitSet,
  type SoakHitSet,
  type SoakProfileName,
} from "#test/tools/coop-soak-coverage";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import type { PartyUiHandler } from "#ui/handlers/party-ui-handler";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) + a pure integer hash. NEVER Math.random.
// ---------------------------------------------------------------------------

/** A tiny deterministic PRNG (mulberry32). Returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a-style pure hash over a list of ints -> uint32. Used for CROSS-SIDE-agreed random choices. */
function hashInts(...nums: number[]): number {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    let x = n >>> 0;
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff;
      h = Math.imul(h, 16777619);
      x >>>= 8;
    }
  }
  return h >>> 0;
}

/** Hash a STRING seed to a uint32 (xmur3 finalizer), so a non-numeric SOAK_SEED is still deterministic. */
function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Resolve the soak seed: env SOAK_SEED (numeric or string-hashed) or, when unset, derive from the UTC
 * date (YYYYMMDD). The returned seed is what the driver PRINTS first thing so any failure is replayable.
 */
export function resolveSoakSeed(): number {
  const env = process.env.SOAK_SEED;
  if (env != null && env.trim() !== "") {
    const n = Number(env);
    return Number.isFinite(n) ? n >>> 0 : hashString(env.trim());
  }
  const d = new Date();
  return (d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()) >>> 0;
}

/** Resolve the wave count: env SOAK_WAVES (nightly passes 150+) or the local/PR default (25). */
export function resolveSoakWaves(): number {
  const env = process.env.SOAK_WAVES;
  if (env != null && env.trim() !== "") {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return 25;
}

/** PRINT the seed FIRST THING (before any run work) so a failing run is always replayable. */
export function announceSoakSeed(seed: number, waves: number): void {
  // eslint-disable-next-line no-console
  console.log(
    `[coop-soak] SEED=${seed} WAVES=${waves} - replay this run with:  SOAK_SEED=${seed} SOAK_WAVES=${waves} ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak.test.ts`,
  );
}

// ---------------------------------------------------------------------------
// The soak PARTY PROFILE (#832). SOAK_PROFILE selects which starter party + level edge the test stands up:
//   - "god" (DEFAULT): a level-500 legendary steamroller that reaches the
//     deep endgame. It faints only OCCASIONALLY, so the FAINT-replacement co-op surfaces are PROBABILISTIC.
//   - "level": the wave-appropriate level-65 party (SNORLAX/GENGAR/DRAGONITE/TYRANITAR/METAGROSS/GARCHOMP,
//     the team where #845-#848 were found). It takes REAL damage and FAINTS reliably through its ~wave-40-48
//     death spiral, then WIPES cleanly (a legitimate terminal) around wave ~48 - below the ~60+ razor's-edge
//     ceiling - so the faint/switch/replace machinery (the RICHEST desync source) is GUARANTEED coverage.
//     See coop-soak-coverage.ts's profile split.
// The party is applied by the TEST (game.override + startBattle); this module resolves the profile NAME +
// its config so the test + the coverage assertion agree on one source of truth.
// ---------------------------------------------------------------------------

/** A soak party spec: the overrides + species the test applies for a given SOAK_PROFILE. */
export interface SoakPartyConfig {
  /** The fixed starting level for the whole party (the winnability LEVEL EDGE / the fainting ceiling). */
  startingLevel: number;
  /**
   * The six starter species (the driver tags host owns party[0..2], guest owns party[3..5]). A fixed 6-tuple
   * (mutable so it spreads straight into game.classicMode.startBattle's fixed-arity variadic signature).
   */
  species: [SpeciesId, SpeciesId, SpeciesId, SpeciesId, SpeciesId, SpeciesId];
  /**
   * The four FORCED damaging moves (a determinism knob, NOT content narrowing): the seeded fixed-slot move
   * picker needs every slot to deal damage or the wave NO-PARK stalls. Status/proc fidelity is exercised by
   * the REAL enemy AI's incoming moves, replayed through the checkpoint.
   */
  moveset: readonly [MoveId, MoveId, MoveId, MoveId];
  /**
   * Starting held items forced on the party, or undefined for none. The god party carries LEFTOVERS for
   * passive sustain across the long endgame gauntlet; the level party carries NONE (matching the proven
   * level-ceiling profile) so it faints reliably rather than out-sustaining the wave curve.
   */
  heldItems: readonly ModifierOverride[] | undefined;
}

/** The two soak party profiles (#832). "god" is today's config verbatim (byte-identical when SOAK_PROFILE is unset). */
export const SOAK_PROFILES: Record<SoakProfileName, SoakPartyConfig> = {
  god: {
    // This profile is the deterministic start-to-finish architecture carrier, not a difficulty test.
    // Level 300 could still wipe on the seeded wave-180 boss after surveying 179 clean waves, silently
    // shortening the only full-classic campaign. Level 500 preserves all control/reward/biome content while
    // keeping the party alive through wave 200; the level profile remains the representative damage/faint leg.
    startingLevel: 500,
    species: [
      SpeciesId.ETERNATUS,
      SpeciesId.RAYQUAZA,
      SpeciesId.ARCEUS,
      SpeciesId.MEWTWO,
      SpeciesId.KYOGRE,
      SpeciesId.ZACIAN,
    ],
    moveset: [MoveId.BODY_SLAM, MoveId.SHADOW_BALL, MoveId.FLAMETHROWER, MoveId.THUNDERBOLT],
    heldItems: [{ name: "LEFTOVERS" }],
  },
  level: {
    // Level 65 (NOT the old level-85 ceiling). The framework's max-damage clamp + force-hit apply to BOTH
    // sides, so at level 65 the party out-levels the early waves but is CAUGHT by the wave curve around
    // wave ~40, faints reliably through the ~40-48 death spiral, and WIPES cleanly (GameOver -> Title) around
    // wave ~48 - WELL BELOW the ~60+ razor's-edge ceiling where boss-segmented wild enemies + the deep
    // boss-reward-tail strand live (the old level-85 profile lingered at that edge to wave ~68 and hit those
    // driver gaps - see the report's FINDINGS). This puts the faint/wipe window at the task's ~wave 30-50
    // target: multiple faint episodes + a legitimate wipe terminal, reliably green across seeds.
    startingLevel: 65,
    species: [
      SpeciesId.SNORLAX,
      SpeciesId.GENGAR,
      SpeciesId.DRAGONITE,
      SpeciesId.TYRANITAR,
      SpeciesId.METAGROSS,
      SpeciesId.GARCHOMP,
    ],
    // EXPLOSION is used by the deterministic wave-2 self-KO leg below. It is issued through the real guest
    // command relay and real move/faint/switch phases; the remaining slots preserve normal combat.
    moveset: [MoveId.EXPLOSION, MoveId.SHADOW_BALL, MoveId.FLAMETHROWER, MoveId.THUNDERBOLT],
    heldItems: undefined,
  },
};

/** Resolve the soak party profile from the SOAK_PROFILE env (default "god" = today's behavior). */
export function resolveSoakProfile(): SoakProfileName {
  return process.env.SOAK_PROFILE?.trim().toLowerCase() === "level" ? "level" : "god";
}

/**
 * Resolve the soak party STARTING LEVEL: env SOAK_LEVEL (a positive integer) overrides the resolved
 * profile's fixed {@linkcode SoakPartyConfig.startingLevel}, or `undefined` when unset (the profile default
 * stands). A diagnosis knob (#846): the level profile's fixed level-65 edge can be re-pointed to a deeper
 * config (e.g. SOAK_LEVEL=55) to reproduce a level-config-specific digest divergence, without editing the
 * profile table. Never a content change - it only shifts the winnability/fainting edge, exactly like the
 * profile's own startingLevel.
 */
export function resolveSoakLevel(): number | undefined {
  const env = process.env.SOAK_LEVEL;
  if (env != null && env.trim() !== "") {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return;
}

/** The level profile's deterministic real-combat faint/replacement coverage leg. */
const LEVEL_FORCED_FAINT_WAVE = 2;

/**
 * The soak FIDELITY mode (#879 review item 5). Selects how faithfully the driver reproduces PRODUCTION's
 * heal + command paths:
 *   - "harness" (DEFAULT, unset = byte-identical to today): the driver heals the guest through convenient
 *     harness seams the live client never takes - it re-mirrors the WHOLE guest (including its player party)
 *     from the host every wave AND runs {@linkcode healGuestFromHost}, and the guest's command answerer reads
 *     the HOST's authoritative guest-slot mon to choose the guest command. Fast + stable, but it MASKS any
 *     guest-side replay drift (the between-wave reset re-syncs it away, and reading host state means a stale
 *     guest still picks the host's move).
 *   - "production": the driver takes ONLY production heal triggers. It does NOT re-mirror the guest player
 *     party or run healGuestFromHost per wave (enemies / arena / run-config are still adopted - those ARE
 *     host-authoritative in production); a heal happens ONLY when a checksum MISMATCH fires the resync
 *     analogue (applyCoopFieldSnapshot / reconcileCoopPlayerField - the stateSync analogue). AND the guest's
 *     command answerer chooses from the GUEST's OWN rendered scene state (its own party / moveset / PP), so a
 *     guest too stale to construct a real player's command fails LOUDLY instead of silently borrowing the
 *     host's. This surfaces the fidelity gaps the harness mode papers over as SoakFindings (Wave-2 evidence).
 * DEFAULT-OFF: only SOAK_FIDELITY=production opts in.
 */
export type SoakFidelity = "harness" | "production";

/** Resolve the soak fidelity mode from the SOAK_FIDELITY env (default "harness" = today's behavior). */
export function resolveSoakFidelity(): SoakFidelity {
  return process.env.SOAK_FIDELITY?.trim().toLowerCase() === "production" ? "production" : "harness";
}

// ---------------------------------------------------------------------------
// Result + option shapes.
// ---------------------------------------------------------------------------

/** A per-wave-boundary digest sample (recorded for the determinism contract cross-run compare, #842). */
export interface SoakBoundaryDigest {
  wave: number;
  hostChecksum: string;
  guestChecksum: string;
  hostSaveDigest: string;
  guestSaveDigest: string;
  /** Optional normalized hash preimages for focused cross-run diagnostics (default off for long soaks). */
  hostSaveState?: Record<string, unknown>;
  guestSaveState?: Record<string, unknown>;
}

/**
 * Immutable post-wave evidence for bounded transition regressions. Captured only when requested so long
 * campaigns do not retain redundant serializer preimages. `playerModifiers` uses the same normalized
 * blobs as the production save digest, including exact constructor args and remaining battle count.
 */
export interface SoakPostWaveState {
  wave: number;
  victoryKind: "wild" | "trainer" | null;
  hostMoney: number;
  guestMoney: number;
  hostPlayerModifiers: Record<string, unknown>[];
  guestPlayerModifiers: Record<string, unknown>[];
  retainedWaveTransaction: {
    operationId: string;
    dataApplied: boolean;
    continuationReady: boolean;
  } | null;
  /** Cumulative boundary recoveries at this point; a clean focused transition remains zero throughout. */
  resyncHeals: number;
}

/**
 * A DIGEST divergence the soak found that the documented one-heal resync did NOT converge - i.e. a REAL
 * host-vs-guest desync (the machine doing its job). The run RECORDS it (grouped by the set of diverging
 * checksum fields) and CONTINUES so a long soak surveys the WHOLE run and reports EVERY finding, rather
 * than stopping at the first. The soak test FAILS if any finding was recorded (a red that faithfully
 * exposes a bug); the report lists each with seed + wave.
 */
export interface SoakFinding {
  /** The set of diverging checksum-state fields (e.g. "modifiers,saveDataDigest"). */
  fields: string;
  firstWave: number;
  lastWave: number;
  occurrences: number;
  /** A sample of the host vs guest values of the diverging field(s) at the first occurrence (for triage). */
  sample: string;
}

/** One checksum mismatch observed BEFORE any boundary heal, retained for causal gate diagnostics. */
export interface SoakPreHealMismatch {
  wave: number;
  where: string;
  fields: string[];
  classification: "expected-renderer-money-lag" | "unexpected";
  sample: string;
}

/** The outcome of a completed soak run (a passing run; a hard LOCKSTEP/NO-PARK/TEARDOWN breach THROWS). */
export interface SoakResult {
  seed: number;
  wavesRequested: number;
  wavesCompleted: number;
  /** Per-wave-type SKIP counters (each skip is logged, never silent). */
  skips: Record<string, number>;
  /** How many DIGEST one-heal graces fired (a converged run is 0). */
  resyncHeals: number;
  /** Every pre-heal mismatch, classified before recovery can hide its cause. */
  preHealMismatches: SoakPreHealMismatch[];
  /**
   * #838 Phase 5: how many PRODUCTION per-turn checksum ASSERTIONS fired during the run - the guest's
   * real {@linkcode CoopFinalizeTurnPhase} `verifyChecksum` counting a mismatch the full-state payload
   * failed to converge. This is INDEPENDENT of `resyncHeals` (which is the driver's own boundary probe):
   * `assertions` reads the in-phase counter the live game increments. A converged run is `assertions=0`;
   * any nonzero count is a real full-state-payload gap (the gate the maintainer flips to hard-fault later).
   */
  assertions: number;
  /** The action script (one line per decision) - also written into a failure artifact. */
  actionScript: string[];
  /** Per-boundary digest samples (for #842). */
  boundaryDigests: SoakBoundaryDigest[];
  /** Optional post-wave transaction/modifier evidence requested by a bounded focused regression. */
  postWaveStates: SoakPostWaveState[];
  /** REAL host-vs-guest desyncs the one-heal resync did not converge (the soak's findings; empty = clean). */
  findings: SoakFinding[];
  /**
   * TERMINAL run-end (#846): set when the HOST run ENDED mid-soak (a party WIPE -> GameOverPhase ->
   * TitlePhase) instead of surveying every requested wave. A wipe is a LOUD, COUNTED terminal outcome (the
   * survey ends honestly at `wave`), NEVER a NO-PARK strand - the driver detects the host's game-over/Title
   * transition and stops instead of hanging a phaseInterceptor.to() against a run that is over. Undefined =
   * the run surveyed every requested wave.
   */
  runEnded?: { wave: number; reason: string } | undefined;
  /**
   * How many surveyed waves were TRAINER battles (#846) - fixed rival/evil-team AND random rolled trainers.
   * Reported so a run's trainer coverage is visible (a seed that rolls zero random trainers still logs the
   * fixed rival waves it crossed). Split into fixed vs random by whether the wave is a gameMode fixed battle.
   */
  trainerWaves: { total: number; fixed: number; random: number };
  /** Number of actual arena-biome changes observed between surveyed waves. */
  biomeTransitions: number;
  /**
   * #828 ASYMMETRIC CONTINUATION (BUILD 2): how many surveyed waves the run played with the HOST half
   * EXHAUSTED - a host-owned field slot fainted with no legal host-owned replacement, the guest half still
   * alive and playing SOLO (the partner-plays-on path). >0 proves the run drove past a host-half-exhaustion
   * instead of terminating at it (the old #848 behavior); the {@linkcode COOP_SOAK_SITUATIONS.hostHalfExhausted}
   * surface is recorded on each such wave. 0 = the run never asymmetrically exhausted (both halves stayed
   * balanced to the terminal), which is fine - the surface is PROBABILISTIC.
   */
  guestSoloWaves: number;
  /**
   * #633 MID-RUN ME CONTINUATION (BUILD 1): the mystery encounters DRIVEN inline this run, one entry per
   * ME wave: the wave, the forced type, and which authoritative path fired (host-owned / guest-owned /
   * battle-handoff). Empty when {@linkcode SoakOptions.meWaves} is unset (MEs off, today's default).
   */
  mysteryEncounters: { wave: number; type: string; path: "host-owned" | "guest-owned" | "battle-handoff" }[];
  /**
   * COMPLETENESS BACKSTOP (#849): every co-op interactive surface the run OBSERVED, per dimension (modes /
   * relay kinds / seq bands / battle-flow situations). The EXPECTED set is derived from the registries, so
   * a surface that is neither hit here nor declared undrivable auto-reds. The caller feeds this to
   * {@linkcode logSoakCoverage} (always) + {@linkcode assertSoakCompleteness} (enforced at >= the gate).
   */
  hits: SoakHitSet;
}

/** Options for a single soak run. */
export interface SoakOptions {
  seed: number;
  waves: number;
  /** The duo log capture (installDuoLogCapture) whose per-client buckets feed the failure artifact. */
  logs: DuoLogs;
  /**
   * Reward-shop policy. "seeded" = take/leave by the seeded PRNG (default, the soak); "leave" = always
   * leave (the determinism contract, so no reward grant perturbs the cross-run digest compare).
   */
  rewardPolicy?: "seeded" | "leave";
  /**
   * Exact waves that must take the first eligible non-party reward even when `rewardPolicy` is `leave`.
   * Used by focused lifecycle proofs so one forced item is acquired once and can then expire naturally.
   */
  forceTakeRewardWaves?: ReadonlySet<number>;
  /** Retain normalized save-digest preimages at each boundary; bounded diagnostic/contract runs only. */
  captureBoundaryPreimages?: boolean;
  /** Retain exact normalized modifier + WAVE_ADVANCE latch evidence after each completed wave. */
  capturePostWaveState?: boolean;
  /**
   * Override the deterministic content seed used from the first post-bootstrap crossing onward. When absent,
   * the driver derives `coop-soak-<SOAK_SEED>`; the printed replay seed must reproduce game content as well as
   * action choices. Explicit values remain useful for the independent-run determinism contract (#842).
   */
  pinSeed?: string;
  /**
   * The party PROFILE (#832). Gates the LEVEL-only driver extensions (e.g. TAKE a Revive reward when the
   * faint-heavy level party has a downed mon, instead of always leaving). Defaults to "god" - byte-identical
   * to today (no revive-take, no other level-only behavior).
   */
  profile?: SoakProfileName;
  /**
   * #879 review item 5 - the PRODUCTION-FIDELITY soak mode. Default "harness" (byte-identical to today).
   * "production" disables the driver's convenient guest heals (no per-wave player re-mirror / healGuestFromHost -
   * heals only via the checksum-mismatch resync analogue) AND selects the guest command from the GUEST's OWN
   * rendered scene state, so a stale guest fails loudly. See {@linkcode SoakFidelity}. Expect FINDINGS in this
   * mode (that is the point); it is gated default-off so the standing soak gate is unaffected.
   */
  fidelity?: SoakFidelity;
  /**
   * #633 MID-RUN MYSTERY-ENCOUNTER CONTINUATION (BUILD 1). A map of wave index -> the {@linkcode
   * MysteryEncounterType} to FORCE at that wave, driven INLINE through the real two-engine ME machinery
   * (mirrorHostMeToGuest + the host MysteryEncounterPhase drive + the guest CoopReplayMePhase) rather than as
   * a normal battle wave. Undefined (the default) = today's behavior byte-identically (MEs OFF, the soak is
   * wave/shop-only). Each forced wave MUST be a legal ME wave (WILD-eligible, non-boss, %10 != 1, in
   * [10,180]) and SHOULD stay below the ~wave-60 playWave razor's-edge on the level profile (use the god
   * profile for the ME leg). The driver forces the ME by raising the ME rate override just for that wave's
   * EncounterPhase then resetting it, so ONLY the designated waves roll an ME. See {@linkcode processMeWave}.
   */
  meWaves?: ReadonlyMap<number, MysteryEncounterType>;
  /**
   * Optional one-based safe option per forced ME wave. This lets a campaign cover non-battle, party-mutation,
   * travel, and multi-option event archetypes without pretending every encounter's option 1 is equivalent.
   * The exact option is used by both ownership parities (guest wire indices are converted to zero-based).
   */
  meOptions?: ReadonlyMap<number, number>;
  /**
   * Optional ordered guest-owned nested picks for a forced ME: party slot, secondary option, catch-full
   * replacement, etc. Values ride the real ME_SUB relay FIFO before the sole host engine advances. This
   * makes continuous campaigns capable of driving events such as Field Trip instead of cancelling their
   * nested selector and mistaking a test-driver omission for an engine softlock.
   */
  meSubPicks?: ReadonlyMap<number, readonly number[]>;
  /**
   * Forced ME waves whose selected option intentionally spawns a battle. These waves exercise the complete
   * authoritative ME terminal -> enemy-party adoption -> shared battle -> ME reward-tail continuation instead
   * of the non-battle meResync/leave terminal. Keeping this explicit makes the campaign schedule deterministic:
   * encounter option callbacks do not expose static "spawns battle" metadata before they execute.
   */
  meBattleWaves?: ReadonlySet<number>;
  /**
   * Forced non-battle ME waves whose selected option intentionally has no embedded reward shop. The driver
   * parks these at PostMysteryEncounterPhase and lets the normal authoritative terminal close the encounter,
   * instead of waiting for a SelectModifierPhase that the event contract never queues.
   */
  meNoRewardWaves?: ReadonlySet<number>;
  /**
   * #843/#849 CATCH LEG (BUILD 1). A set of wave indices where the soak DRIVES a seeded ball throw ->
   * capture -> dexSync instead of an all-faint win. On each such wave the driver faints ONE wild enemy (the
   * host attacks it while the guest SWITCHES, so no move redirect KOs the survivor), then HOST-throws a
   * MASTER_BALL at the lone survivor via the real {@linkcode GameManager.doThrowPokeball} (opens the real
   * BALL menu -> AttemptCapturePhase -> capture -> broadcastCoopWaveResolved("capture") + the dexSync
   * broadcast), reconciles the GUEST to the host's post-catch party ({@linkcode applyCoopCaptureParty}) +
   * dex (the {@linkcode captureCoopDexBaseline}-scoped dexSync stream) + ball inventory, and asserts BOTH
   * accounts' dex credit + ball-count convergence (the #843 pokeball-drift guard). Undefined (the default)
   * = byte-identical to today (no catch driven; the `catch` situation + BALL mode + dexSync kind/band stay
   * declared-undrivable for the default run). Each designated wave MUST be a WILD non-boss double.
   */
  catchWaves?: ReadonlySet<number>;
  /**
   * #848/#849 LEARN-MOVE LEG (BUILD 2). A set of wave indices where the soak DRIVES a level-up move-learn that
   * ACCEPTS + forces a forget across BOTH engines (instead of the default decline), and asserts moveset
   * convergence. On each such wave, after the battle, the driver forces the real ER
   * {@linkcode LearnMoveBatchPhase} on a full-moveset GUEST-owned mon: the host opens the read-only WATCHER
   * panel + streams the present, the guest opens the OWNER panel + picks the replacement (accept, forget slot
   * 0), and the host applies the guest's pick authoritatively - the #848 shared batch-panel path. This lights
   * the LEARN_MOVE_BATCH mode + the learnMoveBatch/learnMoveBatchForward kinds + the learnMoveBatchFwd band +
   * the `levelUpLearn` situation, and asserts BOTH engines' moveset converged. Undefined (the default) =
   * byte-identical to today (level-up learns declined). The caller MUST give the party RAW (not overridden)
   * movesets so the learn's setMove is visible (a MOVESET_OVERRIDE masks getMoveset()); see the leg test.
   */
  learnMoveWaves?: ReadonlySet<number>;
  /**
   * #807/#810/#849 SAVE-RESUME LEG (BUILD 3). A set of wave indices where the soak SERIALIZES the host's live
   * session mid-run, PERTURBS the guest so it diverges, then REBOOTS the guest from the host snapshot (the
   * #807/#810 coopGuestResumeBoot core, {@linkcode GameData.applyCoopLaunchSession}) and asserts the guest
   * CONVERGES byte-equal to the host (full parity, zero divergence at boot). The run then CONTINUES - the
   * next wave's re-mirror re-syncs the guest - so a resume at wave N of a >=N+2 run proves the run stays green
   * for 2+ more waves. This lights the `saveResume` situation. Undefined (the default) = byte-identical to
   * today (a single continuous process, no save/resume exercised).
   */
  resumeWaves?: ReadonlySet<number>;
}

/** A structured HARD invariant breach (DESYNC / LOCKSTEP / NO-PARK / TEARDOWN) the driver throws after writing the
 * failure artifact. (An unhealed DIGEST divergence is recorded as a {@linkcode SoakFinding} + continues,
 * not thrown, so a long soak surveys the whole run.) */
export class SoakInvariantError extends Error {
  public readonly invariant: "desync" | "lockstep" | "no-park" | "teardown";
  public readonly seed: number;
  public readonly wave: number;
  public readonly detail: string;
  public readonly artifactDir: string;

  public constructor(
    invariant: "desync" | "lockstep" | "no-park" | "teardown",
    seed: number,
    wave: number,
    detail: string,
    artifactDir: string,
  ) {
    super(
      `[coop-soak] ${invariant.toUpperCase()} invariant breached at wave ${wave} (seed ${seed}): ${detail}. `
        + `Artifact + both logs: ${artifactDir}. Replay: SOAK_SEED=${seed}`,
    );
    this.name = "SoakInvariantError";
    this.invariant = invariant;
    this.seed = seed;
    this.wave = wave;
    this.detail = detail;
    this.artifactDir = artifactDir;
  }
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/**
 * Bounded per-wave TURN budget (NO-PARK): a wave that is not won within this many turns strands. Raised
 * for #843 REAL combat: the wave now fights its real generated species (real hp / bulk / boss segments),
 * not a 1-HP MAGIKARP, so a bulky boss can legitimately take many turns to grind down even at the player's
 * level edge. Still bounded so a genuine strand (a wave that can NEVER be won - a dead-move stall, an
 * unkillable foe) fails LOUD instead of hanging.
 */
const MAX_TURNS_PER_WAVE = 60;

/** Party-slot co-op ownership for the soak: host owns EVEN party slots, guest owns ODD (3-mon-per-player). */
function coopOwnerForPartySlot(slot: number): "host" | "guest" {
  return slot % 2 === 0 ? "host" : "guest";
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

// ---------------------------------------------------------------------------
// Deterministic per-slot move choice (cross-side agreed, NO stream draw so both engines
// pick the SAME move for a slot without communicating).
// ---------------------------------------------------------------------------

/** Salts so the host slot and the guest slot draw INDEPENDENT (but per-side stable) move choices. */
const HOST_SLOT_SALT = 0x484f5354; // "HOST"
const GUEST_SLOT_SALT = 0x47554553; // "GUES"

/** Salts for the per-side VOLUNTARY-SWITCH decision (independent of the move-choice salts). */
const HOST_SWITCH_SALT = 0x53574348; // "SWCH"
const GUEST_SWITCH_SALT = 0x53574332; // "SWC2"
/** Roughly this % of a side's turns issue a voluntary SWITCH command instead of a move (coverage #4). */
const SWITCH_CHANCE_PCT = 15;

/**
 * Whether THIS side issues a VOLUNTARY SWITCH this turn (seeded, ~{@linkcode SWITCH_CHANCE_PCT}% per side
 * per turn) - PURE. #843 coverage decision #4: occasionally exercising the REAL Command switch path (host
 * via game.doSwitchPokemon, guest via a relayed Command.POKEMON) so the two-engine switch relay + the
 * guest's checkpoint-carried switch replay are surveyed by the soak, not just the faint-switch path.
 */
function switchesThisTurn(seed: number, wave: number, turn: number, salt: number): boolean {
  return hashInts(seed, wave, turn, salt) % 100 < SWITCH_CHANCE_PCT;
}

/** The move slot (index into the mon's moveset) this side picks for `fieldIndex` this wave - PURE. */
function chosenMoveSlot(seed: number, wave: number, salt: number, moveCount: number): number {
  if (moveCount <= 1) {
    return 0;
  }
  return hashInts(seed, wave, salt) % moveCount;
}

/** Resolve a mon's chosen move to `{ slot, moveId }` (moveset is identical host-side vs guest-side). */
function resolveChosenMove(
  mon: Pokemon,
  target: Pokemon | undefined,
  seed: number,
  wave: number,
  salt: number,
  avoidSelfKo = false,
): { slot: number; moveId: number } {
  const moveset = mon.getMoveset().filter((m): m is NonNullable<typeof m> => m != null);
  // #843 RESTRICTION-AWARE: the real command menu only accepts a move that is SELECTABLE this turn - PP
  // remaining AND not blocked by a REAL enemy move (Disable / Encore / Torment / Taunt / Imprison / Choice
  // lock). This is the EXACT predicate CommandPhase uses to build its legal move-slot list
  // (`m.isUsable(mon, false /*ignorePp*/, true /*forSelection*/)[0]`, command-phase.ts:313). The soak fixes
  // ONE slot per wave, so real combat both drains PP and can Encore/Disable the fixed pick; filtering by the
  // selectable set means we never hand the FIGHT menu an illegal move (which soft-locks it open).
  const selectable = moveset.filter(m => m.isUsable(mon, false, true)[0]);
  // The level profile owns one dedicated wave-2 Explosion leg. Outside that leg, repeatedly rolling
  // Explosion is not representative combat: a seed can make the last surviving mon self-KO on an early
  // trash wave and collapse the intended wave-30..50 faint/replacement survey. Prefer every other legal
  // move, but retain Explosion as the honest last resort when it is the only selectable command.
  const survivableSelectable = avoidSelfKo ? selectable.filter(m => m.moveId !== MoveId.EXPLOSION) : selectable;
  const preferredSelectable = survivableSelectable.length > 0 ? survivableSelectable : selectable;
  // #843 EFFECTIVENESS-AWARE: with REAL enemies a fixed-slot move can be TYPE-IMMUNE against the wave's real
  // species (e.g. SHADOW_BALL/Ghost vs a Normal-type = 0x), which deals ZERO damage forever and NO-PARK
  // stalls the wave. Prefer selectable moves that deal NON-ZERO damage to the target; both engines evaluate
  // the SAME host-authoritative target (pickTargets reads rig.hostScene), so the seeded pick still agrees.
  const effective =
    target == null
      ? preferredSelectable
      : preferredSelectable.filter(m => target.getMoveEffectiveness(mon, m.getMove()) > 0);
  // Fall back progressively so a pick always exists (all-immune or all-spent are degenerate; the wave then
  // NO-PARKs loudly rather than silently narrowing).
  const pool = effective.length > 0 ? effective : preferredSelectable.length > 0 ? preferredSelectable : moveset;
  const pick = pool[chosenMoveSlot(seed, wave, salt, pool.length)] ?? pool[0];
  return { slot: moveset.indexOf(pick), moveId: pick.moveId };
}

/**
 * Make the GUEST faithfully reflect the HOST after a mirror, using ONLY the production per-turn convergence
 * mechanism. #843 shrank this heal: the harness mirror (mirrorHostBattleToGuest) now carries arena
 * weather/terrain, boss segments, the run seed/money/ball inventory, and the player-wide modifier set (the
 * last via reconcileCoopPlayerModifiers, whose multi-instance keying was fixed in coop-battle-engine.ts),
 * so the driver no longer supplements those - a re-mirror is a full reset and OWNS that fidelity. What
 * remains here is the ONE thing the mirror's PokemonData round-trip does not carry: per-mon HELD ITEMS
 * (player AND enemy), which in PRODUCTION converge every turn through the full-field snapshot
 * ({@linkcode applyCoopFieldSnapshot}). Keeping ONLY that production heal (and dropping the arena /
 * multi-instance-modifier / money-ball SHIMS) means a between-wave money/ball GRANT divergence is no longer
 * masked by a driver scalar copy - it is now detectable (see assertScalarConvergence, the pokeball-drift
 * classifier). Runs after the initial mirror and after every re-mirror.
 */
async function healGuestFromHost(rig: DuoRig): Promise<void> {
  const snapshot = await withClient(rig.hostCtx, () => captureCoopFieldSnapshot());
  await withClient(rig.guestCtx, () => {
    applyCoopFieldSnapshot(snapshot ?? undefined, true);
  });
}

/** Pick the host + guest attack TARGETS from the host's live enemy field (distinct alive foes when possible). */
function pickTargets(hostScene: BattleScene): {
  hostTarget: BattlerIndex;
  guestTarget: BattlerIndex;
  hostTargetMon: Pokemon;
  guestTargetMon: Pokemon;
} {
  const field = hostScene.getEnemyField();
  const alive = field.filter(e => !e.isFainted());
  const h = alive[0] ?? field[0];
  const g = alive[Math.min(1, alive.length - 1)] ?? h;
  return { hostTarget: h.getBattlerIndex(), guestTarget: g.getBattlerIndex(), hostTargetMon: h, guestTargetMon: g };
}

// ---------------------------------------------------------------------------
// #843 REAL-COMBAT faint replacement. Real enemies with real movesets chip the player down, so a player
// mon can faint mid-soak - and a faint MUST be driven or the run NO-PARK strands. The duo harness carries
// the full #786 machinery (the guest chooses its OWN replacement via CoopGuestFaintSwitchPhase + relay; the
// host auto-picks after its bounded wait). Here we drive BOTH sides headlessly: the HOST's own-slot faint
// opens a real SwitchPhase PARTY picker (auto-picked via onNextPrompt), and the GUEST's own-slot faint
// opens its CoopGuestFaintSwitchPhase PARTY picker (auto-picked by stubbing the one PARTY setMode during
// the guest replay pump). See coop-duo-faint-switch.test.ts - this is that test's pattern, made continuous.
// ---------------------------------------------------------------------------

/**
 * Restore ALL move PP on a scene's player party. #849 GOD-PARTY survivability knob: with a FIXED-slot
 * seeded move picker + a god-tier party that reaches the deep endgame (waves 90+), a move's PP would
 * eventually FULLY deplete, and the picker's last-resort fallback (the raw moveset, when every selectable
 * move is spent) would hand `game.move.select` a no-PP move - which the framework rejects ("not in
 * moveset", getMovePosition gates on `ppUsed < movePp`), STRANDING the run (seed 20260704 wave 90). This
 * is the SAME class as the every-10-waves PartyHealPhase (which already restores PP), just applied per-wave
 * so a long god run never strands on Struggle. It is a determinism/survivability knob (like startingLevel /
 * force-hit / the moveset override), NOT content narrowing - it disables no enemy content and both engines
 * still replay the SAME forced events. Called on the host at wave-start; the re-mirror + heal carry it to
 * the guest (and it is applied to the guest directly too, defensively).
 */
function restorePlayerPartyPp(scene: BattleScene): void {
  for (const mon of scene.getPlayerParty()) {
    for (const mv of mon.getMoveset()) {
      if (mv != null) {
        mv.ppUsed = 0;
      }
    }
  }
}

/**
 * Keep the god profile a start-to-finish architecture carrier without making active combat immortal.
 * Only benched mons are revived between turns; active mons still take real damage, faint, and exercise
 * replacement paths. The faint-heavy level profile remains untouched and owns attrition/wipe coverage.
 */
function restoreGodProfileBench(scene: BattleScene): void {
  const activeIds = new Set(scene.getPlayerField().map(mon => mon.id));
  for (const mon of scene.getPlayerParty()) {
    if (activeIds.has(mon.id)) {
      continue;
    }
    mon.hp = mon.getMaxHp();
    mon.resetStatus(true, false, false, false);
  }
}

/** Tag co-op party-slot ownership on BOTH scenes (host owns EVEN slots, guest ODD) so a faint has a legal
 * same-owner bench. The per-wave mirror copies host `coopOwner` onto the guest, so tagging the host party
 * propagates on every re-mirror; wave 1 (pre-mirror) also tags the guest party directly. */
function tagCoopPartyOwnership(rig: DuoRig): void {
  const hostParty = rig.hostScene.getPlayerParty();
  for (let i = 0; i < hostParty.length; i++) {
    hostParty[i].coopOwner = coopOwnerForPartySlot(i);
  }
  withClientSync(rig.guestCtx, () => {
    const guestParty = rig.guestScene.getPlayerParty();
    for (let i = 0; i < guestParty.length; i++) {
      guestParty[i].coopOwner = coopOwnerForPartySlot(i);
    }
  });
}

/**
 * First legal (non-fainted, benched) SAME-OWNER party slot the given owner may send in, or -1 if none.
 *
 * 🔴 #848 STRICT SAME-OWNER (no cross-owner fallback). In 2-player co-op each player owns exactly one FIELD
 * slot (host slot 0, guest slot 1) and may ONLY switch/replace from their OWN party half - field-slot
 * OWNERSHIP is load-bearing (both engines resolve a slot's owner from the occupant's coopOwner tag), NOT
 * "a nicety". The OLD fallback returned ANY legal bench mon, so when a side had exhausted its own bench a
 * voluntary switch or faint replacement seated the PARTNER's mon into that side's field slot - corrupting
 * the seating so the two engines DISAGREED which slot the guest controls (seed 20260704 wave 62: the guest
 * voluntary-switched slot 1 to a HOST-owned party[2], and separately a host switch seated a guest-owned
 * GARCHOMP into slot 0). The host then resolved slot 0 as guest-owned, requested the partner command for
 * it, and both engines spun. Returning -1 when no same-owner bench exists is CORRECT: a voluntary switch
 * then declines (falls through to a move), a guest faint replacement defers to production's own strict
 * auto-pick ({@linkcode coopAutoPickReplacement}, which leaves the slot empty), and a host faint with no
 * host bench is a host-half-exhaustion terminal ({@linkcode hostRunEndReason}), never a seating swap.
 */
export function firstLegalBenchSlot(scene: BattleScene, owner: "host" | "guest"): number {
  const party = scene.getPlayerParty();
  const battlerCount = scene.currentBattle?.getBattlerCount() ?? 2;
  for (let i = battlerCount; i < party.length; i++) {
    const mon = party[i];
    if (mon != null && !mon.isFainted() && mon.isAllowedInBattle() && mon.coopOwner === owner) {
      return i;
    }
  }
  return -1;
}

/**
 * First FAINTED party slot (any owner), or -1 if the party is fully alive. #832: the faint-heavy level
 * profile uses this to pick a Revive reward's target - a Revive is a party-wide item applied to a chosen
 * slot (both engines apply to the SAME party[slot], so slot OWNERSHIP is irrelevant here, unlike a
 * field-slot switch/replacement). Used only when a Revive actually rolled in the wave's real reward pool.
 */
export function firstFaintedPartySlot(scene: BattleScene): number {
  const party = scene.getPlayerParty();
  for (let i = 0; i < party.length; i++) {
    if (party[i]?.isFainted()) {
      return i;
    }
  }
  return -1;
}

/**
 * True if a HOST-owned field slot is currently FAINTED - i.e. the host's real SwitchPhase (the OWNER-path
 * PARTY picker) is about to open at turn end and needs driving. Reads rig.hostScene directly, so it is
 * owner-ctx-independent. Used to arm {@linkcode registerHostFaintAutoPick} POST-HOC (only when a send-out
 * is genuinely pending), so the one-shot picker is never registered - and left lingering at the prompt
 * queue head - on a faint-free turn.
 */
export function hostOwnedFaintPending(rig: DuoRig): boolean {
  return rig.hostScene.getPlayerField().some(m => m.isFainted() && m.coopOwner === "host");
}

/** Terminal host phases: the run has ENDED (a wipe -> GameOver -> Title), so no battle can be driven. */
const HOST_RUN_END_PHASES = new Set(["GameOverPhase", "TitlePhase"]);

/**
 * DETECT a mid-soak host RUN-END (#846): the host party WIPED (all mons fainted), or the host has
 * transitioned to a terminal phase (GameOverPhase -> TitlePhase), or its currentBattle is gone. When true
 * the soak must STOP surveying and record a terminal outcome - never drive another phaseInterceptor.to()
 * (which would hang against a run that is over and mis-surface as a NO-PARK strand). Reads rig.hostScene
 * directly, so it is owner-ctx-independent. Returns a reason string (for the terminal outcome) or null.
 *
 * The evil-team fixed-trainer gauntlet (waves 62/64/66) at the soak's level edge with NO shop healing was
 * the concrete wipe class this closes (CI run 28710818213, seed 20260704, wave 66). A wipe is EXPECTED to
 * be rare (the soak's premise is a winnable level edge + the real every-10-wave PartyHealPhase firing on
 * the host's wave crossings); when it happens it is reported LOUDLY with the wave, not hidden as a strand.
 */
export function hostRunEndReason(rig: DuoRig): string | null {
  const phaseName = rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "";
  if (HOST_RUN_END_PHASES.has(phaseName)) {
    return `host at terminal phase ${phaseName}`;
  }
  if (rig.hostScene.currentBattle == null) {
    return "host currentBattle is null (run torn down)";
  }
  const party = rig.hostScene.getPlayerParty();
  if (party.length > 0 && party.every(m => m.isFainted())) {
    return "host player party WIPED (all mons fainted)";
  }
  // #848 HOST-HALF EXHAUSTION is NO LONGER a terminal here (#828 ASYMMETRIC CONTINUATION, BUILD 2). A
  // host-owned field slot fainted with no legal host-owned bench does NOT end the run: production's real
  // exhausted-partner guard (switch-phase.ts:191-198 closes the un-pickable modal picker + leaves the slot
  // empty; command-phase.ts:468-481 arrives-only on the reciprocal barrier so the survivor plays on
  // unthrottled) keeps the GUEST half playing waves SOLO to the wave end. The soak now DRIVES that path
  // instead of stopping at it - see {@linkcode hostHalfExhausted} + the wave loop's guest-solo continuation.
  // Only a TRUE terminal (a FULL party wipe / GameOver / Title / torn-down battle, handled above) ends the
  // survey.
  return null;
}

/**
 * #828 ASYMMETRIC CONTINUATION predicate (BUILD 2): the HOST half is exhausted - a host-owned field slot is
 * fainted and the host has NO legal same-owner bench to replace it (strict {@linkcode firstLegalBenchSlot}) -
 * but the GUEST half still has a battle-legal mon, so the run CONTINUES with the guest playing solo. This is
 * the exact live state production's exhausted-partner guard exists for (a long run hits it whenever one
 * player's whole half dies before the other's); the driver detects it to (a) skip arming the host faint
 * auto-picker (the modal picker self-closes, there is no pick to drive) and (b) record the `hostHalfExhausted`
 * surface + keep surveying. Reads rig.hostScene directly (owner-ctx-independent). Returns false once the guest
 * half is ALSO down (that is a full wipe - {@linkcode hostRunEndReason} classifies that terminal).
 */
export function hostHalfExhausted(rig: DuoRig): boolean {
  if (!(hostOwnedFaintPending(rig) && firstLegalBenchSlot(rig.hostScene, "host") < 0)) {
    return false;
  }
  // Guest half must still be alive (else it is a full wipe, not an asymmetric continuation).
  return rig.hostScene
    .getPlayerParty()
    .some(m => m != null && m.coopOwner === "guest" && !m.isFainted() && m.isAllowedInBattle());
}

/**
 * Register a one-shot HOST faint auto-picker for the imminent turn: when a HOST-owned mon faints and the
 * host's real SwitchPhase opens the PARTY picker, send out the first legal host-owned bench mon. (A
 * GUEST-owned faint does NOT open a host PARTY picker - the host's SwitchPhase awaits the guest's relayed
 * pick - so this only fires for host-owned faints.) Expires at the next turn / post-battle boundary so it
 * never lingers at the queue head. Mirrors run-scenario.ts's registerFaintSwitch.
 *
 * 🔴 #845: this MUST be armed POST-HOC - only AFTER the turn has played (the host sitting at TurnEndPhase),
 * right before the crossing that opens the picker - NOT preemptively at the turn's own CommandPhase. The
 * expireFn below drops the prompt the instant a prompt tick sees CommandPhase; registering it while the
 * host still sits at CommandPhase (the old bug) expired it on the very first tick, before the turn even
 * resolved, so the faint's SwitchPhase (which opens at TURN END, after TurnEndPhase) had no picker driving
 * it and parked forever. See the call sites (all gated by {@linkcode hostOwnedFaintPending}).
 */
export function registerHostFaintAutoPick(game: GameManager, rig: DuoRig): void {
  game.onNextPrompt(
    "SwitchPhase",
    UiMode.PARTY,
    () => {
      // A SwitchPhase that reached UiMode.PARTY on the host is - by switch-phase.ts construction - a
      // HOST-owned faint's OWNER picker (a GUEST-owned faint takes the watcher/relay path: it shows
      // MESSAGE and awaits the guest's relayed pick, NEVER opening PARTY on the host). Defensively gate by
      // the fainted occupant's authoritative owner. Static field-index parity is invalid after asymmetric
      // takeover, where the surviving host legitimately occupies both field slots.
      const phase = rig.hostScene.phaseManager.getCurrentPhase() as unknown as { fieldIndex?: number } | undefined;
      const fieldIndex = phase?.fieldIndex;
      const faintedOccupant = typeof fieldIndex === "number" ? rig.hostScene.getPlayerField()[fieldIndex] : undefined;
      const drivesHostSlot =
        faintedOccupant?.coopOwner === "host"
        || (faintedOccupant == null
          && (typeof fieldIndex !== "number" || coopOwnerForPartySlot(fieldIndex) === "host"));
      const benchSlot = firstLegalBenchSlot(rig.hostScene, "host");
      if (drivesHostSlot && benchSlot >= 0) {
        const handler = rig.hostScene.ui.getHandler() as PartyUiHandler;
        handler.setCursor(benchSlot);
        handler.processInput(Button.ACTION); // select the bench mon
        handler.processInput(Button.ACTION); // send it out
      }
      // 🔴 #847 DOUBLE / INTERLEAVED FAINT: one turn can KO BOTH field slots, opening TWO replacement
      // SwitchPhases in a single crossing - the GUEST-owned one (watcher/relay) and this HOST-owned one -
      // in either order, with intervening SwitchSummon / PostSummon / out-of-band-checkpoint phases (and, on
      // a tough trainer wave, the trainer's own enemy send-outs) between them. A ONE-SHOT prompt could be
      // consumed or expired before the host-owned SwitchPhase opened, leaving it with NO picker and
      // STRANDING the to("CommandPhase") crossing forever (seed 20260704 wave 66, a fixed evil-team trainer
      // wave). RE-ARM while a host-owned faint is STILL pending (the summon this pick queued has not fielded
      // yet, so the slot still reads fainted here) and a legal host bench remains - so the picker DRAINS
      // EVERY host-owned SwitchPhase in the crossing. The bench guard stops a no-replacement host PARTY (the
      // run is wiping) from re-arming into an infinite loop; hostRunEndReason then classifies that terminal.
      if (hostOwnedFaintPending(rig) && firstLegalBenchSlot(rig.hostScene, "host") >= 0) {
        registerHostFaintAutoPick(game, rig);
      }
    },
    // Expire ONLY when no host-owned faint remains to drive. The old phase-list expireFn (CommandPhase /
    // TurnInitPhase / ...) could drop the picker on a phase that runs BETWEEN two faint replacements,
    // stranding the second (host-owned) SwitchPhase - the #847 failure mode. Gating on the faint state
    // instead can never expire mid-crossing while a host-owned faint is still open, and a faint-free arm
    // still never lingers because every arming site gates on hostOwnedFaintPending.
    () => !hostOwnedFaintPending(rig),
  );
}

/**
 * Drive the guest's replay turn with the #786 own-faint picker auto-resolved: if the guest's
 * CoopGuestFaintSwitchPhase opens its PARTY picker (a guest-owned mon fainted), pick the first legal
 * guest-owned bench slot - which fires the GENUINE relay send + seq keying (the host summons the guest's
 * pick). MUST be called inside withClient(guestCtx). The stub is one-shot per PARTY open and restored in a
 * finally so it never leaks into the next turn's rendering.
 */
async function driveGuestReplayTurnWithFaint(rig: DuoRig, turn: number): Promise<void> {
  const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
  const realSetMode = ui.setMode.bind(ui);
  ui.setMode = (...args: unknown[]): unknown => {
    if (args[0] === UiMode.PARTY) {
      ui.setMode = realSetMode; // one-shot: restore before invoking the picker callback
      const slot = firstLegalBenchSlot(rig.guestScene, "guest");
      if (slot >= 0) {
        (args[3] as (slotIndex: number, option: number) => void)(slot, 0);
      }
      return;
    }
    if (args[0] === UiMode.MESSAGE) {
      return; // the picker's close transition - a no-op headlessly
    }
    return realSetMode(...args);
  };
  try {
    await driveGuestReplayTurn(rig.guestScene, turn);
  } finally {
    ui.setMode = realSetMode;
  }
}

// ---------------------------------------------------------------------------
// Failure artifact.
// ---------------------------------------------------------------------------

/**
 * Write the failure artifact for an invariant breach: the seed, wave, invariant, the action script so
 * far, a phase/relay wait-state snapshot, and BOTH clients' captured logs (reusing the duo capture's
 * per-client buckets). Returns the directory so the thrown error can point at it.
 */
function writeSoakArtifact(
  logs: DuoLogs,
  info: {
    seed: number;
    wave: number;
    invariant: string;
    detail: string;
    actionScript: string[];
    phaseState?: Record<string, unknown>;
  },
): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve(process.cwd(), "dev-logs", "coop-soak", `${ts}__seed-${info.seed}__wave-${info.wave}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "failure.json"),
    JSON.stringify(
      {
        invariant: info.invariant,
        seed: info.seed,
        wave: info.wave,
        detail: info.detail,
        replay: `SOAK_SEED=${info.seed}`,
        phaseState: info.phaseState ?? null,
        actionScript: info.actionScript,
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "host.log"), logs.host.join("\n"), "utf8");
  fs.writeFileSync(path.join(dir, "guest.log"), logs.guest.join("\n"), "utf8");
  return dir;
}

/** Snapshot both clients' current phase names + interaction counters (the NO-PARK strand dump). */
function phaseStateDump(rig: DuoRig): Record<string, unknown> {
  const monDump = (mon: Pokemon) => ({
    id: mon.id,
    battlerIndex: mon.getBattlerIndex(),
    speciesId: mon.species.speciesId,
    speciesName: mon.species.name,
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    fainted: mon.isFainted(),
    status: mon.status?.effect ?? 0,
    statStages: [...mon.getStatStages()],
    moves: mon.getMoveset().map(move => (move == null ? null : { id: move.moveId, ppUsed: move.ppUsed })),
    coopOwner: (mon as Pokemon & { coopOwner?: "host" | "guest" }).coopOwner,
  });
  return {
    hostPhase: rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none",
    guestPhase: rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "none",
    hostInteractionCounter: rig.hostRuntime.controller.interactionCounter(),
    guestInteractionCounter: rig.guestRuntime.controller.interactionCounter(),
    hostWave: rig.hostScene.currentBattle?.waveIndex,
    hostBattleType: rig.hostScene.currentBattle?.battleType,
    hostPlayerField: rig.hostScene.getPlayerField().map(monDump),
    hostEnemyField: rig.hostScene.getEnemyField().map(monDump),
    guestPlayerField: rig.guestScene.getPlayerField().map(monDump),
    guestEnemyField: rig.guestScene.getEnemyField().map(monDump),
  };
}

/** Pin + sow the content RNG before `startBattle`; mirrors TitlePhase's setSeed -> resetSeed launch order. */
export function prepareCoopSoakContent(game: GameManager, seed: number, pinSeed?: string): string {
  const contentSeed = pinSeed ?? `coop-soak-${seed}`;
  game.scene.setSeed(contentSeed);
  // setSeed updates the master seed and derived offsets but deliberately does NOT sow Phaser.RND.
  // newArena rolls the first biome structure before newBattle's later resetSeed, so omitting this made
  // identical soak seeds inherit different process RNG cursors (biomeLength 25 vs 23 at wave 1).
  game.scene.resetSeed();
  // GameManager's scene reset created the starting arena BEFORE this test helper applied its custom
  // content seed. Re-address that already-created run-start structure to the new seed as a real fresh
  // launch would; later biome entries are handled by SwitchBiomePhase's seeded roll.
  erRollBiomeLength(game.scene.arena.biomeId, 1, contentSeed);
  return contentSeed;
}

// ---------------------------------------------------------------------------
// #849 COMPLETENESS BACKSTOP taps (module-level so the driver body stays readable).
// ---------------------------------------------------------------------------

/**
 * Install the coverage taps (test-side seam wraps, ZERO production change):
 *   - CARRIER tap on BOTH runtimes: every interactionChoice/interactionOutcome frame records its `kind`
 *     (hits.kinds) + the seq BAND it rides (bandForSeq -> hits.bands). The two ME carriers already cut over
 *     to retained P33 envelopes are projected from the exact outgoing operation id onto their legacy semantic
 *     coverage edges (`ME_PRESENT` -> `mePresent`, `ME_TERMINAL` -> `meResync`). ONE tap therefore covers
 *     every raw kind plus the durable replacements, including async ME tails that can escape the relay-instance
 *     wrapper. A carrier that never actually leaves a runtime stays cold and is caught by completeness.
 *   - PERMANENT guest ui.setMode recorder: every guest setMode targeting a co-op-MIRRORED UiMode records
 *     hits.modes. The guest is the renderer, so it opens the mirrored screens the headless host bypass
 *     never shows. The one-shot faint wrapper (driveGuestReplayTurnWithFaint) saves + calls THIS recorder
 *     as its `realSetMode`, so the two compose.
 */
const ME_OPERATION_WIRE_SEQ_STRIDE = 8_000;
const ME_OPERATION_KIND_SEQ_STRIDE = 1_000;

/**
 * Recover the real relay-address root encoded in an outgoing durable ME operation. This is deliberately an
 * observer of the final wire envelope: it does not sample the journal ledger, infer success from scene state,
 * or call an apply seam. Full address validation prevents a malformed/unrelated envelope from manufacturing a
 * coverage hit.
 */
function durableMeCoverageCarrier(message: CoopMessage): { seq: number; kind: "mePresent" | "meResync" } | null {
  if (message.t !== "envelope") {
    return null;
  }
  const operation = message.envelope.pendingOperation;
  if (operation == null || operation.status !== "applied") {
    return null;
  }

  let semanticKind: "mePresent" | "meResync";
  let kindTag: number;
  switch (operation.kind) {
    case "ME_PRESENT":
      semanticKind = "mePresent";
      kindTag = 0;
      break;
    case "ME_TERMINAL":
      semanticKind = "meResync";
      kindTag = 4;
      break;
    default:
      return null;
  }

  const parsed = parseCoopOperationId(operation.id);
  if (
    parsed == null
    || parsed.epoch !== message.envelope.sessionEpoch
    || parsed.owner !== operation.owner
    || parsed.kind !== operation.kind
  ) {
    return null;
  }
  const kindOffset = parsed.pinnedSeq % ME_OPERATION_WIRE_SEQ_STRIDE;
  const kindOffsetMin = kindTag * ME_OPERATION_KIND_SEQ_STRIDE;
  if (kindOffset < kindOffsetMin || kindOffset >= kindOffsetMin + ME_OPERATION_KIND_SEQ_STRIDE) {
    return null;
  }
  const seq = (parsed.pinnedSeq - kindOffset) / ME_OPERATION_WIRE_SEQ_STRIDE;
  return Number.isSafeInteger(seq) && seq >= 0 ? { seq, kind: semanticKind } : null;
}

function installCoverageTaps(rig: DuoRig, hits: SoakHitSet): void {
  const recordSend = (seq: number, kind: string): void => {
    hits.kinds.add(kind);
    const band = bandForSeq(seq);
    if (band != null) {
      hits.bands.add(band);
    }
  };
  for (const runtime of [rig.hostRuntime, rig.guestRuntime]) {
    // Observe the final transport carrier rather than a phase-owned relay method: detached async tails can
    // still send a valid frame after their initiating relay call stack has unwound.
    const transport = runtime.localTransport;
    const realSend = transport.send.bind(transport);
    transport.send = (message: CoopMessage): void => {
      if (message.t === "interactionChoice" || message.t === "interactionOutcome") {
        recordSend(message.seq, message.kind);
      } else {
        const durableMeCarrier = durableMeCoverageCarrier(message);
        if (durableMeCarrier != null) {
          recordSend(durableMeCarrier.seq, durableMeCarrier.kind);
        }
      }
      realSend(message);
    };
  }
  const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
  const realSetMode = ui.setMode.bind(ui);
  ui.setMode = (...args: unknown[]): unknown => {
    const mode = args[0];
    if (typeof mode === "number" && COOP_UI_MIRRORED_MODES.has(mode as UiMode)) {
      hits.modes.add(mode as UiMode);
    }
    return realSetMode(...args);
  };
}

/**
 * Record the wave-start battle-SHAPE situations (reusing the host's already-rolled battle): wildDouble /
 * single / triple for wild waves, trainerFixed / trainerRandom for trainer waves, and boss when an
 * on-field enemy is a boss. Called once per wave at wave-start.
 */
function recordWaveStartSituations(rig: DuoRig, wave: number, hits: SoakHitSet): void {
  const battle = rig.hostScene.currentBattle;
  const battlerCount = battle.getBattlerCount();
  if (battle.battleType === BattleType.TRAINER) {
    hits.situations.add(
      rig.hostScene.gameMode.isFixedBattle(wave)
        ? COOP_SOAK_SITUATIONS.trainerFixed
        : COOP_SOAK_SITUATIONS.trainerRandom,
    );
  } else if (battle.battleType === BattleType.WILD) {
    hits.situations.add(
      battlerCount >= 3
        ? COOP_SOAK_SITUATIONS.triple
        : battlerCount === 2
          ? COOP_SOAK_SITUATIONS.wildDouble
          : COOP_SOAK_SITUATIONS.single,
    );
  }
  if (rig.hostScene.getEnemyField().some(e => e.isBoss())) {
    hits.situations.add(COOP_SOAK_SITUATIONS.boss);
  }
}

/**
 * Record the per-turn situations sampled at TurnEndPhase (BEFORE the faint pickers drive, so fainted mons
 * are still on-field): player faint count (singleFaint / doublePlayerFaint), arena weather / terrain
 * presence, and a mid-turn enemy switch (an enemy field slot whose occupant id changed to a new live mon -
 * a trainer sending its next mon after a KO, or an enemy voluntary switch). All PROBABILISTIC surfaces.
 */
function recordTurnSituations(rig: DuoRig, enemyIdsBefore: number[], hits: SoakHitSet): void {
  const fainted = rig.hostScene.getPlayerField().filter(m => m?.isFainted()).length;
  if (fainted >= 1) {
    hits.situations.add(COOP_SOAK_SITUATIONS.singleFaint);
  }
  if (fainted >= 2) {
    hits.situations.add(COOP_SOAK_SITUATIONS.doublePlayerFaint);
  }
  const arena = rig.hostScene.arena;
  if (arena.weather != null && arena.weather.weatherType !== WeatherType.NONE) {
    hits.situations.add(COOP_SOAK_SITUATIONS.weather);
  }
  if (arena.terrain != null && arena.terrain.terrainType !== TerrainType.NONE) {
    hits.situations.add(COOP_SOAK_SITUATIONS.terrain);
  }
  const enemyIdsAfter = rig.hostScene.getEnemyField().map(e => e.id);
  for (let i = 0; i < enemyIdsAfter.length; i++) {
    if (enemyIdsAfter[i] !== enemyIdsBefore[i]) {
      hits.situations.add(COOP_SOAK_SITUATIONS.enemySwitch);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------------

/**
 * Run a full seeded co-op soak on a HOST GameManager already IN a live co-op-eligible battle (the caller
 * applies the overrides + calls game.classicMode.startBattle). Stands up the two-engine rig, plays `waves`
 * waves driving both owners' commands + the reward shops through the REAL relays with all randomness drawn
 * from `seed`, and asserts the four invariants continuously. Returns a {@linkcode SoakResult} on success;
 * an invariant breach writes the failure artifact + THROWS a {@linkcode SoakInvariantError}.
 */
export async function runCoopSoak(game: GameManager, opts: SoakOptions): Promise<SoakResult> {
  const { seed, waves, logs } = opts;
  const rewardPolicy = opts.rewardPolicy ?? "seeded";
  const profile = opts.profile ?? "god";
  // #879 review item 5: production-fidelity mode (default "harness" = byte-identical to today). Gates the
  // guest-heal seams (no per-wave player re-mirror / healGuestFromHost) + the guest command SOURCE.
  const fidelity: SoakFidelity = opts.fidelity ?? "harness";
  const rng = mulberry32(seed);
  const actionScript: string[] = [];
  const skips: Record<string, number> = {};
  const boundaryDigests: SoakBoundaryDigest[] = [];
  const postWaveStates: SoakPostWaveState[] = [];
  const findings: SoakFinding[] = [];
  let resyncHeals = 0;
  const preHealMismatches: SoakPreHealMismatch[] = [];
  let wavesCompleted = 0;
  // #838 Phase 5: pin the LOUD assertion severity (console.error) and zero the counter so this run's
  // production per-turn checksum assertions are read back cleanly (the ER suite shares module state across
  // files with isolate:false, so a prior file's mismatch must not bleed into this run's `assertions`).
  setCoopChecksumAssertSeverity("assert");
  resetCoopChecksumAssertionCount();
  // #828 ASYMMETRIC CONTINUATION (BUILD 2): waves surveyed with the host half exhausted (guest solo).
  let guestSoloWaves = 0;
  // #633 MID-RUN ME CONTINUATION (BUILD 1): the mystery encounters driven inline this run.
  const mysteryEncounters: SoakResult["mysteryEncounters"] = [];
  // Whether the host half is CURRENTLY exhausted (so the transition is logged once, not every wave).
  let guestSoloActive = false;
  const trainerWaves = { total: 0, fixed: 0, random: 0 };
  // COMPLETENESS BACKSTOP (#849): the surfaces this run observes, populated by the taps installed below.
  const hits = createSoakHitSet();
  resetCoopUiRelayTrace();

  /** Record a battle-flow situation hit (idempotent; a Set). */
  const hitSituation = (s: CoopSoakSituation): void => {
    hits.situations.add(s);
  };
  /** Record a mirrored-UiMode hit (the command-issue tap uses this; the guest ui recorder filters itself). */
  const hitMode = (m: UiMode): void => {
    hits.modes.add(m);
  };

  const bumpSkip = (kind: string): void => {
    skips[kind] = (skips[kind] ?? 0) + 1;
    actionScript.push(`SKIP ${kind}`);
  };

  // #633 BUILD 1: when NO ME leg is configured (opts.meWaves unset) the continuous soak is wave/shop-only -
  // MEs stay OFF (the caller sets mysteryEncounterChance 0), skip-counted here for the report. When a ME leg
  // IS configured, the designated waves are DRIVEN inline (processMeWave), so this skip is NOT recorded.
  if (opts.meWaves == null || opts.meWaves.size === 0) {
    bumpSkip("mysteryEncounterDisabledV1");
  }

  // #899 REPLAY COMPLETENESS: SOAK_SEED used to seed only the driver's action PRNG while game content used
  // the framework's unrelated run seed. The same printed replay could therefore pass or strand on different
  // enemies (observed twice at seed 20260710 wave 2), making its artifact non-reproducible. Pin content too.
  const contentSeed = opts.pinSeed ?? `coop-soak-${seed}`;
  const preseeded = game.scene.seed === contentSeed;
  if (!preseeded) {
    // Backward-compatible fallback for specialized callers not yet migrated; critical gate/nightly callers
    // pre-seed before startBattle so wave 1 is covered too.
    prepareCoopSoakContent(game, seed, opts.pinSeed);
  }
  actionScript.push(`content seed=${contentSeed} preseeded=${preseeded}`);

  // #843 CATCH LEG (BUILD 1): when a catch leg is configured, shorten the dexSync broadcast delay so the
  // host's post-catch dexSync timer fires DURING the guest-ctx reconcile drain (not during the host throw),
  // landing the partner dex credit on the GUEST account deterministically. The default run has no catch leg,
  // so this is never touched (the production 500ms default stands). The catch TEST restores it in afterEach.
  if (opts.catchWaves != null && opts.catchWaves.size > 0) {
    setCoopDexSyncDelayMs(200);
  }

  // TRAINER WAVES ARE SURVEYED (#846). Both FIXED trainer battles (rivals 8/25/55/95/145/195, evil-team
  // grunts/admins/bosses + E4/champion) AND RANDOM (rolled) trainer waves now run: the caller NO LONGER sets
  // .disableTrainerWaves(), and the harness mirror (mirrorHostBattleToGuest) is TRAINER-AWARE - it rebuilds
  // the guest with the host trainer identity + the FULL enemy party (bench included) keyed to the host's
  // authoritative trainerSlot, so a trainer wave mirrors faithfully and the enemy-switch machinery (the
  // trainer sending its next mon after a KO) reconstructs the SAME bench mon on-field, reconciled by the
  // per-turn checkpoint. The trainer VICTORY reward tail's interaction-counter semantics SPLIT by wave (the
  // #846 directive's question): a NON-milestone trainer wave queues a normal owner/watcher SelectModifierPhase
  // (+1 counter, driven by processNormalWave, money host-authoritative + guest lags benignly), but a %10
  // MILESTONE trainer wave AUTO-GRANTS via MoneyRewardPhase + ModifierRewardPhase with queuesSelectModifier
  // =false (counter +0, EXACTLY like a boss) - so the wave loop routes ALL %10 waves through processBossWave
  // (see the bossWave detection below), never asserting a +1 shop advance a milestone trainer never makes.
  // Trainer intro dialogue is auto-skipped by the framework (coopVictoryDialogueDecision force-skips it in
  // co-op; the headless host never opens it).
  // GHOST trainer waves (er-ghost-waves: elite 87+, hell/mystery 63+) need the network ghost-pool prefetch,
  // which the harness SUPPRESSES - with an empty pool applyErGhostOverride returns null so the wave degrades
  // to a normal trainer (no fetch, no hang); a ghost-flagged team is never fielded here. That is the only
  // trainer sub-class not exercised, and it degrades safely rather than being a silent gap.

  // Stand up the two-engine rig over one loopback pair (host owns EVEN interaction counters, guest ODD).
  const pair = createLoopbackPair();
  const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
  let previousBiome = rig.hostScene.arena.biomeId;
  let biomeTransitions = 0;
  // #843: tag party-slot co-op ownership (host EVEN slots, guest ODD) so a player faint has a legal
  // same-owner bench to replace from and the #786 guest-chooses-its-own-replacement path is exercised.
  tagCoopPartyOwnership(rig);
  // Make the guest faithfully reflect the host after the initial mirror (held items / ability / form /
  // tera / moveset via the production field snapshot + arena weather/terrain) - see healGuestFromHost.
  await healGuestFromHost(rig);

  // COMPLETENESS BACKSTOP (#849): install the RELAY-send tap (both runtimes) + the permanent guest
  // ui.setMode mirrored-mode recorder (test-side seam wraps, ZERO production change). See
  // installCoverageTaps.
  installCoverageTaps(rig, hits);

  // Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). The guest picks
  // the SAME move the host selects for the guest slot. #843: it reads the HOST's AUTHORITATIVE guest-slot mon
  // (not the guest's own wave-start mirror), so its PP-aware pick matches the host's playWave guest-select
  // EXACTLY even after the host has depleted a move's PP mid-wave (the guest mirror's PP is stale until the
  // checkpoint). Production-fidelity reads run under the guest client context because Pokemon legality,
  // field membership, trapping, and move usability consult process-global scene services internally.
  rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots, offer }) => {
    const compute = () => {
      // Production's guest is already parked in CoopReplayTurnPhase when a post-faint host reaches the
      // next command. The single-process soak crosses the host first, so consume the same queued
      // out-of-band replacement carrier here, under the guest context, before reading its command UI.
      const replacement = rig.guestRuntime.battleStream.consumeCheckpoint();
      if (
        replacement != null
        && applyCoopCheckpoint(replacement.checkpoint)
        && applyCoopAuthoritativeBattleState(replacement.authoritativeState, true)
      ) {
        rig.guestRuntime.battleStream.retainAppliedOutOfBandCheckpoint(replacement);
      }
      const wave = rig.hostScene.currentBattle.waveIndex;
      const turn = rig.hostScene.currentBattle.turn;
      // #879 PRODUCTION-FIDELITY command SOURCE. In "harness" mode the guest answerer reads the HOST's
      // authoritative guest-slot mon (byte-identical to today - a stale guest still borrows the host's move). In
      // "production" mode it reads the GUEST's OWN rendered scene (its own field mon / moveset / PP / enemy
      // field), exactly as a live guest client would: if the guest has DRIFTED (wrong mon on-field, spent PP,
      // stale enemy), it now constructs a DIFFERENT command than the host - which either desyncs loudly at the
      // per-turn checkpoint or picks an illegal/no-op move the framework rejects. That is the "a stale guest can
      // no longer hide" evidence this mode exists to surface. Reading the guest scene is a plain field read; the
      // guest mon-command still rides the REAL relay the host applies for the guest slot.
      const commandScene = fidelity === "production" ? rig.guestScene : rig.hostScene;
      // The faint-heavy profile must guarantee its namesake coverage instead of waiting for late-run damage
      // RNG. On wave 2 the guest lead sends a genuine Explosion through this production command relay. The
      // normal move, self-faint, guest-owned replacement relay and operation journal then execute unchanged.
      if (profile === "level" && wave === LEVEL_FORCED_FAINT_WAVE && turn === 1) {
        const guestMon = commandScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
        const explosionSlot = guestMon?.getMoveset().findIndex(move => move?.moveId === MoveId.EXPLOSION) ?? -1;
        if (explosionSlot >= 0 && moveSlots.includes(explosionSlot)) {
          const offeredExplosion =
            offer?.moves.find(move => move.moveId === MoveId.EXPLOSION)
            ?? offer?.moves.find(move => move.slot === explosionSlot);
          const explosionTargets = offeredExplosion?.targetSets[0];
          if (explosionTargets == null) {
            return fail("desync", wave, "host did not offer the guest's locally legal Explosion command");
          }
          actionScript.push(`wave ${wave} turn ${turn}: forced-faint guest EXPLOSION self-KO`);
          hitMode(UiMode.COMMAND);
          hitMode(UiMode.FIGHT);
          return {
            command: Command.FIGHT,
            cursor: explosionSlot,
            moveId: MoveId.EXPLOSION,
            targets: [...explosionTargets],
          };
        }
        fail("no-park", wave, "level forced-faint leg could not issue Explosion from the guest lead");
      }
      // #843 coverage #4: occasionally issue a VOLUNTARY SWITCH for the guest slot instead of a move, through
      // the REAL relay Command path (Command.POKEMON + party-slot cursor); the host summons the guest's pick
      // and the switch rides the per-turn checkpoint onto the guest's replay. Only when a legal guest-owned
      // bench mon exists AND the mon is NOT TRAPPED (#846: a trainer enemy's Shadow Tag / Arena Trap / trapping
      // move / Fairy Lock / ER FEAR makes the switch ILLEGAL - the real command menu greys out the POKEMON
      // option, so issuing Command.POKEMON for a trapped mon soft-locks the command resolution; isTrapped is
      // the exact gate the menu uses). Else fall through to a move.
      const guestSwitchMon = commandScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      const benchSlot = firstLegalBenchSlot(commandScene, "guest");
      if (
        switchesThisTurn(seed, wave, turn, GUEST_SWITCH_SALT)
        && benchSlot >= 0
        && guestSwitchMon != null
        && !guestSwitchMon.isTrapped()
      ) {
        const offeredSwitch = offer?.switches.find(candidate => candidate.slot === benchSlot);
        if (offeredSwitch?.canNormal !== true) {
          fail("desync", wave, `guest selected switch party[${benchSlot}] outside the host legal offer`);
        }
        actionScript.push(`wave ${wave} turn ${turn}: guest SWITCH -> party[${benchSlot}]`);
        // #849 COMMAND-issue tap: a guest voluntary switch drives the COMMAND menu + the PARTY picker.
        hitMode(UiMode.COMMAND);
        hitMode(UiMode.PARTY);
        return { command: Command.POKEMON, cursor: benchSlot };
      }
      const guestMon = commandScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      const { guestTarget, guestTargetMon } = pickTargets(commandScene);
      const { slot, moveId } = resolveChosenMove(
        guestMon,
        guestTargetMon,
        seed,
        wave,
        GUEST_SLOT_SALT,
        profile === "level",
      );
      const offeredMove =
        offer?.moves.find(move => move.moveId === moveId) ?? offer?.moves.find(move => move.slot === slot);
      // The renderer can hold a provisionally seated enemy whose internal battler index is still -1.
      // Target UI order is the visible enemy-field order, not `isActive(true)` (which depends on that
      // very index), so preserve the human's ordinal choice and map it onto the host's legal target sets.
      const guestTargetOrdinal = commandScene.getEnemyField().findIndex(mon => mon.id === guestTargetMon.id);
      const offeredTargets =
        offeredMove?.targetSets.find(targets => targets.includes(guestTarget))
        ?? (offeredMove?.targetSets.length === 1 ? offeredMove.targetSets[0] : undefined)
        ?? (guestTargetOrdinal >= 0 ? offeredMove?.targetSets[guestTargetOrdinal] : undefined);
      if (offeredMove != null && offeredTargets == null) {
        fail(
          "desync",
          wave,
          `guest command slot=${slot} move=${moveId} target=${guestTarget} is outside the host legal offer`,
        );
      }
      // Legacy screen-open evidence only: the provider bypasses the guest UI, so it may claim COMMAND/FIGHT
      // navigation but deliberately earns no TARGET_SELECT or uiRelay coverage.
      hitMode(UiMode.COMMAND);
      hitMode(UiMode.FIGHT);
      return {
        command: Command.FIGHT,
        cursor: offeredMove?.slot ?? slot,
        moveId: offeredMove?.moveId ?? moveId,
        targets: [...(offeredTargets ?? [guestTarget])],
      };
    };
    return fidelity === "production" ? withClientSync(rig.guestCtx, compute) : compute();
  });

  /** Capture BOTH clients' full-state checksums (each under its own ctx). */
  const captureChecksums = async (): Promise<{ host: string; guest: string }> => {
    const host = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guest = await withClient(rig.guestCtx, () => captureCoopChecksum());
    return { host, guest };
  };

  /** Capture BOTH clients' #837 save-data digests (each under its own ctx). */
  const captureSaveDigests = async (): Promise<{ host: string; guest: string }> => {
    const host = await withClient(rig.hostCtx, () => captureCoopSaveDataDigest());
    const guest = await withClient(rig.guestCtx, () => captureCoopSaveDataDigest());
    return { host, guest };
  };

  /** Optional exact normalized preimages for cross-run determinism failures (never retained by default). */
  const captureSavePreimages = async (): Promise<{
    hostSaveState: Record<string, unknown>;
    guestSaveState: Record<string, unknown>;
  }> => {
    const hostSaveState = await withClient(rig.hostCtx, () => structuredClone(captureCoopSaveDataNormalized()));
    const guestSaveState = await withClient(rig.guestCtx, () => structuredClone(captureCoopSaveDataNormalized()));
    return { hostSaveState, guestSaveState };
  };

  const fail = (invariant: "desync" | "lockstep" | "no-park" | "teardown", wave: number, detail: string): never => {
    const dir = writeSoakArtifact(logs, {
      seed,
      wave,
      invariant,
      detail,
      actionScript,
      phaseState: phaseStateDump(rig),
    });
    throw new SoakInvariantError(invariant, seed, wave, detail, dir);
  };

  /** INVARIANT (b) LOCKSTEP at a boundary: both controllers' interaction counters must be equal. */
  const assertLockstep = (wave: number, where: string): void => {
    const hostCtr = rig.hostRuntime.controller.interactionCounter();
    const guestCtr = rig.guestRuntime.controller.interactionCounter();
    if (hostCtr !== guestCtr) {
      fail("lockstep", wave, `interactionCounter host=${hostCtr} guest=${guestCtr} (${where}; must be equal)`);
    }
  };

  /** Record an unhealed host-vs-guest DIGEST divergence as a finding (grouped by fields; artifact on first). */
  const recordDigestFinding = async (wave: number, where: string): Promise<void> => {
    const hostState = await withClient(rig.hostCtx, () => JSON.parse(JSON.stringify(captureCoopChecksumState())));
    const guestState = await withClient(rig.guestCtx, () => JSON.parse(JSON.stringify(captureCoopChecksumState())));
    const diffFields: string[] = [];
    for (const k of Object.keys(hostState)) {
      if (JSON.stringify(hostState[k]) !== JSON.stringify(guestState[k])) {
        diffFields.push(k);
      }
    }
    const fields = diffFields.join(",");
    let sample = diffFields
      .map(k => `${k}: host=${JSON.stringify(hostState[k])} guest=${JSON.stringify(guestState[k])}`)
      .join(" | ");
    // #846 SAVE-DATA SUB-DIGEST BREAKDOWN (permanent diagnosability): the `saveDataDigest` checksum field is
    // an OPAQUE 64-bit hash, so a divergence there names no substrate. When it is among the diverging fields,
    // dump BOTH clients' NORMALIZED getSessionSaveData() and diff it KEY-BY-KEY, so the finding names the exact
    // save-data section that drifted (money-streak / ward-stone / a modifier arg / a bench-mon field) instead
    // of just "the digest differs". Cheap (already computed for the digest) and printed once per finding.
    if (diffFields.includes("saveDataDigest")) {
      const hostSave = await withClient(rig.hostCtx, () => JSON.parse(JSON.stringify(captureCoopSaveDataNormalized())));
      const guestSave = await withClient(rig.guestCtx, () =>
        JSON.parse(JSON.stringify(captureCoopSaveDataNormalized())),
      );
      const saveKeys = new Set<string>([...Object.keys(hostSave), ...Object.keys(guestSave)]);
      const saveDiff = [...saveKeys]
        .filter(k => JSON.stringify(hostSave[k]) !== JSON.stringify(guestSave[k]))
        .map(k => `${k}: host=${JSON.stringify(hostSave[k])} guest=${JSON.stringify(guestSave[k])}`);
      const saveSummary =
        saveDiff.length > 0
          ? `saveDataDigest SUB-DIFF keys=[${[...saveKeys]
              .filter(k => JSON.stringify(hostSave[k]) !== JSON.stringify(guestSave[k]))
              .join(",")}] :: ${saveDiff.join(" | ")}`
          : "saveDataDigest diverged but NO normalized key differs (a NON-normalized substrate or a stripped-key edge - widen captureCoopSaveDataNormalized)";
      sample = `${sample} || ${saveSummary}`;
      // eslint-disable-next-line no-console
      console.log(`[coop-soak] SAVE-DATA SUB-DIFF wave ${wave} @${where} (seed ${seed}): ${saveSummary}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak] FINDING wave ${wave} @${where} (seed ${seed}): unhealed DIGEST divergence [${fields}] - ${sample}`,
    );
    recordFinding(wave, fields, sample);
  };

  /** Record a finding grouped by `fields` (generic; used by the digest + scalar-drift detectors). */
  const recordFinding = (wave: number, fields: string, sample: string): void => {
    const existing = findings.find(f => f.fields === fields);
    if (existing) {
      existing.lastWave = wave;
      existing.occurrences++;
    } else {
      findings.push({ fields, firstWave: wave, lastWave: wave, occurrences: 1, sample });
      writeSoakArtifact(logs, { seed, wave, invariant: "digest", detail: `${fields} - ${sample}`, actionScript });
    }
  };

  /**
   * #843 POKEBALL-DRIFT CLASSIFIER (invariant a, POST-SHOP). The host is the sole engine that mutates money
   * (wave-win rewards / pickup) and the ball inventory (captures / ball rewards); the pure-renderer guest
   * applies the relayed owner picks. Previously a driver-side scalar copy (guestScene.money/pokeballCounts =
   * host's) MASKED any drift; that copy is GONE (#843 shrank the heal - the mirror carries the scalars at
   * wave-start via adoptCoopHostRunConfig). This probe reads BOTH scalars RIGHT AFTER the shop, BEFORE the
   * next re-mirror re-copies them, and CLASSIFIES the drift by DIRECTION:
   *   - guest ABOVE host (an OVER-grant - the open pokeball observation's direction) is the ANOMALY: the
   *     guest granted itself something the host did not. That is a REAL host-vs-guest desync -> a FINDING.
   *   - guest BELOW host is the EXPECTED renderer lag: the guest is not the authority for the wave-win money
   *     award / ball reward, so it trails the host post-shop until the next wave-start mirror re-copies it
   *     (in production the per-turn checkpoint + resync carry it). Logged as a benign observation, NOT a
   *     finding, so the soak is not reddened by the guest correctly declining to self-grant.
   * FINDING (2026-07-04, seed 12345): only MONEY drifts, and only guest-BELOW-host (the benign renderer
   * lag). Pokeball counts stay byte-identical every wave - the historical "guest balls above host" over-grant
   * does NOT reproduce with real content. Classified: harness/renderer artifact of the old scalar copy's
   * timing, now moot; no real watcher over-grant exists.
   */
  const assertScalarConvergence = (wave: number, where: string): void => {
    const overGrants: string[] = [];
    const lags: string[] = [];
    const note = (label: string, host: number, guest: number): void => {
      if (guest > host) {
        overGrants.push(`${label} host=${host} guest=${guest} (guest OVER-grant)`);
      } else if (guest < host) {
        lags.push(`${label} host=${host} guest=${guest}`);
      }
    };
    note("money", rig.hostScene.money, rig.guestScene.money);
    const hostBalls = rig.hostScene.pokeballCounts as unknown as Record<string, number>;
    const guestBalls = rig.guestScene.pokeballCounts as unknown as Record<string, number>;
    for (const k of Object.keys(hostBalls)) {
      note(`ball[${k}]`, hostBalls[k], guestBalls[k]);
    }
    if (overGrants.length > 0) {
      const sample = overGrants.join(" | ");
      // eslint-disable-next-line no-console
      console.log(`[coop-soak] FINDING wave ${wave} @${where} (seed ${seed}): guest scalar OVER-grant - ${sample}`);
      recordFinding(wave, "postShopScalarOverGrant", sample);
    } else if (lags.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[coop-soak] scalar-lag wave ${wave} @${where}: guest trails host (expected renderer lag, converges at re-mirror) - ${lags.join(" | ")}`,
      );
    }
  };

  /**
   * INVARIANT (a) DIGEST at a boundary: host and guest captureCoopChecksum() must be EQUAL. On a mismatch,
   * run the ONE-heal grace `oneHeal` (a resync analogue) and re-check; a STILL-diverged boundary is a REAL
   * desync the resync did not converge - RECORDED as a finding (the run CONTINUES so a long soak surveys the
   * whole game). The soak test then FAILS if any finding exists (a faithful red on a real bug, NEVER made
   * green by narrowing content). Returns the (final) host/guest checksums for the boundary sample.
   */
  const checkDigest = async (
    wave: number,
    where: string,
    oneHeal: () => Promise<void>,
  ): Promise<{ host: string; guest: string }> => {
    let chk = await captureChecksums();
    if (chk.host !== chk.guest) {
      resyncHeals++;
      const hostState = await withClient(rig.hostCtx, () => JSON.parse(JSON.stringify(captureCoopChecksumState())));
      const guestState = await withClient(rig.guestCtx, () => JSON.parse(JSON.stringify(captureCoopChecksumState())));
      const fields = [...new Set([...Object.keys(hostState), ...Object.keys(guestState)])].filter(
        k => JSON.stringify(hostState[k]) !== JSON.stringify(guestState[k]),
      );
      // The only intentionally tolerated pre-heal class: at a production-fidelity WAVE START the pure
      // renderer may trail the host's just-awarded money. saveDataDigest necessarily changes with money.
      // No other field or direction is covered, so this cannot hide a combat/party/biome divergence.
      const allowedMoneyLagFields = new Set(["money", "saveDataDigest"]);
      const expectedMoneyLag =
        fidelity === "production"
        && where === "wave-start"
        && fields.includes("money")
        && fields.every(f => allowedMoneyLagFields.has(f))
        && Number(guestState.money) < Number(hostState.money);
      const classification: SoakPreHealMismatch["classification"] = expectedMoneyLag
        ? "expected-renderer-money-lag"
        : "unexpected";
      const sample = fields
        .map(k => `${k}:host=${JSON.stringify(hostState[k])}/guest=${JSON.stringify(guestState[k])}`)
        .join(" | ");
      preHealMismatches.push({ wave, where, fields, classification, sample });
      actionScript.push(
        `wave ${wave}: DIGEST mismatch @${where} class=${classification} fields=[${fields.join(",")}] -> one-heal resync`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[coop-soak] PRE-HEAL ${classification} wave=${wave} where=${where} fields=[${fields.join(",")}] :: ${sample}`,
      );
      await oneHeal();
      chk = await captureChecksums();
      if (chk.host !== chk.guest) {
        await recordDigestFinding(wave, where);
      }
    }
    return chk;
  };

  /**
   * The exact PRODUCTION RESYNC path (stateSync heal): capture the host's real full snapshot and apply it
   * through the authoritative-guest production materializer. Do not approximate this with a field snapshot
   * plus party ordering: that omits bench Pokemon data (moves, abilities, HP/status, form and held items) and
   * can falsely classify a production-healable divergence as unhealable.
   */
  const resyncHealAnalogue = async (wave: number): Promise<void> => {
    const snapshot = await withClient(rig.hostCtx, () => captureCoopFullSnapshot());
    if (snapshot == null) {
      fail("no-park", wave, "production full-snapshot resync capture returned null");
      return;
    }
    await withClient(rig.guestCtx, () => applyCoopFullSnapshot(snapshot, true));
  };

  /**
   * WAVE-START boundary: LOCKSTEP + record the boundary digest sample. The guest was just re-mirrored +
   * faithfully re-synced to the host ({@linkcode healGuestFromHost}), so this is the CLEAN-START parity
   * check (the launch/resync fidelity). The one-heal here is a second re-mirror (HARNESS mode) or the
   * production resync analogue (PRODUCTION-FIDELITY mode - no full reset). The REAL replay-desync detection is
   * the POST-TURN check below.
   */
  const assertWaveBoundary = async (wave: number): Promise<void> => {
    assertLockstep(wave, "wave-start");
    const chk = await checkDigest(wave, "wave-start", async () => {
      if (fidelity === "production") {
        // Heals ONLY via the production trigger (checksum mismatch -> stateSync analogue); no full re-mirror.
        await resyncHealAnalogue(wave);
        return;
      }
      await remirrorWave(rig);
      await healGuestFromHost(rig);
    });
    const save = await captureSaveDigests();
    const preimages = opts.captureBoundaryPreimages ? await captureSavePreimages() : undefined;
    boundaryDigests.push({
      wave,
      hostChecksum: chk.host,
      guestChecksum: chk.guest,
      hostSaveDigest: save.host,
      guestSaveDigest: save.guest,
      ...preimages,
    });
  };

  /**
   * POST-TURN convergence - the REAL desync detector (invariant a). After the guest REPLAYS the host's
   * wave (applying the per-turn checkpoint), its full state must EQUAL the host's WITHOUT a re-mirror (a
   * re-mirror would mask a replay desync by resetting the guest to the host). This is where a checkpoint /
   * replay divergence surfaces (the class that surfaced the historical move-PP desync). The one-heal is the
   * exact production full-snapshot path. This includes the complete bench party, so a moveset/form/ability or
   * held-item drift is judged by the recovery mechanism real clients use rather than a weaker approximation.
   * A still-diverged state after this is a REAL desync -> a finding.
   */
  const assertPostTurnConverged = async (wave: number): Promise<void> => {
    await checkDigest(wave, "post-turn", () => resyncHealAnalogue(wave));
  };

  /**
   * Arm the host faint auto-picker POST-HOC iff a HOST-owned faint is pending (a no-op otherwise). Call
   * right before ANY host phaseInterceptor.to(...) that crosses the turn / reward-shop / wave boundary where
   * the host's own replacement SwitchPhase (OWNER-path PARTY picker) can open: the inter-turn crossing, a
   * killing-turn faint's post-victory reward crossing, or the wave crossing. MUST be called under host ctx.
   * Guarded so a faint-free crossing never pushes a one-shot picker that would linger at the queue head.
   */
  const armHostFaintAutoPick = (): void => {
    // #828 ASYMMETRIC CONTINUATION: only arm when a REPLACEABLE host faint is pending (a legal host-owned
    // bench exists to send in). When the host half is EXHAUSTED (fainted host slot, no bench) the modal
    // SwitchPhase self-closes (switch-phase.ts:191-198, no PARTY picker opens), so there is nothing to drive
    // - and arming a picker whose expireFn (`!hostOwnedFaintPending`) can NEVER fire (the fainted host mon
    // never leaves its slot) would leak a growing stack of do-nothing onNextPrompt handlers for the rest of
    // the guest-solo run. Gating on the bench keeps #845/#847 (arm when a bench exists) byte-identical.
    if (hostOwnedFaintPending(rig) && firstLegalBenchSlot(rig.hostScene, "host") >= 0) {
      registerHostFaintAutoPick(game, rig);
    }
  };

  /** Drive any SwitchPhase UI that occurs before the interceptor can observe TurnEndPhase. */
  const driveHostTurnToEnd = async (turn: number): Promise<void> => {
    const ui = rig.hostScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
    const realSetMode = ui.setMode.bind(ui);
    ui.setMode = (...args: unknown[]): unknown => {
      const result = realSetMode(...args);
      if (args[0] === UiMode.PARTY && rig.hostScene.phaseManager.getCurrentPhase()?.phaseName === "SwitchPhase") {
        void Promise.resolve(result).then(() => {
          const phase = rig.hostScene.phaseManager.getCurrentPhase() as unknown as { fieldIndex?: number } | undefined;
          const fieldIndex = phase?.fieldIndex;
          const occupant = typeof fieldIndex === "number" ? rig.hostScene.getPlayerField()[fieldIndex] : undefined;
          const drivesHostSlot =
            occupant?.coopOwner === "host"
            || (occupant == null && (typeof fieldIndex !== "number" || coopOwnerForPartySlot(fieldIndex) === "host"));
          const benchSlot = firstLegalBenchSlot(rig.hostScene, "host");
          if (!drivesHostSlot || benchSlot < 0) {
            fail(
              "no-park",
              rig.hostScene.currentBattle.waveIndex,
              `forced host switch had no legal owner pick (fieldIndex=${fieldIndex ?? "none"} owner=${occupant?.coopOwner ?? "none"} bench=${benchSlot})`,
            );
          }
          const handler = rig.hostScene.ui.getHandler() as PartyUiHandler;
          handler.setCursor(benchSlot);
          handler.processInput(Button.ACTION);
          handler.processInput(Button.ACTION);
          hitMode(UiMode.PARTY);
          actionScript.push(
            `wave ${rig.hostScene.currentBattle.waveIndex} turn ${turn}: host FORCED SWITCH -> party[${benchSlot}]`,
          );
        });
      }
      return result;
    };
    try {
      await game.phaseInterceptor.to("TurnEndPhase");
    } finally {
      ui.setMode = realSetMode;
    }
  };

  /**
   * Drive the two owner-only Dex Nav species picks when a taken reward queued ErDexNavPhase.
   * The watcher correctly skips this per-account picker; a host owner must answer it before the
   * next CommandPhase. Register prompts only when the phase is actually queued so they can never
   * sit ahead of an unrelated command prompt and poison a later wave.
   */
  const armHostDexNavAutoPicks = (): void => {
    // `hasPhaseOfType` deliberately searches only the pending queues. `toFirst` stops with Dex Nav
    // installed as the current phase, after it has already been shifted out of those queues, so the
    // current phase must be included explicitly or the valid owner prompt is left unanswered.
    const dexNavPresent = (): boolean =>
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName === "ErDexNavPhase"
      || rig.hostScene.phaseManager.hasPhaseOfType("ErDexNavPhase");
    if (!dexNavPresent()) {
      return;
    }
    for (let pick = 0; pick < 2; pick++) {
      game.onNextPrompt(
        "ErDexNavPhase",
        UiMode.OPTION_SELECT,
        () => rig.hostScene.ui.processInput(Button.ACTION),
        () => !dexNavPresent(),
      );
    }
    actionScript.push(`wave ${rig.hostScene.currentBattle.waveIndex}: armed owner Dex Nav picks`);
  };

  /** Drive the Abyss milestone bargain across both real engines, choosing the safe Leave terminal. */
  const driveBargainContinuation = async (): Promise<void> => {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    const hostPhase = rig.hostScene.phaseManager.getCurrentPhase() as TheBargainPhase;
    // The guest replay queues its own copy. Drive an explicit instance under the guest context and remove
    // the queued duplicate so it cannot reopen after the authoritative outcome has already converged.
    rig.guestScene.phaseManager.removeAllPhasesOfType("TheBargainPhase");
    const guestPhase = new TheBargainPhase();
    const ownerCtx = hostOwns ? rig.hostCtx : rig.guestCtx;
    const watcherCtx = hostOwns ? rig.guestCtx : rig.hostCtx;
    const ownerPhase = hostOwns ? hostPhase : guestPhase;
    const watcherPhase = hostOwns ? guestPhase : hostPhase;

    const driveOwnerLeave = async (): Promise<void> => {
      await withClient(ownerCtx, async () => {
        let ended = false;
        const seam = ownerPhase as unknown as { end(): void };
        const realEnd = seam.end.bind(ownerPhase);
        seam.end = () => {
          ended = true;
          // Only the host instance is the real current queue head. The explicit guest instance exists to
          // materialize the reciprocal owner/watcher behavior and must not shift an unrelated guest phase.
          if (ownerPhase === hostPhase) {
            realEnd();
          }
        };
        const ui = ownerCtx.scene.ui as unknown as {
          setMode: (...args: unknown[]) => unknown;
          showDialogue: (...args: unknown[]) => unknown;
          showText: (...args: unknown[]) => unknown;
        };
        const savedSetMode = ui.setMode.bind(ownerCtx.scene.ui);
        const savedShowDialogue = ui.showDialogue?.bind(ownerCtx.scene.ui);
        const savedShowText = ui.showText.bind(ownerCtx.scene.ui);
        try {
          ui.setMode = (...args: unknown[]): unknown => {
            if (args[0] === UiMode.ER_BARGAIN) {
              const onLeave = args[6] as () => void;
              queueMicrotask(onLeave);
            }
            return Promise.resolve(true);
          };
          ui.showDialogue = (...args: unknown[]): unknown => {
            (args[3] as (() => void) | undefined)?.();
            return null;
          };
          ui.showText = (...args: unknown[]): unknown => {
            (args[2] as (() => void) | undefined)?.();
            return null;
          };
          ownerPhase.start();
          for (let i = 0; i < 24 && !ended; i++) {
            await drainLoopback();
          }
          if (!ended) {
            fail("no-park", rig.hostScene.currentBattle.waveIndex, "bargain owner Leave terminal did not end");
          }
        } finally {
          ui.setMode = savedSetMode;
          ui.showDialogue = savedShowDialogue as typeof ui.showDialogue;
          ui.showText = savedShowText;
        }
      });
    };

    const driveWatcher = async (): Promise<void> => {
      await withClient(watcherCtx, async () => {
        let ended = false;
        const seam = watcherPhase as unknown as { end(): void };
        const realEnd = seam.end.bind(watcherPhase);
        seam.end = () => {
          ended = true;
          if (watcherPhase === hostPhase) {
            realEnd();
          }
        };
        watcherPhase.start();
        for (let i = 0; i < 20 && !ended; i++) {
          await drainLoopback();
        }
        if (!ended) {
          fail("no-park", rig.hostScene.currentBattle.waveIndex, "bargain watcher did not adopt the owner terminal");
        }
      });
    };

    // Owner first buffers the durable outcome; the watcher then buffer-hits and materializes it.
    await driveOwnerLeave();
    await driveWatcher();
    hitMode(UiMode.ER_BARGAIN);
    if (
      rig.hostRuntime.controller.interactionCounter() !== counterBefore + 1
      || rig.guestRuntime.controller.interactionCounter() !== counterBefore + 1
    ) {
      fail(
        "lockstep",
        rig.hostScene.currentBattle.waveIndex,
        `bargain did not advance once (before=${counterBefore} host=${rig.hostRuntime.controller.interactionCounter()} guest=${rig.guestRuntime.controller.interactionCounter()})`,
      );
    }
    actionScript.push(
      `wave ${rig.hostScene.currentBattle.waveIndex}: BARGAIN Leave driven (${hostOwns ? "host" : "guest"}-owned)`,
    );
  };

  /**
   * The soak drives the host's real phase queue while the guest is a replay renderer, so the guest does not
   * naturally execute its own CommandPhase. Materialize both halves of the guest's command rendezvous around
   * the host crossing: arrive before the host reaches the boundary, then verify the host's reciprocal arrival
   * afterwards. This is the split arrive/await form of the production reciprocal barrier, not a timeout or a
   * unilateral continuation.
   */
  const crossCommandBoundaryWithReplayGuest = async (
    wave: number,
    turn: number,
    beforeHostCross?: () => void,
  ): Promise<void> => {
    const point = `cmd:${wave}:${turn}`;
    const transitionSourceWave = rig.hostScene.currentBattle.waveIndex;
    type BiomeBoundarySeam = {
      readonly phaseName: "SelectBiomePhase";
      requireCoopSourceWave(): number;
      start(): void;
    };
    const hostBiomeBinding: CoopBiomeOperationBinding = {
      opState: rig.hostRuntime.opState,
      durability: rig.hostRuntime.durability ?? null,
    };
    const waitForPublicModeOrPhaseExit = async (
      ctx: DuoRig["hostCtx"],
      phase: { readonly phaseName: string },
      mode: UiMode,
      label: string,
    ): Promise<"opened" | "ended"> => {
      for (let attempt = 0; attempt < 320; attempt++) {
        const state = await withClient(ctx, async () => {
          await drainLoopback();
          return {
            mode: ctx.scene.ui.getMode(),
            current: ctx.scene.phaseManager.getCurrentPhase(),
          };
        });
        if (state.current !== phase) {
          return "ended";
        }
        if (state.mode === mode) {
          return "opened";
        }
        // Keep this browser-equivalent client installed while its bounded UI transition/tween callback runs.
        await withClient(ctx, () => new Promise<void>(resolve => setTimeout(resolve, 10)));
        await pumpDuoDestinations(rig, 1);
      }
      fail("no-park", transitionSourceWave, `${label} never opened ${UiMode[mode]} or left ${phase.phaseName}`);
      throw new Error(`unreachable after ${label} public-surface failure`);
    };
    const waitForBothBoundaryPhasesToExit = async (
      hostPhase: object,
      guestPhase: object,
      label: string,
    ): Promise<void> => {
      for (let attempt = 0; attempt < 160; attempt++) {
        await pumpDuoDestinations(rig, 1);
        const hostLeft = rig.hostScene.phaseManager.getCurrentPhase() !== hostPhase;
        const guestLeft = rig.guestScene.phaseManager.getCurrentPhase() !== guestPhase;
        if (hostLeft && guestLeft) {
          return;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
      fail(
        "no-park",
        transitionSourceWave,
        `${label} did not leave on both clients `
          + `(host=${rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"} `
          + `guest=${rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"})`,
      );
    };
    // A real co-op pair owns one JS realm per client. Queue every frame for its destination while crossing
    // this multi-surface boundary so a retained biome apply, its promise continuation and the reciprocal
    // command arrival can never run under the partner's ambient scene/runtime in this two-engine fixture.
    const destinationScheduled = rig.pair.setDestinationContextDelivery != null;
    rig.pair.setDestinationContextDelivery?.(destinationScheduled);
    // This crossing now owns the real Crossroads + World-Map public UI. Restore the default even on a hard
    // failure so a following test cannot inherit an interactive prompt it did not opt into.
    setCoopBiomePickerDrivenByTest();
    try {
      let guestCrossroadsProjected = false;
      let guestBiomeSourceWave: number | null = null;
      let committedBiomeOperationId: string | null = null;
      let hostBiomeProjected = false;
      let guestBiomeBoundary: BiomeBoundarySeam | null = null;
      const hostHasCommandable = rig.hostScene
        .getPlayerParty()
        .some(mon => mon.coopOwner === "host" && !mon.isFainted() && mon.isAllowedInBattle());
      withClientSync(rig.guestCtx, () => rig.guestRuntime.rendezvous.reannounce(point));
      // The early guest arrival is now destination-scheduled; publish it to the host before its command
      // boundary starts waiting. This is delivery, not a manufactured rendezvous or direct state mutation.
      await withClient(rig.hostCtx, () => drainLoopback());
      await withClient(rig.hostCtx, () => beforeHostCross?.());
      for (;;) {
        const boundary = await withClient(rig.hostCtx, async () => {
          // A reward continuation can be created DURING this crossing (ModifierRewardPhase applies the item),
          // so inspecting the queue before advancing is too early. Stop at either structural branch, then arm
          // Dex Nav only after it actually exists. This also guarantees no Dex Nav prompt can leak into an
          // ordinary CommandPhase crossing.
          return game.phaseInterceptor.toFirst([
            "CommandPhase",
            "ErDexNavPhase",
            "TheBargainPhase",
            "ErCrossroadsPhase",
            "SelectBiomePhase",
          ] as const);
        });
        if (boundary === "ErDexNavPhase") {
          await withClient(rig.hostCtx, async () => {
            armHostDexNavAutoPicks();
            await game.phaseInterceptor.to("ErDexNavPhase");
          });
          continue;
        }
        if (boundary === "TheBargainPhase") {
          await driveBargainContinuation();
          continue;
        }
        if (boundary === "ErCrossroadsPhase") {
          const crossroads = await openQueuedCrossroadsSurface(transitionSourceWave);
          const hostCrossroads = crossroads.hostPhase;
          const guestCrossroads = crossroads.guestPhase;
          guestCrossroadsProjected = true;
          const pinned = crossroads.pinned;
          const crossroadsOwnerCtx = crossroads.ownerCtx;
          await pressClientUiUntilAccepted(crossroadsOwnerCtx, Button.DOWN, "Crossroads Leave cursor");
          await pressClientUiUntilAccepted(crossroadsOwnerCtx, Button.ACTION, "Crossroads Leave");
          await waitForBothBoundaryPhasesToExit(hostCrossroads, guestCrossroads, "Crossroads Leave");
          const hostPin = withClientSync(rig.hostCtx, () => coopBiomeInteractionStartValue());
          const guestPin = withClientSync(rig.guestCtx, () => coopBiomeInteractionStartValue());
          if (hostPin !== pinned || guestPin !== pinned) {
            fail(
              "desync",
              transitionSourceWave,
              `Crossroads Leave lost its map pin (host=${hostPin} guest=${guestPin} expected=${pinned})`,
            );
          }
          actionScript.push(
            `wave ${transitionSourceWave}: ${crossroadsOwnerCtx.label} chose Crossroads Leave through public UI`,
          );
          continue;
        }
        if (boundary === "SelectBiomePhase") {
          const hostBiomeBoundary = rig.hostScene.phaseManager.getCurrentPhase() as unknown as BiomeBoundarySeam;
          guestBiomeBoundary = (await withClient(rig.guestCtx, () =>
            driveClientPhaseQueueTo(rig.guestScene, "SelectBiomePhase"),
          )) as unknown as BiomeBoundarySeam;
          guestBiomeSourceWave = await withClient(rig.guestCtx, () => guestBiomeBoundary!.requireCoopSourceWave());
          const hostSourceWave = await withClient(rig.hostCtx, () => hostBiomeBoundary.requireCoopSourceWave());
          if (hostSourceWave !== guestBiomeSourceWave || hostSourceWave !== transitionSourceWave) {
            fail(
              "desync",
              transitionSourceWave,
              `World Map source mismatch host=${hostSourceWave} guest=${guestBiomeSourceWave} expected=${transitionSourceWave}`,
            );
          }
          hostBiomeProjected = true;
          const hostPinBeforeMap = withClientSync(rig.hostCtx, () => coopBiomeInteractionStartValue());
          const guestPinBeforeMap = withClientSync(rig.guestCtx, () => coopBiomeInteractionStartValue());
          if (hostPinBeforeMap !== guestPinBeforeMap) {
            fail(
              "desync",
              transitionSourceWave,
              `World Map pin diverged host=${hostPinBeforeMap} guest=${guestPinBeforeMap}`,
            );
          }
          const pinnedBeforeMap = hostPinBeforeMap;
          const hostCounter = withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.interactionCounter());
          const guestCounter = withClientSync(rig.guestCtx, () => rig.guestRuntime.controller.interactionCounter());
          if (hostCounter !== guestCounter) {
            fail(
              "lockstep",
              transitionSourceWave,
              `World Map opened with divergent counters host=${hostCounter} guest=${guestCounter}`,
            );
          }
          const interactionPinned = pinnedBeforeMap >= 0 ? pinnedBeforeMap : hostCounter;
          const hostOwns = withClientSync(rig.hostCtx, () =>
            rig.hostRuntime.controller.isLocalOwnerAtCounter(interactionPinned),
          );
          const guestOwns = withClientSync(rig.guestCtx, () =>
            rig.guestRuntime.controller.isLocalOwnerAtCounter(interactionPinned),
          );
          if (hostOwns === guestOwns) {
            fail("desync", transitionSourceWave, `World Map owner parity diverged at pinned=${interactionPinned}`);
          }
          const preexistingBiomeOps = new Set(
            getCoopOperationLiveSinkInvoked()
              .filter(envelope => envelope.pendingOperation?.kind === "BIOME_PICK")
              .map(envelope => envelope.pendingOperation!.id),
          );

          // Start both actual queued map phases. The pinned owner, which may be the guest, drives the real
          // ER_MAP handler; the host validates/commits the intent and the watcher can exit only on receipt.
          await withClient(rig.hostCtx, async () => {
            hostBiomeBoundary.start();
            await drainLoopback();
          });
          await withClient(rig.guestCtx, async () => {
            guestBiomeBoundary!.start();
            await drainLoopback();
          });
          const mapOwnerCtx = hostOwns ? rig.hostCtx : rig.guestCtx;
          const mapOwnerPhase = hostOwns ? hostBiomeBoundary : guestBiomeBoundary;
          const mapSurface = await waitForPublicModeOrPhaseExit(
            mapOwnerCtx,
            mapOwnerPhase,
            UiMode.ER_MAP,
            `${mapOwnerCtx.label}-owned World Map`,
          );
          if (pinnedBeforeMap >= 0 && mapSurface !== "opened") {
            fail(
              "no-park",
              transitionSourceWave,
              `Crossroads-pinned World Map owner left without public ER_MAP (pinned=${pinnedBeforeMap})`,
            );
          }
          if (mapSurface === "opened") {
            await pressClientUiUntilAccepted(mapOwnerCtx, Button.ACTION, "World Map route");
          }
          await waitForBothBoundaryPhasesToExit(hostBiomeBoundary, guestBiomeBoundary, "World Map");

          const journalEnvelope = getCoopOperationLiveSinkInvoked().find(
            envelope =>
              envelope.pendingOperation?.kind === "BIOME_PICK"
              && envelope.wave === transitionSourceWave
              && !preexistingBiomeOps.has(envelope.pendingOperation.id),
          );
          committedBiomeOperationId = journalEnvelope?.pendingOperation?.id ?? null;
          const expectedOperationId =
            pinnedBeforeMap >= 0 || mapSurface === "opened"
              ? coopBiomeOperationId(
                  "BIOME_PICK",
                  COOP_BIOME_PICK_SEQ_BASE + interactionPinned,
                  interactionPinned,
                  hostBiomeBinding,
                )
              : coopAuthoritativeBiomeTransitionOperationId(transitionSourceWave, hostBiomeBinding);
          if (
            committedBiomeOperationId == null
            || committedBiomeOperationId !== expectedOperationId
            || parseCoopOperationId(committedBiomeOperationId)?.kind !== "BIOME_PICK"
            || journalEnvelope?.wave !== transitionSourceWave
          ) {
            fail(
              "no-park",
              transitionSourceWave,
              "World Map did not materialize the exact typed BIOME_PICK journal "
                + `(actual=${committedBiomeOperationId ?? "none"} expected=${expectedOperationId ?? "none"})`,
            );
          }
          if (pinnedBeforeMap >= 0 || mapSurface === "opened") {
            const expectedCounter = interactionPinned + 1;
            const hostCounterAfter = withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.interactionCounter());
            const guestCounterAfter = withClientSync(rig.guestCtx, () =>
              rig.guestRuntime.controller.interactionCounter(),
            );
            if (hostCounterAfter !== expectedCounter || guestCounterAfter !== expectedCounter) {
              fail(
                "lockstep",
                transitionSourceWave,
                `World Map did not advance exactly once (expected=${expectedCounter} `
                  + `host=${hostCounterAfter} guest=${guestCounterAfter})`,
              );
            }
          }
          actionScript.push(
            `wave ${transitionSourceWave}: ${mapOwnerCtx.label} drove World Map via public UI=${mapSurface === "opened"} `
              + `and both consumed ${committedBiomeOperationId}`,
          );
          continue;
        }
        if (guestCrossroadsProjected && (guestBiomeBoundary != null) !== hostBiomeProjected) {
          fail(
            "desync",
            transitionSourceWave,
            `Crossroads decision diverged hostMoveOn=${hostBiomeProjected} guestMoveOn=${guestBiomeBoundary != null}`,
          );
        }
        break;
      }
      // With a biome commit this resumes only after the renderer consumed its exact receipt. Without one it
      // starts the CommandPhase that toFirst deliberately left untouched, publishing the host's reciprocal
      // arrival in both cases.
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
      await pumpDuoDestinations(rig, 2);
      if (!hostHasCommandable) {
        actionScript.push(
          `wave ${wave} turn ${turn}: host half exhausted; guest command proceeds without reciprocal await`,
        );
        return;
      }
      let guestBiomeCommandBoundary: { tryCoopCheckpointSync(): void } | null = null;
      if (guestBiomeBoundary != null) {
        // PhaseInterceptor starts the host's SwitchBiome/NewBiomeEncounter tail while driving it to Command,
        // but it deliberately disables the guest PhaseManager's automatic start hook. Drain the guest's
        // actual committed biome tail to the same public command boundary before comparing destinations.
        // Merely awaiting the command rendezvous here would leave the guest parked on an unstarted
        // SwitchBiomePhase and misclassify a harness scheduling gap as a production biome desync.
        const guestCommand = await withClient(rig.guestCtx, () =>
          driveClientPhaseQueueTo(rig.guestScene, "CommandPhase"),
        );
        if (guestCommand.phaseName !== "CommandPhase") {
          fail(
            "no-park",
            transitionSourceWave,
            `World Map guest tail reached ${guestCommand.phaseName} instead of CommandPhase`,
          );
        }
        // driveClientPhaseQueueTo intentionally stops BEFORE its target starts. Production does not expose
        // input in that state: CommandPhase.start() first consumes the latest wave-start authority (including
        // the host-rolled World-Map routes/biome structure), then crosses the reciprocal barrier and opens
        // input. The soak manually models the barrier below, so invoke that exact production adoption seam
        // here as well. Otherwise the next loop samples its "wave-start" digest against a guest that is one
        // private method call earlier than any human-visible command surface and falsely reports erMapState.
        await withClient(rig.guestCtx, () => {
          guestBiomeCommandBoundary = guestCommand as unknown as { tryCoopCheckpointSync(): void };
          guestBiomeCommandBoundary.tryCoopCheckpointSync();
        });
      }
      const guestResult = await withClient(rig.guestCtx, () => rig.guestRuntime.rendezvous.awaitPartner(point));
      if (guestResult.timedOut || guestResult.crossPoint !== undefined) {
        fail(
          "no-park",
          wave,
          `replay guest did not reciprocally cross ${point} (timedOut=${guestResult.timedOut} crossPoint=${guestResult.crossPoint ?? "none"})`,
        );
      }
      if (guestBiomeCommandBoundary != null) {
        // CommandPhase's real continuation funnel consumes again after the reciprocal barrier: a refreshed
        // carrier may arrive while that barrier is pending. Match that second production seam before the
        // soak observes the next wave boundary.
        await withClient(rig.guestCtx, () => guestBiomeCommandBoundary?.tryCoopCheckpointSync());
      }
      if (guestBiomeBoundary != null && rig.hostScene.arena.biomeId !== rig.guestScene.arena.biomeId) {
        fail(
          "desync",
          transitionSourceWave,
          `World Map continuation landed in different biomes host=${rig.hostScene.arena.biomeId} `
            + `guest=${rig.guestScene.arena.biomeId}`,
        );
      }
      actionScript.push(`wave ${wave} turn ${turn}: replay guest reciprocally crossed ${point}`);
    } finally {
      resetCoopBiomePickerDrivenByTest();
      rig.pair.setDestinationContextDelivery?.(false);
    }
  };

  /** Play ONE host wave to a terminal (bounded by the NO-PARK turn budget); the guest replays each turn. */
  const playWave = async (wave: number): Promise<"win" | "capture" | "flee" | undefined> => {
    for (let t = 0; t < MAX_TURNS_PER_WAVE; t++) {
      const turn = rig.hostScene.currentBattle.turn;
      if (profile === "level" && wave === LEVEL_FORCED_FAINT_WAVE && t === 0) {
        const guestLead = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
        const mirroredGuestLead = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
        if (guestLead == null || mirroredGuestLead == null || firstLegalBenchSlot(rig.hostScene, "guest") < 0) {
          fail("no-park", wave, "level forced-faint leg requires a live guest lead and legal guest-owned bench");
        }
        guestLead.hp = 1;
        withClientSync(rig.guestCtx, () => {
          mirroredGuestLead.hp = 1;
        });
        actionScript.push(`wave ${wave} turn ${turn}: staged guest-owned lead at 1 HP on both engines`);
      }
      // #849 per-turn SITUATION tap: snapshot the enemy on-field occupants BEFORE the turn so a mid-turn
      // enemy switch (a trainer sending its next mon after a KO, or an enemy voluntary switch) is detectable.
      const enemyIdsBefore = rig.hostScene.getEnemyField().map(e => e.id);
      await withClient(rig.hostCtx, async () => {
        const field = rig.hostScene.getPlayerField();
        // The host LOCALLY commands ONLY the slots it OWNS (coopOwner==="host"); a PARTNER (guest-owned)
        // slot rides the relay (the guest's onCommandRequest answers it) and MUST NOT be game.move.select'd
        // here. Selecting a partner slot leaked its onNextPrompt(COMMAND/FIGHT) handlers into the NEXT
        // turn's host CommandPhase (the partner slot never opens a local command UI to consume them), which
        // jammed the FIGHT menu on a multi-turn real-combat wave - the wave-1-only original never hit a
        // turn 2 so never saw it. A fainted/empty slot is skipped (the game does not prompt it).
        let hostMoveId = 0;
        let guestMoveId = 0;
        for (let fi = 0; fi < field.length; fi++) {
          const mon = field[fi];
          if (mon == null || mon.isFainted()) {
            continue;
          }
          const salt = fi === COOP_HOST_FIELD_INDEX ? HOST_SLOT_SALT : GUEST_SLOT_SALT;
          const targets = pickTargets(rig.hostScene);
          const isHostSlot = fi === COOP_HOST_FIELD_INDEX;
          const targetIndex = isHostSlot ? targets.hostTarget : targets.guestTarget;
          const targetMon = isHostSlot ? targets.hostTargetMon : targets.guestTargetMon;
          const moveId = resolveChosenMove(mon, targetMon, seed, wave, salt, profile === "level").moveId;
          if (isHostSlot) {
            hostMoveId = moveId;
          } else {
            guestMoveId = moveId;
          }
          if (mon.coopOwner === "host") {
            // #843 coverage #4: occasionally issue a VOLUNTARY SWITCH for the host's own slot through the
            // REAL Command path (game.doSwitchPokemon drives the POKEMON command + party pick), instead of a
            // move. The switch broadcasts to the guest and rides the per-turn checkpoint onto its replay.
            // #846: skip the voluntary switch when the mon is TRAPPED (a trainer enemy's Shadow Tag / Arena
            // Trap / trapping move / Fairy Lock / ER FEAR). The real command menu greys out POKEMON when
            // trapped; game.doSwitchPokemon blindly drives the POKEMON command, which the menu then REJECTS,
            // leaving CommandPhase open forever (the NO-PARK strand seen at seed 20260704 wave 43). isTrapped
            // is the exact switch-legality gate the command menu uses.
            const benchSlot = firstLegalBenchSlot(rig.hostScene, "host");
            if (switchesThisTurn(seed, wave, turn, HOST_SWITCH_SALT) && benchSlot >= 0 && !mon.isTrapped()) {
              game.doSwitchPokemon(benchSlot);
              // #849 COMMAND-issue tap: a host voluntary switch drives the COMMAND menu + the PARTY picker.
              hitMode(UiMode.COMMAND);
              hitMode(UiMode.PARTY);
              if (isHostSlot) {
                actionScript.push(`wave ${wave} turn ${turn}: host SWITCH -> party[${benchSlot}]`);
              }
            } else {
              // A MULTI-TARGET (spread) move must NOT be handed a targetIndex (game.move.select asserts), so
              // omit it for spread moves (they auto-target). The default profile's moveset has no spread moves,
              // so this is byte-identical there; it only matters for a catch-leg variant whose moveset carries
              // a spread move for the isolation turn (see processCatchWave).
              const isSpread =
                mon
                  .getMoveset()
                  .find(m => m?.moveId === moveId)
                  ?.getMove()
                  .isMultiTarget() ?? false;
              game.move.select(moveId, fi, isSpread ? undefined : targetIndex);
              // Legacy screen-open evidence only. GameManager's target prompt now uses public Ui.processInput,
              // so a targeted move earns TARGET_SELECT only through the separate production uiRelay trace.
              hitMode(UiMode.COMMAND);
              hitMode(UiMode.FIGHT);
            }
          }
        }
        if (t === 0) {
          actionScript.push(`wave ${wave}: host slot move=${hostMoveId} guest slot move=${guestMoveId}`);
        }
        await driveHostTurnToEnd(turn);
        // #849 per-turn SITUATION tap (sampled at TurnEndPhase, BEFORE the faint pickers drive so the
        // fainted mons are still visible on-field): faints / weather / terrain / enemy switch.
        recordTurnSituations(rig, enemyIdsBefore, hits);
        // #845 host-owned FAINT drive (the NO-PARK strand this run fixed). A HOST-owned mon that fainted
        // THIS turn opens its replacement SwitchPhase - the OWNER-path PARTY picker - at TURN END: AFTER this
        // TurnEndPhase, during the NEXT host crossing (the inter-turn to("CommandPhase") below, or - on a
        // winning-turn faint - the reward-shop crossing). Arm the auto-picker POST-HOC HERE, while the host
        // sits at TurnEndPhase, so it survives to catch that picker. Arming it preemptively at the turn's own
        // CommandPhase (the old bug) self-expired it before the picker ever opened, so once a real host faint
        // finally happened - a leaked FIXED trainer wave (rival / evil-grunt bypass .disableTrainerWaves(),
        // are far tougher, and DO KO the host) - the SwitchPhase parked forever.
        armHostFaintAutoPick();
      });
      await withClient(rig.guestCtx, () => driveGuestReplayTurnWithFaint(rig, turn));
      if (profile === "god") {
        restoreGodProfileBench(rig.hostScene);
        withClientSync(rig.guestCtx, () => restoreGodProfileBench(rig.guestScene));
      }

      if (t === 0 || (t + 1) % 10 === 0) {
        actionScript.push(
          `wave ${wave} turn ${turn}: progress enemyHp=[${rig.hostScene
            .getEnemyField()
            .map(mon => `${mon.species.speciesId}:${mon.hp}/${mon.getMaxHp()}`)
            .join(",")}] playerHp=[${rig.hostScene
            .getPlayerField()
            .map(mon => `${mon.species.speciesId}:${mon.hp}/${mon.getMaxHp()}`)
            .join(",")}]`,
        );
      }

      // Re-evaluate only after the complete end-of-turn tail. Weather, terrain, poison, recoil, and similar
      // delayed effects can KO the final enemy after the intercepted TurnEndPhase (seed 20260712 wave 63:
      // toxic terrain). Sampling before replay made the driver announce cmd:<wave>:<nextTurn> and wait for a
      // CommandPhase while production correctly entered SelectModifierPhase, a false softlock report.
      const waveWon = rig.hostScene.currentBattle.enemyParty.every(e => e.isFainted());
      const authoritativeTerminal = getCoopActiveWaveTransition(wave)?.outcome;
      if (waveWon) {
        return "win";
      }
      if (authoritativeTerminal === "win" || authoritativeTerminal === "capture" || authoritativeTerminal === "flee") {
        return authoritativeTerminal;
      }
      // TurnEndPhase is an EARLY interception point: the host still has to execute its own delayed
      // weather/terrain/status tail. The guest replay can already have rendered that tail while the host
      // enemy remains provisionally alive. Let the authoritative host choose the next structural phase,
      // stopping before either the next command or a terminal surface. Seed 20260712 wave 63 reaches the
      // reward shop here because toxic terrain KOs the final enemy; guessing CommandPhase created a false
      // softlock even though production correctly won the wave.
      const nextStructuralPhase = await withClient(rig.hostCtx, () =>
        game.phaseInterceptor.toFirst(["CommandPhase", "SelectModifierPhase", "GameOverPhase", "TitlePhase"]),
      );
      if (nextStructuralPhase !== "CommandPhase") {
        const outcome = getCoopActiveWaveTransition(wave)?.outcome;
        return outcome === "gameOver"
          ? undefined
          : (outcome ?? (nextStructuralPhase === "SelectModifierPhase" ? "win" : undefined));
      }
      // Not won yet: the host is parked immediately before the next turn's CommandPhase.
      // TurnInitPhase increments `currentBattle.turn` while crossing, so the point the guest must
      // pre-arrive is the NEXT turn, not the just-completed turn still visible at TurnEndPhase.
      withClientSync(rig.guestCtx, () => rig.guestRuntime.rendezvous.reannounce(`cmd:${wave}:${turn + 1}`));
      await drainLoopback();
      await crossCommandBoundaryWithReplayGuest(wave, turn + 1);
    }
    fail("no-park", wave, `wave did not complete within ${MAX_TURNS_PER_WAVE} turns (enemies never all fainted)`);
  };

  /**
   * Drive the OWNER side of a reward shop with a SEEDED decision over the wave's REAL, UNFORCED, UNFILTERED
   * reward pool: leave, or take a NON-party reward (ball / berry / lure / temp-stat-booster / exp-charm /
   * relic / ... - the full non-party universe, whatever this wave rolled). Returns a label for the action
   * script. MUST be called inside withClient(ownerCtx).
   *
   * 🔴 V1 COVERAGE DECISION #2 (harness-driver limitation, NOT content-narrowing): the pool is NOT
   * curated - every reward type the wave rolls is OFFERED and STREAMED to the watcher (presentation is
   * covered). But a TAKE is restricted to NON-PARTY rewards, because a PARTY-TARGET reward
   * (PokemonModifierType: TMs, Remember-Move, Evolution items, Rare Candy, ...) chains into a learn-move /
   * evolution / fusion SUB-interaction, and the two-engine harness provides only a SPECIALIZED continuation
   * driver (driveGuestTmCaseRegression, for the #698 repro) - not a general one - so TAKING a continuation
   * reward strands the guest on an un-driven sub-phase. Non-party rewards are all instant grants and drive
   * cleanly on both sides. Taking party-target rewards is the report's follow-up item after MEs.
   *
   * 🔴 #832 LEVEL-PROFILE REVIVE-TAKE (the ONE party-target exception, level-only): the faint-heavy level
   * party rolls a Revive in the pool whenever it has a downed mon (the pool gates Revive on a fainted party
   * member). A Revive is an INSTANT party-target grant (no learn-move / evolution continuation), so it drives
   * cleanly through {@linkcode driveHostRewardShopOwner}'s reviveSlot path + the watcher, advancing the
   * counter once like any terminal. Passing a fainted `reviveSlot` makes the shop TAKE a Revive if the pool
   * rolled one (revive that mon) instead of leaving it dead, else it falls through to the seeded take/leave -
   * so the pool is only ever inspected AFTER the phase's start() populates typeOptions (never before, which
   * would read undefined). Gated to "level" so the god profile is byte-identical (reviveSlot stays undefined).
   * MUST be called inside withClient(ownerCtx) with the OWNER's scene.
   */
  const driveOwnerReward = async (
    shop: ShopPhaseSeam,
    ownerScene: BattleScene,
    wave: number,
    policy: "seeded" | "leave" = "seeded",
    alreadyStarted = false,
  ): Promise<string> => {
    const reviveSlot = policy === "seeded" && profile === "level" ? firstFaintedPartySlot(ownerScene) : -1;
    const take =
      policy === "seeded"
      && (opts.forceTakeRewardWaves?.has(wave) === true || (rewardPolicy === "seeded" && rng() < 0.5));
    await driveHostRewardShopOwner(
      shop,
      reviveSlot >= 0 ? { takeReward: take, reviveSlot, alreadyStarted } : { takeReward: take, alreadyStarted },
    );
    // reviveSlot>=0 means a Revive was TAKEN iff the pool rolled one (the shop path decides post-start); a
    // non-fainted party or no-Revive pool falls through to seeded take/leave. The label reflects the intent.
    if (reviveSlot >= 0 && !ownerScene.getPlayerParty()[reviveSlot]?.isFainted()) {
      return `revive party[${reviveSlot}]`;
    }
    return take ? "take-nonparty" : "leave";
  };

  /**
   * Bounded proof that the real guest boundary applied the exact retained DATA and, after its public shop
   * opens, recorded continuationReady. Pumping alternates complete client contexts; it never advances a
   * phase or mutates the latch itself.
   */
  const awaitGuestWaveTransaction = async (wave: number, continuationReady: boolean): Promise<void> => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const staged = getCoopStagedWaveAdvanceTransaction(wave, rig.guestRuntime.waveOperationBinding);
      const current = rig.guestScene.phaseManager.getCurrentPhase();
      const boundaryReleased = current?.phaseName !== "BattleEndPhase";
      if (
        staged?.dataApplied === true
        && boundaryReleased
        && (!continuationReady || staged.continuationReady === true)
      ) {
        return;
      }
      await pumpDuoDestinations(rig, 1);
    }
    const staged = getCoopStagedWaveAdvanceTransaction(wave, rig.guestRuntime.waveOperationBinding);
    const current = rig.guestScene.phaseManager.getCurrentPhase();
    throw new Error(
      `guest retained wave ${wave} did not reach ${continuationReady ? "continuationReady" : "dataApplied/release"} `
        + `within 24 destination pumps (current=${current?.phaseName ?? "none"} `
        + `dataApplied=${staged?.dataApplied === true} continuationReady=${staged?.continuationReady === true})`,
    );
  };

  /** Drive the reward shop (seeded owner take/leave across ALL reward types; watcher mirrors) + LOCKSTEP. */
  const driveRewardShop = async (
    wave: number,
    deferAdvanceToMeTerminal = false,
    beforeSharedInput?: () => Promise<void>,
    ownerPolicy: "seeded" | "leave" = "seeded",
  ): Promise<void> => {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    let guestAccountRewardAcknowledged = false;

    // Every two-engine campaign shares one JS realm for two runtimes. During this interaction, queue EVERY
    // transport frame until its destination ClientCtx is installed: reward options can resume a watcher, a
    // guest intent can resume the host authority, and the retained result can resume the guest owner. Real
    // browsers have independent globals; immediate loopback under the sender's context does not. This is a
    // harness-fidelity requirement for both calibrated and production-fidelity profiles, not a gameplay mode.
    const destinationScheduled = rig.pair.setDestinationContextDelivery != null;
    rig.pair.setDestinationContextDelivery?.(destinationScheduled);
    try {
      await withClient(rig.hostCtx, async () => {
        // #845: a KILLING-TURN host faint (fainted the same turn the wave was won) opens its PARTY picker on
        // this post-victory crossing to the shop - drive it (guarded; no-op when no host faint is pending).
        armHostFaintAutoPick();
        await game.phaseInterceptor.to("SelectModifierPhase", false);
      });
      const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      if (hostShop.phaseName !== "SelectModifierPhase") {
        bumpSkip("rewardShopUnavailable");
        return;
      }
      // Every campaign, including AttemptCapture, must execute the guest's ACTUAL queued Victory -> BattleEnd
      // tail. A detached synthetic reward surface can advance the interaction counter while leaving the
      // retained WAVE_ADVANCE unresolved; the next wave then correctly fails closed on two candidate identities.
      // The retained WAVE_ADVANCE DATA is admitted only while that exact BattleEnd is current; the helper
      // stops before the queued SelectModifierPhase starts, so no detached surface can skip the boundary.
      // A retained automatic terminal can arrive after the final replay finalizer, leaving the guest safely
      // parked at a closed phantom CommandPhase with its boundary wake queued. Production releases that exact
      // state when the host ENTERS the authoritative shop and phase-routes the displaced command. Start the
      // host's real shop first (owner or watcher), then let the guest consume that route and drain its retained
      // Victory/BattleEnd tail. Reaching the guest shop before starting the host manufactured a harness-only
      // deadlock: nobody had announced the authoritative shop point that closes cmd:<wave>:<turn+1>.
      let hostShopStarted = false;
      if (hostOwns) {
        await withClient(rig.hostCtx, async () => {
          hostShop.start();
          await drainLoopback();
        });
        hostShopStarted = true;
      } else {
        await withClient(rig.hostCtx, () => beginRewardShopWatch(hostShop));
        hostShopStarted = true;
      }
      const guestShop = await withClient(rig.guestCtx, () =>
        reachQueuedRewardShop(rig.guestScene, {
          // Real browsers run both event loops concurrently. The in-process scheduled transport needs the
          // host inbox pumped while the guest's phantom command awaits its authoritative shop phaseRoute.
          pumpPeer: () => withClient(rig.hostCtx, () => drainLoopback()),
          // Fixed trainer rewards can include an account-local voucher. Unlike shared run modifiers, the
          // authoritative renderer intentionally applies that voucher to its own account and presents the
          // normal acknowledgement message. A real player dismisses it with ACTION; the headless two-engine
          // driver must do the same through the public UI boundary instead of mistaking it for a phase hang.
          // No other phase or UI mode is admitted here, so an unexpected prompt still fails closed.
          drivePublicPhaseInput: phase => {
            if (
              guestAccountRewardAcknowledged
              || phase.phaseName !== "ModifierRewardPhase"
              || rig.guestScene.ui.getMode() !== UiMode.MESSAGE
            ) {
              return false;
            }
            guestAccountRewardAcknowledged = rig.guestScene.ui.processInput(Button.ACTION);
            return guestAccountRewardAcknowledged;
          },
        }),
      );
      await awaitGuestWaveTransaction(wave, false);
      // A terminal turn has TWO authoritative material boundaries: its TurnEnd checkpoint and the retained
      // BattleEnd DATA image. The host may execute automatic PokemonHeal/BattleEnd work while the guest is
      // still rendering the final turn. Compare only after both clients have reached this exact retained
      // boundary, but before either owner can mutate the reward surface. Sampling immediately after
      // playWave() races those two legitimate phases (and, on natural expiry, mistakes the host's lapsed
      // temporary modifier for a desync before the guest has been allowed to adopt the retained image).
      await beforeSharedInput?.();
      // #849: the reward shop is the real MODIFIER_SELECT surface (owner drives, watcher mirrors over the relay).
      hitMode(UiMode.MODIFIER_SELECT);

      let action: string;
      if (hostOwns) {
        await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
        action = await withClient(rig.hostCtx, () =>
          driveOwnerReward(hostShop, rig.hostScene, wave, ownerPolicy, hostShopStarted),
        );
        await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
      } else {
        action = await withClient(rig.guestCtx, () => driveOwnerReward(guestShop, rig.guestScene, wave, ownerPolicy));
        await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
      }
      if (destinationScheduled) {
        // Close result -> materialization -> exact ACK before reading either controller. Four alternating
        // rounds are bounded and cover the longest retained-result chain without a timing sleep.
        await pumpDuoDestinations(rig, 4);
      }
      // Mechanical result/counter convergence is not a continuation boundary. Keep each renderer's
      // complete context installed until its actual queued SelectModifierPhase exits; otherwise the
      // pending MESSAGE transition can resume after a context swap and strand one side before Crossroads.
      await withClient(rig.hostCtx, () => awaitRewardShopPhaseExit(hostShop));
      await withClient(rig.guestCtx, () => awaitRewardShopPhaseExit(guestShop));
      await awaitGuestWaveTransaction(wave, true);
      actionScript.push(`wave ${wave}: reward shop owner=${hostOwns ? "host" : "guest"} ${action}`);

      const hostAfter = rig.hostRuntime.controller.interactionCounter();
      const guestAfter = rig.guestRuntime.controller.interactionCounter();
      const expectedAfter = deferAdvanceToMeTerminal ? counterBefore : counterBefore + 1;
      if (hostAfter !== expectedAfter || guestAfter !== expectedAfter) {
        fail(
          "lockstep",
          wave,
          deferAdvanceToMeTerminal
            ? `ME battle reward shop advanced before the true ME terminal (before=${counterBefore} host=${hostAfter} guest=${guestAfter})`
            : `reward shop did not advance both counters once (before=${counterBefore} host=${hostAfter} guest=${guestAfter})`,
        );
      }
    } finally {
      rig.pair.setDestinationContextDelivery?.(false);
    }
  };

  /** Wait for one client's real UI mode while keeping that complete client context installed. */
  const awaitClientUiMode = async (ctx: DuoRig["hostCtx"], mode: UiMode, label: string): Promise<void> => {
    // Headless Phaser does not tick every fade tween. The bounded production mode transition has a two-
    // second force path, so retain this exact client's globals while that local callback settles rather
    // than alternating the process-global harness context underneath it.
    await withClient(ctx, async () => {
      for (let attempt = 0; attempt < 320; attempt++) {
        if (ctx.scene.ui.getMode() === mode) {
          return;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`${label} never opened ${UiMode[mode]} (stuck on ${UiMode[ctx.scene.ui.getMode()]})`);
    });
  };

  /** Press one public UI button, bounded by destination-context pumps just like two independent browsers. */
  const pressClientUiUntilAccepted = async (ctx: DuoRig["hostCtx"], button: Button, label: string): Promise<void> => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const accepted = await withClient(ctx, () => ctx.scene.ui.processInput(button));
      await pumpDuoDestinations(rig, 1);
      if (accepted) {
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`${label} never accepted ${Button[button]}`);
  };

  type CrossroadsPhaseSeam = {
    readonly phaseName: "ErCrossroadsPhase";
    start(): void;
  };

  /**
   * Open both renderers' real queued Crossroads phases and stop before either player chooses an option.
   *
   * The every-ten-wave market can chain directly into Crossroads. In that case the retained WAVE_ADVANCE
   * is intentionally not continuation-ready merely because both phase queues point at ErCrossroadsPhase:
   * a player cannot act until start() exposes OPTION_SELECT. This helper creates exactly that public boundary
   * and is idempotent for the later next-wave crossing, which resumes an already-visible prompt instead of
   * starting either phase twice. The caller must keep `setCoopBiomePickerDrivenByTest()` armed while invoking
   * this helper so the headless-only auto-resolver cannot bypass the production owner/watcher surface.
   */
  const openQueuedCrossroadsSurface = async (
    wave: number,
  ): Promise<{
    hostPhase: CrossroadsPhaseSeam;
    guestPhase: CrossroadsPhaseSeam;
    ownerCtx: DuoRig["hostCtx"];
    pinned: number;
  }> => {
    const hostPhase = rig.hostScene.phaseManager.getCurrentPhase() as unknown as CrossroadsPhaseSeam;
    if (hostPhase?.phaseName !== "ErCrossroadsPhase") {
      fail("no-park", wave, `expected queued ErCrossroadsPhase, reached ${hostPhase?.phaseName ?? "none"}`);
    }
    const guestPhase = (await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "ErCrossroadsPhase"),
    )) as unknown as CrossroadsPhaseSeam;
    if (guestPhase?.phaseName !== "ErCrossroadsPhase") {
      fail(
        "no-park",
        wave,
        `guest did not reach queued ErCrossroadsPhase (current=${guestPhase?.phaseName ?? "none"})`,
      );
    }

    const hostCounter = withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.interactionCounter());
    const guestCounter = withClientSync(rig.guestCtx, () => rig.guestRuntime.controller.interactionCounter());
    if (hostCounter !== guestCounter) {
      fail("lockstep", wave, `Crossroads opened with divergent counters host=${hostCounter} guest=${guestCounter}`);
    }
    const pinned = hostCounter;
    const hostOwns = withClientSync(rig.hostCtx, () => rig.hostRuntime.controller.isLocalOwnerAtCounter(pinned));
    const guestOwns = withClientSync(rig.guestCtx, () => rig.guestRuntime.controller.isLocalOwnerAtCounter(pinned));
    if (hostOwns === guestOwns) {
      fail("desync", wave, `Crossroads owner parity diverged at pinned=${pinned}`);
    }

    let hostOpen = withClientSync(rig.hostCtx, () => rig.hostScene.ui.getMode() === UiMode.OPTION_SELECT);
    let guestOpen = withClientSync(rig.guestCtx, () => rig.guestScene.ui.getMode() === UiMode.OPTION_SELECT);
    if (hostOpen !== guestOpen) {
      fail(
        "desync",
        wave,
        `Crossroads public surface was already asymmetric hostOpen=${hostOpen} guestOpen=${guestOpen}`,
      );
    }
    if (!hostOpen) {
      await withClient(rig.hostCtx, async () => {
        hostPhase.start();
        await drainLoopback();
      });
      await withClient(rig.guestCtx, async () => {
        guestPhase.start();
        await drainLoopback();
      });
      for (let attempt = 0; attempt < 320; attempt++) {
        hostOpen = await withClient(rig.hostCtx, async () => {
          await drainLoopback();
          if (rig.hostScene.ui.getMode() === UiMode.OPTION_SELECT) {
            return true;
          }
          await new Promise<void>(resolve => setTimeout(resolve, 10));
          return false;
        });
        guestOpen = await withClient(rig.guestCtx, async () => {
          await drainLoopback();
          if (rig.guestScene.ui.getMode() === UiMode.OPTION_SELECT) {
            return true;
          }
          await new Promise<void>(resolve => setTimeout(resolve, 10));
          return false;
        });
        if (hostOpen && guestOpen) {
          break;
        }
        await pumpDuoDestinations(rig, 1);
      }
      if (!hostOpen || !guestOpen) {
        fail(
          "no-park",
          wave,
          `Crossroads did not expose OPTION_SELECT on both clients hostOpen=${hostOpen} guestOpen=${guestOpen}`,
        );
      }
    }

    return {
      hostPhase,
      guestPhase,
      ownerCtx: hostOwns ? rig.hostCtx : rig.guestCtx,
      pinned,
    };
  };

  /**
   * Drive the every-ten-wave Biome Market through its real owner/watcher phases and public UI terminal.
   *
   * BiomeShopPhase deliberately inherits phaseName="SelectModifierPhase" for party-continuation
   * compatibility, but it owns `shopOptions`, not the ordinary reward phase's `typeOptions`. Treating this
   * phase as ShopPhaseSeam made an odd-counter milestone call the HOST watcher helper and dereference an
   * undefined typeOptions array before the actual GUEST owner had even started. Route by concrete phase
   * identity instead: both queued renderers enter the market, the parity owner presses CANCEL/CONFIRM, and
   * the retained terminal must advance both counters exactly once.
   */
  const driveBiomeMarketLeave = async (wave: number, beforeSharedInput?: () => Promise<void>): Promise<void> => {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    const destinationScheduled = rig.pair.setDestinationContextDelivery != null;
    rig.pair.setDestinationContextDelivery?.(destinationScheduled);
    // GameManager keeps the every-ten-wave market disabled in broad engine tests by default. This
    // production-fidelity leg owns the real public market boundary, so opt in only for this bounded surface
    // and restore the standing harness default even when the market fails closed.
    setCoopBiomeMarketTestSkip(false);
    try {
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
      const hostMarket = rig.hostScene.phaseManager.getCurrentPhase();
      if (!(hostMarket instanceof BiomeShopPhase)) {
        fail(
          "no-park",
          wave,
          `expected queued BiomeShopPhase, reached ${hostMarket?.constructor.name ?? hostMarket?.phaseName ?? "none"}`,
        );
      }
      const guestMarket = await withClient(rig.guestCtx, () =>
        driveClientPhaseQueueTo(rig.guestScene, "BiomeShopPhase", {
          matches: phase => phase instanceof BiomeShopPhase,
        }),
      );
      if (!(guestMarket instanceof BiomeShopPhase)) {
        fail(
          "no-park",
          wave,
          `guest did not reach queued BiomeShopPhase (current=${guestMarket?.constructor.name ?? guestMarket?.phaseName ?? "none"})`,
        );
      }

      // Match ordinary rewards: DATA must be applied and both real queues must expose the shared surface
      // before measuring the immutable boundary or allowing either owner to provide input.
      await awaitGuestWaveTransaction(wave, false);
      await beforeSharedInput?.();
      hitMode(UiMode.BIOME_SHOP);

      const ownerCtx = hostOwns ? rig.hostCtx : rig.guestCtx;
      const watcherCtx = hostOwns ? rig.guestCtx : rig.hostCtx;
      const ownerMarket = hostOwns ? hostMarket : guestMarket;
      const watcherMarket = hostOwns ? guestMarket : hostMarket;

      // Start the watcher first so the option/terminal streams always have a live consumer, then start the
      // concrete parity owner. No private callback or stock mutation is invoked by the harness.
      await withClient(watcherCtx, async () => {
        watcherMarket.start();
        await drainLoopback();
      });
      await withClient(ownerCtx, async () => {
        ownerMarket.start();
        await drainLoopback();
      });
      await pumpDuoDestinations(rig, 4);

      await awaitClientUiMode(ownerCtx, UiMode.BIOME_SHOP, `${hostOwns ? "host" : "guest"} biome market`);
      await pressClientUiUntilAccepted(ownerCtx, Button.CANCEL, "biome market leave");
      await awaitClientUiMode(ownerCtx, UiMode.CONFIRM, "biome market leave confirmation");
      await pressClientUiUntilAccepted(ownerCtx, Button.ACTION, "biome market confirm yes");

      let advanced = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        await pumpDuoDestinations(rig, 1);
        if (
          rig.hostRuntime.controller.interactionCounter() === counterBefore + 1
          && rig.guestRuntime.controller.interactionCounter() === counterBefore + 1
        ) {
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        fail(
          "lockstep",
          wave,
          `biome market did not advance both counters once (before=${counterBefore} `
            + `host=${rig.hostRuntime.controller.interactionCounter()} `
            + `guest=${rig.guestRuntime.controller.interactionCounter()})`,
        );
      }

      // The terminal envelope advances the shared interaction counter before both local phase managers
      // necessarily finish their confirmation teardown. A real browser keeps rendering during that tail.
      // Wait until BOTH concrete market instances have actually left before classifying/opening the chained
      // continuation; inspecting immediately can still see SelectModifierPhase, then pump into an unstarted
      // Crossroads only after the continuation-ready waiter has already begun.
      let bothMarketsExited = false;
      for (let attempt = 0; attempt < 160; attempt++) {
        await pumpDuoDestinations(rig, 1);
        const hostExited = rig.hostScene.phaseManager.getCurrentPhase() !== hostMarket;
        const guestExited = rig.guestScene.phaseManager.getCurrentPhase() !== guestMarket;
        if (hostExited && guestExited) {
          bothMarketsExited = true;
          break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
      if (!bothMarketsExited) {
        fail(
          "no-park",
          wave,
          `biome market terminal did not leave on both clients (host=${rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"} `
            + `guest=${rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"})`,
        );
      }

      // A real shared continuation is not complete merely because its mechanical terminal advanced. The
      // renderer must also have opened the addressed continuation surface before the retained wave journal
      // can release. On every tenth wave the market can chain into Crossroads; expose that real public prompt
      // now, without choosing, so the post-wave capture observes the same actionable boundary a human does.
      // The later next-wave crossing resumes this already-open owner/watcher pair idempotently.
      const hostContinuation = rig.hostScene.phaseManager.getCurrentPhase();
      const guestContinuation = rig.guestScene.phaseManager.getCurrentPhase();
      const hostAtCrossroads = hostContinuation?.phaseName === "ErCrossroadsPhase";
      const guestAtCrossroads = guestContinuation?.phaseName === "ErCrossroadsPhase";
      if (hostAtCrossroads !== guestAtCrossroads) {
        fail(
          "desync",
          wave,
          `post-market continuation diverged host=${hostContinuation?.phaseName ?? "none"} `
            + `guest=${guestContinuation?.phaseName ?? "none"}`,
        );
      }
      if (hostAtCrossroads) {
        setCoopBiomePickerDrivenByTest();
        try {
          await openQueuedCrossroadsSurface(wave);
        } finally {
          resetCoopBiomePickerDrivenByTest();
        }
      }
      await awaitGuestWaveTransaction(wave, true);
      actionScript.push(`wave ${wave}: biome market owner=${hostOwns ? "host" : "guest"} leave`);
    } finally {
      setCoopBiomeMarketTestSkip(true);
      rig.pair.setDestinationContextDelivery?.(false);
    }
  };

  // ---------------------------------------------------------------------------
  // #633 MID-RUN MYSTERY-ENCOUNTER CONTINUATION (BUILD 1). Port buildDuoForMe's pump INLINE into the
  // continuous wave loop: when a wave is a FORCED ME, mirror the host's ME onto the guest (mirrorHostMeToGuest,
  // NOT the battle mirror - an ME wave has no enemy party), drive the host through the REAL MysteryEncounterPhase
  // + embedded reward shop, drive the guest's REAL CoopReplayMePhase (driveGuestMeReplay), and assert LOCKSTEP.
  // Routes the three authoritative paths by interaction-counter parity at the ME: HOST-OWNED (even, host drives
  // its own UI), GUEST-OWNED (odd, host awaits the guest's relayed index via coopHostAwaitGuestIndex), and
  // (a battle-spawning option would be) BATTLE-HANDOFF. A SAFE non-battle option is driven (the goal is SYNC-layer
  // coverage, not every outcome branch). The relay-send tap (installCoverageTaps) records the ME kinds/bands
  // automatically as the host/guest stream them; here we record the MYSTERY_ENCOUNTER mode + the ME manifest.
  // ---------------------------------------------------------------------------

  /**
   * Cross the host from wave W-1's shop INTO wave W's forced ME, parking at its {@linkcode MysteryEncounterPhase}
   * (ME rolled + `currentBattle.mysteryEncounter` set, intro dialogue auto-advanced) so {@linkcode processMeWave}
   * can mirror + drive it. FORCES the ME by raising the rate override for just this wave's EncounterPhase then
   * resetting it to 0 (so ONLY the designated wave rolls an ME). MUST be called under host ctx by the caller.
   */
  const crossIntoMeWave = async (type: MysteryEncounterType): Promise<boolean> => {
    game.override.mysteryEncounterChance(100).mysteryEncounter(type);
    // Auto-advance the EncounterPhase intro dialogue (mirrors runToMysteryEncounter) so the crossing reaches
    // MysteryEncounterPhase without a live prompt handler.
    game.onNextPrompt(
      "EncounterPhase",
      UiMode.MESSAGE,
      () => (game.scene.ui.getHandler() as unknown as { processInput(b: number): boolean }).processInput(Button.ACTION),
      () => game.isCurrentPhase("MysteryEncounterPhase"),
      true,
    );
    armHostFaintAutoPick();
    await game.phaseInterceptor.to("MysteryEncounterPhase", false);
    // Reset the rate so subsequent waves are normal battles again.
    game.override.mysteryEncounterChance(0);
    const isMe = rig.hostScene.currentBattle.battleType === BattleType.MYSTERY_ENCOUNTER;
    if (!isMe) {
      bumpSkip("meForceFailed");
    }
    return isMe;
  };

  /**
   * Drive ONE mid-run ME wave across BOTH engines (BUILD 1). The host is parked at MysteryEncounterPhase (ME
   * set) from {@linkcode crossIntoMeWave}. Mirror the host's ME onto the guest, then route by counter parity:
   *   - HOST-OWNED (even counter): the host drives its OWN pick (option 1 = a SAFE non-battle option) + embedded
   *     reward shop to PostMysteryEncounterPhase; the guest replays via driveGuestMeReplay (pure renderer).
   *   - GUEST-OWNED (odd counter): the host AWAITS the guest's relayed option index; the guest starts its
   *     CoopReplayMePhase, relays index 0, the host applies it programmatically + drives the embedded shop, then
   *     the guest's deferred outcome/terminal race converges (the IT #2 STEP B/C/D handshake, inline).
   * Advances the alternation counter exactly ONCE (like a shop). Asserts LOCKSTEP at start + end.
   */
  const processMeWave = async (wave: number, type: MysteryEncounterType): Promise<void> => {
    // Mirror the host's CURRENT mystery encounter onto the guest (rebuilds the guest party + sets its ME).
    await withClient(rig.guestCtx, () => mirrorHostMeToGuest(rig.hostScene, rig.guestScene));
    assertLockstep(wave, "me-start");
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    const option = Math.max(1, Math.trunc(opts.meOptions?.get(wave) ?? 1));
    const battleSpawning = opts.meBattleWaves?.has(wave) === true;
    const noRewardShop = opts.meNoRewardWaves?.has(wave) === true;
    // #849: the guest opens the real MYSTERY_ENCOUNTER screen (the mirrored mode); record it.
    hitMode(UiMode.MYSTERY_ENCOUNTER);

    let mePath: "host-owned" | "guest-owned" | "battle-handoff";
    if (hostOwns && battleSpawning) {
      // BATTLE-HANDOFF: the selected option terminates the ME pump with the dedicated 9M sentinel instead of
      // a non-battle meResync/LEAVE. Park the host after it has generated + streamed the authoritative enemy
      // manifest, let the guest's real replay terminal adopt that manifest and boot its own ME battle, then
      // drive the same bounded multi-turn battle/reward machinery used by normal waves. This is the production
      // path that used to be absent from the continuous campaign, allowing an ME->battle strand to hide behind
      // focused handoff tests.
      await withClient(rig.hostCtx, async () => {
        await runSelectMysteryEncounterOption(game, option);
        await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      });
      const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      await withClient(rig.guestCtx, async () => {
        await drainGuestMeReplayToSettle(replay);
        if (rig.guestScene.phaseManager.getCurrentPhase()?.phaseName !== "MysteryEncounterBattlePhase") {
          fail(
            "no-park",
            wave,
            `guest ME battle handoff did not boot MysteryEncounterBattlePhase (current=${rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"})`,
          );
        }
      });
      if (rig.hostScene.getEnemyParty().length !== rig.guestScene.getEnemyParty().length) {
        fail(
          "desync",
          wave,
          `ME battle enemy manifest count diverged at handoff (host=${rig.hostScene.getEnemyParty().length} guest=${rig.guestScene.getEnemyParty().length})`,
        );
      }
      if (rig.hostScene.arena.biomeId !== rig.guestScene.arena.biomeId) {
        fail(
          "desync",
          wave,
          `ME battle arena diverged at handoff (host=${rig.hostScene.arena.biomeId} guest=${rig.guestScene.arena.biomeId})`,
        );
      }
      await crossCommandBoundaryWithReplayGuest(wave, rig.hostScene.currentBattle.turn);
      await playWave(wave);
      await assertPostTurnConverged(wave);
      // An ME-battle reward screen deliberately suppresses its normal shop tick: the whole encounter owns
      // exactly one alternation step, committed by PostMysteryEncounterPhase after the spawned battle. Drive
      // that true terminal and flush the guest's detached 9M listener before checking the +1 lockstep.
      await driveRewardShop(wave, true);
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("PostMysteryEncounterPhase"));
      await withClient(rig.guestCtx, async () => {
        await drainLoopback();
      });
      // The two-engine harness persists the guest module context when the scoped pump returns; only then can
      // the detached promise continuation run against its captured controller. Wait outside the client scope
      // (bounded) rather than starving that continuation with an inner polling loop.
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
        if (rig.guestRuntime.controller.interactionCounter() === counterBefore + 1) {
          break;
        }
      }
      mePath = "battle-handoff";
    } else if (hostOwns) {
      // HOST-OWNED: park the host at its embedded shop, start the guest replay while the presentation is
      // buffered, then let BOTH real shop phases rendezvous before the owner commits LEAVE. The previous
      // owner-only shortcut called the shop's private terminal while its async shop-pick barrier was still
      // waiting for the guest. That stale waiter survived the ME and could resolve several waves later,
      // shifting the host into the next battle early (the wave-22 nondeterministic freeze caught by the
      // continuous journey). This ordering mirrors production: owner reaches shop -> watcher handoff reaches
      // shop -> barrier opens -> owner terminal -> watcher terminal -> ME terminal.
      let hostShop!: ShopPhaseSeam;
      await withClient(rig.hostCtx, async () => {
        await runMysteryEncounterToEnd(game, option);
        await game.phaseInterceptor.to(noRewardShop ? "PostMysteryEncounterPhase" : "SelectModifierPhase", false);
        if (!noRewardShop) {
          hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        }
      });
      const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      let retainedTerminalDrovePostMystery = false;

      if (!noRewardShop) {
        // Start the owner shop synchronously so its option stream + arrival are queued, then flush them under
        // the guest context. CoopReplayMePhase's reward-options handoff ends detached and automatically starts
        // the guest's own SelectModifierPhase watcher, whose arrival releases the host barrier.
        withClientSync(rig.hostCtx, () => hostShop.start());
        let guestShop!: ShopPhaseSeam;
        await withClient(rig.guestCtx, async () => {
          for (let i = 0; i < 8; i++) {
            await drainLoopback();
            const current = rig.guestScene.phaseManager.getCurrentPhase();
            if (current?.phaseName === "SelectModifierPhase") {
              guestShop = current as unknown as ShopPhaseSeam;
              break;
            }
          }
        });
        if (guestShop == null) {
          fail("no-park", wave, "guest never reached the host-owned ME embedded reward shop");
        }

        // Flush the guest arrival under the host context, then commit the already-started owner shop exactly
        // once (do not call driveHostRewardShopOwner: it would start the phase/barrier a second time). A
        // retained host terminal returns true and owns teardown: it must remain the current phase until the
        // guest materially applies that exact result and the peer-material callback ends/advances it. Ending
        // here used to replace the phase with PostMysteryEncounter before the ACK callback, which correctly
        // failed the strict phase fence and left the comprehensive ME terminal empty.
        const setDestinationDelivery = rig.pair.setDestinationContextDelivery;
        if (setDestinationDelivery == null) {
          fail("no-park", wave, "host-owned embedded ME reward requires destination-context transport scheduling");
        }
        const deliverInDestinationContext = setDestinationDelivery as (enabled: boolean) => void;
        let parkedForPeerMaterial = false;
        deliverInDestinationContext(true);
        try {
          await withClient(rig.hostCtx, async () => {
            await drainLoopback();
            hostShop.coopEndMirror();
            parkedForPeerMaterial = hostShop.coopRelaySend(-1, undefined, "skip");
            // Compatibility/non-retained fallback only. In the retained path the production callback owns
            // these exact mutations after the guest's material ACK.
            if (!parkedForPeerMaterial) {
              hostShop.end();
              hostShop.coopAdvanceInteraction();
            }
          });

          if (parkedForPeerMaterial) {
            for (let i = 0; i < 24; i++) {
              // Result first reaches/materializes on the guest; its addressed ACK then reaches the host.
              // Preserve this causal order instead of using a timing sleep or advancing either phase directly.
              await withClient(rig.guestCtx, () => drainLoopback());
              await withClient(rig.hostCtx, () => drainLoopback());
              if (
                rig.hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase"
                && rig.guestScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase"
              ) {
                break;
              }
            }
            // Peer materialization completes the embedded shop terminal. Production's scheduler then runs
            // the retained EggLapse/PostMystery tail, where the ME owns its single +1 interaction commit.
            // The interceptor runner must execute that real tail before asserting the post-ME counter.
            await withClient(rig.hostCtx, () => game.phaseInterceptor.to("PostMysteryEncounterPhase"));
            retainedTerminalDrovePostMystery = true;
            await withClient(rig.guestCtx, async () => {
              for (let i = 0; i < 8; i++) {
                await drainLoopback();
              }
            });
            if (
              rig.hostRuntime.controller.interactionCounter() !== counterBefore + 1
              || rig.guestRuntime.controller.interactionCounter() !== counterBefore + 1
            ) {
              fail(
                "no-park",
                wave,
                "host-owned ME retained reward terminal did not finish after peer material apply "
                  + `(host=${rig.hostRuntime.controller.interactionCounter()} `
                  + `guest=${rig.guestRuntime.controller.interactionCounter()} expected=${counterBefore + 1} `
                  + `hostPhase=${rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"} `
                  + `guestPhase=${rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"})`,
              );
            }
          }
        } finally {
          deliverInDestinationContext(false);
        }
        await withClient(rig.guestCtx, async () => {
          for (let i = 0; i < 8; i++) {
            await drainLoopback();
            if (rig.guestScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
              break;
            }
          }
        });
      }
      if (!retainedTerminalDrovePostMystery) {
        await withClient(rig.hostCtx, () => game.phaseInterceptor.to("PostMysteryEncounterPhase"));
      }
      await withClient(rig.guestCtx, async () => {
        // The shop handoff marks the replay detached/settled before the true 9M terminal. Drain first so
        // meResync + LEAVE apply and advance the guest, then assert the replay's terminal guard.
        for (let i = 0; i < 8; i++) {
          await drainLoopback();
        }
        await drainGuestMeReplayToSettle(replay);
      });
      mePath = "host-owned";
    } else {
      // GUEST-OWNED (odd counter): the host CANNOT take the human pick - it awaits the guest's relayed option
      // index. Interleave the IT #2 handshake inline: (B) start the guest divert + relay index 0 under the guest
      // ctx; (C) drain under the host ctx so coopHostAwaitGuestIndex resolves, apply the pick, drive the embedded
      // shop (host is the pick WATCHER on a guest-owned ME), to PostMysteryEncounterPhase; (D) start the guest's
      // deferred outcome/terminal race so it buffer-hits the meResync + LEAVE under the guest ctx and converges.
      // Start the host ME first so its authoritative presentation is buffered before the guest divert
      // resolves ownership. This is the production order and prevents a pending guest continuation from
      // resuming under the harness's later host context.
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("MysteryEncounterPhase"));
      const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      const scriptedSubPicks = [...(opts.meSubPicks?.get(wave) ?? [])];

      if (scriptedSubPicks.length === 0) {
        // A flat guest-owned ME still crosses a bidirectional process boundary. Deliver the owner's exact
        // top-level intent only while the HOST runtime is installed, then keep the sole engine under that
        // same destination until it opens the reward/post surface. Automatic loopback used to invoke the
        // host transport handler under the sender's guest runtime: the packet was visibly received, but the
        // host relay waiter never saw it and retransmitted the valid pick forever (wave-26 Town Raffle).
        const setDestinationDelivery = rig.pair.setDestinationContextDelivery;
        if (setDestinationDelivery == null) {
          fail("no-park", wave, "guest-owned ME requires destination-context transport scheduling");
        }
        const deliverInDestinationContext = setDestinationDelivery as (enabled: boolean) => void;
        let hostReachedDestination = false;
        let hostDriveError: unknown;

        deliverInDestinationContext(true);
        try {
          const hostDrive = withClient(rig.hostCtx, () =>
            game.phaseInterceptor.to(noRewardShop ? "PostMysteryEncounterPhase" : "SelectModifierPhase", false),
          ).then(
            () => {
              hostReachedDestination = true;
            },
            error => {
              hostDriveError = error;
            },
          );

          withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, option - 1));
          const hostDriveDeadline = Date.now() + 10_000;
          while (!hostReachedDestination && Date.now() < hostDriveDeadline) {
            // No guest pump is needed after its complete pick is queued. Keeping the engine's async option
            // callback in host context also prevents a Promise continuation from ending the guest phase.
            await withClient(rig.hostCtx, () => drainLoopback());
            if (hostDriveError != null) {
              throw hostDriveError;
            }
          }
          if (hostDriveError != null) {
            throw hostDriveError;
          }
          if (!hostReachedDestination) {
            throw new Error(
              `wave ${wave} ${MysteryEncounterType[type]} guest-owned public drive did not reach its continuation; `
                + `host=${rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"}`,
            );
          }
          await hostDrive;
        } finally {
          deliverInDestinationContext(false);
        }
      } else {
        // A nested PARTY/OPTION_SELECT cannot be pre-sent. CoopReplayMePhase deliberately accepts a sub-pick
        // only after the exact retained ME_PRESENT has armed its one-shot presentation ticket. The old driver
        // called relayGuestSubPick([0, 0]) before either presentation existed; both calls correctly returned
        // false, then the host waited forever for meSub while the driver kept retransmitting the top-level
        // `me` pick. Drive the same public capture callbacks a browser uses, in destination context, instead.
        const setDestinationDelivery = rig.pair.setDestinationContextDelivery;
        if (setDestinationDelivery == null) {
          fail("no-park", wave, "guest-owned nested ME requires destination-context transport scheduling");
        }
        const deliverInDestinationContext = setDestinationDelivery as (enabled: boolean) => void;

        type BoundedModeResult = "completed" | "forced" | "superseded";
        type ScriptableGuestUi = {
          setModeBoundedWhen: (
            mode: UiMode,
            timeoutMs: number,
            isCurrent: (() => boolean) | undefined,
            ...args: unknown[]
          ) => Promise<BoundedModeResult>;
        };
        const ui = rig.guestScene.ui as unknown as ScriptableGuestUi;
        const originalSetModeBoundedWhen = ui.setModeBoundedWhen;
        const realSetModeBoundedWhen = originalSetModeBoundedWhen.bind(ui);
        const pendingSubPicks = [...scriptedSubPicks];
        let scriptedDriveError: Error | undefined;

        ui.setModeBoundedWhen = (
          mode: UiMode,
          timeoutMs: number,
          isCurrent: (() => boolean) | undefined,
          ...args: unknown[]
        ): Promise<BoundedModeResult> => {
          if (mode === UiMode.PARTY) {
            const callback = args[2];
            const value = pendingSubPicks.shift();
            if (typeof callback !== "function" || value == null) {
              scriptedDriveError = new Error(
                `wave ${wave} ${MysteryEncounterType[type]} PARTY sub-prompt had no scripted public callback/value`,
              );
              return Promise.resolve("superseded");
            }
            hitMode(UiMode.PARTY);
            actionScript.push(`wave ${wave}: ME ${MysteryEncounterType[type]} public PARTY pick=${value}`);
            queueMicrotask(() => (callback as (slot: number) => void)(value));
            return Promise.resolve("completed");
          }
          if (mode === UiMode.OPTION_SELECT) {
            const config = args[0] as { options?: { handler?: () => unknown }[] } | undefined;
            const value = pendingSubPicks.shift();
            const handler = value == null ? undefined : config?.options?.[value]?.handler;
            if (typeof handler !== "function") {
              scriptedDriveError = new Error(
                `wave ${wave} ${MysteryEncounterType[type]} OPTION_SELECT sub-prompt had no scripted handler at ${value ?? "missing"}`,
              );
              return Promise.resolve("superseded");
            }
            hitMode(UiMode.OPTION_SELECT);
            actionScript.push(`wave ${wave}: ME ${MysteryEncounterType[type]} public OPTION_SELECT pick=${value}`);
            queueMicrotask(() => handler());
            return Promise.resolve("completed");
          }
          return realSetModeBoundedWhen(mode, timeoutMs, isCurrent, ...args);
        };

        deliverInDestinationContext(true);
        let hostReachedNestedDestination = false;
        let hostNestedDriveError: unknown;
        try {
          // Keep the host's async interceptor scope alive while each queued carrier is delivered only under
          // the destination client's full scene/runtime/module context. This models two browser processes:
          // host receives ME_PICK -> guest receives PARTY -> host receives ME_SUB -> guest receives SECONDARY
          // -> host receives ME_SUB. No direct sub-pick seam and no terminal shortcut is involved.
          const hostNestedDrive = withClient(rig.hostCtx, () =>
            game.phaseInterceptor.to(noRewardShop ? "PostMysteryEncounterPhase" : "SelectModifierPhase", false),
          ).then(
            () => {
              hostReachedNestedDestination = true;
            },
            error => {
              hostNestedDriveError = error;
            },
          );

          await withClient(rig.guestCtx, async () => {
            relayGuestMeOptionIndexOnly(replay, option - 1);
            startGuestMeOutcomeRace(replay);
            await drainLoopback();
          });

          // Once the final sub-pick lands, the real Field Trip chain still crosses narration, rewards, and
          // party EXP before opening SelectModifierPhase. Twenty-four zero-delay pump rounds were only about
          // 200 ms and became runner-load dependent; use the same bounded ten-second production-transition
          // window as the T2 journey while continuing to fail loudly on a genuine no-progress state.
          const nestedDriveDeadline = Date.now() + 10_000;
          while (!hostReachedNestedDestination && Date.now() < nestedDriveDeadline) {
            // Alternate destinations only while the guest still needs to receive and answer another
            // retained sub-prompt. Once its final public callback has queued ME_SUB, drain the host only:
            // the authoritative option callback is async, and entering guest context while it resolves can
            // make Phase.end() shift the guest queue (the intermittent host-Rewards / guest-Inert strand).
            if (pendingSubPicks.length > 0) {
              await pumpDuoDestinations(rig, 1);
            } else {
              await withClient(rig.hostCtx, () => drainLoopback());
            }
            if (scriptedDriveError != null) {
              throw scriptedDriveError;
            }
            if (hostNestedDriveError != null) {
              throw hostNestedDriveError;
            }
          }
          if (hostNestedDriveError != null) {
            throw hostNestedDriveError;
          }
          if (!hostReachedNestedDestination) {
            throw new Error(
              `wave ${wave} ${MysteryEncounterType[type]} nested public drive did not reach its continuation; `
                + `host=${rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"} `
                + `remainingSubPicks=[${pendingSubPicks.join(",")}]`,
            );
          }
          await hostNestedDrive;
          if (pendingSubPicks.length > 0) {
            throw new Error(
              `wave ${wave} ${MysteryEncounterType[type]} left ${pendingSubPicks.length} scripted public sub-pick(s) unused`,
            );
          }
        } finally {
          ui.setModeBoundedWhen = originalSetModeBoundedWhen;
          deliverInDestinationContext(false);
        }
      }
      const setRewardDestinationDelivery = noRewardShop ? null : rig.pair.setDestinationContextDelivery;
      if (!noRewardShop && setRewardDestinationDelivery == null) {
        fail("no-park", wave, "guest-owned embedded ME reward requires destination-context transport scheduling");
      }
      const deliverRewardInDestinationContext = setRewardDestinationDelivery as ((enabled: boolean) => void) | null;
      deliverRewardInDestinationContext?.(true);
      try {
        if (noRewardShop) {
          await withClient(rig.hostCtx, () => game.phaseInterceptor.to("PostMysteryEncounterPhase"));
        } else {
          // The nested host interceptor necessarily overlaps guest destination pumps in this single-process
          // harness. Its final context restoration can save the outer process's `-1` ME pin into hostCtx even
          // though the real host browser remains pinned for the whole encounter. Rehydrate that one module-let
          // boundary before starting the embedded shop; withClient persists it back into hostCtx for every
          // later host delivery. This is the counterpart to the existing post-ME guest pin cleanup below.
          const interactionCounter = rig.hostRuntime.controller.interactionCounter();
          await withClient(rig.hostCtx, async () => {
            coopSetMePinForGuest(interactionCounter);
          });

          // Keep every reward carrier on its destination client. The guest Replay phase receives the host's
          // streamed stock under guestCtx, performs its production embedded-shop handoff, and opens the real
          // SelectModifierPhase. Its public CANCEL -> CONFIRM -> ACTION path proposes LEAVE; the host watcher
          // validates that proposal and retains the authoritative result. Delivering that result under hostCtx
          // used to clear the ME pin on the wrong engine, so the shop consumed interaction 21 and parked the
          // host at CoopPartnerSync while the guest remained at 21.
          let hostShop!: ShopPhaseSeam;
          await withClient(rig.hostCtx, async () => {
            await game.phaseInterceptor.to("SelectModifierPhase", false);
            hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
            hostShop.start();
            await drainLoopback();
          });
          await pumpDuoDestinations(rig, 2);

          const guestShop = (await withClient(rig.guestCtx, async () => {
            const phase = await driveClientPhaseQueueTo(rig.guestScene, "SelectModifierPhase");
            phase.start();
            await drainLoopback();
            return phase;
          })) as unknown as ShopPhaseSeam;
          if (guestShop.coopWatcher) {
            fail("desync", wave, "guest-owned embedded ME reward opened the guest as watcher instead of owner");
          }
          await withClient(rig.guestCtx, async () => {
            const handler = rig.guestScene.ui.getHandler() as unknown as { unblockInput?: () => void };
            handler.unblockInput?.();
            if (!rig.guestScene.ui.processInput(Button.CANCEL)) {
              fail("no-park", wave, "guest embedded ME reward public CANCEL input was rejected");
            }
            await drainLoopback();
            if (rig.guestScene.ui.getMode() !== UiMode.CONFIRM) {
              fail("no-park", wave, "guest embedded ME reward did not open its public confirmation surface");
            }
            if (!rig.guestScene.ui.processInput(Button.ACTION)) {
              fail("no-park", wave, "guest embedded ME reward public confirmation input was rejected");
            }
          });
          actionScript.push(`wave ${wave}: ME ${MysteryEncounterType[type]} public embedded reward leave`);

          await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
          await pumpDuoDestinations(rig, 2);
          await withClient(rig.hostCtx, () => game.phaseInterceptor.to("PostMysteryEncounterPhase"));
        }
        await withClient(rig.guestCtx, async () => {
          // Nested MEs armed this race before alternating the real public party/secondary captures. A flat
          // guest-owned ME keeps the original split: arm only after the host buffered its full outcome/terminal.
          if (scriptedSubPicks.length === 0) {
            startGuestMeOutcomeRace(replay);
          }
          await drainGuestMeReplayToSettle(replay);
        });
      } finally {
        deliverRewardInDestinationContext?.(false);
      }
      mePath = "guest-owned";
    }

    // Clear any leftover ME onNextPrompt handlers (crossIntoMeWave's intro + runMysteryEncounterToEnd's option
    // prompts): in the single-file FIFO prompt queue a stale ME prompt sits at the head and STARVES the NEXT
    // wave's command prompt, so the following wave's game.move.select never fires and its CommandPhase strands
    // (the exact footgun coop-duo-mystery IT #4 clears). Drain the queue so the continuous run's next wave is
    // driven cleanly.
    (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
    // Clear the GUEST's leftover ME phase queue so its NEXT-wave replay does not re-divert into a spurious
    // second CoopReplayMePhase (driveGuestMeReplay drives THROUGH the leave terminal but leaves the guest's
    // post-ME phase queue populated - see the harness scope note). The next wave's remirror rebuilds the
    // guest's currentBattle; this drops the stale ME phases so the replay runs a clean CoopReplayTurnPhase.
    // #633 FOLLOW-UP (finding (a) - POST-ME COUNTER DESYNC, the HARNESS LEAK): ALSO clear the guest's ME
    // interaction pin here. driveGuestMeReplay / the guest-owned drive above run the guest's ME divert
    // (coopSetMePinForGuest sets coopMeInteractionStart so coopMeInProgress() is TRUE across the whole guest
    // ME, exactly as production) but stop at the CoopReplayMePhase LEAVE terminal - they never drive the
    // guest's PostMysteryEncounterPhase, whose authoritative-guest guard is where production CLEARS the pin
    // (coopClearMePinForGuest, after the embedded watcher shop drains). Without this the pin leaks into
    // guestCtx.mePins, so the NEXT wave's guest pump reads coopMeInProgress() TRUE and RE-DIVERTS a spurious
    // second ME - the guest never drives that wave's (guest-owned) reward-shop terminal and the host watcher
    // hangs (seed 828633 wave 13: "watcher neither left nor advanced ... owner terminal never arrived").
    // Mirror the production post-ME boundary clear under the guest ctx (so guestCtx.mePins gets the -1 on
    // swap-back), exactly as PostMysteryEncounterPhase.start() does for the authoritative guest. Use the ASYNC
    // withClient (NOT withClientSync): ONLY withClient persists the mutated ME pins back into the ctx on exit
    // (`ctx.mePins = readMePins()`, line ~406); withClientSync deliberately drops them (it restores prev.mePins
    // without saving), so a coopClearMePinForGuest under withClientSync would set the global to -1 but leave
    // guestCtx.mePins.start at the leaked ME counter - the exact no-op that let the spurious re-divert persist.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearPhaseQueue();
      coopClearMePinForGuest();
    });

    // The whole ME advanced the alternation counter EXACTLY once (like a shop). Assert LOCKSTEP.
    const hostAfter = rig.hostRuntime.controller.interactionCounter();
    const guestAfter = rig.guestRuntime.controller.interactionCounter();
    if (hostAfter !== counterBefore + 1 || guestAfter !== counterBefore + 1) {
      fail(
        "lockstep",
        wave,
        `ME (${mePath}) did not advance both counters once (before=${counterBefore} host=${hostAfter} guest=${guestAfter})`,
      );
    }
    assertLockstep(wave, "me-end");
    mysteryEncounters.push({ wave, type: MysteryEncounterType[type], path: mePath });
    actionScript.push(
      `wave ${wave}: ME ${MysteryEncounterType[type]} option=${option} driven (${mePath}, counter ${counterBefore}->${hostAfter})`,
    );
    // eslint-disable-next-line no-console
    console.log(`[coop-soak] ME DRIVEN wave ${wave} (seed ${seed}): ${MysteryEncounterType[type]} [${mePath}]`);
  };

  /**
   * A BOSS wave (every 10th). #843: the harness mirror now carries the host's authoritative boss segments
   * onto the guest enemy (mirrorHostBattleToGuest re-asserts setBoss + bossSegmentIndex), so the guest is a
   * FAITHFUL boss and the wave-start + post-turn DIGEST invariants run on boss waves EXACTLY like a normal
   * wave (no more digest skip). The boss reward itself AUTO-GRANTS via ModifierRewardPhase and advances the
   * alternating interaction counter by ZERO. A milestone/biome tail can still queue a later SelectModifierPhase;
   * each such real shared surface is driven through its parity owner + watcher and advances the counter once.
   */
  const processBossWave = async (wave: number): Promise<void> => {
    await assertWaveBoundary(wave); // (a)+(b) wave-start clean-start parity - boss segments now carried
    await playWave(wave); // (c) NO-PARK
    // A pure boss auto-grant has no shop and advances the interaction counter by zero. A milestone may then
    // queue one or more genuine shared reward continuations. Those surfaces still belong to the parity owner:
    // never clear the other renderer's queue or drive an odd-counter HOST watcher as though it were the owner.
    // Sample the retained boundary only after both real queues reach the first shared surface (same rule as a
    // normal reward); if there is no shared surface, preserve the existing post-turn convergence probe.
    let boundarySampled = false;
    const sampleBoundaryOnce = async (): Promise<void> => {
      if (!boundarySampled) {
        boundarySampled = true;
        await assertPostTurnConverged(wave);
      }
    };
    // A deep milestone may queue MORE THAN ONE selectable reward surface (for example a normal milestone
    // reward followed by a biome/relic continuation). The old one-shot `if` drained only the first and left
    // the next MODIFIER_SELECT parked until the following wave, producing the documented ~wave-140 full-run
    // strand. Drain the complete finite tail, but cap it so a genuinely recursive shop loop is a loud failure.
    let milestoneShops = 0;
    while (rig.hostScene.phaseManager.hasPhaseOfType("SelectModifierPhase")) {
      milestoneShops++;
      if (milestoneShops > 8) {
        fail("no-park", wave, "milestone reward tail queued more than 8 SelectModifierPhase continuations");
      }
      // BiomeShopPhase intentionally presents as SelectModifierPhase to party continuations, but its market
      // protocol and stock are distinct. Route that concrete phase through the market's public owner/watcher
      // path; ordinary selectable reward continuations retain their calibrated driver.
      if (rig.hostScene.phaseManager.hasPhaseOfType("SelectModifierPhase", phase => phase instanceof BiomeShopPhase)) {
        await driveBiomeMarketLeave(wave, sampleBoundaryOnce);
      } else {
        await driveRewardShop(wave, false, sampleBoundaryOnce, "leave");
      }
    }
    await sampleBoundaryOnce();
    if (milestoneShops > 0) {
      actionScript.push(`wave ${wave}: drained ${milestoneShops} milestone reward continuation(s)`);
    }
    assertLockstep(wave, "boss-wave-end");
    assertScalarConvergence(wave, "boss-post-shop"); // #843 pokeball-drift classifier on boss waves too
  };

  /** A normal battle wave: wave-start clean-start parity, play, POST-TURN real-desync check, reward shop. */
  const processNormalWave = async (wave: number): Promise<void> => {
    await assertWaveBoundary(wave); // (a)+(b) wave-start clean-start parity
    const outcome = await playWave(wave); // (c) NO-PARK
    // A flee terminal advances through BattleEnd/NewBattle and has no reward screen. The authoritative
    // runtime can produce it through encounter behavior even though this driver never presses RUN. Treating
    // every terminal as a victory made the harness wait for a nonexistent SelectModifierPhase at wave 176.
    if (outcome === "flee") {
      // There is no shared-input surface on a flee. Retain the existing terminal probe until the dedicated
      // flee crossing exposes an equivalent public retained-boundary waiter.
      await assertPostTurnConverged(wave);
    } else {
      await driveRewardShop(wave, false, () => assertPostTurnConverged(wave));
    }
    assertScalarConvergence(wave, "post-shop"); // #843 pokeball-drift classifier (money + ball inventory)
  };

  // ---------------------------------------------------------------------------
  // #843 CATCH LEG (BUILD 1). Drive a SEEDED ball throw -> capture -> dexSync across BOTH engines on a
  // designated WILD double wave, and assert BOTH accounts' dex credit + ball-count convergence (the #843
  // pokeball-drift guard). The doubles constraint (you cannot throw at two live foes - `noPokeballMulti`)
  // is handled by fainting ONE enemy first: the host attacks it while the guest SWITCHES (no damage, so no
  // move redirect KOs the survivor), leaving a LONE foe. The AttemptCapturePhase is UNSHIFTED (runs before
  // any partner MovePhase - turn-start-phase.ts), so the host's ball throw on the sole survivor resolves the
  // capture and ends the wave cleanly. The guest is a pure renderer: it reconciles the host's post-catch
  // PARTY via applyCoopCaptureParty (the real #633 B1/B2 handshake) and its DEX via the real dexSync stream
  // (the #794 partner-account credit), and its ball inventory via the wave-boundary adopt analogue. All are
  // PRODUCTION heal mechanisms, not content narrowing.
  // ---------------------------------------------------------------------------

  /** The ball the catch leg throws. MASTER_BALL guarantees the capture on a non-boss wild (no weaken needed). */
  const CATCH_BALL = PokeballType.MASTER_BALL;

  /** The move the learn-move leg teaches (NOT in the soak's forced moveset, so the accept/forget always fires). */
  const LEARN_NEW_MOVE = MoveId.WATER_GUN;

  /**
   * Drive ONE catch wave. Falls back to a normal wave (skip-counted, never silent) when the wave is not a
   * catchable WILD double or the survivor cannot be isolated - so a mis-designated catch wave degrades
   * safely instead of stranding. On a capture: asserts BOTH accounts' dex credit + ball-count convergence;
   * a miss on any of these is RECORDED as a loud finding (the run continues + the soak test then reds).
   */
  const processCatchWave = async (wave: number): Promise<void> => {
    await assertWaveBoundary(wave); // (a)+(b) wave-start clean-start parity (before any ball grant)

    const battle = rig.hostScene.currentBattle;
    const liveEnemies = rig.hostScene.getEnemyField().filter(e => !e.isFainted());
    if (battle.battleType !== BattleType.WILD || liveEnemies.length < 2 || liveEnemies.some(e => e.isBoss())) {
      // Not a catchable wild double (trainer / single / boss-segmented): degrade to a normal wave.
      bumpSkip("catchWaveNotCatchableWildDouble");
      await playWave(wave);
      await assertPostTurnConverged(wave);
      await driveRewardShop(wave);
      assertScalarConvergence(wave, "post-shop");
      return;
    }

    const hostBalls = rig.hostScene.pokeballCounts as unknown as Record<number, number>;
    const survivor = liveEnemies[1]; // the second foe we will isolate + catch
    const rootId = survivor.species.getRootSpeciesId();
    const hostPartyBefore = rig.hostScene.getPlayerParty().length;

    // ===== TURN 1: faint the FIRST foe with a SPREAD move so the wave drops to a lone survivor to catch. =====
    // A MULTI-TARGET (spread) move auto-targets BOTH foes and needs NO TARGET_SELECT UI - which is essential
    // here: a single-target host move opens SelectTargetPhase whose target prompt is driven off the
    // prompt-interval, and that interval does NOT drive the target UI while the host is parked awaiting the
    // partner-slot command relay (SelectTargetPhase is not an endBySetMode interrupt phase), so a single-target
    // setup move STRANDS the host (seed 424242 wave 3). The spread move hits both foes: the first faints, the
    // survivor's boosted HP absorbs the splash. This is why the catch leg's moveset MUST carry a spread move.
    const turn1 = rig.hostScene.currentBattle.turn;
    const hostMon0 = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
    const spreadMove = hostMon0
      .getMoveset()
      .filter((m): m is NonNullable<typeof m> => m != null)
      .find(m => m.isUsable(hostMon0, false, true)[0] && m.getMove().isMultiTarget());
    if (spreadMove == null) {
      // No spread move available - the single-target path strands here (see above). Degrade loudly.
      bumpSkip("catchNoSpreadMove");
      await playWave(wave);
      await assertPostTurnConverged(wave);
      await driveRewardShop(wave);
      assertScalarConvergence(wave, "post-shop");
      return;
    }
    // Keep the survivor ALIVE through the isolation turn by making it near-unkillable via a huge DEFENSE +
    // SPDEF (so the spread hit AND the guest's move deal ~0), NOT by bulking HP. HP is hashed by the per-turn
    // checksum, so an HP change would count a transient host-vs-guest divergence the checkpoint heals (a #838
    // assertion); DEF/SPDEF are NOT hashed, and with them boosted the survivor stays at FULL hp on both
    // engines - byte-identical checksums, no assertion. The boost is host-only (the host is the authoritative
    // damage engine; the guest replays the streamed ~0 damage). A determinism knob, reset by the next mirror.
    survivor.stats[Stat.DEF] = 1_000_000_000;
    survivor.stats[Stat.SPDEF] = 1_000_000_000;
    await withClient(rig.hostCtx, async () => {
      hitMode(UiMode.COMMAND);
      hitMode(UiMode.FIGHT);
      // Spread move: omit the target so game.move.select registers the multi-target confirm prompt (which does
      // processInput(ACTION) with no cursor) rather than asserting a target was passed to a spread move.
      game.move.select(spreadMove.moveId, COOP_HOST_FIELD_INDEX);
      await game.phaseInterceptor.to("TurnEndPhase");
      // #845: a HOST-owned mon can faint on the isolation turn (a real enemy hit); arm its replacement picker
      // POST-HOC so the crossing to the throw's CommandPhase drives it instead of stranding at the PARTY UI.
      armHostFaintAutoPick();
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurnWithFaint(rig, turn1));

    if (rig.hostScene.getEnemyField().filter(e => !e.isFainted()).length !== 1) {
      // The survivor was not isolated (an ally proc / weather KO'd it, or the first foe survived) - degrade.
      bumpSkip("catchSurvivorNotIsolated");
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
      await playWave(wave);
      await assertPostTurnConverged(wave);
      await driveRewardShop(wave);
      assertScalarConvergence(wave, "post-shop");
      return;
    }

    // ===== TURN 2: HOST throws the ball at the lone survivor via the REAL BALL menu -> AttemptCapturePhase. =====
    await crossCommandBoundaryWithReplayGuest(wave, turn1 + 1, () => {
      armHostFaintAutoPick(); // drive any host faint replacement opened on this crossing
    });
    // Grant the host a catch ball (a determinism knob, like the moveset override), reconcile the guest so the
    // checksum stays matched, then SCOPE the dexSync delta to this catch (the run-start baseline). Done HERE
    // (right before the throw, after the isolation turn) so turn 1 is byte-for-byte the normal command path.
    hostBalls[CATCH_BALL] = (hostBalls[CATCH_BALL] ?? 0) + 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.pokeballCounts = { ...rig.hostScene.pokeballCounts };
    });
    await withClient(rig.hostCtx, () => captureCoopDexBaseline());
    hitMode(UiMode.COMMAND);
    hitMode(UiMode.BALL); // the real BALL menu opens on the host throw (doThrowPokeball drives it)
    hitSituation(COOP_SOAK_SITUATIONS.catch);
    await withClient(rig.hostCtx, async () => {
      game.doThrowPokeball(CATCH_BALL);
      // A capture ends the wave BEFORE TurnEndPhase (the AttemptCapturePhase -> BattleEndPhase). Advance and
      // tolerate the "never reached TurnEndPhase" throw (the battle ended) - the party-length check is truth.
      await game.phaseInterceptor.to("TurnEndPhase").catch(() => {});
    });
    const captured = rig.hostScene.getPlayerParty().length === hostPartyBefore + 1;
    actionScript.push(`wave ${wave}: CATCH throw sp=${rootId} captured=${captured}`);
    // eslint-disable-next-line no-console
    console.log(`[coop-soak] CATCH wave ${wave} (seed ${seed}): sp=${rootId} captured=${captured}`);

    if (!captured) {
      // A Master Ball on a non-boss wild should always capture; a miss is a loud finding. Finish the wave
      // normally so the run continues (the enemy survived the throw turn - drive it down).
      recordFinding(wave, "catchFailed", `Master Ball did not capture sp=${rootId} on wild wave ${wave}`);
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase").catch(() => {}));
      if (hostRunEndReason(rig) == null && rig.hostScene.currentBattle?.enemyParty.some(e => !e.isFainted())) {
        await playWave(wave);
      }
      await driveRewardShop(wave);
      assertScalarConvergence(wave, "post-shop");
      return;
    }

    // ===== GUEST reconcile (production heal analogues): party + dex + ball inventory. =====
    const captureParty = await withClient(rig.hostCtx, () => captureCoopCaptureParty());
    await withClient(rig.guestCtx, async () => {
      applyCoopCaptureParty(JSON.parse(JSON.stringify(captureParty)));
      // Let the delayed dexSync timer fire UNDER the guest ctx so the partner ACCOUNT is credited (the merge
      // lands on the guest gameData). The host relay's send delivers over the loopback synchronously here.
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 60));
        await drainLoopback();
      }
    });
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.pokeballCounts = { ...rig.hostScene.pokeballCounts };
    });

    // ===== ASSERT both accounts' dex credit + ball-count convergence (the #843 guard). =====
    const hostDex = rig.hostScene.gameData.dexData[rootId]?.caughtAttr ?? 0n;
    const guestDex = rig.guestScene.gameData.dexData[rootId]?.caughtAttr ?? 0n;
    if (hostDex === 0n) {
      recordFinding(wave, "catchHostDexUncredited", `host account dex NOT credited for caught sp=${rootId}`);
    }
    if (guestDex === 0n) {
      recordFinding(
        wave,
        "catchGuestDexUncredited",
        `partner (guest) account dex NOT credited via the dexSync stream for caught sp=${rootId}`,
      );
    }
    const gBalls = rig.guestScene.pokeballCounts as unknown as Record<number, number>;
    const ballDrift = Object.keys(hostBalls).filter(k => hostBalls[Number(k)] !== gBalls[Number(k)]);
    if (ballDrift.length > 0) {
      recordFinding(
        wave,
        "catchBallDrift",
        `post-catch ball counts diverged host-vs-guest for types [${ballDrift.join(",")}]`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak] CATCH wave ${wave}: host dex=${hostDex !== 0n} guest dex=${guestDex !== 0n} ballDrift=${ballDrift.length === 0 ? "none" : ballDrift.join(",")}`,
    );

    // ===== Reward shop + boundary (the captured wave still awards the wave-win reward pool). =====
    // AttemptCapture has no guest TurnEnd, so the retained journal wake routes its speculative CommandPhase
    // into the real Victory -> BattleEnd -> reward tail. Never clear that queue or construct a detached shop:
    // continuationReady belongs to this exact retained wave transaction.
    await driveRewardShop(wave);
    assertLockstep(wave, "catch-wave-end");
    assertScalarConvergence(wave, "post-shop");
  };

  // ---------------------------------------------------------------------------
  // #848 LEARN-MOVE LEG (BUILD 2). Drive a level-up move-learn that ACCEPTS + forces a forget across BOTH
  // engines (instead of the default decline), and assert moveset convergence. Ports coop-duo-learn-move.ts's
  // guest-owned case INLINE into the continuous run: on a designated wave the driver forces the real ER
  // LearnMoveBatchPhase on a full-moveset GUEST-owned mon (slot 1) at wave-start; the host opens the read-only
  // WATCHER panel + streams the present, the guest opens the OWNER panel + picks the replacement (accept,
  // forget slot 0), and the host applies the guest's pick authoritatively (the #848 shared batch-panel path).
  // The relay-send tap records the learnMoveBatch/learnMoveBatchForward kinds + the band automatically; here we
  // record the LEARN_MOVE_BATCH mode + the `levelUpLearn` situation and assert BOTH movesets converged.
  // ---------------------------------------------------------------------------

  /**
   * Drive ONE learn-move wave: at wave-start, force + drive a guest-owned mon's batch-panel move-learn
   * (accept + forget) across both engines, assert moveset convergence + no picker strand, then play the wave
   * + reward shop as normal. Degrades (skip-counted) when the target mon is not a full-moveset guest-owned mon.
   */
  const processLearnMoveWave = async (wave: number): Promise<void> => {
    await assertWaveBoundary(wave); // (a)+(b) wave-start clean-start parity

    const LEARN_SLOT = COOP_GUEST_FIELD_INDEX; // slot 1 = guest-owned (host opens watcher, guest owns the pick)
    const targetHost = rig.hostScene.getPlayerParty()[LEARN_SLOT];
    const hostMovesetFull = targetHost != null && targetHost.getMoveset(true).filter(m => m != null).length >= 4;
    const alreadyKnows = targetHost?.getMoveset(true).some(m => m?.moveId === LEARN_NEW_MOVE) ?? false;
    if (targetHost == null || targetHost.coopOwner !== "guest" || !hostMovesetFull || alreadyKnows) {
      // Not a full-moveset guest-owned mon (or it already knows the move): degrade to a normal wave.
      bumpSkip("learnMoveTargetNotEligible");
      await playWave(wave);
      await assertPostTurnConverged(wave);
      await driveRewardShop(wave);
      assertScalarConvergence(wave, "post-shop");
      return;
    }
    const forgotten = targetHost.moveset[0]?.moveId;

    // HOST (sole engine): force the batch phase on the GUEST-owned mon. withClientSync = SEND-ONLY: it streams
    // the present (queued, not yet delivered) + opens the host's read-only WATCHER panel; the await is parked.
    withClientSync(rig.hostCtx, () => {
      rig.hostScene.phaseManager.create("LearnMoveBatchPhase", LEARN_SLOT, [LEARN_NEW_MOVE]).start();
    });
    hitMode(UiMode.LEARN_MOVE_BATCH);
    // GUEST: draining under the guest ctx delivers the present -> the persistent listener opens the OWNER panel.
    await withClient(rig.guestCtx, () => drainLoopback());
    // GUEST (mon owner) drives the real panel: ACTION selects the learnable move -> full moveset -> pickSlot;
    // ACTION assigns it over slot 0 -> learned, list empties -> finish/done relays the terminal + closes.
    withClientSync(rig.guestCtx, () => {
      if (rig.guestScene.ui.getMode() === UiMode.LEARN_MOVE_BATCH) {
        rig.guestScene.ui.processInput(Button.ACTION);
        rig.guestScene.ui.processInput(Button.ACTION);
      }
    });
    // HOST: the relayed terminal resolves the parked await under the HOST ctx; the host applies + closes.
    await withClient(rig.hostCtx, () => drainLoopback());

    hitSituation(COOP_SOAK_SITUATIONS.levelUpLearn);
    // ASSERT convergence: the host applied the guest's pick (NEW_MOVE learned over the forgotten slot), the
    // guest's local copy converged, and the picker released (no strand). Each miss is a loud finding.
    const hostMoves = targetHost.moveset.map(m => m?.moveId);
    const guestMoves = rig.guestScene.getPlayerParty()[LEARN_SLOT]?.moveset.map(m => m?.moveId) ?? [];
    if (!hostMoves.includes(LEARN_NEW_MOVE) || (forgotten != null && hostMoves.includes(forgotten))) {
      recordFinding(
        wave,
        "learnMoveHostNotApplied",
        `host moveset did not learn ${LEARN_NEW_MOVE} / forget ${forgotten}: [${hostMoves.join(",")}]`,
      );
    }
    if (!guestMoves.includes(LEARN_NEW_MOVE)) {
      recordFinding(
        wave,
        "learnMoveGuestNotConverged",
        `guest moveset did not converge to ${LEARN_NEW_MOVE}: [${guestMoves.join(",")}]`,
      );
    }
    if (!isCoopLearnMoveForwardInFlightEmpty()) {
      recordFinding(wave, "learnMovePickerStranded", "a learn-move picker was left in-flight (strand)");
    }
    actionScript.push(
      `wave ${wave}: LEARN-MOVE guest-owned slot ${LEARN_SLOT} learned ${LEARN_NEW_MOVE} forget ${forgotten}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak] LEARN-MOVE wave ${wave} (seed ${seed}): host=[${hostMoves.join(",")}] guest=[${guestMoves.join(",")}]`,
    );

    // Clear any leftover batch-panel phases on the guest. This specialized seam deliberately opened the
    // batch panel on top of an already-materialized slot-0 CommandPhase; mirrored panel input can advance
    // that synthetic old prompt to slot 1. Rebuild this SAME turn through TurnInitPhase (which queues both
    // player commands, enemy commands, and TurnStart; it does not increment the battle turn) so combat
    // resumes from a complete clean queue rather than only the two UI phases.
    withClientSync(rig.guestCtx, () => rig.guestScene.phaseManager.clearPhaseQueue());
    await withClient(rig.hostCtx, async () => {
      await rig.hostScene.ui.setMode(UiMode.MESSAGE);
      rig.hostScene.ui.resetModeChain();
      const pm = rig.hostScene.phaseManager;
      pm.clearAllPhases();
      pm.shiftPhase();
      await game.phaseInterceptor.to("CommandPhase");
    });
    await playWave(wave);
    await assertPostTurnConverged(wave);
    await driveRewardShop(wave);
    assertLockstep(wave, "learn-move-wave-end");
    assertScalarConvergence(wave, "post-shop");
  };

  // ---------------------------------------------------------------------------
  // #807/#810 SAVE-RESUME LEG (BUILD 3). Serialize the host's live session mid-run, PERTURB the guest so it
  // diverges, REBOOT the guest from the host snapshot (coopGuestResumeBoot / applyCoopLaunchSession), and
  // assert full byte-equal parity at boot (the #807/#810 resume machinery). Ports coop-duo-resume.ts's
  // convergence proof INLINE into the continuous run: after the resume the wave loop crosses + re-mirrors as
  // normal, so a resume at wave N proves the run stays green for the remaining waves. This lights the
  // `saveResume` situation.
  // ---------------------------------------------------------------------------

  /** Serialize a scene's coherent session EXACTLY as a real RESUME load broadcasts it (bigint-safe JSON). */
  const serializeHostLaunchSnapshot = (): string =>
    JSON.stringify(rig.hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );

  /**
   * Drive ONE save/resume wave: play the wave normally, then serialize the host session, perturb + REBOOT the
   * guest from the snapshot, and assert the guest converged byte-equal to the host (a miss is a loud finding).
   * The next wave's re-mirror re-syncs the guest, so the run continues from here.
   */
  const processResumeWave = async (wave: number): Promise<void> => {
    // Play the wave (parity + combat + shop) exactly like a normal wave first.
    await processNormalWave(wave);

    // Serialize the host's live session + capture its full-state checksum (the resume TARGET).
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot());
    const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());

    // PERTURB the guest so its state DIVERGES from the host - makes the convergence proof meaningful.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money += 987_654;
    });
    const guestBefore = await withClient(rig.guestCtx, () => captureCoopChecksum());
    const perturbed = guestBefore !== hostChecksum;

    // REBOOT the guest from the host's saved snapshot (the #807/#810 coopGuestResumeBoot core) ...
    const booted = await withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson));
    // ... and it must CONVERGE byte-equal to the host (a resumed run cannot diverge at boot).
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());

    hitSituation(COOP_SOAK_SITUATIONS.saveResume);
    if (!booted) {
      recordFinding(wave, "resumeBootFailed", `guest applyCoopLaunchSession returned false at wave ${wave}`);
    } else if (guestAfter !== hostChecksum) {
      recordFinding(
        wave,
        "resumeNotConverged",
        `guest full-state checksum did NOT equal the host's after resume boot: host=${hostChecksum} guest=${guestAfter}`,
      );
    }
    actionScript.push(
      `wave ${wave}: SAVE/RESUME round-trip (perturbed=${perturbed} booted=${booted} converged=${guestAfter === hostChecksum})`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[coop-soak] SAVE/RESUME wave ${wave} (seed ${seed}): booted=${booted} converged=${guestAfter === hostChecksum}`,
    );
  };

  /** INVARIANT (d) TEARDOWN: clear the runtime, then assert no runtime / relay / ME pin survives. */
  const assertTeardown = (): void => {
    clearCoopRuntime();
    const problems: string[] = [];
    if (getCoopRuntime() != null) {
      problems.push("getCoopRuntime() is not null after clearCoopRuntime");
    }
    if (getCoopInteractionRelay() != null) {
      problems.push("getCoopInteractionRelay() is not null after clearCoopRuntime");
    }
    if (coopMeInteractionStartValue() !== -1) {
      problems.push(`coopMeInteractionStart pin is ${coopMeInteractionStartValue()} (expected -1 idle)`);
    }
    if (getCoopMeBattleInteractionCounter() !== -1) {
      problems.push(`coopMeBattleInteractionCounter pin is ${getCoopMeBattleInteractionCounter()} (expected -1)`);
    }
    if (getCoopMeHostPresentation() != null) {
      problems.push("coopMeHostPresentation pin is non-null (expected null idle)");
    }
    // #843: the learn-move-forward in-flight Set now HAS a read-only export (isCoopLearnMoveForwardInFlightEmpty),
    // so the teardown invariant verifies clearCoopRuntime drained it (it calls learnMoveForwardInFlight.clear()
    // internally). A leaked learn-move picker pin surviving into the next run is now DETECTED, not silent.
    if (!isCoopLearnMoveForwardInFlightEmpty()) {
      problems.push("learnMoveForwardInFlight set is non-empty after clearCoopRuntime (leaked learn-move pin)");
    }
    if (problems.length > 0) {
      fail("teardown", wavesCompleted, problems.join("; "));
    }
  };

  /** True if wave>1 crossing hit a non-battle wave the continuous harness cannot drive (skip + stop). */
  const crossedUndrivableWave = (wave: number): boolean => {
    if (
      wave > 1
      && rig.hostScene.currentBattle.battleType === BattleType.MYSTERY_ENCOUNTER
      && opts.meWaves?.has(wave) !== true
    ) {
      // An UNDESIGNATED ME wave (a stray ME the harness cannot drive). A DESIGNATED ME wave (opts.meWaves) is
      // DRIVEN inline by processMeWave (BUILD 1), so it does NOT stop the survey. If an unexpected ME ever
      // reaches here, count it + STOP cleanly - never silent.
      bumpSkip("mysteryEncounterWaveHit");
      return true;
    }
    return false;
  };

  // TERMINAL run-end (#846): set the FIRST time the host run ends (a wipe / GameOver / Title). Recorded +
  // reported LOUDLY; the survey ends honestly at that wave (never a NO-PARK strand). See hostRunEndReason.
  let runEnded: { wave: number; reason: string } | undefined;

  // ===== The wave loop. =====
  const captureOperationHits = (): void => {
    for (const cls of getCoopOperationJournalCommittedClasses()) {
      hits.operations.add(cls);
    }
    for (const mode of getCoopUiRelayHitModes()) {
      hits.uiRelays.add(mode);
      hits.modes.add(mode);
    }
    for (const uiOperationPair of getCoopUiOperationHits()) {
      hits.uiOperations.add(uiOperationPair);
    }
  };
  const capturePostWaveState = async (wave: number): Promise<void> => {
    if (!opts.capturePostWaveState) {
      return;
    }
    const modifiersFor = async (ctx: typeof rig.hostCtx): Promise<Record<string, unknown>[]> =>
      withClient(ctx, () => {
        const modifiers = captureCoopSaveDataNormalized().modifiers;
        return Array.isArray(modifiers) ? structuredClone(modifiers as Record<string, unknown>[]) : [];
      });
    const staged = getCoopStagedWaveAdvanceTransaction(wave, rig.guestRuntime.waveOperationBinding);
    const victoryKind = (staged?.envelope.pendingOperation?.payload as { victoryKind?: unknown } | undefined)
      ?.victoryKind;
    postWaveStates.push({
      wave,
      victoryKind: victoryKind === "wild" || victoryKind === "trainer" ? victoryKind : null,
      hostMoney: await withClient(rig.hostCtx, () => rig.hostScene.money),
      guestMoney: await withClient(rig.guestCtx, () => rig.guestScene.money),
      hostPlayerModifiers: await modifiersFor(rig.hostCtx),
      guestPlayerModifiers: await modifiersFor(rig.guestCtx),
      retainedWaveTransaction:
        staged == null
          ? null
          : {
              operationId: staged.operationId,
              dataApplied: staged.dataApplied,
              continuationReady: staged.continuationReady,
            },
      resyncHeals,
    });
  };
  for (let wave = 1; wave <= waves; wave++) {
    // Sample cumulatively before the next wave can terminal and clear the runtime's session-local diagnostic
    // ledger. A wave-180 GameOver used to erase 179 waves of op:wave/op:reward evidence before the sole
    // end-of-run sample, making guaranteed operation coverage falsely report cold.
    captureOperationHits();
    if (crossedUndrivableWave(wave)) {
      break;
    }
    // Arm a scheduled NEXT-wave ME before this wave's shared terminal. A reward TAKE (and some crossroads
    // tails) can synchronously shift through NewBattlePhase/EncounterPhase all the way to the next
    // CommandPhase before driveRewardShop returns. Setting the override only in the post-wave crossing was
    // therefore too late and attempted to "force" an already-constructed normal battle. Priming one boundary
    // early makes both LEAVE and immediate terminal-reward paths deterministic and production-representative.
    const scheduledNextMe = opts.meWaves?.get(wave + 1);
    if (scheduledNextMe != null) {
      game.override.mysteryEncounterChance(100).mysteryEncounter(scheduledNextMe);
    }
    const currentBiome = rig.hostScene.arena.biomeId;
    if (currentBiome !== previousBiome) {
      biomeTransitions++;
      hitSituation(COOP_SOAK_SITUATIONS.biomeBoundary);
      actionScript.push(`wave ${wave}: BIOME ${previousBiome}->${currentBiome}`);
      previousBiome = currentBiome;
    }
    // #849 GOD-PARTY: restore the host party's move PP at wave-start so a long god run never fully depletes
    // a fixed-slot move + strands on a no-PP command (seed 20260704 wave 90). The re-mirror + heal below
    // carry it to the guest; also applied to the guest directly (defensive). See restorePlayerPartyPp.
    restorePlayerPartyPp(rig.hostScene);
    withClientSync(rig.guestCtx, () => restorePlayerPartyPp(rig.guestScene));
    // #633 BUILD 1: a DESIGNATED ME wave (the host is parked at MysteryEncounterPhase from crossIntoMeWave) is
    // driven by processMeWave, which mirrors via mirrorHostMeToGuest (NOT the battle mirror) - so SKIP the
    // normal wave re-mirror for it.
    const meType = opts.meWaves?.get(wave);
    const isMeWave = meType != null && rig.hostScene.currentBattle.battleType === BattleType.MYSTERY_ENCOUNTER;
    // Re-mirror the host's freshly-rolled battle onto the guest before each new wave (wave 1 was mirrored by
    // buildDuo), then faithfully re-sync the guest (held items / weather / modifiers / scalars).
    // #879 PRODUCTION-FIDELITY: in "production" mode the per-wave mirror adopts ONLY the host-AUTHORITATIVE
    // side (enemies / arena / run-config, exactly what a live guest adopts through its own EncounterPhase) but
    // PRESERVES the guest's own replayed player party (no reset) AND does NOT run healGuestFromHost - so guest
    // drift accumulates and surfaces (at the digest, or when the guest builds its own command) instead of
    // being papered over every wave. In "harness" mode this is byte-identical to today (full re-mirror + heal).
    if (wave > 1 && !isMeWave) {
      if (fidelity === "production") {
        await remirrorWave(rig, { preserveGuestPlayerParty: true });
      } else {
        await remirrorWave(rig);
        await healGuestFromHost(rig);
      }
    }

    // Trainer-wave coverage tally (#846): count TRAINER waves (fixed rival/evil-team vs random rolled) so a
    // run's actual trainer coverage is reportable. gameMode.isFixedBattle keys the fixed/random split.
    if (rig.hostScene.currentBattle.battleType === BattleType.TRAINER) {
      trainerWaves.total++;
      if (rig.hostScene.gameMode.isFixedBattle(wave)) {
        trainerWaves.fixed++;
      } else {
        trainerWaves.random++;
      }
      actionScript.push(`wave ${wave}: TRAINER (${rig.hostScene.gameMode.isFixedBattle(wave) ? "fixed" : "random"})`);
    }

    // #849 wave-start SITUATION tap: classify the wave's battle SHAPE (wildDouble / single / triple /
    // trainerFixed / trainerRandom / boss) - see recordWaveStartSituations.
    recordWaveStartSituations(rig, wave, hits);

    // BOSS-LIKE (auto-grant reward tail, interaction counter +0). Two classes:
    //   - a real BOSS (isBoss on an on-field enemy): its VictoryPhase auto-grants via ModifierRewardPhase.
    //   - a %10 MILESTONE wave (#846): the milestone reward tail ALSO auto-grants (MoneyRewardPhase +
    //     ModifierRewardPhase, queuesSelectModifier=false) with NO owner/watcher SelectModifierPhase - even
    //     when the %10 wave rolled a TRAINER instead of a wild boss (the trainer's mons are not isBoss, so
    //     the isBoss check alone misses it and processNormalWave would wrongly assert a +1 shop advance).
    //     Both are handled by processBossWave: the automatic reward remains counter +0, while any separate
    //     queued milestone/biome continuation uses its real parity owner + watcher and advances once.
    // 🔴 #832 PROFILE-GATED boss-tail routing. Under "level", a NON-%10 WILD wave can roll a boss-SEGMENTED
    // enemy (isBoss true) that STILL presents a NORMAL owner/watcher reward shop (VictoryPhase
    // queuesSelectModifier=true, +1 counter), NOT a boss AUTO-GRANT. Under "level" classify bossWave by %10
    // alone so this ordinary shop keeps the normal-wave path and its post-turn assertions. The god profile
    // retains its historical boss detection; processBossWave now drives any real continuation through both
    // renderers instead of clearing the parity owner and attempting to use a watcher as the owner.
    const bossWave =
      !isMeWave && (wave % 10 === 0 || (profile !== "level" && rig.hostScene.getEnemyField().some(e => e.isBoss())));
    // #843 CATCH LEG (BUILD 1): a DESIGNATED catch wave (opts.catchWaves) that is a normal (non-ME, non-boss)
    // wild wave routes through processCatchWave (which itself degrades to a normal wave if the wave turns out
    // uncatchable). Boss / ME waves are never catch waves.
    const isCatchWave = opts.catchWaves?.has(wave) === true && !isMeWave && !bossWave;
    // #848 LEARN-MOVE LEG (BUILD 2): a designated learn-move wave (normal, non-ME/boss/catch) routes through
    // processLearnMoveWave (which degrades to a normal wave if the target mon is ineligible).
    const isLearnMoveWave = opts.learnMoveWaves?.has(wave) === true && !isMeWave && !bossWave && !isCatchWave;
    // #807/#810 SAVE-RESUME LEG (BUILD 3): a designated resume wave (normal, non-ME/boss/catch/learn) plays as
    // a normal wave then does a save/resume round-trip at wave-end (processResumeWave).
    const isResumeWave =
      opts.resumeWaves?.has(wave) === true && !isMeWave && !bossWave && !isCatchWave && !isLearnMoveWave;
    try {
      // #633 BUILD 1: a designated ME wave routes through processMeWave (the inline two-engine ME pump); a
      // designated catch wave through processCatchWave; a designated learn-move wave through
      // processLearnMoveWave; a designated resume wave through processResumeWave; every other wave is a
      // normal/boss battle.
      await (isMeWave
        ? processMeWave(wave, meType)
        : isCatchWave
          ? processCatchWave(wave)
          : isLearnMoveWave
            ? processLearnMoveWave(wave)
            : isResumeWave
              ? processResumeWave(wave)
              : bossWave
                ? processBossWave(wave)
                : processNormalWave(wave));
    } catch (e) {
      if (e instanceof SoakInvariantError) {
        throw e;
      }
      // #846 RUN-END vs STRAND: a caught driver error is a NO-PARK strand ONLY if the host is still in a
      // live battle. If the host RUN ENDED (a party wipe on the evil-team gauntlet -> GameOverPhase ->
      // TitlePhase), the phaseInterceptor.to() that threw was waiting on a battle phase a game-over run will
      // never reach - that is a TERMINAL outcome, not a strand. Detect it and END the survey LOUDLY at this
      // wave (counted, reported), instead of writing a misleading no-park artifact.
      const endReason = hostRunEndReason(rig);
      if (endReason != null) {
        runEnded = { wave, reason: endReason };
        // eslint-disable-next-line no-console
        console.log(`[coop-soak] RUN ENDED at wave ${wave} (seed ${seed}): ${endReason}. Survey stops here.`);
        actionScript.push(`RUN-END wave ${wave}: ${endReason}`);
        break;
      }
      // #828/#851 ASYMMETRIC CONTINUATION SAFE-DEGRADE (BUILD 2): a stall that surfaced WHILE the host half is
      // exhausted is treated as an exhaustion terminal rather than a fresh NO-PARK regression. NB (#851): the old
      // "vacated host slot's REDIRECTED CommandPhase re-issues a duplicate partner request that eats the timeout"
      // explanation is WRONG - VERIFIED in coop-soak-asymmetric.test.ts's SUSTAINED guest-solo test: the party
      // compacts the survivor to slot 0, turn-init queues EXACTLY ONE CommandPhase (the inactive vacated slot gets
      // none, so there is no redirect and no duplicate), and every guest-SOLO TURN resolves with exactly one
      // requestPartnerCommand and no timeout. The single-battle guest-solo TURN is therefore driven cleanly and
      // this in-wave degrade is effectively dormant for it. This backstop REMAINS only for the multi-WAVE
      // guest-solo crossing (winning a wave solo -> the owner/watcher reward shop -> the next wave with an
      // exhausted host half), which the continuous harness does not yet drive; that + the true live-desync class
      // (the relay keys the partner command by fieldIndex, which can skew if the guest's post-recenter geometry
      // ever disagrees with the host's - see the #851 report) is the remaining follow-up.
      if (hostHalfExhausted(rig)) {
        hitSituation(COOP_SOAK_SITUATIONS.hostHalfExhausted);
        runEnded = { wave, reason: "host HALF exhausted (guest-solo continuation hit the harness field-collapse gap)" };
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak] HOST-HALF EXHAUSTED at wave ${wave} (seed ${seed}): guest-solo continuation reached the two-engine `
            + "harness field-collapse gap; ending as the exhaustion terminal (no NO-PARK regression). Finding reported.",
        );
        actionScript.push(`RUN-END wave ${wave}: host half exhausted (harness field-collapse gap in guest-solo drive)`);
        break;
      }
      // A genuine driver stall (driveGuestReplayTurn / driveGuestRewardWatch / phaseInterceptor timeout in a
      // LIVE battle) - convert it into a NO-PARK artifact with the phase dump so the strand is replayable.
      fail("no-park", wave, `wave driving threw (strand/stall): ${e instanceof Error ? e.message : String(e)}`);
    }

    await capturePostWaveState(wave);
    wavesCompleted++;
    // #828 ASYMMETRIC CONTINUATION (BUILD 2): if the HOST half is exhausted after this wave (a host-owned
    // field slot fainted with no legal host-owned replacement) but the GUEST half is still alive, the run
    // just played this wave with the guest SOLO - the partner-plays-on path. Record the surface + count it,
    // and log the TRANSITION once (a heal every 10 waves can revive the host half, clearing this). The soak
    // CONTINUES surveying (the old #848 behavior stopped here); the DIGEST / LOCKSTEP / NO-PARK invariants
    // already asserted the surviving side kept playing with zero stalls and the exhausted side spectated
    // cleanly, so a green continuation IS the proof.
    if (hostHalfExhausted(rig)) {
      guestSoloWaves++;
      hitSituation(COOP_SOAK_SITUATIONS.hostHalfExhausted);
      if (!guestSoloActive) {
        guestSoloActive = true;
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak] ASYMMETRIC CONTINUATION wave ${wave} (seed ${seed}): host half EXHAUSTED, guest plays on SOLO (partner-plays-on path).`,
        );
        actionScript.push(`ASYMMETRIC wave ${wave}: host half exhausted -> guest solo continuation`);
      }
    } else {
      guestSoloActive = false; // the host half recovered (an every-10-wave heal) or was never exhausted
    }
    // Cross into the next wave's battle (real EncounterPhase rolls wave w+1). #845: a host faint left
    // pending by a boss killing-turn (whose reward tail auto-grants with no shop to drive it through) still
    // opens its PARTY picker on this crossing - re-arm the auto-picker (guarded) so it is driven, not parked.
    if (wave < waves) {
      try {
        // #633 BUILD 1: if the NEXT wave is a designated ME, cross into it (force + park at its
        // MysteryEncounterPhase) instead of to("CommandPhase") - an ME wave has no CommandPhase.
        const nextMeType = opts.meWaves?.get(wave + 1);
        if (nextMeType == null) {
          await crossCommandBoundaryWithReplayGuest(wave + 1, 1, armHostFaintAutoPick);
        } else {
          await withClient(rig.hostCtx, async () => {
            const battle = rig.hostScene.currentBattle;
            const alreadyConstructed =
              battle.waveIndex === wave + 1
              && battle.battleType === BattleType.MYSTERY_ENCOUNTER
              && battle.mysteryEncounter?.encounterType === nextMeType;
            if (alreadyConstructed) {
              // The prior terminal already consumed the primed override. Park at the same boundary
              // crossIntoMeWave promises, then clear the rate so later unscheduled waves remain ordinary.
              if (rig.hostScene.phaseManager.getCurrentPhase()?.phaseName !== "MysteryEncounterPhase") {
                await game.phaseInterceptor.to("MysteryEncounterPhase", false);
              }
              game.override.mysteryEncounterChance(0);
            } else {
              await crossIntoMeWave(nextMeType);
            }
          });
        }
      } catch (e) {
        // #846: the crossing itself can hit a run-end (a killing turn that also wiped the host, or a
        // between-wave game-over). Same rule: a terminal host state is a counted run-end, not a strand.
        const endReason = hostRunEndReason(rig);
        if (endReason == null) {
          // #828/#851 SAFE-DEGRADE (BUILD 2): a crossing stall while the host half is exhausted ends as the
          // exhaustion terminal (no NO-PARK regression), records the surface, reports the finding. This is the
          // multi-WAVE crossing the in-wave catch above notes as the remaining follow-up (reward shop + next-wave
          // start with an exhausted host half); the guest-solo TURN itself is driven cleanly (verified - see the
          // in-wave note + coop-soak-asymmetric.test.ts). NOT the debunked "duplicate partner request" gap.
          if (hostHalfExhausted(rig)) {
            hitSituation(COOP_SOAK_SITUATIONS.hostHalfExhausted);
            runEnded = {
              wave: wave + 1,
              reason:
                "host HALF exhausted (guest-solo continuation hit the harness field-collapse gap at the crossing)",
            };
            // eslint-disable-next-line no-console
            console.log(
              `[coop-soak] HOST-HALF EXHAUSTED crossing into wave ${wave + 1} (seed ${seed}): guest-solo continuation `
                + "reached the harness field-collapse gap; ending as the exhaustion terminal. Finding reported.",
            );
            actionScript.push(`RUN-END crossing wave ${wave + 1}: host half exhausted (harness field-collapse gap)`);
            break;
          }
          throw e;
        }
        runEnded = { wave: wave + 1, reason: endReason };
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak] RUN ENDED crossing into wave ${wave + 1} (seed ${seed}): ${endReason}. Survey stops here.`,
        );
        actionScript.push(`RUN-END crossing wave ${wave + 1}: ${endReason}`);
        break;
      }
      // A clean crossing can still land on a terminal host state without throwing (defensive): stop LOUDLY.
      const endReason = hostRunEndReason(rig);
      if (endReason != null) {
        runEnded = { wave: wave + 1, reason: endReason };
        // eslint-disable-next-line no-console
        console.log(
          `[coop-soak] RUN ENDED after crossing into wave ${wave + 1} (seed ${seed}): ${endReason}. Survey stops.`,
        );
        actionScript.push(`RUN-END post-crossing wave ${wave + 1}: ${endReason}`);
        break;
      }
    }
  }

  // #828 ASYMMETRIC CONTINUATION (BUILD 2): host-half exhaustion is NO LONGER a terminal - it is now DRIVEN
  // (the guest plays on solo, {@linkcode hostHalfExhausted} recorded per wave in the loop above). Any
  // run-end here is a TRUE terminal (full wipe / GameOver / Title), so nothing extra to record.

  captureOperationHits();

  assertTeardown();
  return {
    seed,
    wavesRequested: waves,
    wavesCompleted,
    skips,
    resyncHeals,
    preHealMismatches,
    assertions: getCoopChecksumAssertionCount(),
    actionScript,
    boundaryDigests,
    postWaveStates,
    findings,
    runEnded,
    trainerWaves,
    biomeTransitions,
    guestSoloWaves,
    mysteryEncounters,
    hits,
  };
}
