/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op RENDERER ALLOWLIST gate (#633 -> allowlist; accepted-review item 2). Pure-logic test (no
// game engine): proves the decision logic that makes the authoritative GUEST a pure renderer under
// a DEFAULT-DENY allowlist. Only presentation + input-intent phases (+ the transitional boundary
// tails) may be constructed on the live authoritative guest; every other phase fails closed under
// ENFORCE mode (neutralized + LOUD `[coop:gate] ALLOWLIST BLOCK`) and, under the default OBSERVE
// mode, runs-but-warns (`WOULD-BLOCK`) so a mis-classification self-heals instead of hanging prod.
//
// The GATE-COMPLETENESS test re-runs the collector logic in test mode: the empirically-observed set
// (every phase the guest actually constructs across the full duo + soak suite) MUST be a subset of
// the allowlist, so a newly-added guest phase reds CI (an observed phase outside the allowlist)
// rather than soft-locking a live renderer. The real PhaseManager.create() wiring is exercised
// end-to-end by the two-engine duo suite + tsc.
// See docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §3.

import { setCoopAuthoritativeGuestPredicate } from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  COOP_RENDERER_ALLOWED_PHASES,
  COOP_RENDERER_DENIED_PHASES,
  coopRendererGateNeutralizes,
  getCoopRendererNeutralizedLog,
  getCoopRendererWouldBlockLog,
  getObservedCoopGuestPhases,
  isCoopRendererBlockedPhase,
  isCoopRendererGateEnforced,
  recordCoopRendererNeutralized,
  resetCoopRendererNeutralizedLog,
  resetCoopRendererWouldBlockLog,
  resetObservedCoopGuestPhases,
  setCoopRendererGateEnforced,
  setCoopStrictTailsMode,
} from "#data/elite-redux/coop/coop-renderer-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * EMPIRICALLY-OBSERVED SET: every phase the authoritative co-op GUEST constructs via the phase
 * factory, collected by a temporary in-gate collector across the FULL duo + soak suite (35-wave god
 * soak, level + me-asymmetric + host-faint soak legs, and the biome / mystery / catch-full / revival
 * / learn-move / trainer-mirror / faint-switch / enemy-switch-render / seating / voluntary-switch
 * duo repros). This is the ground truth the allowlist MUST cover: a live guest that constructs a
 * phase outside the allowlist soft-locks under enforcement, so this list failing the subset check
 * below is a RED that must be reconciled (add the phase to the allowlist or stop the guest building
 * it), never made green by trimming this constant.
 */
const COOP_GUEST_OBSERVED_PHASES: readonly string[] = [
  "CommandPhase",
  "CommonAnimPhase",
  "CoopFaintReplayPhase",
  "CoopFinalizeTurnPhase",
  "CoopFinalizeEntryPresentationPhase",
  "CoopGuestCatchFullPhase",
  "CoopGuestFaintSwitchPhase",
  "CoopGuestRevivalPhase",
  "CoopHpDrainReplayPhase",
  "CoopMoveAnimReplayPhase",
  "CoopPartnerSyncPhase",
  "CoopPresentationReceiptPhase",
  "CoopReplayMePhase",
  "CoopReplayTurnPhase",
  "CoopStatStageReplayPhase",
  "CoopSwitchReplayPhase",
  "CoopTeraReplayPhase",
  "CoopVictorySealPhase",
  "EggLapsePhase",
  "ErQuizPhase",
  "LearnMovePhase",
  "MysteryEncounterBattlePhase",
  "MysteryEncounterPhase",
  "MysteryEncounterRewardsPhase",
  "SelectBiomePhase",
  "SelectGenderPhase",
  "SelectModifierPhase",
  // Real title/lobby path: after resumeStartNew the authoritative guest must remain on its
  // local roster picker. Blocking this phase skips directly into battle construction with no
  // launch snapshot/currentBattle and strands the two peers on different screens.
  "SelectStarterPhase",
  "SwitchBiomePhase",
  "TurnStartPhase",
  "VictoryPhase",
];

/** A representative mutating / host-authoritative resolution phase the guest must NEVER run. */
const MUTATING_PHASES: readonly string[] = [
  "MovePhase",
  "MoveEffectPhase",
  "EnemyCommandPhase",
  "FaintPhase",
  "StatStageChangePhase",
  "AttemptCapturePhase",
  "BerryPhase",
  "WeatherEffectPhase",
  "AddEnemyBuffModifierPhase",
];

describe("co-op renderer ALLOWLIST gate (#633, accepted-review item 2)", () => {
  beforeEach(() => {
    resetCoopRendererNeutralizedLog();
    resetCoopRendererWouldBlockLog();
    resetObservedCoopGuestPhases();
    setCoopRendererGateEnforced(true);
    // This file verifies the phase allowlist. Tail-sanction enforcement has its own focused suite;
    // disabling it here prevents an unsanctioned boundary tail from masquerading as an allowlist block.
    setCoopStrictTailsMode(false);
  });
  afterEach(() => {
    // Never leak the predicate / enforcement / logs into the next test file (solo / host read false).
    setCoopAuthoritativeGuestPredicate(null);
    setCoopRendererGateEnforced(true);
    setCoopStrictTailsMode(true);
    resetCoopRendererNeutralizedLog();
    resetCoopRendererWouldBlockLog();
    resetObservedCoopGuestPhases();
  });

  it("can explicitly enable ENFORCE (fail closed)", () => {
    expect(isCoopRendererGateEnforced()).toBe(true);
  });

  it("neutralizes NOTHING when there is no live session (solo / host / lockstep read false)", () => {
    setCoopAuthoritativeGuestPredicate(null); // the default
    setCoopRendererGateEnforced(true); // even under enforcement, no session => never blocks
    for (const phase of [...MUTATING_PHASES, ...COOP_GUEST_OBSERVED_PHASES]) {
      expect(isCoopRendererBlockedPhase(phase), `${phase} must not be blocked off a session`).toBe(false);
      expect(coopRendererGateNeutralizes(phase), `${phase} must not be neutralized off a session`).toBe(false);
    }
  });

  it("neutralizes NOTHING for the host / a lockstep client (predicate false)", () => {
    setCoopAuthoritativeGuestPredicate(() => false);
    setCoopRendererGateEnforced(true);
    expect(isCoopRendererBlockedPhase("MovePhase")).toBe(false);
    expect(coopRendererGateNeutralizes("MovePhase")).toBe(false);
    expect(coopRendererGateNeutralizes("AddEnemyBuffModifierPhase")).toBe(false);
  });

  // ── ENFORCE mode: fail closed ──
  describe("ENFORCE mode (fail closed)", () => {
    beforeEach(() => {
      setCoopAuthoritativeGuestPredicate(() => true); // the authoritative guest
      setCoopRendererGateEnforced(true);
    });

    it("BLOCKS every unknown / mutating phase (default-deny)", () => {
      for (const phase of MUTATING_PHASES) {
        expect(isCoopRendererBlockedPhase(phase), `${phase} must be blocked on the renderer`).toBe(true);
        expect(coopRendererGateNeutralizes(phase), `${phase} must be neutralized on the renderer`).toBe(true);
      }
    });

    it("BLOCKS a brand-new mutating phase that no one remembered to classify", () => {
      // The whole point of an allowlist: an overlooked NEW phase fails closed, not open.
      expect(isCoopRendererBlockedPhase("SomeBrandNewMutatingPhase")).toBe(true);
      expect(coopRendererGateNeutralizes("SomeBrandNewMutatingPhase")).toBe(true);
      expect(getCoopRendererNeutralizedLog()).toContain("SomeBrandNewMutatingPhase");
    });

    it("RUNS every allowlisted presentation / input-intent / boundary phase (never soft-locks)", () => {
      for (const phase of COOP_RENDERER_ALLOWED_PHASES) {
        expect(isCoopRendererBlockedPhase(phase), `${phase} must NOT be blocked`).toBe(false);
        expect(coopRendererGateNeutralizes(phase), `${phase} must NOT be neutralized`).toBe(false);
      }
    });

    it("RUNS the guest's pre-run starter picker after the Resume/New Game barrier releases", () => {
      expect(isCoopRendererBlockedPhase("SelectStarterPhase")).toBe(false);
      expect(coopRendererGateNeutralizes("SelectStarterPhase")).toBe(false);
      expect(getCoopRendererNeutralizedLog()).not.toContain("SelectStarterPhase");
    });

    it("RUNS the account/session shell while a guest session is paired but no battle exists", () => {
      for (const phase of ["LoginPhase", "TitlePhase"]) {
        expect(isCoopRendererBlockedPhase(phase), `${phase} is outside shared-run mutation`).toBe(false);
        expect(coopRendererGateNeutralizes(phase), `${phase} must not strand boot/reconnect`).toBe(false);
      }
    });

    it("RUNS the guest turn dispatcher so it can divert into CoopReplayTurnPhase", () => {
      expect(isCoopRendererBlockedPhase("TurnStartPhase")).toBe(false);
      expect(coopRendererGateNeutralizes("TurnStartPhase")).toBe(false);
    });

    it("permits only a loaded EncounterPhase after authoritative launch/resume adoption", () => {
      expect(coopRendererGateNeutralizes("EncounterPhase")).toBe(true);
      expect(coopRendererGateNeutralizes("EncounterPhase", [false])).toBe(true);
      expect(coopRendererGateNeutralizes("EncounterPhase", [true])).toBe(false);
    });
  });

  // ── OBSERVE mode: warn-first, behavior-preserving ──
  describe("OBSERVE mode (default warn-first)", () => {
    beforeEach(() => {
      setCoopAuthoritativeGuestPredicate(() => true);
      setCoopRendererGateEnforced(false);
    });

    it("still NEUTRALIZES the 6 legacy resolution phases exactly as today (no behavior change)", () => {
      for (const phase of COOP_RENDERER_DENIED_PHASES) {
        expect(coopRendererGateNeutralizes(phase), `${phase} legacy denylist must still neutralize`).toBe(true);
      }
      // Already-blocked legacy phases are NOT counted as NEW would-block noise.
      expect(getCoopRendererWouldBlockLog()).toEqual([]);
    });

    it("RUNS-but-WARNS an unlisted, non-denied phase (WOULD-BLOCK), never neutralizing it", () => {
      expect(coopRendererGateNeutralizes("SomeBrandNewMutatingPhase")).toBe(false); // runs today
      expect(getCoopRendererWouldBlockLog()).toContain("SomeBrandNewMutatingPhase"); // but is surfaced
      expect(getCoopRendererNeutralizedLog()).not.toContain("SomeBrandNewMutatingPhase");
    });

    it("RUNS every allowlisted phase silently (no WOULD-BLOCK noise for legitimate phases)", () => {
      for (const phase of COOP_RENDERER_ALLOWED_PHASES) {
        expect(coopRendererGateNeutralizes(phase), `${phase} must run`).toBe(false);
      }
      expect(getCoopRendererWouldBlockLog(), "no allowlisted phase may produce a WOULD-BLOCK line").toEqual([]);
    });
  });

  // ── GATE-COMPLETENESS: the observed set must be fully covered by the allowlist ──
  describe("gate-completeness (observed-set vs allowlist)", () => {
    it("EVERY empirically-observed guest phase is on the allowlist (no live soft-lock under enforcement)", () => {
      const missing = COOP_GUEST_OBSERVED_PHASES.filter(p => !COOP_RENDERER_ALLOWED_PHASES.has(p));
      expect(
        missing,
        "these phases the guest ACTUALLY constructs are missing from the allowlist and would soft-lock a "
          + `live renderer under enforcement: ${missing.join(", ")}`,
      ).toEqual([]);
    });

    it("re-runs the collector logic: no observed phase is blocked under enforcement", () => {
      setCoopAuthoritativeGuestPredicate(() => true);
      setCoopRendererGateEnforced(true);
      for (const phase of COOP_GUEST_OBSERVED_PHASES) {
        coopRendererGateNeutralizes(phase);
      }
      // The gate recorded exactly the observed phases and blocked NONE of them.
      const observed = getObservedCoopGuestPhases();
      for (const phase of COOP_GUEST_OBSERVED_PHASES) {
        expect(observed.has(phase), `${phase} must be recorded in the observed set`).toBe(true);
      }
      expect(getCoopRendererNeutralizedLog(), "no observed guest phase may be neutralized").toEqual([]);
    });

    it("the observed constant contains no duplicates (hygiene)", () => {
      expect(new Set(COOP_GUEST_OBSERVED_PHASES).size).toBe(COOP_GUEST_OBSERVED_PHASES.length);
    });
  });

  // ── The allowlist and the legacy denylist are DISJOINT (a phase can't be both allowed and denied) ──
  it("the allowlist and the legacy resolution denylist are disjoint", () => {
    const overlap = [...COOP_RENDERER_DENIED_PHASES].filter(p => COOP_RENDERER_ALLOWED_PHASES.has(p));
    expect(overlap, `a phase cannot be both allowed and denied: ${overlap.join(", ")}`).toEqual([]);
  });

  it("records each neutralized leak (bounded) so the harness can prove what was caught", () => {
    expect(getCoopRendererNeutralizedLog()).toEqual([]);
    recordCoopRendererNeutralized("MovePhase");
    recordCoopRendererNeutralized("FaintPhase");
    expect(getCoopRendererNeutralizedLog()).toEqual(["MovePhase", "FaintPhase"]);
    resetCoopRendererNeutralizedLog();
    expect(getCoopRendererNeutralizedLog()).toEqual([]);
  });
});
