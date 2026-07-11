/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  armCoopCatchFullIntentResend,
  commitCoopCatchFullAuthorityDecision,
  resetCoopCatchFullOperationFlag,
  resetCoopCatchFullRetryMs,
  sendCoopCatchFullPrompt,
  setCoopCatchFullOperationEnabled,
  setCoopCatchFullRetryMs,
} from "#data/elite-redux/coop/coop-catch-full-operation";
import { COOP_CATCH_FULL_SEQ } from "#data/elite-redux/coop/coop-interaction-relay";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op wild catch-full operation migration", () => {
  afterEach(() => {
    resetCoopCatchFullRetryMs();
    resetCoopCatchFullOperationFlag();
    clearCoopRuntime();
  });

  it("keeps the pure legacy prompt and choice carriers working when the operation flag is off", async () => {
    setCoopCatchFullOperationEnabled(false);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    let prompts = 0;
    guestRuntime.interactionRelay.onCatchFullPrompt = () => prompts++;
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(COOP_CATCH_FULL_SEQ, 25, ["catchFull"]);

    sendCoopCatchFullPrompt(hostRuntime.interactionRelay, "Venusaur", 3, {
      localRole: "host",
      wave: 7,
      turn: 1,
    });
    guestRuntime.interactionRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 4);

    expect(await awaited).toMatchObject({ choice: 4, kind: "catchFull" });
    expect(prompts).toBe(1);
  });

  it("DURABILITY + EXACTLY ONCE: a dropped raw prompt is materialized once from the journal", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      { drop: 1, reorder: 0, delay: 0, faultable: msg => msg.t === "catchFullPrompt" },
      { seed: 0xca7cf011 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let prompts = 0;
    guestRuntime.interactionRelay.onCatchFullPrompt = (name, speciesId) => {
      expect([name, speciesId]).toEqual(["Venusaur", 3]);
      prompts++;
    };
    setCoopRuntime(hostRuntime);

    sendCoopCatchFullPrompt(hostRuntime.interactionRelay, "Venusaur", 3, {
      localRole: "host",
      wave: 7,
      turn: 2,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(pair.faultsInjected(), "the raw catchFullPrompt was actually dropped").toBe(1);
    expect(prompts, "the committed prompt opened exactly one guest picker").toBe(1);
  });

  it("EXACTLY ONCE: the journal prompt and raw legacy echo open only one picker", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let prompts = 0;
    guestRuntime.interactionRelay.onCatchFullPrompt = () => prompts++;
    setCoopRuntime(hostRuntime);

    sendCoopCatchFullPrompt(hostRuntime.interactionRelay, "Venusaur", 3, {
      localRole: "host",
      wave: 7,
      turn: 3,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(prompts, "raw + journal are two carriers for one prompt").toBe(1);
  });

  it("INTENT RECOVERY: a dropped owner choice is resent until the host commits the resolved decision", async () => {
    setCoopCatchFullRetryMs(10);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "catchFull",
      },
      { seed: 0xca7cf012 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    let delivered = 0;
    const offCount = pair.host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "catchFull") {
        delivered++;
      }
    });
    pair.armNextDrop("interactionChoice", "guest");
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(COOP_CATCH_FULL_SEQ, 100, ["catchFull"]);
    const resend = () => guestRuntime.interactionRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 4);

    resend();
    armCoopCatchFullIntentResend({
      payload: { type: "decision", speciesId: 3, partySlot: 4 },
      wave: 7,
      turn: 4,
      resend,
    });

    expect(pair.faultsInjected(), "the first owner decision was actually dropped").toBe(1);
    expect(await awaited).toMatchObject({ choice: 4, kind: "catchFull" });
    commitCoopCatchFullAuthorityDecision({
      payload: { type: "decision", speciesId: 3, partySlot: 4 },
      ownerRole: "guest",
      localRole: "host",
      wave: 7,
      turn: 4,
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered, "the committed decision cancels all later owner retries").toBe(1);
    offCount();
  });
});
