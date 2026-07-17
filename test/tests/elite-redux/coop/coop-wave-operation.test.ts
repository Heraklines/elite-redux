/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op POST-BATTLE WAVE-ADVANCE operation - THE KEYSTONE (Wave-2f run-state migration,
// docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §2.5 item 4, §8.6).
//
// Pure-logic spec (no game engine): the wave-advance is the guest-constructed post-battle tail
// migrated onto the authoritative operation model. This suite proves, engine-free:
//   1. WATCHER adoption gating: a host-stated advance is adopted; a STALE advance for an EARLIER wave
//      is REJECTED (stale:true = a legitimate skip, the lastResolvedWave successor); a DUPLICATE
//      re-delivery of an already-applied advance is a no-op (invariant 5).
//   2. FAIL-LOUD vs derive: a stale/dup rejection carries stale:true (the flag-ON caller skips); the
//      flag-OFF pass-through adopts verbatim (legacy derivation). Only flag-OFF derives.
//   3. Per-transition SANCTIONED TAILS: the boundary tails the op sanctions vary by outcome (wild win
//      vs trainer victory vs biome boundary vs game-over vs egg-lapse) - the §3 strict-tails instrument.
//   4. STRICT-TAILS gate: an unsanctioned shared tail fails closed under enforcement; observe rollback logs.
//
// The two-engine end-to-end + full-convergence proof (one per transition class) lives in
// coop-duo-wave-operation.test.ts (ER_SCENARIO). This is the fast deterministic lifecycle spec.
// =============================================================================

import { setCoopAuthoritativeGuestPredicate } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopMeTerminalSanctionedTails } from "#data/elite-redux/coop/coop-me-operation";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  adoptCoopBiomeTransitionSwitchPermit,
  armCoopBiomeTransitionTailPermit,
  COOP_RENDERER_ALLOWED_PHASES,
  COOP_WAVE_TAIL_PHASES,
  clearCoopBiomeTransitionTailPermit,
  coopRendererGateNeutralizes,
  getCoopTailWouldBlockLog,
  isCoopStrictTailsMode,
  markCoopBiomeTransitionHistoryRecorded,
  markCoopBiomeTransitionSwitchPrepared,
  resetCoopTailWouldBlockLog,
  setCoopRendererGateEnforced,
  setCoopStrictTailsMode,
  setCoopWaveTailSanction,
} from "#data/elite-redux/coop/coop-renderer-gate";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import {
  adoptWaveAdvanceWatcherChoice,
  captureCoopWaveAdvanceOperationBinding,
  commitWaveAdvanceOwnerIntent,
  coopWaveAdvanceSanctionedTails,
  isCoopWaveAdvanceOperationEnabled,
  isValidCoopSettledWaveAdvance,
  isValidCoopWaveAdvancePayload,
  preflightCoopWaveAdvanceEnvelope,
  resetCoopWaveAdvanceOperationFlag,
  resetCoopWaveAdvanceOperationState,
  resolveCoopBiomeBoundaryFlag,
  resolveCoopVictoryTailControl,
  setCoopWaveAdvanceOperationEnabled,
} from "#data/elite-redux/coop/coop-wave-operation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Build a host-stated wave-advance payload (the shape the host commits / the guest reconstructs). */
function payload(over: Partial<CoopWaveAdvancePayload> & { wave: number }): CoopWaveAdvancePayload {
  const isVictory = (over.outcome ?? "win") === "win" || (over.outcome ?? "win") === "capture";
  return {
    outcome: "win",
    nextLogicalPhase: isVictory ? "WAVE_VICTORY" : "WAVE_FLEE",
    nextWave: over.wave + 1,
    biomeChange: false,
    eggLapse: false,
    meBoundary: "none",
    ...(isVictory ? { victoryKind: "wild" as const } : {}),
    ...over,
  };
}

function settledState(wave: number, turn = 1): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: wave + 100,
    wave,
    turn,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: 0,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
}

function retainedEnvelope(wave: number): CoopAuthoritativeEnvelopeV1 {
  const authoritativeState = settledState(wave);
  const transition = payload({ wave, settledStateTick: authoritativeState.tick });
  return {
    version: 1,
    sessionEpoch: 1,
    revision: 1,
    wave,
    turn: authoritativeState.turn,
    logicalPhase: transition.nextLogicalPhase,
    pendingOperation: {
      id: `1:0:WAVE_ADVANCE:${wave}`,
      kind: "WAVE_ADVANCE",
      owner: 0,
      status: "applied",
      payload: transition,
    },
    authoritativeState,
  };
}

describe("co-op WAVE-ADVANCE operation - the keystone (Wave-2f)", () => {
  beforeEach(() => {
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    clearCoopBiomeTransitionTailPermit();
    setCoopWaveAdvanceOperationEnabled(true);
    resetCoopWaveAdvanceOperationState();
  });
  afterEach(() => {
    clearCoopBiomeTransitionTailPermit();
    resetCoopWaveAdvanceOperationFlag();
    resetCoopWaveAdvanceOperationState();
    setActiveCoopRuntimeOpState(null);
  });

  it("concrete VictoryPhase control uses the host boundary statement and never evaluates guest derivations", () => {
    const host = payload({ wave: 10, victoryKind: "wild", biomeChange: true, eggLapse: true });
    let localReads = 0;
    const local = (value: boolean) => () => {
      localReads++;
      return value;
    };
    const control = resolveCoopVictoryTailControl(host, {
      trainerWin: local(true),
      runContinues: local(false),
      biomeChange: local(false),
    });
    expect(control).toEqual({ trainerWin: false, runContinues: true, eggLapse: true, biomeChange: true });
    expect(localReads, "no contradictory guest-local tail predicate was evaluated").toBe(0);
  });

  it("represents a final victory as Victory -> BattleEnd -> GameOver without inventing a next wave", () => {
    const terminal = payload({
      wave: 200,
      nextWave: 200,
      victoryKind: "wild",
      biomeChange: false,
      eggLapse: false,
    });
    expect(isValidCoopWaveAdvancePayload(terminal)).toBe(true);
    expect(
      resolveCoopVictoryTailControl(terminal, {
        trainerWin: () => true,
        runContinues: () => true,
        biomeChange: () => true,
      }),
    ).toEqual({ trainerWin: false, runContinues: false, eggLapse: false, biomeChange: false });
    expect(coopWaveAdvanceSanctionedTails(terminal)).toEqual([
      "VictoryPhase",
      "BattleEndPhase",
      "CoopVictorySealPhase",
      "GameOverPhase",
    ]);
    expect(
      isValidCoopWaveAdvancePayload({ ...terminal, biomeChange: true }),
      "a terminal victory cannot also authorize a biome destination",
    ).toBe(false);
  });

  // ── WATCHER adoption + stale/dup gating ──────────────────────────────────
  describe("complete retained transaction preflight", () => {
    it("admits only an exact epoch/revision/id/wave/turn/state-tick/destination binding", () => {
      const envelope = retainedEnvelope(10);
      expect(preflightCoopWaveAdvanceEnvelope(envelope)?.payload.wave).toBe(10);

      const wrongEpoch: CoopAuthoritativeEnvelopeV1 = {
        ...envelope,
        sessionEpoch: envelope.sessionEpoch + 1,
        pendingOperation: {
          ...envelope.pendingOperation!,
          id: `2:0:WAVE_ADVANCE:${envelope.wave}`,
        },
      };
      expect(preflightCoopWaveAdvanceEnvelope(wrongEpoch), "a foreign session cannot stage DATA").toBeNull();

      const wrongTick: CoopAuthoritativeEnvelopeV1 = {
        ...envelope,
        authoritativeState: { ...envelope.authoritativeState, tick: envelope.authoritativeState.tick + 1 },
      };
      expect(preflightCoopWaveAdvanceEnvelope(wrongTick), "state tick cannot detach from its destination").toBeNull();

      const wrongWave: CoopAuthoritativeEnvelopeV1 = {
        ...envelope,
        authoritativeState: { ...envelope.authoritativeState, wave: envelope.authoritativeState.wave + 1 },
      };
      expect(preflightCoopWaveAdvanceEnvelope(wrongWave), "cross-wave DATA cannot apply").toBeNull();

      const wrongPhase: CoopAuthoritativeEnvelopeV1 = { ...envelope, logicalPhase: "SHOP" };
      expect(
        preflightCoopWaveAdvanceEnvelope(wrongPhase),
        "the envelope phase must equal the stated destination",
      ).toBeNull();
    });

    it("accepts a raw compatibility transition but refuses to classify it as settled DATA", () => {
      const raw = payload({ wave: 3 });
      const state = settledState(3);
      expect(isValidCoopWaveAdvancePayload(raw)).toBe(true);
      expect(isValidCoopSettledWaveAdvance(raw, state)).toBe(false);
    });
  });

  describe("WATCHER adoption gating (invariants 5, 6)", () => {
    it("fails closed on missing or role-mismatched continuation bindings", () => {
      const hostState = createCoopRuntimeOpState("host");
      const guestState = createCoopRuntimeOpState("guest");
      setActiveCoopRuntimeOpState(hostState);
      const hostBinding = captureCoopWaveAdvanceOperationBinding("host");
      setActiveCoopRuntimeOpState(guestState);
      const guestBinding = captureCoopWaveAdvanceOperationBinding("guest");
      const authoritativeState = settledState(5);
      const transition = payload({ wave: 5, settledStateTick: authoritativeState.tick });

      expect(() =>
        commitWaveAdvanceOwnerIntent(
          {
            payload: transition,
            authoritativeState,
            localRole: "host",
            wave: 5,
            turn: 1,
          },
          guestBinding,
        ),
      ).toThrow(/binding role=guest cannot execute localRole=host/);
      expect(() =>
        adoptWaveAdvanceWatcherChoice({ payload: transition, localRole: "guest", wave: 5, turn: 1 }, hostBinding),
      ).toThrow(/binding role=host cannot execute localRole=guest/);
      setActiveCoopRuntimeOpState(null);
      expect(() => captureCoopWaveAdvanceOperationBinding("guest")).toThrow(/no runtime installed/);
    });

    it("adopts a host-stated advance and returns its payload + sanctioned tails", () => {
      expect(isCoopWaveAdvanceOperationEnabled()).toBe(true);
      const d = adoptWaveAdvanceWatcherChoice({
        payload: payload({ wave: 5, victoryKind: "wild" }),
        localRole: "guest",
        wave: 5,
        turn: 1,
      });
      expect(d.adopt).toBe(true);
      if (d.adopt) {
        expect(d.payload.wave).toBe(5);
        expect(d.payload.outcome).toBe("win");
        expect(d.sanctionedTails).toContain("VictoryPhase");
      }
    });

    it("REJECTS (stale:true) a wave-advance for a wave STRICTLY BELOW the last adopted one (lastResolvedWave successor)", () => {
      // Adopt wave 8 first (advances the cross-wave order to 8).
      const adopted = adoptWaveAdvanceWatcherChoice({
        payload: payload({ wave: 8, victoryKind: "wild" }),
        localRole: "guest",
        wave: 8,
        turn: 1,
      });
      expect(adopted.adopt).toBe(true);
      // A stale advance for an EARLIER wave 6 must be rejected as a legitimate skip.
      const stale = adoptWaveAdvanceWatcherChoice({
        payload: payload({ wave: 6, victoryKind: "wild" }),
        localRole: "guest",
        wave: 6,
        turn: 1,
      });
      expect(stale.adopt).toBe(false);
      if (!stale.adopt) {
        expect(stale.reason).toBe("stale-or-duplicate");
        expect(stale.stale, "a stale advance is a legitimate skip, not a fail-loud").toBe(true);
      }
    });

    it("is a no-op (stale:true) on a DUPLICATE re-delivery of an already-applied advance (invariant 5)", () => {
      const first = adoptWaveAdvanceWatcherChoice({
        payload: payload({ wave: 10, victoryKind: "wild" }),
        localRole: "guest",
        wave: 10,
        turn: 1,
      });
      expect(first.adopt).toBe(true);
      const dup = adoptWaveAdvanceWatcherChoice({
        payload: payload({ wave: 10, victoryKind: "wild" }),
        localRole: "guest",
        wave: 10,
        turn: 1,
      });
      expect(dup.adopt).toBe(false);
      if (!dup.adopt) {
        expect(dup.stale).toBe(true);
      }
    });

    it("adopts a STRICTLY-LATER wave after an earlier one (the run advances monotonically)", () => {
      expect(
        adoptWaveAdvanceWatcherChoice({ payload: payload({ wave: 3 }), localRole: "guest", wave: 3, turn: 1 }).adopt,
      ).toBe(true);
      expect(
        adoptWaveAdvanceWatcherChoice({ payload: payload({ wave: 4 }), localRole: "guest", wave: 4, turn: 1 }).adopt,
      ).toBe(true);
    });
  });

  // ── flag-OFF pass-through (legacy derivation) ────────────────────────────
  describe("dual-run flag semantics (§5.1)", () => {
    it("flag OFF: pass-through adopt verbatim, NO operation gating (pure legacy derivation)", () => {
      setCoopWaveAdvanceOperationEnabled(false);
      // With the flag OFF a later wave then an earlier wave BOTH adopt (no stale gating - the legacy
      // pending.outcome derivation is the caller's control, this layer is a pass-through).
      expect(
        adoptWaveAdvanceWatcherChoice({ payload: payload({ wave: 9 }), localRole: "guest", wave: 9, turn: 1 }).adopt,
      ).toBe(true);
      expect(
        adoptWaveAdvanceWatcherChoice({ payload: payload({ wave: 7 }), localRole: "guest", wave: 7, turn: 1 }).adopt,
        "flag OFF never stale-rejects (the caller derives)",
      ).toBe(true);
    });

    it("a null payload is a no-op skip regardless of flag", () => {
      const d = adoptWaveAdvanceWatcherChoice({ payload: null, localRole: "guest", wave: 1, turn: 1 });
      expect(d.adopt).toBe(false);
      if (!d.adopt) {
        expect(d.stale).toBe(true);
      }
    });
  });

  // ── HOST commit smoke (exactly-once is the CoopOperationHost spec; here: no-op guards) ──
  describe("HOST commit seam", () => {
    it("is a no-op when the local client is NOT the host (the guest never commits a wave-advance)", () => {
      // Must not throw; the guest is always the watcher for a host-driven wave-advance.
      const authoritativeState = settledState(2);
      expect(() =>
        commitWaveAdvanceOwnerIntent({
          payload: payload({ wave: 2, settledStateTick: authoritativeState.tick }),
          authoritativeState,
          localRole: "guest",
          wave: 2,
          turn: 1,
        }),
      ).not.toThrow();
    });

    it("is a no-op when the flag is OFF, and never throws on the host path", () => {
      const authoritativeState = settledState(2);
      const transition = payload({ wave: 2, settledStateTick: authoritativeState.tick });
      setCoopWaveAdvanceOperationEnabled(false);
      expect(() =>
        commitWaveAdvanceOwnerIntent({
          payload: transition,
          authoritativeState,
          localRole: "host",
          wave: 2,
          turn: 1,
        }),
      ).not.toThrow();
      setCoopWaveAdvanceOperationEnabled(true);
      expect(() =>
        commitWaveAdvanceOwnerIntent({
          payload: transition,
          authoritativeState,
          localRole: "host",
          wave: 2,
          turn: 1,
        }),
      ).not.toThrow();
    });
  });

  // ── per-transition SANCTIONED TAILS (the §3 strict-tails instrument) ──────
  describe("sanctioned tails per transition class (§3.3 KEYSTONE)", () => {
    it("WILD win: Victory cascade WITHOUT TrainerVictoryPhase", () => {
      const tails = coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "win", victoryKind: "wild" }));
      expect(tails).toEqual(
        expect.arrayContaining([
          "VictoryPhase",
          "BattleEndPhase",
          "CoopVictorySealPhase",
          "NewBattlePhase",
          "NextEncounterPhase",
        ]),
      );
      expect(tails).not.toContain("TrainerVictoryPhase");
      expect(tails).not.toContain("GameOverPhase");
    });

    it("TRAINER victory: Victory cascade WITH TrainerVictoryPhase", () => {
      const tails = coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "win", victoryKind: "trainer" }));
      expect(tails).toContain("VictoryPhase");
      expect(tails).toContain("TrainerVictoryPhase");
      expect(tails).toContain("CoopVictorySealPhase");
    });

    it("CAPTURE retains its established BattleEnd settlement without an automatic-victory seal", () => {
      const tails = coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "capture", victoryKind: "wild" }));
      expect(tails).toContain("BattleEndPhase");
      expect(tails).not.toContain("CoopVictorySealPhase");
    });

    it("BIOME boundary sanctions only SelectBiome; destination tails require the later exact pick", () => {
      const tails = coopWaveAdvanceSanctionedTails(
        payload({ wave: 10, outcome: "win", victoryKind: "wild", biomeChange: true }),
      );
      expect(tails).toContain("SelectBiomePhase");
      expect(tails).not.toContain("SwitchBiomePhase");
      expect(tails).not.toContain("NewBiomeEncounterPhase");
    });

    it("EGG LAPSE: adds EggLapsePhase", () => {
      const tails = coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "win", eggLapse: true }));
      expect(tails).toContain("EggLapsePhase");
    });

    it("FLEE: BattleEnd -> NewBattle tail, no VictoryPhase", () => {
      const tails = coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "flee" }));
      expect(tails).toContain("BattleEndPhase");
      expect(tails).toContain("NewBattlePhase");
      expect(tails).not.toContain("VictoryPhase");
    });

    it("GAME OVER: only GameOverPhase", () => {
      const tails = coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "gameOver" }));
      expect(tails).toEqual(["GameOverPhase"]);
    });

    it("every sanctioned tail is a real allowlisted phase the guest constructs (no phantom names)", () => {
      const all = new Set<string>([
        ...coopWaveAdvanceSanctionedTails(
          payload({ wave: 5, outcome: "win", victoryKind: "trainer", biomeChange: true, eggLapse: true }),
        ),
        ...coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "flee", biomeChange: true })),
        ...coopWaveAdvanceSanctionedTails(payload({ wave: 5, outcome: "gameOver" })),
      ]);
      // A sanctioned tail is either a boundary-tail group member (strict-tails gated) OR a legitimately-
      // constructed input-intent allowlist phase (e.g. SelectBiomePhase). Either way it must be a real
      // allowlisted phase - never a phantom name.
      for (const t of all) {
        expect(
          COOP_WAVE_TAIL_PHASES.has(t) || COOP_RENDERER_ALLOWED_PHASES.has(t),
          `${t} must be a real allowlisted phase`,
        ).toBe(true);
      }
    });
  });
});

// =====================================================================================
// STRICT-TAILS gate: shared boundary tails require an authoritative wave/ME sanction under enforcement.
// =====================================================================================
it("normalizes an undefined ordinary-wave biome predicate to a concrete false wire flag", () => {
  expect(resolveCoopBiomeBoundaryFlag(false, undefined)).toBe(false);
  expect(resolveCoopBiomeBoundaryFlag(undefined, undefined)).toBe(false);
  expect(resolveCoopBiomeBoundaryFlag(false, true)).toBe(true);
  expect(resolveCoopBiomeBoundaryFlag(true, undefined)).toBe(true);
});

describe("co-op STRICT-TAILS renderer gate mode (Wave-2f, §3.3)", () => {
  beforeEach(() => {
    clearCoopBiomeTransitionTailPermit();
    setCoopRendererGateEnforced(true);
    setCoopStrictTailsMode(true);
    setCoopWaveTailSanction(null);
    resetCoopTailWouldBlockLog();
    setCoopAuthoritativeGuestPredicate(() => true); // the authoritative guest (else the gate short-circuits)
  });
  afterEach(() => {
    clearCoopBiomeTransitionTailPermit();
    setCoopAuthoritativeGuestPredicate(null);
    setCoopStrictTailsMode(false);
    setCoopWaveTailSanction(null);
    resetCoopTailWouldBlockLog();
  });

  it("defaults to ON (strict-tail mismatches are always observable)", () => {
    expect(isCoopStrictTailsMode()).toBe(true);
  });

  it("OFF: never logs TAIL WOULD-BLOCK, never neutralizes a boundary tail (byte-for-byte today)", () => {
    setCoopStrictTailsMode(false);
    for (const tail of COOP_WAVE_TAIL_PHASES) {
      expect(coopRendererGateNeutralizes(tail), `${tail} still runs`).toBe(false);
    }
    expect(getCoopTailWouldBlockLog()).toHaveLength(0);
  });

  it("ON, unsanctioned: blocks the tail under renderer enforcement", () => {
    setCoopStrictTailsMode(true);
    setCoopWaveTailSanction(["VictoryPhase"]); // only VictoryPhase is op-sanctioned this advance
    // VictoryPhase is sanctioned -> no would-block.
    expect(coopRendererGateNeutralizes("VictoryPhase")).toBe(false);
    // BattleEndPhase is NOT sanctioned this advance -> fail closed.
    expect(coopRendererGateNeutralizes("BattleEndPhase"), "unsanctioned tail is neutralized").toBe(true);
    expect(getCoopTailWouldBlockLog()).toContain("BattleEndPhase");
    expect(getCoopTailWouldBlockLog()).not.toContain("VictoryPhase");
  });

  it("renderer observe rollback logs an unsanctioned tail but lets it run", () => {
    setCoopRendererGateEnforced(false);
    setCoopStrictTailsMode(true);
    setCoopWaveTailSanction([]);
    expect(coopRendererGateNeutralizes("BattleEndPhase")).toBe(false);
    expect(getCoopTailWouldBlockLog()).toContain("BattleEndPhase");
  });

  it("ON with a matching sanction set: a fully-sanctioned tail produces ZERO would-block (the clean-run target)", () => {
    setCoopStrictTailsMode(true);
    const sanction = coopWaveAdvanceSanctionedTails({
      wave: 12,
      outcome: "win",
      nextLogicalPhase: "WAVE_VICTORY",
      nextWave: 13,
      biomeChange: false,
      eggLapse: true,
      meBoundary: "none",
      victoryKind: "wild",
    });
    setCoopWaveTailSanction(sanction);
    for (const t of sanction) {
      expect(coopRendererGateNeutralizes(t)).toBe(false);
    }
    expect(getCoopTailWouldBlockLog(), "a run whose tails match the op's sanction has zero would-block").toHaveLength(
      0,
    );
  });

  it.each(["leave", "battle"] as const)("ON with a host-stated ME %s terminal sanctions its exact tail", terminal => {
    setCoopStrictTailsMode(true);
    const sanction = coopMeTerminalSanctionedTails(terminal);
    setCoopWaveTailSanction(sanction);
    for (const tail of sanction) {
      expect(coopRendererGateNeutralizes(tail)).toBe(false);
    }
    expect(getCoopTailWouldBlockLog()).toHaveLength(0);
  });

  it("ON with NO adopted op (null sanction): every boundary tail blocks (a tail built without an op)", () => {
    setCoopStrictTailsMode(true);
    setCoopWaveTailSanction(null);
    expect(coopRendererGateNeutralizes("VictoryPhase")).toBe(true);
    expect(getCoopTailWouldBlockLog()).toContain("VictoryPhase");
  });

  it("a biome tail blocks without a permit and admits only the matching, fully-prepared exact permit", () => {
    const sanction = coopWaveAdvanceSanctionedTails(
      payload({ wave: 10, outcome: "win", victoryKind: "wild", biomeChange: true }),
    );
    setCoopWaveTailSanction(sanction);
    expect(coopRendererGateNeutralizes("SwitchBiomePhase", [30])).toBe(true);
    expect(coopRendererGateNeutralizes("NewBiomeEncounterPhase")).toBe(true);

    expect(
      armCoopBiomeTransitionTailPermit({
        operationId: "1:0:BIOME_PICK:9800011",
        sessionEpoch: 1,
        revision: 1,
        wave: 10,
        sourceBiomeId: 1,
        destinationBiomeId: 30,
        nextWave: 11,
      }),
    ).toBe(true);
    expect(coopRendererGateNeutralizes("SwitchBiomePhase", [31]), "wrong destination remains blocked").toBe(true);
    expect(coopRendererGateNeutralizes("SwitchBiomePhase", [30]), "exact destination can enter Switch").toBe(false);
    expect(coopRendererGateNeutralizes("NewBiomeEncounterPhase"), "unprepared Switch cannot construct NewBiome").toBe(
      true,
    );

    const adopted = adoptCoopBiomeTransitionSwitchPermit({ destinationBiomeId: 30, sourceBiomeId: 1, wave: 10 });
    expect(adopted).not.toBeNull();
    expect(markCoopBiomeTransitionHistoryRecorded(adopted!.operationId)).not.toBeNull();
    expect(markCoopBiomeTransitionSwitchPrepared(adopted!.operationId)).not.toBeNull();
    expect(coopRendererGateNeutralizes("NewBiomeEncounterPhase")).toBe(false);
  });

  it("ON: a non-boundary-tail allowlist phase is NEVER strict-tails checked", () => {
    setCoopStrictTailsMode(true);
    setCoopWaveTailSanction([]); // nothing sanctioned
    expect(coopRendererGateNeutralizes("CommandPhase")).toBe(false); // input-intent, not a boundary tail
    expect(getCoopTailWouldBlockLog()).not.toContain("CommandPhase");
  });

  it("ON: account-local deterministic EggLapsePhase is allowlisted but not operation-sanction checked", () => {
    setCoopStrictTailsMode(true);
    setCoopWaveTailSanction([]);
    expect(coopRendererGateNeutralizes("EggLapsePhase")).toBe(false);
    expect(getCoopTailWouldBlockLog()).not.toContain("EggLapsePhase");
  });
});
