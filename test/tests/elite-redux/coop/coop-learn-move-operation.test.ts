/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  armCoopLearnMoveBatchIntentResend,
  armCoopLearnMoveIntentResend,
  captureCoopLearnMoveOperationBinding,
  commitCoopLearnMoveBatchDecision,
  commitCoopLearnMoveDecision,
  resetCoopLearnMoveOperationFlag,
  resetCoopLearnMoveOperationState,
  resetCoopLearnMoveRetryMs,
  sendCoopLearnMoveBatchPrompt,
  sendCoopLearnMovePrompt,
  setCoopLearnMoveRetryMs,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
  COOP_LEARN_MOVE_FWD_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

const SLOT = 3;
const WAVE = 8;
const TURN = 2;

describe("co-op learn-move operation migration", () => {
  afterEach(() => {
    resetCoopLearnMoveRetryMs();
    resetCoopLearnMoveOperationFlag();
    clearCoopRuntime();
  });

  it("FAIL LOUD: an enabled prompt cannot hide a missing or wrong-role runtime behind its raw carrier", () => {
    const bare = createLoopbackPair();
    const bareRelay = new CoopInteractionRelay(bare.host);
    expect(() =>
      sendCoopLearnMovePrompt(
        bareRelay,
        { type: "prompt", partySlot: SLOT, moveId: 57, maxMoveCount: 4 },
        { localRole: "host", wave: WAVE, turn: TURN },
      ),
    ).toThrow(/\[coop-op\].*surface=learnMove/);
    bare.host.close();
    bare.guest.close();

    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(guestRuntime);
    const wrongRoleBinding = captureCoopLearnMoveOperationBinding("guest");
    expect(() =>
      sendCoopLearnMovePrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, moveId: 57, maxMoveCount: 4 },
        { localRole: "host", wave: WAVE, turn: TURN },
        wrongRoleBinding,
      ),
    ).toThrow(/binding role=guest.*localRole=host/);
    pair.host.close();
    pair.guest.close();
  });

  it("ASYNC BINDING: single and batch commits stay on the host ledger while the guest is ambient", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    guestRuntime.interactionRelay.onLearnMoveForward = () => {};
    guestRuntime.interactionRelay.onLearnMoveBatchForward = () => {};
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");

    // Both production send adapters resume with the peer ambient, but must retain and order on the host.
    setCoopRuntime(guestRuntime);
    expect(
      sendCoopLearnMovePrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, moveId: 57, maxMoveCount: 4 },
        { localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);
    expect(
      sendCoopLearnMoveBatchPrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, learnableIds: [57, 58], ownerIsGuest: true },
        { localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(hostRuntime.durability?.highWaterMarks()["op:global"], "both commits stayed on the host journal").toBe(2);
    expect(
      guestRuntime.durability?.highWaterMarks()["op:global"],
      "the ambient renderer never became a second authority",
    ).toBeUndefined();
    expect(guestRuntime.durability?.appliedMarks()["op:global"], "the renderer applied the same dense order").toBe(2);
  });

  it("FAIL CLOSED: a journal conflict suppresses both single and batch raw prompt carriers", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");
    let singles = 0;
    let batches = 0;
    guestRuntime.interactionRelay.onLearnMoveForward = () => singles++;
    guestRuntime.interactionRelay.onLearnMoveBatchForward = () => batches++;
    expect(
      hostRuntime.durability?.commit("op:global", 1, {
        t: "interactionChoice",
        seq: COOP_LEARN_MOVE_FWD_SEQ_BASE - 1,
        kind: "conflicting-test-entry",
        choice: -1,
      }),
    ).toBe(true);

    expect(
      sendCoopLearnMovePrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, moveId: 57, maxMoveCount: 4 },
        { localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(false);
    // The dense host clock advanced to two; conflict that address as well before the batch proposal.
    expect(
      hostRuntime.durability?.commit("op:global", 2, {
        t: "interactionChoice",
        seq: COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE - 1,
        kind: "conflicting-test-entry",
        choice: -1,
      }),
    ).toBe(true);
    expect(
      sendCoopLearnMoveBatchPrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, learnableIds: [57], ownerIsGuest: true },
        { localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(singles).toBe(0);
    expect(batches).toBe(0);
  });

  it("RECONNECT ISOLATION: a replacement renderer owns an independent retry map for the same decision", async () => {
    setCoopLearnMoveRetryMs(5);
    const oldPair = createLoopbackPair();
    const replacementPair = createLoopbackPair();
    const oldGuest = assembleCoopRuntime(oldPair.guest, { username: "Guest-old", netcodeMode: "authoritative" });
    const replacementGuest = assembleCoopRuntime(replacementPair.guest, {
      username: "Guest-rejoined",
      netcodeMode: "authoritative",
    });
    setCoopRuntime(oldGuest);
    const oldBinding = captureCoopLearnMoveOperationBinding("guest");
    setCoopRuntime(replacementGuest);
    const replacementBinding = captureCoopLearnMoveOperationBinding("guest");
    const payload = { type: "decision" as const, partySlot: SLOT, moveId: 57, forgetSlot: 1, maxMoveCount: 4 };
    let oldTicks = 0;
    let replacementTicks = 0;

    armCoopLearnMoveIntentResend({ payload, wave: WAVE, turn: TURN, resend: () => oldTicks++ }, oldBinding);
    armCoopLearnMoveIntentResend(
      { payload, wave: WAVE, turn: TURN, resend: () => replacementTicks++ },
      replacementBinding,
    );
    await new Promise(resolve => setTimeout(resolve, 18));
    expect(oldTicks).toBeGreaterThan(0);
    expect(replacementTicks).toBeGreaterThan(0);

    setCoopRuntime(oldGuest);
    resetCoopLearnMoveOperationState();
    const oldAtReset = oldTicks;
    const replacementAtOldReset = replacementTicks;
    await new Promise(resolve => setTimeout(resolve, 14));
    expect(oldTicks, "tearing down the retired runtime cancels only its timer").toBe(oldAtReset);
    expect(replacementTicks, "the replacement runtime remains live").toBeGreaterThan(replacementAtOldReset);

    setCoopRuntime(replacementGuest);
    resetCoopLearnMoveOperationState();
    oldPair.host.close();
    oldPair.guest.close();
    replacementPair.host.close();
    replacementPair.guest.close();
  });

  it("DURABILITY: dropping a per-move forward still opens exactly one guest picker", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: msg => msg.t === "interactionOutcome" },
      { seed: 0x1ea211 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let opened = 0;
    guestRuntime.interactionRelay.onLearnMoveForward = outcome => {
      expect(outcome).toMatchObject({ partySlot: SLOT, moveId: 57, maxMoveCount: 4 });
      opened++;
    };
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");

    expect(
      sendCoopLearnMovePrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, moveId: 57, maxMoveCount: 4 },
        { localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(pair.faultsInjected()).toBe(1);
    expect(opened).toBe(1);
  });

  it("INTENT RECOVERY: a dropped per-move owner decision is resent until committed", async () => {
    setCoopLearnMoveRetryMs(10);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "learnMove",
      },
      { seed: 0x1ea212 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopLearnMoveOperationBinding("guest");
    const payload = { type: "decision" as const, partySlot: SLOT, moveId: 57, forgetSlot: 1, maxMoveCount: 4 };
    const send = () =>
      guestRuntime.interactionRelay.sendInteractionChoice(COOP_LEARN_MOVE_FWD_SEQ_BASE + SLOT, "learnMove", 1);
    let delivered = 0;
    const offCount = pair.host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "learnMove") {
        delivered++;
      }
    });
    pair.armNextDrop("interactionChoice", "guest");
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(COOP_LEARN_MOVE_FWD_SEQ_BASE + SLOT, 100);

    // Model a picker callback resuming after the two-engine harness installed the authority ambiently.
    setCoopRuntime(hostRuntime);
    send();
    armCoopLearnMoveIntentResend({ payload, wave: WAVE, turn: TURN, resend: send }, guestBinding);
    expect(pair.faultsInjected()).toBe(1);
    expect((await awaited)?.choice).toBe(1);
    setCoopRuntime(hostRuntime);
    expect(
      commitCoopLearnMoveDecision(
        { payload, ownerRole: "guest", localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered).toBe(1);
    offCount();
  });

  it("DURABILITY: dropping a batch forward still opens exactly one guest panel", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: msg => msg.t === "interactionOutcome" },
      { seed: 0x1ea213 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let opened = 0;
    guestRuntime.interactionRelay.onLearnMoveBatchForward = outcome => {
      expect(outcome).toMatchObject({ partySlot: SLOT, learnableIds: [57, 58], ownerIsGuest: true });
      opened++;
    };
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");

    expect(
      sendCoopLearnMoveBatchPrompt(
        hostRuntime.interactionRelay,
        { type: "prompt", partySlot: SLOT, learnableIds: [57, 58], ownerIsGuest: true },
        { localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(pair.faultsInjected()).toBe(1);
    expect(opened).toBe(1);
  });

  it("DURABILITY: a dropped host-owned batch terminal still reaches the guest watcher exactly once", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "learnMoveBatch",
      },
      { seed: 0x1ea214 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");
    const seq = COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + SLOT;
    const awaited = guestRuntime.interactionRelay.awaitInteractionChoice(seq, 100);
    const payload = {
      type: "decision" as const,
      partySlot: SLOT,
      assignments: [[57, 1]] as [number, number][],
      fallback: false,
    };
    hostRuntime.interactionRelay.sendInteractionChoice(seq, "learnMoveBatch", 1, [57, 1]);
    expect(
      commitCoopLearnMoveBatchDecision(
        { payload, ownerRole: "host", localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);

    expect(pair.faultsInjected()).toBe(1);
    expect(await awaited).toMatchObject({ choice: 1, data: [57, 1], kind: "learnMoveBatch" });
    expect(await guestRuntime.interactionRelay.awaitInteractionChoice(seq, 10)).toBeNull();
  });

  it("INTENT RECOVERY: a dropped guest-owned batch terminal is resent until committed", async () => {
    setCoopLearnMoveRetryMs(10);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "learnMoveBatch",
      },
      { seed: 0x1ea215 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopLearnMoveOperationBinding("host");
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopLearnMoveOperationBinding("guest");
    const seq = COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + SLOT;
    const payload = {
      type: "decision" as const,
      partySlot: SLOT,
      assignments: [[57, 1]] as [number, number][],
      fallback: false,
    };
    const send = () => guestRuntime.interactionRelay.sendInteractionChoice(seq, "learnMoveBatch", 1, [57, 1]);
    let delivered = 0;
    const offCount = pair.host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "learnMoveBatch") {
        delivered++;
      }
    });
    pair.armNextDrop("interactionChoice", "guest");
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(seq, 100);

    // Same adversarial callback schedule for the batch terminal: explicit guest binding, host ambient.
    setCoopRuntime(hostRuntime);
    send();
    armCoopLearnMoveBatchIntentResend({ payload, wave: WAVE, turn: TURN, resend: send }, guestBinding);
    expect(pair.faultsInjected()).toBe(1);
    expect(await awaited).toMatchObject({ choice: 1, data: [57, 1] });
    setCoopRuntime(hostRuntime);
    expect(
      commitCoopLearnMoveBatchDecision(
        { payload, ownerRole: "guest", localRole: "host", wave: WAVE, turn: TURN },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered).toBe(1);
    offCount();
  });
});
