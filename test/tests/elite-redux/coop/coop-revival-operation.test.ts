/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { clearNegotiatedCoopCapabilities } from "#data/elite-redux/coop/coop-capabilities";
import {
  COOP_REVIVAL_SEQ_BASE,
  CoopInteractionRelay,
  sendCoopRevivalChoice,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { type CoopAuthoritativeEnvelopeV1, makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  armCoopRevivalIntentResend,
  captureCoopRevivalOperationBinding,
  commitRevivalAuthorityDecision,
  coopRevivalOperationId,
  resetCoopRevivalOperationFlag,
  resetCoopRevivalOperationState,
  resetCoopRevivalRetryMs,
  sendCoopRevivalPrompt,
  setCoopRevivalOperationEnabled,
  setCoopRevivalRetryMs,
} from "#data/elite-redux/coop/coop-revival-operation";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  setCoopRuntime,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("co-op Revival Blessing operation migration", () => {
  beforeEach(() => {
    clearNegotiatedCoopCapabilities();
    setCoopRevivalOperationEnabled(true);
  });

  afterEach(() => {
    resetCoopRevivalRetryMs();
    resetCoopRevivalOperationFlag();
    resetCoopRevivalOperationState();
    clearCoopRuntime();
    setCoopOperationDurability(null);
    setActiveCoopRuntimeOpState(null);
    registerCoopOperationLiveSink("op:revival", null);
    resetCoopOperationJournalLog();
    clearNegotiatedCoopCapabilities();
  });

  it("FAIL LOUD: an enabled prompt cannot hide a missing runtime behind its raw carrier", () => {
    const pair = createLoopbackPair();
    const relay = new CoopInteractionRelay(pair.host);

    expect(() =>
      sendCoopRevivalPrompt(relay, COOP_GUEST_FIELD_INDEX, {
        localRole: "host",
        wave: 1,
        turn: 1,
      }),
    ).toThrow(/\[coop-op\].*surface=revival/);
    relay.dispose();
    pair.host.close();
    pair.guest.close();
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
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopRevivalOperationBinding("host");
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopRevivalOperationBinding("guest");
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
    armCoopRevivalIntentResend(
      {
        payload: { type: "decision", fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
        localRole: "guest",
        wave: 4,
        turn: 2,
        resend: () => sendCoopRevivalChoice(guestRuntime.interactionRelay, COOP_GUEST_FIELD_INDEX, 3, data),
      },
      guestBinding,
    );

    expect(pair.faultsInjected(), "the first owner decision was actually dropped").toBe(1);
    const choice = await awaited;
    expect(choice).toMatchObject({ choice: 3, data, kind: "revival" });
    const decisionOperationId = coopRevivalOperationId(
      { type: "decision", fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
      4,
      2,
      "guest",
      guestBinding,
    );
    expect(settleCoopV2InteractionOperation(decisionOperationId, guestRuntime)).toBe(true);
    setCoopRuntime(hostRuntime);
    expect(
      commitRevivalAuthorityDecision(
        {
          payload: { type: "decision", fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
          ownerRole: "guest",
          localRole: "host",
          wave: 4,
          turn: 2,
        },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(delivered, "the committed decision cancels all later owner retries").toBe(1);
    offCount();
  });

  it("IDENTICAL IDS: independent authority runtimes do not share cursors or reset effects", () => {
    setCoopOperationDurability(null);
    const runtimeA = createCoopRuntimeOpState();
    const runtimeB = createCoopRuntimeOpState();
    setActiveCoopRuntimeOpState(runtimeA);
    const bindingA = captureCoopRevivalOperationBinding("host");
    setActiveCoopRuntimeOpState(runtimeB);
    const bindingB = captureCoopRevivalOperationBinding("host");
    const params = {
      payload: { type: "decision" as const, fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
      ownerRole: "guest" as const,
      localRole: "host" as const,
      wave: 4,
      turn: 2,
    };

    expect(commitRevivalAuthorityDecision(params, bindingA)).toBe(true);
    expect(commitRevivalAuthorityDecision(params, bindingB)).toBe(true);
    expect(runtimeA.hostClock?.revision).toBe(1);
    expect(runtimeB.hostClock?.revision).toBe(1);

    // Reset A explicitly while B is ambient. B's cursor and remembered identical operation remain intact.
    resetCoopRevivalOperationState(bindingA);
    expect(runtimeA.hostClock).toBeNull();
    expect(runtimeB.hostClock?.revision).toBe(1);
    expect(commitRevivalAuthorityDecision(params, bindingB), "B still idempotently re-ACKs its own operation").toBe(
      true,
    );
    expect(runtimeB.hostClock?.revision).toBe(1);
  });

  it("IDENTICAL IDS: two receiver runtimes each apply the same retained operation exactly once", () => {
    const authoritativeState: CoopAuthoritativeBattleStateV1 = {
      version: 1,
      tick: 0,
      wave: 4,
      turn: 2,
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
    const envelope: CoopAuthoritativeEnvelopeV1 = {
      version: 1,
      sessionEpoch: 1,
      revision: 1,
      wave: 4,
      turn: 2,
      logicalPhase: "TURN_RESOLVE",
      pendingOperation: {
        id: makeCoopOperationId(1, 1, 4_000_000 + 200 + COOP_GUEST_FIELD_INDEX * 10 + 4, "REVIVAL"),
        kind: "REVIVAL",
        owner: 1,
        status: "applied",
        payload: { type: "decision", fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 },
      },
      authoritativeState,
    };
    const entry = { cls: "op:global" as const, seq: 1, msg: { t: "envelope" as const, envelope } };
    const hooks = coopOperationDurabilityHooks();
    const runtimeA = createCoopRuntimeOpState();
    const runtimeB = createCoopRuntimeOpState();
    setCoopOperationDurability(null);
    registerCoopOperationLiveSink("op:revival", () => true);

    setActiveCoopRuntimeOpState(runtimeA);
    const bindingA = captureCoopRevivalOperationBinding("guest");
    expect(hooks.apply?.(entry)).toBe("applied");
    setActiveCoopRuntimeOpState(runtimeB);
    expect(hooks.apply?.(entry), "B must not inherit A's applied-id receipt").toBe("applied");
    expect(runtimeA.guestClock?.revision).toBe(1);
    expect(runtimeB.guestClock?.revision).toBe(1);

    resetCoopRevivalOperationState(bindingA);
    expect(runtimeA.guestClock).toBeNull();
    expect(runtimeB.guestClock?.revision).toBe(1);
    expect(hooks.apply?.(entry), "resetting A cannot erase B's duplicate receipt").toBe("duplicate");
    setActiveCoopRuntimeOpState(runtimeA);
    expect(hooks.apply?.(entry), "only reset A accepts its operation again").toBe("applied");
  });

  it("RECONNECT ISOLATION: equal retry keys live and reset independently", async () => {
    setCoopRevivalRetryMs(5);
    setCoopOperationDurability(null);
    const runtimeA = createCoopRuntimeOpState();
    const runtimeB = createCoopRuntimeOpState();
    setActiveCoopRuntimeOpState(runtimeA);
    const bindingA = captureCoopRevivalOperationBinding("guest");
    setActiveCoopRuntimeOpState(runtimeB);
    const bindingB = captureCoopRevivalOperationBinding("guest");
    const payload = { type: "decision" as const, fieldIndex: COOP_GUEST_FIELD_INDEX, partySlot: 3, speciesId: 9 };
    let ticksA = 0;
    let ticksB = 0;

    armCoopRevivalIntentResend({ payload, localRole: "guest", wave: 4, turn: 2, resend: () => ticksA++ }, bindingA);
    armCoopRevivalIntentResend({ payload, localRole: "guest", wave: 4, turn: 2, resend: () => ticksB++ }, bindingB);
    await new Promise(resolve => setTimeout(resolve, 18));
    expect(ticksA).toBeGreaterThan(0);
    expect(ticksB).toBeGreaterThan(0);

    resetCoopRevivalOperationState(bindingA);
    const aAtReset = ticksA;
    const bAtReset = ticksB;
    await new Promise(resolve => setTimeout(resolve, 14));
    expect(ticksA).toBe(aAtReset);
    expect(ticksB).toBeGreaterThan(bAtReset);
    resetCoopRevivalOperationState(bindingB);
  });
});
