/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Atomic Mystery control snapshot contract. These are the engine-free state seams used by stateSync/hot
// rejoin before CoopReplayMePhase performs its real UI/terminal rebound.

import {
  captureCoopActiveMysteryControl,
  resetCoopActiveMysteryControl,
  restoreCoopActiveMysteryControl,
  restoreCoopMeInteractionStartForHarness,
  setCoopMeActivePresentation,
  setCoopMeColosseumControl,
  setCoopMeInteractionStart,
  setCoopMeOwnerIntentOrdinals,
  setCoopMeTerminalControl,
  setOnMePinCleared,
  setOnMeSnapshotRebind,
} from "#data/elite-redux/coop/coop-me-pin-state";
import {
  COOP_ME_BATTLE_SETTLED_CHOICE,
  COOP_ME_REWARD_SETTLED_CHOICE,
  makeCoopOperationId,
} from "#data/elite-redux/coop/coop-operation-envelope";
import { COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopActiveMysteryEncounterSnapshotV1 } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it, vi } from "vitest";

function terminalOp(counter: number, step: number): string {
  return makeCoopOperationId(1, 0, (COOP_ME_TERM_SEQ_BASE + counter) * 8000 + 4000 + step, "ME_TERMINAL");
}

describe("co-op Mystery active-control snapshot/rejoin", () => {
  let restoreSnapshotHook: () => void = () => {};

  afterEach(() => {
    restoreSnapshotHook();
    restoreSnapshotHook = () => {};
    setCoopMeInteractionStart(-1);
    resetCoopActiveMysteryControl();
  });

  it("captures an immutable exact selector and the later host terminal at one pinned address", () => {
    setCoopMeInteractionStart(41);
    const presentation = {
      k: "mePresent" as const,
      tokens: { itemName: "Host Relic" },
      meetsReqs: [true, false],
      labels: ["Take it", "Leave"],
    };
    setCoopMeActivePresentation(presentation);

    const pending = captureCoopActiveMysteryControl();
    expect(pending).toMatchObject({
      version: 1,
      interactionCounter: 41,
      terminal: "pending",
      presentation,
    });
    // Caller mutation cannot rewrite the retained authoritative screen.
    pending!.presentation!.labels[0] = "CORRUPTED";
    expect(captureCoopActiveMysteryControl()?.presentation?.labels[0]).toBe("Take it");

    setCoopMeTerminalControl("battle", 7, { operationId: terminalOp(41, 0), step: 0, choice: -1000 });
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      interactionCounter: 41,
      terminal: "battle",
      hostTurn: 7,
      presentation,
    });
    setCoopMeActivePresentation({ ...presentation, labels: ["LATE"] });
    expect(captureCoopActiveMysteryControl()?.terminal, "late UI cannot regress a committed terminal").toBe("battle");
    expect(captureCoopActiveMysteryControl()?.presentation?.labels[0]).toBe("Take it");
    setCoopMeTerminalControl("battle-settled", 7, {
      operationId: terminalOp(41, 1),
      step: 1,
      choice: COOP_ME_BATTLE_SETTLED_CHOICE,
    });
    const resumedPresentation = { ...presentation, labels: ["Continue", "Leave"] };
    setCoopMeActivePresentation(resumedPresentation);
    setCoopMeOwnerIntentOrdinals(41, 1, 2);
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      terminal: "battle-settled",
      terminalStep: 1,
      nextPickStep: 1,
      nextSubPickStep: 2,
      presentation: resumedPresentation,
    });
    setCoopMeTerminalControl("leave", undefined, { operationId: terminalOp(41, 2), step: 2, choice: -1 });
    setCoopMeTerminalControl("battle", 99, { operationId: terminalOp(41, 0), step: 0, choice: -1000 });
    expect(captureCoopActiveMysteryControl()?.terminal, "an old handoff cannot rewind the true leave").toBe("leave");
  });

  it("retains sequential Colosseum battle steps and admits only the exact next rejoin/final-leave address", () => {
    setCoopMeInteractionStart(47);
    expect(setCoopMeColosseumControl(47, { expectedRound: 1, boardRound: 1 })).toBe(true);
    setCoopMeTerminalControl("battle", 4, {
      operationId: terminalOp(47, 0),
      step: 0,
      choice: -1000,
    });
    setCoopMeTerminalControl("battle-settled", 4, {
      operationId: terminalOp(47, 1),
      step: 1,
      choice: COOP_ME_BATTLE_SETTLED_CHOICE,
    });
    expect(setCoopMeColosseumControl(47, { expectedRound: 2, boardRound: 2 })).toBe(true);
    setCoopMeTerminalControl("battle", 9, {
      operationId: terminalOp(47, 2),
      step: 2,
      choice: -1000,
    });
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      interactionCounter: 47,
      terminal: "battle",
      terminalStep: 2,
      hostTurn: 9,
      colosseum: { expectedRound: 2, boardRound: 2 },
    });

    const round2 = captureCoopActiveMysteryControl()!;
    expect(
      restoreCoopActiveMysteryControl({
        ...round2,
        revision: round2.revision + 1,
        terminal: "leave",
        terminalOperationId: terminalOp(47, 3),
        terminalStep: 3,
        terminalChoice: -1,
        hostTurn: undefined,
      }),
      "the exact next step cannot leave directly after a battle handoff",
    ).toBe(false);
    const settledRound2: CoopActiveMysteryEncounterSnapshotV1 = {
      ...round2,
      revision: round2.revision + 1,
      terminal: "battle-settled",
      terminalOperationId: terminalOp(47, 3),
      terminalStep: 3,
      terminalChoice: COOP_ME_BATTLE_SETTLED_CHOICE,
      hostTurn: 9,
    };
    expect(restoreCoopActiveMysteryControl(settledRound2)).toBe(true);
    const finalLeave: CoopActiveMysteryEncounterSnapshotV1 = {
      ...settledRound2,
      revision: settledRound2.revision + 1,
      terminal: "leave",
      terminalOperationId: terminalOp(47, 4),
      terminalStep: 4,
      terminalChoice: -1,
      hostTurn: undefined,
    };
    expect(restoreCoopActiveMysteryControl(finalLeave)).toBe(true);
    expect(captureCoopActiveMysteryControl()).toMatchObject({ terminal: "leave", terminalStep: 4 });
    setCoopMeTerminalControl("battle", 10, {
      operationId: terminalOp(47, 5),
      step: 5,
      choice: -1000,
    });
    expect(captureCoopActiveMysteryControl()?.terminal, "final leave remains terminal-final").toBe("leave");
  });

  it("a verified rejoin snapshot rebounds pending UI and terminal state exactly; delayed older state is rejected", () => {
    const rebound = vi.fn();
    restoreSnapshotHook = setOnMeSnapshotRebind(rebound);
    setCoopMeInteractionStart(53);
    const pending: CoopActiveMysteryEncounterSnapshotV1 = {
      version: 1,
      interactionCounter: 53,
      revision: 2,
      round: 1,
      terminal: "pending",
      presentation: {
        k: "mePresent",
        tokens: { selectedPokemon: "Snorlax" },
        meetsReqs: [true],
        labels: ["Investigate"],
      },
    };
    expect(restoreCoopActiveMysteryControl(pending)).toBe(true);
    expect(rebound).toHaveBeenLastCalledWith(pending);

    const leave: CoopActiveMysteryEncounterSnapshotV1 = {
      ...pending,
      revision: 3,
      terminal: "leave",
      terminalOperationId: terminalOp(53, 0),
      terminalStep: 0,
      terminalChoice: -1,
    };
    expect(restoreCoopActiveMysteryControl(leave)).toBe(true);
    expect(rebound).toHaveBeenLastCalledWith(leave);

    // A delayed snapshot from a lower interaction counter cannot rewind the live ME.
    setCoopMeInteractionStart(55);
    expect(restoreCoopActiveMysteryControl({ ...pending, interactionCounter: 53 })).toBe(false);
    expect(captureCoopActiveMysteryControl()).toMatchObject({ interactionCounter: 55, terminal: "pending" });
  });

  it("retains the exact nested cipher quiz presentation whose answer uses the intentional -1 sentinel", () => {
    setCoopMeInteractionStart(59);
    const presentation = {
      k: "mePresent" as const,
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: {
        kind: "quiz" as const,
        stopOnWrong: false,
        questions: [
          {
            kind: "cipher",
            answerId: -1,
            options: [],
            prompt: "",
            cipherWord: "VAULT",
            cipherOptions: ["VAULT", "RELIC", "CRYPT", "RUNIC"],
          },
        ],
      },
    };

    setCoopMeActivePresentation(presentation);
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      interactionCounter: 59,
      round: 1,
      terminal: "pending",
      presentation,
    });
  });

  it("accepts only monotonic content and exact same-revision idempotency on one counter", () => {
    setCoopMeInteractionStart(61);
    const pending: CoopActiveMysteryEncounterSnapshotV1 = {
      version: 1,
      interactionCounter: 61,
      revision: 2,
      round: 1,
      terminal: "pending",
      presentation: {
        k: "mePresent",
        tokens: {},
        meetsReqs: [true],
        labels: ["Continue"],
      },
    };
    expect(restoreCoopActiveMysteryControl(pending)).toBe(true);
    expect(restoreCoopActiveMysteryControl(pending), "exact equality is an idempotent rebind").toBe(true);
    expect(
      restoreCoopActiveMysteryControl({ ...pending, presentation: { ...pending.presentation!, labels: ["Changed"] } }),
      "different content at one revision is conflicting authority",
    ).toBe(false);
    expect(restoreCoopActiveMysteryControl({ ...pending, revision: 1 }), "lower revision cannot rewind").toBe(false);

    const battle: CoopActiveMysteryEncounterSnapshotV1 = {
      ...pending,
      revision: 3,
      terminal: "battle",
      terminalOperationId: terminalOp(61, 0),
      terminalStep: 0,
      terminalChoice: -1000,
    };
    expect(restoreCoopActiveMysteryControl(battle)).toBe(true);
    expect(
      restoreCoopActiveMysteryControl({
        ...battle,
        revision: 4,
        terminal: "leave",
        terminalOperationId: terminalOp(61, 1),
        terminalStep: 1,
        terminalChoice: -1,
        hostTurn: undefined,
      }),
      "the exact step-1 operation must settle the battle before it can leave",
    ).toBe(false);
    const settled: CoopActiveMysteryEncounterSnapshotV1 = {
      ...battle,
      revision: 4,
      terminal: "battle-settled",
      terminalOperationId: terminalOp(61, 1),
      terminalStep: 1,
      terminalChoice: COOP_ME_BATTLE_SETTLED_CHOICE,
    };
    expect(restoreCoopActiveMysteryControl(settled)).toBe(true);
    expect(
      restoreCoopActiveMysteryControl({
        ...settled,
        revision: 5,
        terminal: "leave",
        terminalOperationId: terminalOp(61, 2),
        terminalStep: 2,
        terminalChoice: -1,
        hostTurn: undefined,
      }),
      "the next exact operation may leave after the battle settlement",
    ).toBe(true);
    expect(
      restoreCoopActiveMysteryControl({
        ...pending,
        revision: 4,
        terminal: "pending",
      }),
      "terminal battle cannot regress to pending",
    ).toBe(false);
  });

  it("rejects a step-1 leave when no battle handoff was accepted", () => {
    setCoopMeInteractionStart(63);
    expect(
      restoreCoopActiveMysteryControl({
        version: 1,
        interactionCounter: 63,
        revision: 2,
        round: 0,
        terminal: "leave",
        terminalOperationId: terminalOp(63, 1),
        terminalStep: 1,
        terminalChoice: -1,
      }),
    ).toBe(false);
  });

  it("retains a no-battle pre-reward cursor and accepts only its step-1 final leave", () => {
    setCoopMeInteractionStart(67);
    setCoopMeTerminalControl("reward-settled", 3, {
      operationId: terminalOp(67, 0),
      step: 0,
      choice: COOP_ME_REWARD_SETTLED_CHOICE,
    });
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      interactionCounter: 67,
      terminal: "reward-settled",
      terminalStep: 0,
      hostTurn: 3,
    });
    setCoopMeTerminalControl("battle", 3, {
      operationId: terminalOp(67, 1),
      step: 1,
      choice: -1000,
    });
    expect(captureCoopActiveMysteryControl()?.terminal).toBe("reward-settled");
    setCoopMeTerminalControl("leave", undefined, {
      operationId: terminalOp(67, 1),
      step: 1,
      choice: -1,
    });
    expect(captureCoopActiveMysteryControl()).toMatchObject({
      terminal: "leave",
      terminalStep: 1,
    });
  });

  it("harness pin swaps are raw and never fire the other client's pin-clear hook", () => {
    const cleared = vi.fn();
    setCoopMeInteractionStart(71);
    setOnMePinCleared(cleared);
    restoreCoopMeInteractionStartForHarness(-1);
    expect(cleared).not.toHaveBeenCalled();
    expect(captureCoopActiveMysteryControl()).toMatchObject({ interactionCounter: 71 });
    setOnMePinCleared(null);
  });
});
