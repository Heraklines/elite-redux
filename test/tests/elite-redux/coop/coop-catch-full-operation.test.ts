/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  armCoopCatchFullIntentResend,
  captureCoopCatchFullOperationBinding,
  commitCoopCatchFullAuthorityDecision,
  coopCatchFullDecisionOperationId,
  resetCoopCatchFullOperationFlag,
  resetCoopCatchFullRetryMs,
  sendCoopCatchFullPrompt,
  sendCoopCatchFullPromptWithOperationId,
  setCoopCatchFullOperationEnabled,
  setCoopCatchFullRetryMs,
} from "#data/elite-redux/coop/coop-catch-full-operation";
import { COOP_CATCH_FULL_SEQ, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { getCoopOperationJournalApplied } from "#data/elite-redux/coop/coop-operation-journal";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  setCoopRuntime,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
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

  it("FAIL LOUD: an enabled operation cannot hide a missing runtime behind the raw carrier", () => {
    const pair = createLoopbackPair();
    const relay = new CoopInteractionRelay(pair.host);

    expect(() =>
      sendCoopCatchFullPrompt(relay, "Venusaur", 3, {
        localRole: "host",
        wave: 7,
        turn: 1,
      }),
    ).toThrow(/\[coop-op\].*surface=catchFull/);
    pair.host.close();
    pair.guest.close();
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
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopCatchFullOperationBinding();
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopCatchFullOperationBinding();
    setCoopRuntime(hostRuntime);
    const promptOperationId = sendCoopCatchFullPromptWithOperationId(
      hostRuntime.interactionRelay,
      "Venusaur",
      3,
      { localRole: "host", wave: 7, turn: 4 },
      hostBinding,
    );
    expect(promptOperationId).not.toBeNull();
    const decisionOperationId = coopCatchFullDecisionOperationId(promptOperationId!);
    expect(decisionOperationId).not.toBeNull();
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
    armCoopCatchFullIntentResend(
      {
        payload: { type: "decision", speciesId: 3, partySlot: 4 },
        // A renderer may be behind the authority here. Cancellation is keyed by the exact resolved
        // decision, not these presentation-local coordinates.
        wave: 6,
        turn: 99,
        resend,
      },
      guestBinding,
    );

    expect(pair.faultsInjected(), "the first owner decision was actually dropped").toBe(1);
    expect(await awaited).toMatchObject({ choice: 4, kind: "catchFull" });
    expect(settleCoopV2InteractionOperation(decisionOperationId!, guestRuntime)).toBe(true);
    setCoopRuntime(hostRuntime);
    commitCoopCatchFullAuthorityDecision(
      {
        payload: { type: "decision", speciesId: 3, partySlot: 4 },
        ownerRole: "guest",
        localRole: "host",
        wave: 7,
        turn: 4,
        operationId: decisionOperationId!,
      },
      hostBinding,
    );
    await new Promise(resolve => setTimeout(resolve, 30));
    const traced = getCoopOperationJournalApplied()
      .filter(envelope => envelope.pendingOperation?.kind === "CATCH_FULL")
      .at(-1);
    expect(traced?.pendingOperation?.payload, "the host-resolved owner decision is trace-replayable").toEqual({
      type: "decision",
      speciesId: 3,
      partySlot: 4,
    });
    setCoopRuntime(guestRuntime);
    expect(delivered, "the committed decision cancels all later owner retries").toBe(1);
    offCount();
  });

  it("ASYNC BINDING: a host await tail commits into its own ledger while the guest is ambient", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    expect(hostRuntime.durability).toBeDefined();
    expect(guestRuntime.durability).toBeDefined();

    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopCatchFullOperationBinding();
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(COOP_CATCH_FULL_SEQ, 100, ["catchFull"]);
    const promptOperationId = sendCoopCatchFullPromptWithOperationId(
      hostRuntime.interactionRelay,
      "Venusaur",
      3,
      { localRole: "host", wave: 7, turn: 5 },
      hostBinding,
    );
    expect(promptOperationId).not.toBeNull();
    const decisionOperationId = coopCatchFullDecisionOperationId(promptOperationId!);
    expect(decisionOperationId).not.toBeNull();

    // Model the promise tail after a two-engine context swap: the guest remains the ambient process runtime
    // when its proposal resolves the host's await. The explicit binding must still use the host clock/journal.
    setCoopRuntime(guestRuntime);
    guestRuntime.interactionRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 4);
    expect(await awaited).toMatchObject({ choice: 4, kind: "catchFull" });
    expect(settleCoopV2InteractionOperation(decisionOperationId!, guestRuntime)).toBe(true);
    expect(
      commitCoopCatchFullAuthorityDecision(
        {
          payload: { type: "decision", speciesId: 3, partySlot: 4 },
          ownerRole: "guest",
          localRole: "host",
          wave: 7,
          turn: 5,
          operationId: decisionOperationId!,
        },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(hostRuntime.durability?.highWaterMarks()["op:global"], "both commits stayed on the host journal").toBe(2);
    expect(
      guestRuntime.durability?.highWaterMarks()["op:global"],
      "the ambient guest never became a second authority",
    ).toBeUndefined();
    expect(
      guestRuntime.durability?.appliedMarks()["op:global"],
      "the guest applied the same dense prompt+decision order",
    ).toBe(2);
  });

  it("ASYNC RETRY BINDING: a guest callback retry is cancelled in its own runtime while the host is ambient", async () => {
    setCoopCatchFullRetryMs(10);
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopCatchFullOperationBinding();
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopCatchFullOperationBinding();
    setCoopRuntime(hostRuntime);
    const promptOperationId = sendCoopCatchFullPromptWithOperationId(
      hostRuntime.interactionRelay,
      "Venusaur",
      3,
      { localRole: "host", wave: 7, turn: 6 },
      hostBinding,
    );
    expect(promptOperationId).not.toBeNull();
    const decisionOperationId = coopCatchFullDecisionOperationId(promptOperationId!);
    expect(decisionOperationId).not.toBeNull();
    let delivered = 0;
    const offCount = pair.host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "catchFull") {
        delivered++;
      }
    });
    const resend = () => guestRuntime.interactionRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 4);

    // This is the picker callback shape: it resumes under the host's ambient selector, but carries the
    // guest binding captured before the UI opened. The raw choice is only a proposal carrier.
    setCoopRuntime(hostRuntime);
    resend();
    armCoopCatchFullIntentResend(
      {
        payload: { type: "decision", speciesId: 3, partySlot: 4 },
        wave: 7,
        turn: 6,
        resend,
      },
      guestBinding,
    );
    expect(settleCoopV2InteractionOperation(decisionOperationId!, guestRuntime)).toBe(true);
    expect(
      commitCoopCatchFullAuthorityDecision(
        {
          payload: { type: "decision", speciesId: 3, partySlot: 4 },
          ownerRole: "guest",
          localRole: "host",
          wave: 7,
          turn: 6,
          operationId: decisionOperationId!,
        },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));

    setCoopRuntime(guestRuntime);
    expect(delivered, "the retained host decision cancelled the exact guest-owned retry").toBe(1);
    offCount();
  });

  it("FAIL CLOSED: a journal conflict suppresses the raw prompt carrier", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopCatchFullOperationBinding();
    let prompts = 0;
    guestRuntime.interactionRelay.onCatchFullPrompt = () => prompts++;

    expect(hostRuntime.durability).toBeDefined();
    expect(
      hostRuntime.durability?.commit("op:global", 1, {
        t: "interactionChoice",
        seq: COOP_CATCH_FULL_SEQ + 1,
        kind: "conflicting-test-entry",
        choice: -1,
      }),
    ).toBe(true);
    expect(
      sendCoopCatchFullPrompt(
        hostRuntime.interactionRelay,
        "Venusaur",
        3,
        { localRole: "host", wave: 7, turn: 7 },
        hostBinding,
      ),
      "a required retained prompt cannot degrade to an untracked raw terminal path",
    ).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(prompts).toBe(0);
  });
});
