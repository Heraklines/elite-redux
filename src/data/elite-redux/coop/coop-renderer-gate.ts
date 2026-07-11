/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RENDERER gate (#633 -> allowlist migration; accepted-review item 2). See
// docs/plans/2026-07-02-coop-authoritative-replication-redesign.md and the migration
// contract docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §3.
//
// The authoritative co-op GUEST is a PURE RENDERER: it resolves nothing. It renders the
// host's streamed outcome via the CoopReplay* phases and applies the host's authoritative
// checkpoint/snapshot. The ONLY phases it may legitimately construct are PRESENTATION
// (render/animation/narration - no hashed shared state) and INPUT-INTENT (collect a human
// choice, emit a typed intent - never a direct mutation), plus a transitional set of
// wave/battle BOUNDARY-TAIL phases it still builds LOCALLY today (the #859-era VictoryPhase
// / BattleEndPhase / NewBattlePhase tails + the ME/wave-transition continuation). Every
// OTHER phase is a host-authoritative battle-RESOLUTION / progression / reward leak: it must
// NOT run on the guest (it renders the visible effect via a CoopReplay* phase and adopts the
// host's checkpoint).
//
// This module inverts the old M1 DENYLIST (6 resolution phases) to an ALLOWLIST so a NEW or
// overlooked mutating phase can never silently run on the guest: it fails closed (neutralized
// to CoopInertPhase) and is LOUDLY logged.
//
// ── DEFAULT-DENY SHIPPED; OBSERVE IS THE EMERGENCY ROLLBACK ─────────────────
// The warn-first soak phase is complete. The shipped behavior is now:
//   • OBSERVE (explicit rollback): legacy behavior is preserved - the legacy resolution
//     DENYLIST still neutralizes its 6 phases, and any OTHER non-allowlisted phase RUNS (as it
//     does today) but is logged `[coop:gate] ALLOWLIST WOULD-BLOCK phase=X`. Staging + the full
//     soaks watch that log: ZERO WOULD-BLOCK lines across a clean run == the allowlist is
//     complete and it is safe to flip enforcement.
//   • ENFORCE (default): fail closed - ANY non-allowlisted phase on the live guest is
//     neutralized to CoopInertPhase and logged `[coop:gate] ALLOWLIST BLOCK phase=X`.
// URL/localStorage/env can still force OBSERVE immediately if staging finds a missing legitimate phase.
//
// This is a CYCLE-FREE leaf (like coop-authoritative-gate): it imports only that gate (which
// imports nothing heavy) and the cycle-free debug logger, so phase-manager can import it with
// no import cycle. The gate short-circuits to a hard `false` off a live authoritative-guest
// session, so solo / host / lockstep are byte-for-byte unaffected (the allowlist lookup never
// runs).
//
// The allowlist below is EMPIRICALLY DERIVED: a temporary collector recorded every phase the
// authoritative guest constructs across the full duo + soak suite (god + level + me-asymmetric
// + host-faint soak legs; the biome / mystery / catch-full / revival / learn-move / trainer /
// faint-switch / enemy-switch-render / seating / evolution / exp duo repros), cross-checked
// row-for-row against the migration contract §3 inventory. See the task report for the
// per-entry justification + the four adjudicated REVIEW rows.
// =============================================================================

import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";

/**
 * The phases a co-op RENDERER (authoritative GUEST) may legitimately construct. Everything NOT
 * in this set is neutralized under enforcement (and logged WOULD-BLOCK under observe).
 *
 * Kept as a literal string set (not typed `PhaseString`) so this stays a cycle-free leaf.
 *
 * Grouped by classification; the group comment is the shared justification, matching the
 * migration contract §3.1 (presentation) / §3.2 (input-intent) tables plus the transitional
 * Wave-1 boundary-tail allowance the guest still builds locally today.
 */
export const COOP_RENDERER_ALLOWED_PHASES: ReadonlySet<string> = new Set<string>([
  // ── PRESENTATION (§3.1) - pure render / animation / narration; mutates no hashed state ──
  "MessagePhase", // narration box; guest shows host-localized log lines
  "CommonAnimPhase", // shared VFX; no state (empirically constructed on the guest)
  "DamageAnimPhase", // hit flash; the numeric damage is in the checkpoint
  "MoveAnimPhase", // move animation; the resolution (MovePhase) is host-only
  "LoadMoveAnimPhase", // move-anim asset load; presentation only
  "MoveHeaderPhase", // move banner; presentation
  "MoveChargePhase", // charge-move animation; the charge resolution is host-only
  "PokemonAnimPhase", // sprite animation
  "ShinySparklePhase", // cosmetic
  "ShowAbilityPhase", // ability flyout; the ability itself is host-resolved
  "HideAbilityPhase", // ability flyout teardown
  "ShowPartyExpBarPhase", // exp-bar chrome
  "HidePartyExpBarPhase", // exp-bar chrome
  "ShowTrainerPhase", // trainer-sprite intro
  "ScanIvsPhase", // per-client IV scanner readout
  "EndCardPhase", // run end card

  // ── COOP REPLAY / RENDER FAMILY (§3.1) - the guest's OWN render + adopt pipeline ──
  "CoopReplayTurnPhase", // the guest's per-turn render driver
  "CoopFinalizeTurnPhase", // guest turn-finalize + checksum verify
  "CoopReplayMePhase", // mystery-encounter render on the guest
  "CoopReplayLearnMovePhase", // learn-move render on the guest
  "CoopMoveAnimReplayPhase", // move-anim replay (renders the denied MovePhase)
  "CoopHpDrainReplayPhase", // hp tween replay
  "CoopStatStageReplayPhase", // stat tween replay (renders the denied StatStageChangePhase)
  "CoopStatusReplayPhase", // status-change replay
  "CoopFaintReplayPhase", // faint replay (renders the denied FaintPhase)
  "CoopCaptureReplayPhase", // guest ball-throw replay (renders the denied AttemptCapturePhase)
  "CoopApplyResyncPhase", // applies a host resync snapshot at a safe boundary
  "CoopInertPhase", // this gate's own neutralized-phase placeholder (must never self-block)
  "CoopPartnerSyncPhase", // partner-state sync render

  // ── INPUT-INTENT (§3.2) - owner drives; emits a typed intent, never a direct mutation ──
  "CommandPhase", // battle-command intent (own slots); watcher-safe
  "SelectTargetPhase", // target-select intent
  "SelectModifierPhase", // reward / shop / reroll intent (watcher or owner)
  "SelectBiomePhase", // biome-pick intent
  "ErCrossroadsPhase", // crossroads-pick intent
  "MysteryEncounterPhase", // ME option-panel intent
  "MysteryEncounterOptionSelectedPhase", // ME option-commit intent
  "ErQuizPhase", // quiz-answer intent
  "BiomeShopPhase", // biome-shop buy intent
  "BlackMarketShopPhase", // black-market buy intent
  "ExoticShopPhase", // exotic-shop buy intent
  "ImportBazaarShopPhase", // import-bazaar buy intent
  "ColosseumChoicePhase", // colosseum-pick intent
  "TheBargainPhase", // Giratina bargain intent
  "ErAbilityCapsulePhase", // ability-capsule pick intent
  "ErGreaterAbilityCapsulePhase", // greater-ability-capsule pick intent
  "ErGreaterAbilityRandomizerPhase", // greater-ability randomizer pick intent (same capsule family)
  "ErStormglassPickerPhase", // stormglass pick intent
  "LearnMovePhase", // per-move learn intent
  "LearnMoveBatchPhase", // ER batch level-up learn intent
  "SwitchPhase", // own faint-switch / voluntary-switch intent
  "RevivalBlessingPhase", // revival PICK intent (the APPLY half is host-authoritative)
  "CoopGuestCatchFullPhase", // guest-catcher CATCH_FULL intent driver
  "CoopGuestFaintSwitchPhase", // guest faint-switch intent driver
  "CoopGuestRevivalPhase", // guest revival intent driver
  // Pre-run roster input after the host's Resume/New Game decision. This is local input whose
  // rosterSync intent is merged host-authoritatively; blocking it skips the guest straight into
  // battle phases before a launch snapshot/currentBattle exists.
  "SelectStarterPhase",
  "ErDexNavPhase", // per-client dex-nav selection (REVIEW row: acquisitions are host-shared, so this is intent-only)
  "SelectGenderPhase", // account-local one-time gender pick (REVIEW row: per-account, not shared state)

  // ── WAVE-1 BOUNDARY-TAIL ALLOWANCE (migration contract §3.3 KEYSTONE) ──
  // The guest still CONSTRUCTS these LOCALLY today (coop-replay-phases.ts wave-advance tail +
  // the ME/wave-transition continuation). Removing that derivation - so the host STATES the
  // logical transition and the guest merely renders it - is Wave-2 scope. Until then they are
  // allowed so the guest does not softlock; each is empirically constructed by the guest
  // across the duo/soak suite (or is the direct companion of one that is).
  "VictoryPhase", // win/capture wave-advance tail the guest builds
  "TrainerVictoryPhase", // trainer-win tail pushed after VictoryPhase on a trainer wave
  "BattleEndPhase", // flee / wave-end tail the guest builds
  "NewBattlePhase", // next-wave boundary the guest builds
  "NextEncounterPhase", // next-encounter continuation companion of NewBattlePhase
  "NewBiomeEncounterPhase", // new-biome encounter continuation companion
  "SwitchBiomePhase", // biome-transition tail the guest builds
  "GameOverPhase", // game-over tail (has an isCoop render-only branch)
  "MysteryEncounterBattlePhase", // ME-spawned battle handoff the guest builds via CoopReplayMePhase
  "MysteryEncounterBattleStartCleanupPhase", // ME battle-start cleanup companion
  "MysteryEncounterRewardsPhase", // ME reward tail the guest builds
  "PostMysteryEncounterPhase", // post-ME continuation companion
  "EggLapsePhase", // per-client DETERMINISTIC egg lapse the guest runs locally at a wave boundary
]);

/**
 * The WAVE-1 BOUNDARY-TAIL group (§3.3 KEYSTONE): the between-wave / ME-boundary tail phases the guest
 * still CONSTRUCTS locally today (coop-replay-phases.ts wave-advance tail + the ME/wave-transition
 * continuation). Under the Wave-2f STRICT-TAILS mode (below) each of these is only SANCTIONED when the
 * current adopted WAVE_ADVANCE operation (coop-wave-operation.ts) states it - op-sanctioned construction.
 * A strict subset of {@linkcode COOP_RENDERER_ALLOWED_PHASES}; kept as its own set so strict-tails gates
 * ONLY the boundary tails (never the presentation / input-intent allowlist entries).
 */
export const COOP_WAVE_TAIL_PHASES: ReadonlySet<string> = new Set<string>([
  "VictoryPhase",
  "TrainerVictoryPhase",
  "BattleEndPhase",
  "NewBattlePhase",
  "NextEncounterPhase",
  "NewBiomeEncounterPhase",
  "SwitchBiomePhase",
  "GameOverPhase",
  "MysteryEncounterBattlePhase",
  "MysteryEncounterBattleStartCleanupPhase",
  "MysteryEncounterRewardsPhase",
  "PostMysteryEncounterPhase",
]);

/**
 * The legacy M1 host-authoritative battle-RESOLUTION denylist. Retained ONLY for OBSERVE mode:
 * so the warn-first rollout is byte-for-byte identical to today, these 6 phases keep being
 * neutralized on the guest exactly as before (they are NOT in the allowlist - they are pure
 * mutations the guest renders via the CoopReplay* family). Under ENFORCE mode the allowlist is
 * the sole gate and this set is a strict subset of "everything not allowed", so it is subsumed.
 */
export const COOP_RENDERER_DENIED_PHASES: ReadonlySet<string> = new Set<string>([
  "EnemyCommandPhase", // rolls enemy AI (per-client field-state divergence)
  "MovePhase", // resolves a move (draws battle RNG); renderer renders CoopMoveAnimReplayPhase
  "MoveEffectPhase", // applies damage/secondary (per-account innate/passive gating)
  "FaintPhase", // faint resolution; renderer renders CoopFaintReplayPhase
  "StatStageChangePhase", // stat resolution; renderer renders CoopStatStageReplayPhase
  "AttemptCapturePhase", // capture resolution; renderer renders CoopCaptureReplayPhase
]);

/**
 * Read the INITIAL enforcement mode without a rebuild, so the nightly/soak (env) or a staging
 * tester (localStorage / URL) can override it for a run. Precedence: URL `?coopgateenforce=0|1`
 * > localStorage `coopGateEnforce` > env `COOP_RENDERER_GATE_ENFORCE` > default ON (enforce). All
 * reads are guarded, so solo / host / lockstep remain unaffected regardless of this flag. `0` remains an
 * emergency observe-mode rollback without a rebuild.
 */
function readInitialEnforced(): boolean {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    if (loc?.search) {
      const q = new URLSearchParams(loc.search).get("coopgateenforce");
      if (q === "1" || q === "true") {
        return true;
      }
      if (q === "0" || q === "false") {
        return false;
      }
    }
    const ls = (globalThis as { localStorage?: Storage }).localStorage?.getItem("coopGateEnforce");
    if (ls === "1") {
      return true;
    }
    if (ls === "0") {
      return false;
    }
  } catch {
    // headless / SSR / no DOM: fall through to the env / compile default.
  }
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (env?.COOP_RENDERER_GATE_ENFORCE === "1" || env?.COOP_RENDERER_GATE_ENFORCE === "true") {
      return true;
    }
    if (env?.COOP_RENDERER_GATE_ENFORCE === "0" || env?.COOP_RENDERER_GATE_ENFORCE === "false") {
      return false;
    }
  } catch {
    // no `process` (browser): env is not a source here.
  }
  return true;
}

/**
 * Enforcement flag. `false` = OBSERVE rollback: a non-allowlisted phase RUNS (or, if in the legacy
 * denylist, neutralizes as before) and is logged WOULD-BLOCK. `true` (default) = ENFORCE:
 * a non-allowlisted phase fails closed (neutralized + logged BLOCK).
 */
let enforced = readInitialEnforced();

/** Whether the renderer allowlist is ENFORCED (fail-closed, default) vs OBSERVE (rollback). */
export function isCoopRendererGateEnforced(): boolean {
  return enforced;
}

/** Set the enforcement mode. Default is ENFORCE (`true`); false is the emergency observe rollback. */
export function setCoopRendererGateEnforced(on: boolean): void {
  enforced = on;
}

// ── Wave-2f STRICT-TAILS mode (§3.3 KEYSTONE, §6.3) ──────────────────────────
// A SEPARATE sub-flag, default ON. Under renderer ENFORCE an unsanctioned shared boundary tail is
// neutralized; under the emergency renderer OBSERVE rollback it logs and runs. A boundary-tail phase
// constructs is checked against the CURRENT adopted WAVE_ADVANCE op's sanctioned set: an UNSANCTIONED
// tail logs `[coop:gate] TAIL WOULD-BLOCK` (the signal that the guest built a tail the host's stated
// transition did not sanction). The op adapter (coop-wave-operation.ts) PUSHES the sanction on adopt
// (keeping this gate a cycle-free leaf - nothing is pulled from the operation runtime). The main renderer
// observe rollback remains available for emergency diagnosis.

/**
 * Read the INITIAL strict-tails mode without a rebuild (env `COOP_RENDERER_GATE_STRICT_TAILS` /
 * localStorage `coopGateStrictTails` / URL `?coopgatestricttails=1`), default ON (observe). Guarded
 * exactly like {@linkcode readInitialEnforced}. OFF by default: strict-tails is evidence-gathering the
 * migration follow-up turns ON after the op surface soaks; it NEVER enforces (§6.3).
 */
function readInitialStrictTails(): boolean {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    if (loc?.search) {
      const q = new URLSearchParams(loc.search).get("coopgatestricttails");
      if (q === "1" || q === "true") {
        return true;
      }
      if (q === "0" || q === "false") {
        return false;
      }
    }
    const ls = (globalThis as { localStorage?: Storage }).localStorage?.getItem("coopGateStrictTails");
    if (ls === "1") {
      return true;
    }
    if (ls === "0") {
      return false;
    }
  } catch {
    // headless / SSR / no DOM: fall through to env / compile default.
  }
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (env?.COOP_RENDERER_GATE_STRICT_TAILS === "1" || env?.COOP_RENDERER_GATE_STRICT_TAILS === "true") {
      return true;
    }
    if (env?.COOP_RENDERER_GATE_STRICT_TAILS === "0" || env?.COOP_RENDERER_GATE_STRICT_TAILS === "false") {
      return false;
    }
  } catch {
    // no `process` (browser): env is not a source here.
  }
  return true;
}

/** Strict-tail sanction flag (default ON). Enforcement follows the main renderer gate mode. */
let strictTails = readInitialStrictTails();

/** The tail phases the CURRENT adopted WAVE_ADVANCE op sanctions, or null when no op is adopted (all tails would-block). */
let sanctionedTailPhases: ReadonlySet<string> | null = null;

/** Whether strict-tails OBSERVE mode is on (boundary tails checked against the adopted WAVE_ADVANCE op). */
export function isCoopStrictTailsMode(): boolean {
  return strictTails;
}

/** Set strict-tail sanction mode. Default ON; false disables sanction checks for emergency diagnosis. */
export function setCoopStrictTailsMode(on: boolean): void {
  strictTails = on;
}

/**
 * PUSH the tail phases the current adopted WAVE_ADVANCE op sanctions (called by coop-wave-operation.ts on
 * adopt, keeping this gate cycle-free). `null` clears the sanction (no op adopted). Under strict-tails a
 * boundary-tail phase NOT in this set logs TAIL WOULD-BLOCK.
 */
export function setCoopWaveTailSanction(phases: readonly string[] | null): void {
  sanctionedTailPhases = phases == null ? null : new Set(phases);
}

/** Phases that STRICT-TAILS mode flagged (built a boundary tail the adopted op did not sanction). For tests/soak. */
let tailWouldBlockLog: string[] = [];

/** The tail-would-block log (STRICT-TAILS observe evidence). */
export function getCoopTailWouldBlockLog(): readonly string[] {
  return tailWouldBlockLog;
}

/** Reset the tail-would-block log (per-test; also safe on session teardown). */
export function resetCoopTailWouldBlockLog(): void {
  tailWouldBlockLog = [];
}

/** LOUD (ungated) tail-would-block log - the strict-tails signal that a built tail was not op-sanctioned. */
function logTailWouldBlock(phaseName: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[coop:gate] TAIL WOULD-BLOCK phase=${phaseName} (the adopted WAVE_ADVANCE op did not sanction this boundary tail; allowed under strict-tails observe - op-sanctioned construction is the enforce target)`,
  );
  if (tailWouldBlockLog.length < LOG_CAP) {
    tailWouldBlockLog.push(phaseName);
  }
}

function logTailBlock(phaseName: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[coop:gate] TAIL BLOCK phase=${phaseName} (no authoritative operation sanctioned this boundary tail; neutralized to CoopInertPhase)`,
  );
  if (tailWouldBlockLog.length < LOG_CAP) {
    tailWouldBlockLog.push(phaseName);
  }
}

/** Bounded so a runaway leak can never grow a diagnostic log without limit. */
const LOG_CAP = 256;
/** Phases actually NEUTRALIZED on the guest (ENFORCE block + OBSERVE legacy-denylist neutralize). */
let neutralizedLog: string[] = [];
/** Phases that ENFORCE mode WOULD newly block (OBSERVE-mode signal that the allowlist is incomplete). */
let wouldBlockLog: string[] = [];
/** Every phase the authoritative guest constructed via the factory (the permanent collector set). */
let observedGuestPhases = new Set<string>();

/**
 * Whether `phaseName` would FAIL CLOSED (be neutralized) on a live authoritative guest under
 * ENFORCEMENT: we are the live authoritative co-op GUEST AND the phase is not on the allowlist.
 * PURE (no side effects, ignores the enforcement flag) - the test + any read-only caller use it.
 * Hard `false` for solo / host / lockstep (the gate predicate is false), so those paths never
 * even reach the allowlist lookup.
 */
export function isCoopRendererBlockedPhase(phaseName: string): boolean {
  return isCoopAuthoritativeGuestGated() && !COOP_RENDERER_ALLOWED_PHASES.has(phaseName);
}

/**
 * THE GATE DECISION used by {@linkcode PhaseManager.create}. Returns `true` iff the phase must be
 * substituted with an inert no-op on this client right now. Side effects (guest only): record the
 * phase in the observed-set, and LOUDLY log a WOULD-BLOCK (observe) or BLOCK (enforce) when the
 * phase is not allowlisted. Pure + cheap for solo / host / lockstep (a single boolean short-circuit).
 *
 * OBSERVE (default): preserve today's behavior - the legacy denylist neutralizes its 6 phases; any
 * other non-allowlisted phase RUNS but is logged WOULD-BLOCK so staging can see the allowlist gap.
 * ENFORCE: any non-allowlisted phase neutralizes (fail closed) and is logged BLOCK.
 */
export function coopRendererGateNeutralizes(phaseName: string): boolean {
  // Fast path: solo / host / lockstep never touch the allowlist.
  if (!isCoopAuthoritativeGuestGated()) {
    return false;
  }
  observedGuestPhases.add(phaseName);

  if (COOP_RENDERER_ALLOWED_PHASES.has(phaseName)) {
    // Wave-2f STRICT-TAILS: a tail the current authoritative operation did NOT sanction fails closed under
    // renderer enforcement, or is surfaced loudly and allowed under observe rollback. Only the boundary-tail
    // group is checked; presentation / input-intent allowlist entries are always fine.
    if (strictTails && COOP_WAVE_TAIL_PHASES.has(phaseName) && !(sanctionedTailPhases?.has(phaseName) ?? false)) {
      if (enforced) {
        logTailBlock(phaseName);
        recordNeutralized(phaseName);
        return true;
      }
      logTailWouldBlock(phaseName);
    }
    return false; // presentation / input-intent / allowed boundary tail: the guest runs it
  }

  if (enforced) {
    // Fail closed: any non-allowlisted phase is a leak on the renderer.
    logBlock(phaseName);
    recordNeutralized(phaseName);
    return true;
  }

  // OBSERVE / warn-first mode.
  if (COOP_RENDERER_DENIED_PHASES.has(phaseName)) {
    // The 6 legacy resolution phases keep neutralizing exactly as today (already blocked, so no
    // WOULD-BLOCK line - this is not a NEW block the enforcement flip would introduce).
    recordNeutralized(phaseName);
    return true;
  }
  // A phase enforcement WOULD newly block - surface it LOUDLY but RUN it (today's default).
  logWouldBlock(phaseName);
  return false;
}

/** LOUD (ungated) block log - rides the console ring buffer captured in bug reports. */
function logBlock(phaseName: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[coop:gate] ALLOWLIST BLOCK phase=${phaseName} (not a guest presentation/input-intent phase; neutralized to CoopInertPhase)`,
  );
}

/** LOUD (ungated) would-block log - the warn-first signal that the allowlist is missing an entry. */
function logWouldBlock(phaseName: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[coop:gate] ALLOWLIST WOULD-BLOCK phase=${phaseName} (allowed under observe mode; enforcement would neutralize it - add to the allowlist if legitimate)`,
  );
  if (wouldBlockLog.length < LOG_CAP) {
    wouldBlockLog.push(phaseName);
  }
}

function recordNeutralized(phaseName: string): void {
  if (neutralizedLog.length < LOG_CAP) {
    neutralizedLog.push(phaseName);
  }
}

/**
 * Record that a phase was neutralized on the renderer. Public for the harness/test seam; the live
 * path records via {@linkcode coopRendererGateNeutralizes}. Also emits the LOUD block log.
 */
export function recordCoopRendererNeutralized(phaseName: string): void {
  logBlock(phaseName);
  recordNeutralized(phaseName);
}

/** The neutralized-phase log (the harness reads this to assert which phases were caught). */
export function getCoopRendererNeutralizedLog(): readonly string[] {
  return neutralizedLog;
}

/** Reset the neutralized-phase log (per-test; also safe on session teardown). */
export function resetCoopRendererNeutralizedLog(): void {
  neutralizedLog = [];
}

/** The would-block log (OBSERVE-mode: phases enforcement would newly block; must be empty on a clean run). */
export function getCoopRendererWouldBlockLog(): readonly string[] {
  return wouldBlockLog;
}

/** Reset the would-block log. */
export function resetCoopRendererWouldBlockLog(): void {
  wouldBlockLog = [];
}

/**
 * The observed-set: every phase the authoritative guest constructed via the factory this session
 * (the permanent, in-memory equivalent of the empirical collector). The gate-completeness
 * regression test asserts this stays a subset of {@linkcode COOP_RENDERER_ALLOWED_PHASES} so a
 * newly-added guest phase fails CI (an observed phase outside the allowlist) rather than production.
 */
export function getObservedCoopGuestPhases(): ReadonlySet<string> {
  return observedGuestPhases;
}

/** Reset the observed-set (per-test; also safe on session teardown). */
export function resetObservedCoopGuestPhases(): void {
  observedGuestPhases = new Set();
}
