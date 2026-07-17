/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { clearNegotiatedCoopCapabilities } from "#data/elite-redux/coop/coop-capabilities";
import {
  armCoopFaintSwitchIntentResend,
  captureCoopFaintSwitchOperationBinding,
  commitFaintSwitchAuthorityIntent,
  coopFaintSwitchOperationAddress,
  markCoopFaintSwitchPickerSettled,
  materializeCoopFaintSwitchPickerTerminal,
  registerCoopFaintSwitchPickerTerminal,
  resetCoopFaintSwitchOperationFlag,
  resetCoopFaintSwitchOperationState,
  resetCoopFaintSwitchRetryMs,
  setCoopFaintSwitchOperationEnabled,
  setCoopFaintSwitchRetryMs,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import type { CoopAuthoritativeEnvelopeV1 } from "#data/elite-redux/coop/coop-operation-envelope";
import { COOP_FAINT_SWITCH_SEQ_BASE, sendCoopFaintSwitchChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import { setCoopOperationDurability } from "#data/elite-redux/coop/coop-operation-journal";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("co-op faint-switch operation migration", () => {
  beforeEach(() => {
    clearNegotiatedCoopCapabilities();
    setCoopFaintSwitchOperationEnabled(true);
  });

  afterEach(() => {
    resetCoopFaintSwitchRetryMs();
    resetCoopFaintSwitchOperationFlag();
    resetCoopFaintSwitchOperationState();
    clearCoopRuntime();
    setCoopOperationDurability(null);
    setActiveCoopRuntimeOpState(null);
    clearNegotiatedCoopCapabilities();
  });

  it("addresses repeated same-turn replacements by the authoritative party slot", () => {
    expect(coopFaintSwitchOperationAddress(7, 3, 1, 2)).not.toBe(coopFaintSwitchOperationAddress(7, 3, 1, 3));
    expect(coopFaintSwitchOperationAddress(7, 3, 1, -1)).not.toBe(coopFaintSwitchOperationAddress(7, 3, 1, 2));
  });

  it("materializes only the exact old-address picker before acknowledging a timeout fallback", () => {
    const guestState = createCoopRuntimeOpState("guest");
    setActiveCoopRuntimeOpState(guestState);
    const binding = captureCoopFaintSwitchOperationBinding("guest");
    const consumed: string[] = [];
    registerCoopFaintSwitchPickerTerminal(
      {
        wave: 2,
        turn: 2,
        fieldIndex: COOP_GUEST_FIELD_INDEX,
        consume: (payload, operationId) => {
          consumed.push(`${payload.partySlot}:${operationId}`);
          return true;
        },
      },
      binding,
    );
    const envelope = {
      sessionEpoch: 1,
      wave: 2,
      turn: 2,
      pendingOperation: {
        id: "1:1:FAINT_SWITCH:2000214",
        kind: "FAINT_SWITCH",
        owner: 1,
        status: "applied",
        payload: { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, data: [0, 6] },
      },
    } as unknown as CoopAuthoritativeEnvelopeV1;

    expect(materializeCoopFaintSwitchPickerTerminal(envelope, binding)).toBe(true);
    expect(consumed).toEqual(["3:1:1:FAINT_SWITCH:2000214"]);
    expect(materializeCoopFaintSwitchPickerTerminal(envelope, binding), "exact replay is already settled").toBe(true);

    const later = { ...envelope, turn: 3 } as CoopAuthoritativeEnvelopeV1;
    expect(
      materializeCoopFaintSwitchPickerTerminal(later, binding),
      "a reused field slot at another address cannot consume the old terminal",
    ).toBe(false);

    markCoopFaintSwitchPickerSettled(2, 3, COOP_GUEST_FIELD_INDEX, binding);
    expect(materializeCoopFaintSwitchPickerTerminal(later, binding)).toBe(true);
  });

  it("keeps host and guest operation state isolated and rejects missing or role-mismatched bindings", () => {
    const hostState = createCoopRuntimeOpState("host");
    const guestState = createCoopRuntimeOpState("guest");
    setCoopOperationDurability(null);

    setActiveCoopRuntimeOpState(hostState);
    const hostBinding = captureCoopFaintSwitchOperationBinding("host");
    setActiveCoopRuntimeOpState(guestState);
    const guestBinding = captureCoopFaintSwitchOperationBinding("guest");

    expect(
      commitFaintSwitchAuthorityIntent(
        {
          payload: { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, data: [0, 6] },
          ownerRole: "guest",
          localRole: "host",
          wave: 4,
          turn: 2,
        },
        hostBinding,
      ),
      "the host callback uses its captured state even while the guest is ambient",
    ).toBe(true);
    expect(hostState.hostClock?.revision).toBe(1);
    expect(guestState.hostClock, "the host commit never creates or advances a guest-owned host cursor").toBeNull();

    expect(() =>
      commitFaintSwitchAuthorityIntent(
        {
          payload: { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, data: [0, 6] },
          ownerRole: "guest",
          localRole: "host",
          wave: 4,
          turn: 2,
        },
        guestBinding,
      ),
    ).toThrow(/binding role=guest cannot execute localRole=host/);
    expect(() =>
      armCoopFaintSwitchIntentResend(
        {
          payload: { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, data: [0, 6] },
          localRole: "guest",
          wave: 4,
          turn: 2,
          resend: () => {},
        },
        hostBinding,
      ),
    ).toThrow(/binding role=host cannot execute localRole=guest/);

    setActiveCoopRuntimeOpState(null);
    expect(() => captureCoopFaintSwitchOperationBinding("guest")).toThrow(/no runtime installed/);
  });

  it("keeps the pure legacy switch carrier working when the operation flag is off", async () => {
    setCoopFaintSwitchOperationEnabled(false);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    const seq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
    const awaited = hostRuntime.interactionRelay.awaitInteractionChoice(seq, 25);

    sendCoopFaintSwitchChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 2, [0, 131]);

    expect(await awaited).toMatchObject({ choice: 2, data: [0, 131], kind: "switch" });
  });

  it("INTENT RECOVERY: dropping the guest's replacement pick still delivers that exact pick to host authority", async () => {
    setCoopFaintSwitchRetryMs(10);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "switch",
      },
      { seed: 0xfa1717 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopFaintSwitchOperationBinding("host");
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopFaintSwitchOperationBinding("guest");
    const seq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
    const exactPick = { partySlot: 3, data: [0, 6] };
    let deliveredGuestIntents = 0;
    const offCount = pair.host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "switch") {
        deliveredGuestIntents++;
      }
    });
    pair.armNextDrop("interactionChoice", "guest");
    const hostAwait = hostRuntime.interactionRelay.awaitInteractionChoice(seq, 25);

    sendCoopFaintSwitchChoice(
      guestRuntime.interactionRelay,
      COOP_GUEST_FIELD_INDEX,
      exactPick.partySlot,
      exactPick.data,
    );
    armCoopFaintSwitchIntentResend(
      {
        payload: { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: exactPick.partySlot, data: exactPick.data },
        localRole: "guest",
        wave: 1,
        turn: 1,
        resend: () =>
          sendCoopFaintSwitchChoice(
            guestRuntime.interactionRelay,
            COOP_GUEST_FIELD_INDEX,
            exactPick.partySlot,
            exactPick.data,
          ),
      },
      guestBinding,
    );

    expect(pair.faultsInjected(), "the one-shot guest replacement intent was actually dropped").toBe(1);
    const action = await hostAwait;
    expect(action, "the host must receive the human's exact replacement, never silently auto-pick").toMatchObject({
      choice: exactPick.partySlot,
      data: exactPick.data,
      kind: "switch",
    });
    expect(
      commitFaintSwitchAuthorityIntent(
        {
          payload: {
            fieldIndex: COOP_GUEST_FIELD_INDEX,
            partySlot: action?.choice ?? -1,
            data: [...(action?.data ?? [])],
          },
          ownerRole: "guest",
          localRole: "host",
          wave: 1,
          turn: 1,
        },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(deliveredGuestIntents, "the committed envelope cancels further guest retries").toBe(1);
    offCount();
  });

  it("stops a guest retry when authority commits the same field from a drifted turn counter", async () => {
    setCoopFaintSwitchRetryMs(10);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopFaintSwitchOperationBinding("host");
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopFaintSwitchOperationBinding("guest");
    const seq = COOP_FAINT_SWITCH_SEQ_BASE + COOP_GUEST_FIELD_INDEX;
    let deliveredGuestIntents = 0;
    const offCount = host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.seq === seq && msg.kind === "switch") {
        deliveredGuestIntents++;
      }
    });
    const payload = { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, data: [0, 6] };

    sendCoopFaintSwitchChoice(guestRuntime.interactionRelay, payload.fieldIndex, payload.partySlot, payload.data);
    armCoopFaintSwitchIntentResend(
      {
        payload,
        localRole: "guest",
        wave: 12,
        turn: 4,
        resend: () =>
          sendCoopFaintSwitchChoice(guestRuntime.interactionRelay, payload.fieldIndex, payload.partySlot, payload.data),
      },
      guestBinding,
    );
    expect(
      commitFaintSwitchAuthorityIntent(
        {
          payload,
          ownerRole: "guest",
          localRole: "host",
          wave: 12,
          turn: 5,
        },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 35));

    expect(deliveredGuestIntents, "no stale switch carrier may survive the authoritative commit").toBe(1);
    offCount();
  });
});
