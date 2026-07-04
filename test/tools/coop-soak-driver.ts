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
  applyCoopFieldSnapshot,
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopFieldSnapshot,
  captureCoopSaveDataDigest,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  clearCoopRuntime,
  getCoopInteractionRelay,
  getCoopMeBattleInteractionCounter,
  getCoopRuntime,
  isCoopLearnMoveForwardInFlightEmpty,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { getCoopMeHostPresentation } from "#phases/coop-replay-me-phase";
import { coopMeInteractionStartValue } from "#phases/mystery-encounter-phases";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import type { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoLogs,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  remirrorWave,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
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
// Result + option shapes.
// ---------------------------------------------------------------------------

/** A per-wave-boundary digest sample (recorded for the determinism contract cross-run compare, #842). */
export interface SoakBoundaryDigest {
  wave: number;
  hostChecksum: string;
  guestChecksum: string;
  hostSaveDigest: string;
  guestSaveDigest: string;
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

/** The outcome of a completed soak run (a passing run; a hard LOCKSTEP/NO-PARK/TEARDOWN breach THROWS). */
export interface SoakResult {
  seed: number;
  wavesRequested: number;
  wavesCompleted: number;
  /** Per-wave-type SKIP counters (each skip is logged, never silent). */
  skips: Record<string, number>;
  /** How many DIGEST one-heal graces fired (a converged run is 0). */
  resyncHeals: number;
  /** The action script (one line per decision) - also written into a failure artifact. */
  actionScript: string[];
  /** Per-boundary digest samples (for #842). */
  boundaryDigests: SoakBoundaryDigest[];
  /** REAL host-vs-guest desyncs the one-heal resync did not converge (the soak's findings; empty = clean). */
  findings: SoakFinding[];
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
   * Pin the run seed to this string on the host BEFORE the duo mirror (setSeed writes the seed field with
   * no RND re-sow), so two INDEPENDENT runs compare their (seed-bearing) save-data digests apples-to-apples
   * for the determinism contract (#842). Undefined for the soak = the framework's own run seed.
   */
  pinSeed?: string;
}

/** A structured HARD invariant breach (LOCKSTEP / NO-PARK / TEARDOWN) the driver throws after writing the
 * failure artifact. (An unhealed DIGEST divergence is recorded as a {@linkcode SoakFinding} + continues,
 * not thrown, so a long soak surveys the whole run.) */
export class SoakInvariantError extends Error {
  public readonly invariant: "lockstep" | "no-park" | "teardown";
  public readonly seed: number;
  public readonly wave: number;
  public readonly detail: string;
  public readonly artifactDir: string;

  public constructor(
    invariant: "lockstep" | "no-park" | "teardown",
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
): { slot: number; moveId: number } {
  const moveset = mon.getMoveset().filter((m): m is NonNullable<typeof m> => m != null);
  // #843 RESTRICTION-AWARE: the real command menu only accepts a move that is SELECTABLE this turn - PP
  // remaining AND not blocked by a REAL enemy move (Disable / Encore / Torment / Taunt / Imprison / Choice
  // lock). This is the EXACT predicate CommandPhase uses to build its legal move-slot list
  // (`m.isUsable(mon, false /*ignorePp*/, true /*forSelection*/)[0]`, command-phase.ts:313). The soak fixes
  // ONE slot per wave, so real combat both drains PP and can Encore/Disable the fixed pick; filtering by the
  // selectable set means we never hand the FIGHT menu an illegal move (which soft-locks it open).
  const selectable = moveset.filter(m => m.isUsable(mon, false, true)[0]);
  // #843 EFFECTIVENESS-AWARE: with REAL enemies a fixed-slot move can be TYPE-IMMUNE against the wave's real
  // species (e.g. SHADOW_BALL/Ghost vs a Normal-type = 0x), which deals ZERO damage forever and NO-PARK
  // stalls the wave. Prefer selectable moves that deal NON-ZERO damage to the target; both engines evaluate
  // the SAME host-authoritative target (pickTargets reads rig.hostScene), so the seeded pick still agrees.
  const effective =
    target == null ? selectable : selectable.filter(m => target.getMoveEffectiveness(mon, m.getMove()) > 0);
  // Fall back progressively so a pick always exists (all-immune or all-spent are degenerate; the wave then
  // NO-PARKs loudly rather than silently narrowing).
  const pool = effective.length > 0 ? effective : selectable.length > 0 ? selectable : moveset;
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

/** First legal (non-fainted, benched) party slot the given owner may send in, or -1 if none. */
function firstLegalBenchSlot(scene: BattleScene, owner: "host" | "guest"): number {
  const party = scene.getPlayerParty();
  const battlerCount = scene.currentBattle?.getBattlerCount() ?? 2;
  for (let i = battlerCount; i < party.length; i++) {
    const mon = party[i];
    if (mon != null && !mon.isFainted() && mon.isAllowedInBattle() && mon.coopOwner === owner) {
      return i;
    }
  }
  // Fall back to ANY legal bench mon (ownership is a nicety; a legal replacement must always be sent).
  for (let i = battlerCount; i < party.length; i++) {
    const mon = party[i];
    if (mon != null && !mon.isFainted() && mon.isAllowedInBattle()) {
      return i;
    }
  }
  return -1;
}

/**
 * Register a one-shot HOST faint auto-picker for the imminent turn: when a HOST-owned mon faints and the
 * host's real SwitchPhase opens the PARTY picker, send out the first legal host-owned bench mon. (A
 * GUEST-owned faint does NOT open a host PARTY picker - the host's SwitchPhase awaits the guest's relayed
 * pick - so this only fires for host-owned faints.) Expires at the next turn / post-battle boundary so it
 * never lingers at the queue head. Mirrors run-scenario.ts's registerFaintSwitch.
 */
function registerHostFaintAutoPick(game: GameManager, rig: DuoRig): void {
  game.onNextPrompt(
    "SwitchPhase",
    UiMode.PARTY,
    () => {
      const slot = firstLegalBenchSlot(rig.hostScene, "host");
      if (slot < 0) {
        return;
      }
      const handler = rig.hostScene.ui.getHandler() as PartyUiHandler;
      handler.setCursor(slot);
      handler.processInput(Button.ACTION); // select the bench mon
      handler.processInput(Button.ACTION); // send it out
    },
    () =>
      game.isCurrentPhase(
        "CommandPhase",
        "TurnInitPhase",
        "VictoryPhase",
        "BattleEndPhase",
        "NewBattlePhase",
        "SelectModifierPhase",
      ),
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
  return {
    hostPhase: rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none",
    guestPhase: rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "none",
    hostInteractionCounter: rig.hostRuntime.controller.interactionCounter(),
    guestInteractionCounter: rig.guestRuntime.controller.interactionCounter(),
    hostWave: rig.hostScene.currentBattle?.waveIndex,
    hostBattleType: rig.hostScene.currentBattle?.battleType,
  };
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
  const rng = mulberry32(seed);
  const actionScript: string[] = [];
  const skips: Record<string, number> = {};
  const boundaryDigests: SoakBoundaryDigest[] = [];
  const findings: SoakFinding[] = [];
  let resyncHeals = 0;
  let wavesCompleted = 0;

  const bumpSkip = (kind: string): void => {
    skips[kind] = (skips[kind] ?? 0) + 1;
    actionScript.push(`SKIP ${kind}`);
  };

  // 🔴 V1 COVERAGE GAP #1 (loud + skip-counted): the continuous soak does not yet drive MYSTERY ENCOUNTERS
  // (the caller sets mysteryEncounterChance 0). The duo harness drives MEs only from a PARKED buildDuoForMe
  // rig, not a mid-run continuation, so a random ME cannot be driven inline yet. Recorded here so it shows
  // in the run's skip counters + report; see the report's COVERAGE DECISIONS for the concrete follow-up.
  bumpSkip("mysteryEncounterDisabledV1");

  // Optionally PIN the run seed BEFORE the mirror (determinism contract) so two runs are seed-aligned.
  if (opts.pinSeed != null) {
    game.scene.setSeed(opts.pinSeed);
  }

  // 🔴 V1 COVERAGE GAP #2 (loud + skip-counted): the continuous soak does not yet drive TRAINER waves
  // (the caller sets disableTrainerWaves). mirrorHostBattleToGuest rebuilds a WILD party (TrainerSlot.NONE,
  // no trainer object / variant bench / enemy-switch machinery), so a mid-soak trainer wave would mirror a
  // structurally wrong battle onto the guest. Recorded here so it shows in the run's skip counters + report;
  // see the report's COVERAGE DECISIONS for the concrete follow-up (a trainer-aware harness mirror).
  bumpSkip("trainerWavesDisabledV1");

  // Stand up the two-engine rig over one loopback pair (host owns EVEN interaction counters, guest ODD).
  const pair = createLoopbackPair();
  const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
  // #843: tag party-slot co-op ownership (host EVEN slots, guest ODD) so a player faint has a legal
  // same-owner bench to replace from and the #786 guest-chooses-its-own-replacement path is exercised.
  tagCoopPartyOwnership(rig);
  // Make the guest faithfully reflect the host after the initial mirror (held items / ability / form /
  // tera / moveset via the production field snapshot + arena weather/terrain) - see healGuestFromHost.
  await healGuestFromHost(rig);

  // Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). The guest picks
  // the SAME move the host selects for the guest slot. #843: it reads the HOST's AUTHORITATIVE guest-slot mon
  // (not the guest's own wave-start mirror), so its PP-aware pick matches the host's playWave guest-select
  // EXACTLY even after the host has depleted a move's PP mid-wave (the guest mirror's PP is stale until the
  // checkpoint). Reading the host object is a plain field read - it needs no globalScene swap.
  rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => {
    const wave = rig.hostScene.currentBattle.waveIndex;
    const turn = rig.hostScene.currentBattle.turn;
    // #843 coverage #4: occasionally issue a VOLUNTARY SWITCH for the guest slot instead of a move, through
    // the REAL relay Command path (Command.POKEMON + party-slot cursor); the host summons the guest's pick
    // and the switch rides the per-turn checkpoint onto the guest's replay. Only when a legal guest-owned
    // bench mon exists; else fall through to a move.
    const benchSlot = firstLegalBenchSlot(rig.hostScene, "guest");
    if (switchesThisTurn(seed, wave, turn, GUEST_SWITCH_SALT) && benchSlot >= 0) {
      actionScript.push(`wave ${wave} turn ${turn}: guest SWITCH -> party[${benchSlot}]`);
      return { command: Command.POKEMON, cursor: benchSlot };
    }
    const guestMon = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
    const { guestTarget, guestTargetMon } = pickTargets(rig.hostScene);
    const { slot, moveId } = resolveChosenMove(guestMon, guestTargetMon, seed, wave, GUEST_SLOT_SALT);
    return {
      command: Command.FIGHT,
      cursor: moveSlots.includes(slot) ? slot : (moveSlots[0] ?? 0),
      moveId,
      targets: [guestTarget],
    };
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

  const fail = (invariant: "lockstep" | "no-park" | "teardown", wave: number, detail: string): never => {
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
    const sample = diffFields
      .map(k => `${k}: host=${JSON.stringify(hostState[k])} guest=${JSON.stringify(guestState[k])}`)
      .join(" | ");
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
      actionScript.push(`wave ${wave}: DIGEST mismatch @${where} -> one-heal resync`);
      await oneHeal();
      chk = await captureChecksums();
      if (chk.host !== chk.guest) {
        await recordDigestFinding(wave, where);
      }
    }
    return chk;
  };

  /**
   * WAVE-START boundary: LOCKSTEP + record the boundary digest sample. The guest was just re-mirrored +
   * faithfully re-synced to the host ({@linkcode healGuestFromHost}), so this is the CLEAN-START parity
   * check (the launch/resync fidelity). The one-heal here is a second re-mirror. The REAL replay-desync
   * detection is the POST-TURN check below.
   */
  const assertWaveBoundary = async (wave: number): Promise<void> => {
    assertLockstep(wave, "wave-start");
    const chk = await checkDigest(wave, "wave-start", async () => {
      await remirrorWave(rig);
      await healGuestFromHost(rig);
    });
    const save = await captureSaveDigests();
    boundaryDigests.push({
      wave,
      hostChecksum: chk.host,
      guestChecksum: chk.guest,
      hostSaveDigest: save.host,
      guestSaveDigest: save.guest,
    });
  };

  /**
   * POST-TURN convergence - the REAL desync detector (invariant a). After the guest REPLAYS the host's
   * wave (applying the per-turn checkpoint), its full state must EQUAL the host's WITHOUT a re-mirror (a
   * re-mirror would mask a replay desync by resetting the guest to the host). This is where a checkpoint /
   * replay divergence surfaces (the class that surfaced the historical move-PP desync). The one-heal is the
   * production per-turn full-field resync ({@linkcode applyCoopFieldSnapshot}); a still-diverged state is a
   * REAL desync the per-turn resync did not converge -> recorded as a finding.
   */
  const assertPostTurnConverged = async (wave: number): Promise<void> => {
    await checkDigest(wave, "post-turn", async () => {
      const snap = await withClient(rig.hostCtx, () => captureCoopFieldSnapshot());
      await withClient(rig.guestCtx, () => applyCoopFieldSnapshot(snap ?? undefined, true));
    });
  };

  /** Play ONE host wave to a win (bounded by the NO-PARK turn budget); the guest replays each turn. */
  const playWave = async (wave: number): Promise<void> => {
    for (let t = 0; t < MAX_TURNS_PER_WAVE; t++) {
      const turn = rig.hostScene.currentBattle.turn;
      await withClient(rig.hostCtx, async () => {
        // #843 REAL combat can faint a player mon mid-wave: auto-pick the host's own-slot replacement.
        registerHostFaintAutoPick(game, rig);
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
          const moveId = resolveChosenMove(mon, targetMon, seed, wave, salt).moveId;
          if (isHostSlot) {
            hostMoveId = moveId;
          } else {
            guestMoveId = moveId;
          }
          if (mon.coopOwner === "host") {
            // #843 coverage #4: occasionally issue a VOLUNTARY SWITCH for the host's own slot through the
            // REAL Command path (game.doSwitchPokemon drives the POKEMON command + party pick), instead of a
            // move. The switch broadcasts to the guest and rides the per-turn checkpoint onto its replay.
            const benchSlot = firstLegalBenchSlot(rig.hostScene, "host");
            if (switchesThisTurn(seed, wave, turn, HOST_SWITCH_SALT) && benchSlot >= 0) {
              game.doSwitchPokemon(benchSlot);
              if (isHostSlot) {
                actionScript.push(`wave ${wave} turn ${turn}: host SWITCH -> party[${benchSlot}]`);
              }
            } else {
              game.move.select(moveId, fi, targetIndex);
            }
          }
        }
        if (t === 0) {
          actionScript.push(`wave ${wave}: host slot move=${hostMoveId} guest slot move=${guestMoveId}`);
        }
        await game.phaseInterceptor.to("TurnEndPhase");
      });
      await withClient(rig.guestCtx, () => driveGuestReplayTurnWithFaint(rig, turn));

      if (rig.hostScene.currentBattle.enemyParty.every(e => e.isFainted())) {
        return;
      }
      // Not won yet: advance the host to the next turn's CommandPhase for another round.
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
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
   */
  const driveOwnerReward = async (shop: ShopPhaseSeam): Promise<string> => {
    const take = rewardPolicy === "seeded" && rng() < 0.5;
    await driveHostRewardShopOwner(shop, { takeReward: take });
    return take ? "take-nonparty" : "leave";
  };

  /** Drive the reward shop (seeded owner take/leave across ALL reward types; watcher mirrors) + LOCKSTEP. */
  const driveRewardShop = async (wave: number): Promise<void> => {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;

    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    if (hostShop.phaseName !== "SelectModifierPhase") {
      bumpSkip("rewardShopUnavailable");
      return;
    }
    const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;

    let action: string;
    if (hostOwns) {
      action = await withClient(rig.hostCtx, () => driveOwnerReward(hostShop));
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
    } else {
      action = await withClient(rig.guestCtx, () => driveOwnerReward(guestShop));
      await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop));
    }
    actionScript.push(`wave ${wave}: reward shop owner=${hostOwns ? "host" : "guest"} ${action}`);

    const hostAfter = rig.hostRuntime.controller.interactionCounter();
    const guestAfter = rig.guestRuntime.controller.interactionCounter();
    if (hostAfter !== counterBefore + 1 || guestAfter !== counterBefore + 1) {
      fail(
        "lockstep",
        wave,
        `reward shop did not advance both counters once (before=${counterBefore} host=${hostAfter} guest=${guestAfter})`,
      );
    }
  };

  /**
   * A BOSS wave (every 10th). #843: the harness mirror now carries the host's authoritative boss segments
   * onto the guest enemy (mirrorHostBattleToGuest re-asserts setBoss + bossSegmentIndex), so the guest is a
   * FAITHFUL boss and the wave-start + post-turn DIGEST invariants run on boss waves EXACTLY like a normal
   * wave (no more digest skip). The ONE thing that stays boss-specific is the reward tail: a boss VictoryPhase
   * AUTO-GRANTS via ModifierRewardPhase with NO owner/watcher SelectModifierPhase, so it advances the
   * alternating interaction counter by ZERO - there is no shop to drive. We preserve that semantic (drive any
   * host boss SelectModifierPhase SOLO if one is queued, reconciling the guest counter) instead of running the
   * normal owner/watcher driveRewardShop (which would assert a +1 advance the boss auto-grant never makes).
   */
  const processBossWave = async (wave: number): Promise<void> => {
    await assertWaveBoundary(wave); // (a)+(b) wave-start clean-start parity - boss segments now carried
    await playWave(wave); // (c) NO-PARK
    await assertPostTurnConverged(wave); // (a) POST-TURN real replay-desync detector
    // Boss reward tail: auto-grant, no shop, counter +0 (see doc above). Clear any guest phantom queue and
    // drive a host boss SelectModifierPhase SOLO only if one was actually queued.
    withClientSync(rig.guestCtx, () => rig.guestScene.phaseManager.clearPhaseQueue());
    if (rig.hostScene.phaseManager.hasPhaseOfType("SelectModifierPhase")) {
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        const shop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        if (shop.phaseName === "SelectModifierPhase") {
          await driveHostRewardShopOwner(shop, { takeReward: false });
        }
      });
      const hostCtr = rig.hostRuntime.controller.interactionCounter();
      await withClient(rig.guestCtx, () => {
        while (rig.guestRuntime.controller.interactionCounter() < hostCtr) {
          rig.guestRuntime.controller.advanceInteraction();
        }
      });
    }
    assertLockstep(wave, "boss-wave-end");
    assertScalarConvergence(wave, "boss-post-shop"); // #843 pokeball-drift classifier on boss waves too
  };

  /** A normal battle wave: wave-start clean-start parity, play, POST-TURN real-desync check, reward shop. */
  const processNormalWave = async (wave: number): Promise<void> => {
    await assertWaveBoundary(wave); // (a)+(b) wave-start clean-start parity
    await playWave(wave); // (c) NO-PARK
    await assertPostTurnConverged(wave); // (a) POST-TURN real replay-desync detector
    await driveRewardShop(wave);
    assertScalarConvergence(wave, "post-shop"); // #843 pokeball-drift classifier (money + ball inventory)
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
    if (wave > 1 && rig.hostScene.currentBattle.battleType === BattleType.MYSTERY_ENCOUNTER) {
      // Continuous-run ME driving is not supported by the duo harness (V1 COVERAGE GAP #1). If an ME ever
      // reaches here (a future run raising mysteryEncounterChance), count it + STOP cleanly - never silent.
      bumpSkip("mysteryEncounterWaveHit");
      return true;
    }
    return false;
  };

  // ===== The wave loop. =====
  for (let wave = 1; wave <= waves; wave++) {
    if (crossedUndrivableWave(wave)) {
      break;
    }
    // Re-mirror the host's freshly-rolled battle onto the guest before each new wave (wave 1 was mirrored by
    // buildDuo), then faithfully re-sync the guest (held items / weather / modifiers / scalars).
    if (wave > 1) {
      await remirrorWave(rig);
      await healGuestFromHost(rig);
    }

    const bossWave = rig.hostScene.getEnemyField().some(e => e.isBoss());
    try {
      await (bossWave ? processBossWave(wave) : processNormalWave(wave));
    } catch (e) {
      if (e instanceof SoakInvariantError) {
        throw e;
      }
      // A driver stall (driveGuestReplayTurn / driveGuestRewardWatch / phaseInterceptor timeout) throws a
      // plain Error - convert it into a NO-PARK artifact with the phase dump so the strand is replayable.
      fail("no-park", wave, `wave driving threw (strand/stall): ${e instanceof Error ? e.message : String(e)}`);
    }

    wavesCompleted++;
    // Cross into the next wave's battle (real EncounterPhase rolls wave w+1).
    if (wave < waves) {
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase"));
    }
  }

  assertTeardown();
  return { seed, wavesRequested: waves, wavesCompleted, skips, resyncHeals, actionScript, boundaryDigests, findings };
}
