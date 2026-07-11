/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  armCoopLearnMoveBatchIntentResend,
  armCoopLearnMoveIntentResend,
  commitCoopLearnMoveBatchDecision,
  commitCoopLearnMoveDecision,
  resetCoopLearnMoveOperationFlag,
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

    sendCoopLearnMovePrompt(
      hostRuntime.interactionRelay,
      { type: "prompt", partySlot: SLOT, moveId: 57, maxMoveCount: 4 },
      { localRole: "host", wave: WAVE, turn: TURN },
    );
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

    send();
    armCoopLearnMoveIntentResend({ payload, wave: WAVE, turn: TURN, resend: send });
    expect(pair.faultsInjected()).toBe(1);
    expect((await awaited)?.choice).toBe(1);
    setCoopRuntime(hostRuntime);
    commitCoopLearnMoveDecision({ payload, ownerRole: "guest", localRole: "host", wave: WAVE, turn: TURN });
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

    sendCoopLearnMoveBatchPrompt(
      hostRuntime.interactionRelay,
      { type: "prompt", partySlot: SLOT, learnableIds: [57, 58], ownerIsGuest: true },
      { localRole: "host", wave: WAVE, turn: TURN },
    );
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
    const seq = COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + SLOT;
    const awaited = guestRuntime.interactionRelay.awaitInteractionChoice(seq, 100);
    const payload = {
      type: "decision" as const,
      partySlot: SLOT,
      assignments: [[57, 1]] as [number, number][],
      fallback: false,
    };
    setCoopRuntime(hostRuntime);

    hostRuntime.interactionRelay.sendInteractionChoice(seq, "learnMoveBatch", 1, [57, 1]);
    commitCoopLearnMoveBatchDecision({ payload, ownerRole: "host", localRole: "host", wave: WAVE, turn: TURN });

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

    send();
    armCoopLearnMoveBatchIntentResend({ payload, wave: WAVE, turn: TURN, resend: send });
    expect(pair.faultsInjected()).toBe(1);
    expect(await awaited).toMatchObject({ choice: 1, data: [57, 1] });
    setCoopRuntime(hostRuntime);
    commitCoopLearnMoveBatchDecision({ payload, ownerRole: "guest", localRole: "host", wave: WAVE, turn: TURN });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered).toBe(1);
    offCount();
  });
});
