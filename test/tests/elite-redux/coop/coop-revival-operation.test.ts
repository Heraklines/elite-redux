/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { COOP_REVIVAL_SEQ_BASE, sendCoopRevivalChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  armCoopRevivalIntentResend,
  commitRevivalAuthorityDecision,
  resetCoopRevivalOperationFlag,
  resetCoopRevivalRetryMs,
  sendCoopRevivalPrompt,
  setCoopRevivalOperationEnabled,
  setCoopRevivalRetryMs,
} from "#data/elite-redux/coop/coop-revival-operation";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op Revival Blessing operation migration", () => {
  afterEach(() => {
    resetCoopRevivalRetryMs();
    resetCoopRevivalOperationFlag();
    clearCoopRuntime();
  });

  it("keeps the pure legacy prompt and choice carriers working when the operation flag is off", async () => {
    setCoopRevivalOperationEnabled(false);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    let prompts = 0;
    guestRuntime.interactionRelay.onRevivalPrompt = () => prompts++;
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(
      COOP_REVIVAL_SEQ_BASE + COOP_GUEST_FIELD_INDEX,
      25,
    );

    sendCoopRevivalPrompt(hostRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, {
      localRole: "host",
      wave: 1,
      turn: 1,
    });
    sendCoopRevivalChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 3, [0, 9]);

    expect(await awaited).toMatchObject({ choice: 3, data: [0, 9], kind: "revival" });
    expect(prompts).toBe(1);
  });

  it("DURABILITY + EXACTLY ONCE: a dropped raw prompt is materialized once from the journal", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "revivalPrompt",
      },
      { seed: 0x2e717e },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let prompts = 0;
    guestRuntime.interactionRelay.onRevivalPrompt = fieldIndex => {
      expect(fieldIndex).toBe(COOP_GUEST_FIELD_INDEX);
      prompts++;
    };
    setCoopRuntime(hostRuntime);

    sendCoopRevivalPrompt(hostRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, {
      localRole: "host",
      wave: 4,
      turn: 2,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(pair.faultsInjected(), "the raw revivalPrompt was actually dropped").toBe(1);
    expect(prompts, "the committed prompt opened exactly one guest picker").toBe(1);
  });

  it("EXACTLY ONCE: the journal prompt and its raw legacy echo open only one picker", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let prompts = 0;
    guestRuntime.interactionRelay.onRevivalPrompt = () => prompts++;
    setCoopRuntime(hostRuntime);

    sendCoopRevivalPrompt(hostRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, {
      localRole: "host",
      wave: 4,
      turn: 3,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(prompts, "raw + journal are two carriers for one prompt").toBe(1);
  });

  it("INTENT RECOVERY: a dropped owner choice is resent until the host commits the resolved decision", async () => {
    setCoopRevivalRetryMs(10);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "revival",
      },
      { seed: 0x2e717f },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    const seq = COOP_REVIVAL_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
    const data = [0, 9];
    let delivered = 0;
    const offCount = pair.host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "revival") {
        delivered++;
      }
    });
    pair.armNextDrop("interactionChoice", "guest");
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(seq, 100);

    sendCoopRevivalChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 3, data);
    armCoopRevivalIntentResend({
      payload: { type: "decision", fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
      wave: 4,
      turn: 2,
      resend: () => sendCoopRevivalChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 3, data),
    });

    expect(pair.faultsInjected(), "the first owner decision was actually dropped").toBe(1);
    const choice = await awaited;
    expect(choice).toMatchObject({ choice: 3, data, kind: "revival" });
    commitRevivalAuthorityDecision({
      payload: { type: "decision", fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
      ownerRole: "guest",
      localRole: "host",
      wave: 4,
      turn: 2,
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered, "the committed decision cancels all later owner retries").toBe(1);
    offCount();
  });
});
