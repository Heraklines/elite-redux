/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Engine-free contracts for the T3 Mystery/Colosseum identity hardening. These tests deliberately avoid
// Phaser and exercise the exact retry/rejoin seams that previously allowed one logical address to acquire
// different meaning after a dropped carrier or hot channel replacement.

import {
  commitColosseumBoard,
  resetCoopColosseumOperationFlag,
  resetCoopColosseumOperationState,
  setCoopColosseumOperationEnabled,
} from "#data/elite-redux/coop/coop-colosseum-operation";
import { adoptCoopMeCommittedOwnerOrdinal, CoopMeTerminalOutcomeLatch } from "#data/elite-redux/coop/coop-me-operation";
import {
  CoopMePresentationIntentGate,
  captureCoopActiveMysteryControl,
  isValidCoopActiveMysteryControl,
  resetCoopActiveMysteryControl,
  resolveCoopMeOwnerIntentRebind,
  restoreCoopActiveMysteryControl,
  setCoopMeActivePresentation,
  setCoopMeColosseumControl,
  setCoopMeInteractionStart,
  setCoopMeOwnerIntentOrdinals,
  setCoopMeTerminalControl,
} from "#data/elite-redux/coop/coop-me-pin-state";
import { type CoopPendingOperation, makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { type CoopCommitContext, CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

function state(wave = 7, turn = 2): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 4,
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

function context(wave = 7, turn = 2): CoopCommitContext {
  return { wave, turn, logicalPhase: "MYSTERY_ENCOUNTER", authoritativeState: state(wave, turn) };
}

describe("T3 operation identity and reconnect ordinals", () => {
  afterEach(() => {
    setCoopMeInteractionStart(-1);
    resetCoopActiveMysteryControl();
    resetCoopColosseumOperationState();
    resetCoopColosseumOperationFlag();
  });

  it("re-ACKs the canonical first result at the exact boundary and rejects cross-boundary collisions", () => {
    const host = new CoopOperationHost({ epoch: 3 });
    const original: CoopPendingOperation = {
      id: makeCoopOperationId(3, 1, 88, "ME_SUB"),
      kind: "ME_SUB",
      owner: 1,
      status: "proposed",
      payload: { value: 0, nested: { a: 1, b: 2 } },
    };
    expect(host.submit(original, context(), () => ({ ok: true })).kind).toBe("committed");

    const reordered: CoopPendingOperation = {
      ...original,
      payload: { nested: { b: 2, a: 1 }, value: 0 },
    };
    expect(host.submit(reordered, context(), () => ({ ok: true })).kind).toBe("reack");

    const changedPayload = host.submit(
      { ...original, payload: { value: 1, nested: { a: 1, b: 2 } } },
      context(),
      () => ({ ok: true }),
    );
    expect(changedPayload.kind).toBe("reack");
    if (changedPayload.kind !== "reack") {
      throw new Error("same-boundary deterministic retry did not return canonical authority");
    }
    expect(changedPayload.op.payload, "the first committed value wins; the late payload is never adopted").toEqual(
      original.payload,
    );

    const changedContext = host.submit(original, context(8, 2), () => ({ ok: true }));
    expect(changedContext).toEqual({ kind: "rejected-late", reason: "conflicting-retry" });
    expect(host.getRevision(), "conflicts never create a second mutation").toBe(1);
  });

  it("retains monotonic Mystery pick/sub ordinals and rejects poisoned or regressing snapshots", () => {
    setCoopMeInteractionStart(21);
    setCoopMeOwnerIntentOrdinals(21, 2, 3);
    const retained = captureCoopActiveMysteryControl()!;
    expect(retained).toMatchObject({ nextPickStep: 2, nextSubPickStep: 3 });

    setCoopMeOwnerIntentOrdinals(21, Number.NaN, 4);
    setCoopMeOwnerIntentOrdinals(21, 1_000, 4);
    expect(captureCoopActiveMysteryControl(), "one invalid field rejects the atomic update").toEqual(retained);

    expect(
      restoreCoopActiveMysteryControl({
        ...retained,
        revision: retained.revision + 1,
        nextPickStep: 1,
        nextSubPickStep: 3,
      }),
      "a newer carrier cannot rewind an already accepted owner ordinal",
    ).toBe(false);
    expect(isValidCoopActiveMysteryControl({ ...retained, nextSubPickStep: 1_000 })).toBe(false);
  });

  it("rewinds a lost uncommitted local proposal to the host-confirmed ordinal on rejoin", () => {
    setCoopMeInteractionStart(23);
    const hostBeforeProposal = captureCoopActiveMysteryControl()!;
    expect(resolveCoopMeOwnerIntentRebind(hostBeforeProposal, 1)).toEqual({
      pickStep: 0,
      subPickStep: 0,
      retryUncommittedPick: true,
    });
  });

  it("projects a committed owner envelope before rejecting an older ordinal snapshot", () => {
    setCoopMeInteractionStart(25);
    const beforeCommit = captureCoopActiveMysteryControl()!;
    const seq = 8_000_000 + 25;
    const applied: CoopPendingOperation = {
      id: makeCoopOperationId(3, 1, seq * 8000 + 1000, "ME_PICK"),
      kind: "ME_PICK",
      owner: 1,
      status: "applied",
      payload: { optionIndex: 0 },
    };
    expect(adoptCoopMeCommittedOwnerOrdinal(applied)).toBe(true);
    const afterCommit = captureCoopActiveMysteryControl()!;
    expect(afterCommit.nextPickStep).toBe(1);
    expect(
      restoreCoopActiveMysteryControl({
        ...beforeCommit,
        revision: afterCommit.revision + 1,
      }),
      "even a later carrier revision cannot erase a journal-confirmed owner ordinal",
    ).toBe(false);
  });

  it("allows one sub-pick per committed presentation identity and rearms only for a new presentation", () => {
    const gate = new CoopMePresentationIntentGate();
    expect(gate.bind("revision-7/round-2")).toBe(true);
    expect(gate.claim("revision-7/round-2")).toBe(true);
    expect(gate.claim("revision-7/round-2"), "a double UI callback cannot mint the next step").toBe(false);
    expect(gate.bind("revision-7/round-2"), "a duplicate carrier cannot rearm the settled prompt").toBe(false);
    expect(gate.claim("revision-7/round-2")).toBe(false);
    expect(gate.bind("revision-8/round-3"), "only a newly committed presentation rearms input").toBe(true);
    expect(gate.claim("revision-8/round-3")).toBe(true);
  });

  it("captures the terminal outcome once and reuses it when an exact journal retry follows", () => {
    const latch = new CoopMeTerminalOutcomeLatch();
    let captures = 0;
    const capture = () => {
      captures++;
      if (captures > 1) {
        throw new Error("a retry must not recapture or advance producer state");
      }
      return {
        k: "meResync" as const,
        base: null,
        party: [],
        meSaveData: "[]",
        seed: "seed",
        waveSeed: "wave-seed",
        dex: "dex",
      };
    };
    const first = latch.getOrCapture(capture);
    const retry = latch.getOrCapture(capture);
    expect(retry).toEqual(first);
    expect(captures).toBe(1);
  });

  it("establishes a one-based Colosseum board origin and makes every same-round retry immutable", () => {
    setCoopColosseumOperationEnabled(false);
    const first = commitColosseumBoard({
      pinned: 31,
      round: 1,
      labels: ["Continue", "Cash out"],
      localRole: "host",
      wave: 10,
    });
    expect(first).toEqual({ operationId: null, round: 1 });
    expect(
      commitColosseumBoard({
        pinned: 31,
        round: 1,
        labels: ["Continue", "Cash out"],
        localRole: "host",
        wave: 10,
      }),
      "the exact lost-carrier retry reuses the established round",
    ).toEqual(first);
    expect(
      commitColosseumBoard({
        pinned: 31,
        round: 1,
        labels: ["Different semantic board", "Cash out"],
        localRole: "host",
        wave: 10,
      }),
      "one round cannot be recaptured with different labels",
    ).toBeNull();
    expect(
      commitColosseumBoard({
        pinned: 31,
        round: 3,
        labels: ["Continue", "Cash out"],
        localRole: "host",
        wave: 10,
      }),
      "a future board cannot skip the next exact round",
    ).toBeNull();
    expect(
      commitColosseumBoard({
        pinned: 31,
        round: 2,
        labels: ["Continue", "Cash out"],
        localRole: "host",
        wave: 10,
      }),
    ).toEqual({ operationId: null, round: 2 });
  });

  it("serializes Colosseum board/decision recovery state and refuses a rewind or changed same-round pick", () => {
    setCoopMeInteractionStart(33);
    setCoopMeTerminalControl("battle", 0, {
      operationId: makeCoopOperationId(3, 0, (9_000_000 + 33) * 8000 + 4000, "ME_TERMINAL"),
      step: 0,
      choice: -1000,
    });
    setCoopMeActivePresentation(
      {
        k: "mePresent",
        tokens: { coopColosseumRound: "1" },
        meetsReqs: [],
        labels: [],
        subPrompt: { kind: "secondary", labels: ["Continue", "Cash out"] },
      },
      true,
    );
    expect(setCoopMeColosseumControl(33, { expectedRound: 1, boardRound: 1 })).toBe(true);
    expect(
      setCoopMeColosseumControl(33, {
        expectedRound: 1,
        boardRound: 1,
        decision: { round: 1, index: 0, operationId: "3:1:COLO_PICK:3303" },
      }),
    ).toBe(true);
    const decided = captureCoopActiveMysteryControl()!;
    expect(decided.terminal, "between-round boards retain the accepted battle handoff").toBe("battle");
    expect(JSON.parse(JSON.stringify(decided))).toEqual(decided);
    expect(
      restoreCoopActiveMysteryControl({
        ...decided,
        revision: decided.revision + 1,
        colosseum: {
          expectedRound: 1,
          boardRound: 1,
          decision: { round: 1, index: 1, operationId: "3:1:COLO_PICK:3303" },
        },
      }),
      "one retained board cannot acquire a different choice",
    ).toBe(false);
    expect(setCoopMeColosseumControl(33, { expectedRound: 2 })).toBe(true);
    expect(
      restoreCoopActiveMysteryControl({ ...decided, revision: captureCoopActiveMysteryControl()!.revision + 1 }),
      "an older board cannot rewind the next expected round",
    ).toBe(false);
  });
});
