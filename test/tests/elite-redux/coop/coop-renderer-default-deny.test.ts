/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op RENDERER default-deny gate (#633, M1 - authoritative session replication redesign).
// Pure-logic test (no game engine): proves the decision logic that makes the authoritative
// GUEST a pure renderer. A host-authoritative battle-RESOLUTION phase is neutralized ONLY on
// the live authoritative guest; solo / host / lockstep read false and are byte-for-byte
// unaffected. The real PhaseManager.create() wiring is exercised end-to-end by the two-engine
// duo suite (a broken gate would soft-lock the renderer and fail those tests) + tsc.
// See docs/plans/2026-07-02-coop-authoritative-replication-redesign.md.

import { setCoopAuthoritativeGuestPredicate } from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  COOP_RENDERER_DENIED_PHASES,
  getCoopRendererNeutralizedLog,
  isCoopRendererNeutralizedPhase,
  recordCoopRendererNeutralized,
  resetCoopRendererNeutralizedLog,
} from "#data/elite-redux/coop/coop-renderer-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("co-op renderer default-deny gate (#633, M1)", () => {
  beforeEach(() => {
    resetCoopRendererNeutralizedLog();
  });
  afterEach(() => {
    // Never leak the predicate into the next test file (solo / host must read false).
    setCoopAuthoritativeGuestPredicate(null);
    resetCoopRendererNeutralizedLog();
  });

  it("neutralizes NOTHING when there is no live session (solo / host / lockstep read false)", () => {
    setCoopAuthoritativeGuestPredicate(null); // the default
    for (const phase of COOP_RENDERER_DENIED_PHASES) {
      expect(isCoopRendererNeutralizedPhase(phase), `${phase} must not be neutralized off a session`).toBe(false);
    }
  });

  it("neutralizes NOTHING for the host / a lockstep client (predicate false)", () => {
    setCoopAuthoritativeGuestPredicate(() => false);
    expect(isCoopRendererNeutralizedPhase("MovePhase")).toBe(false);
    expect(isCoopRendererNeutralizedPhase("EnemyCommandPhase")).toBe(false);
  });

  it("neutralizes EVERY battle-resolution phase on the authoritative renderer", () => {
    setCoopAuthoritativeGuestPredicate(() => true); // the authoritative guest
    for (const phase of COOP_RENDERER_DENIED_PHASES) {
      expect(isCoopRendererNeutralizedPhase(phase), `${phase} must be neutralized on the renderer`).toBe(true);
    }
  });

  it("NEVER neutralizes the renderer's own input / render / launch / interaction phases", () => {
    setCoopAuthoritativeGuestPredicate(() => true);
    // The renderer legitimately RUNS: its own input, the CoopReplay* render phases, launch +
    // turn scaffolding, cosmetic, and interactions. None may be neutralized or it would soft-lock.
    const allowed = [
      "CommandPhase",
      "SelectTargetPhase",
      "TurnInitPhase",
      "TurnStartPhase",
      "CoopReplayTurnPhase",
      "CoopFinalizeTurnPhase",
      "CoopMoveAnimReplayPhase",
      "CoopFaintReplayPhase",
      "EncounterPhase",
      "MessagePhase",
      "SelectModifierPhase",
      "BattleEndPhase",
    ];
    for (const phase of allowed) {
      expect(isCoopRendererNeutralizedPhase(phase), `${phase} must NOT be neutralized`).toBe(false);
    }
  });

  it("records each neutralized leak (bounded) so the harness can prove what was caught", () => {
    setCoopAuthoritativeGuestPredicate(() => true);
    expect(getCoopRendererNeutralizedLog()).toEqual([]);
    recordCoopRendererNeutralized("MovePhase");
    recordCoopRendererNeutralized("FaintPhase");
    expect(getCoopRendererNeutralizedLog()).toEqual(["MovePhase", "FaintPhase"]);
    resetCoopRendererNeutralizedLog();
    expect(getCoopRendererNeutralizedLog()).toEqual([]);
  });

  it("the denied set is EXACTLY the pure battle-resolution phases (no scaffolding / cosmetic)", () => {
    expect([...COOP_RENDERER_DENIED_PHASES].sort()).toEqual(
      [
        "AttemptCapturePhase",
        "EnemyCommandPhase",
        "FaintPhase",
        "MoveEffectPhase",
        "MovePhase",
        "StatStageChangePhase",
      ].sort(),
    );
  });
});
