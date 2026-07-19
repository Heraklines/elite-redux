/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { clearNegotiatedCoopCapabilities } from "#data/elite-redux/coop/coop-capabilities";
import {
  addressCoopFaintSwitchChoiceData,
  armCoopFaintSwitchIntentResend,
  awaitAddressedCoopFaintSwitchChoice,
  COOP_FAINT_SWITCH_RESOLUTION_NONE,
  COOP_FAINT_SWITCH_RESOLUTION_OWNER,
  captureCoopFaintSwitchOperationBinding,
  commitFaintSwitchAuthorityIntent,
  coopFaintSwitchOperationAddress,
  markCoopFaintSwitchPickerSettled,
  materializeCoopFaintSwitchPickerTerminal,
  materializeCoopV2ReplacementPickerTerminal,
  registerCoopFaintSwitchPickerTerminal,
  resetCoopFaintSwitchOperationFlag,
  resetCoopFaintSwitchOperationState,
  resetCoopFaintSwitchRetryMs,
  setCoopFaintSwitchOperationEnabled,
  setCoopFaintSwitchRetryMs,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import { COOP_FAINT_SWITCH_SEQ_BASE, sendCoopFaintSwitchChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopAuthoritativeEnvelopeV1 } from "#data/elite-redux/coop/coop-operation-envelope";
import { setCoopOperationDurability } from "#data/elite-redux/coop/coop-operation-journal";
import {
  createCoopRuntimeOpState,
  resetCoopGlobalOperationOrder,
  setActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("co-op faint-switch operation migration", () => {
  beforeEach(() => {
    clearNegotiatedCoopCapabilities();
    resetCoopGlobalOperationOrder();
    setCoopFaintSwitchOperationEnabled(true);
  });

  afterEach(() => {
    resetCoopFaintSwitchRetryMs();
    resetCoopFaintSwitchOperationFlag();
    resetCoopFaintSwitchOperationState();
    clearCoopRuntime();
    setCoopOperationDurability(null);
    setActiveCoopRuntimeOpState(null);
    resetCoopGlobalOperationOrder();
    clearNegotiatedCoopCapabilities();
  });

  it("addresses repeated same-turn replacements by occurrence and authoritative result slot", () => {
    expect(coopFaintSwitchOperationAddress(7, 3, 1, 2)).not.toBe(coopFaintSwitchOperationAddress(7, 3, 1, 3));
    expect(coopFaintSwitchOperationAddress(7, 3, 1, -1)).not.toBe(coopFaintSwitchOperationAddress(7, 3, 1, 2));
    expect(coopFaintSwitchOperationAddress(7, 3, 1, 2, 4)).not.toBe(coopFaintSwitchOperationAddress(7, 3, 1, 2, 5));
    expect(
      Number.isSafeInteger(coopFaintSwitchOperationAddress(90_000, 99_999, 3, 8, 9_999)),
      "the documented maximum remains exactly representable",
    ).toBe(true);
    expect(
      () => coopFaintSwitchOperationAddress(90_000, 100_000, 3, 8, 9_999),
      "an out-of-budget turn fails closed instead of colliding",
    ).toThrow(/invalid faint-switch turn/u);
  });

  it("stamps a DENSE all-finite payload from a short legacy base (the host-owned replacement wire shape)", () => {
    // The live faint-stall class (gate 29598888047 B1/B7/B8/B10/B12 + S4): the host's SwitchPhase
    // builds its choice from the legacy base `[0]` / `[1]`, and the address stamp wrote only
    // indices 2..5 - leaving index 1 a HOLE that survives JSON as null. The guest applier's
    // validPayload (`data.every(Number.isFinite)`) then permanently rejected every host-owned
    // committed replacement op, exhausting bounded recovery into a shared session terminal.
    const guestState = createCoopRuntimeOpState("guest");
    setActiveCoopRuntimeOpState(guestState);
    const binding = captureCoopFaintSwitchOperationBinding("guest");
    for (const base of [[0], [1]]) {
      const data = addressCoopFaintSwitchChoiceData(
        base,
        { wave: 1, turn: 1, fieldIndex: 0, partySlot: 2, resolution: COOP_FAINT_SWITCH_RESOLUTION_NONE },
        binding,
      );
      expect(data.length, "the stamp covers the full metadata block").toBeGreaterThan(5);
      for (let i = 0; i < data.length; i++) {
        expect(Number.isFinite(data[i]), `index ${i} must be finite (no holes) for base [${base}]`).toBe(true);
      }
      const roundTripped = JSON.parse(JSON.stringify(data)) as unknown[];
      expect(
        roundTripped.every(Number.isFinite),
        "the wire round-trip must stay admissible to the guest applier's validPayload",
      ).toBe(true);
    }
  });

  it("acknowledges a no-picker terminal only after the exact no-surface occurrence was proved", () => {
    const guestState = createCoopRuntimeOpState("guest");
    setActiveCoopRuntimeOpState(guestState);
    const binding = captureCoopFaintSwitchOperationBinding("guest");
    const data = addressCoopFaintSwitchChoiceData(
      [0],
      {
        wave: 8,
        turn: 2,
        occurrence: 17,
        fieldIndex: COOP_GUEST_FIELD_INDEX,
        partySlot: -1,
        resolution: COOP_FAINT_SWITCH_RESOLUTION_NONE,
      },
      binding,
    );
    const envelope = {
      sessionEpoch: 1,
      wave: 8,
      turn: 2,
      pendingOperation: {
        id: "1:1:FAINT_SWITCH:no-surface",
        kind: "FAINT_SWITCH",
        owner: 1,
        status: "applied",
        payload: { fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: -1, data },
      },
    } as unknown as CoopAuthoritativeEnvelopeV1;

    expect(materializeCoopFaintSwitchPickerTerminal(envelope, binding)).toBe(false);
    markCoopFaintSwitchPickerSettled(8, 2, COOP_GUEST_FIELD_INDEX, binding, 16);
    expect(
      materializeCoopFaintSwitchPickerTerminal(envelope, binding),
      "another faint occurrence cannot prove this no-surface terminal",
    ).toBe(false);
    markCoopFaintSwitchPickerSettled(8, 2, COOP_GUEST_FIELD_INDEX, binding, 17);
    expect(materializeCoopFaintSwitchPickerTerminal(envelope, binding)).toBe(true);
  });

  it("V2 treats an explicit wiped-half null as the exact absence of a picker, but retains a concrete pick", () => {
    const guestState = createCoopRuntimeOpState("guest");
    const base = {
      sourceAddress: {
        epoch: 1,
        wave: 8,
        turn: 2,
        occurrence: 17,
        fieldIndex: COOP_GUEST_FIELD_INDEX,
      },
      ownerSeatId: 1,
      resolution: "fallback-auto" as const,
    };
    expect(
      materializeCoopV2ReplacementPickerTerminal({ ...base, selected: null }, 1, guestState),
      "zero legal choices means the renderer correctly opened no modal",
    ).toBe(true);
    expect(
      materializeCoopV2ReplacementPickerTerminal(
        {
          ...base,
          sourceAddress: { ...base.sourceAddress, occurrence: 18 },
          selected: { partySlot: 3, speciesId: 6 },
        },
        1,
        guestState,
      ),
      "a concrete timeout fallback must still close its exact live picker before state installation",
    ).toBe(false);
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

  it("rejects a buffered proposal from an older same-turn same-field occurrence", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopFaintSwitchOperationBinding("host");
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopFaintSwitchOperationBinding("guest");
    const oldData = addressCoopFaintSwitchChoiceData(
      [0, 6],
      {
        wave: 12,
        turn: 5,
        occurrence: 9,
        fieldIndex: COOP_GUEST_FIELD_INDEX,
        partySlot: 2,
        resolution: COOP_FAINT_SWITCH_RESOLUTION_OWNER,
      },
      guestBinding,
    );
    const currentData = addressCoopFaintSwitchChoiceData(
      [0, 25],
      {
        wave: 12,
        turn: 5,
        occurrence: 12,
        fieldIndex: COOP_GUEST_FIELD_INDEX,
        partySlot: 3,
        resolution: COOP_FAINT_SWITCH_RESOLUTION_OWNER,
      },
      guestBinding,
    );

    sendCoopFaintSwitchChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 2, oldData);
    const awaited = awaitAddressedCoopFaintSwitchChoice(
      hostRuntime.interactionRelay,
      { wave: 12, turn: 5, occurrence: 12, fieldIndex: COOP_GUEST_FIELD_INDEX, timeoutMs: 100 },
      hostBinding,
    );
    sendCoopFaintSwitchChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 3, currentData);

    expect(await awaited).toMatchObject({ choice: 3, data: currentData, kind: "switch" });
  });

  it("INTENT RECOVERY: a dropped guest pick recovers and a remapped terminal cancels its exact window", async () => {
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

    // The real public picker closes its UI before sending the raw proposal. Model that exact material
    // boundary so the later retained commit may ACK and cancel this proposal's retry.
    markCoopFaintSwitchPickerSettled(1, 1, COOP_GUEST_FIELD_INDEX, guestBinding);
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
            // Model the legal identity-remap path: authority found the proposed species in a different
            // local party slot. The terminal operation ID therefore differs from the proposal's slot.
            partySlot: 4,
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

  it("does not let a different-turn authority terminal cancel an older same-field retry", async () => {
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
    markCoopFaintSwitchPickerSettled(12, 5, COOP_GUEST_FIELD_INDEX, guestBinding);
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

    expect(
      deliveredGuestIntents,
      "a terminal for turn 5 must not cancel the distinct turn-4 proposal retry",
    ).toBeGreaterThan(1);
    offCount();
  });
});
