/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopDurabilityManager, setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import { COOP_INTERACTION_LEAVE, COOP_INTERACTION_REROLL } from "#data/elite-redux/coop/coop-interaction-relay";
import type { CoopRewardActionPayload, CoopShopBuyPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  getCoopOperationJournalApplied,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  adoptRewardWatcherChoice,
  captureCoopRewardOperationBinding,
  commitRewardAuthoritativeResult,
  commitRewardOwnerIntent,
  resetCoopRewardOperationState,
  setCoopRewardAuthorityStateHooksForTest,
  setCoopRewardOperationEnabled,
} from "#data/elite-redux/coop/coop-reward-operation";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { type CoopFaultProfile, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function flushWire(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

function state(tick: number, money: number, marker: string, wave = 7, turn = 3): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick,
    wave,
    turn,
    playerParty: [{ id: 1, marker }],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money,
    pokeballCounts: [],
    playerModifiers: [{ typeId: marker }],
    enemyModifiers: [],
  };
}

function latestAppliedOperationAddress(): { epoch: number; wave: number; turn: number } {
  const envelope = getCoopOperationJournalApplied().at(-1);
  if (envelope == null) {
    throw new Error("no applied authoritative operation is available for continuation readiness");
  }
  return { epoch: envelope.sessionEpoch, wave: envelope.wave, turn: envelope.turn };
}

describe("P33 retained reward/shop authoritative results", () => {
  let appliedStates: CoopAuthoritativeBattleStateV1[];
  let applyCalls: number;
  let reapplyCalls: number;

  beforeEach(() => {
    // The reward surface's apply state is per-runtime (fail-loud without an installed runtime). This
    // engine-free suite exercises one logical client in one realm, so a single installed op-state faithfully
    // reproduces the former shared module state (role separation is internal to the record).
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    setCoopDurabilityEnabled(true);
    setCoopRewardOperationEnabled(true);
    resetCoopRewardOperationState();
    resetCoopOperationJournalLog();
    setCoopOperationDurability(null);
    registerCoopOperationLiveSink("op:reward", null);
    appliedStates = [];
    applyCalls = 0;
    reapplyCalls = 0;
    setCoopRewardAuthorityStateHooksForTest({
      capture: () => null,
      apply: authoritative => {
        applyCalls++;
        appliedStates.push(structuredClone(authoritative));
        return true;
      },
      reapply: authoritative => {
        reapplyCalls++;
        appliedStates[appliedStates.length - 1] = structuredClone(authoritative);
        return true;
      },
    });
  });

  afterEach(() => {
    setCoopOperationDurability(null);
    registerCoopOperationLiveSink("op:reward", null);
    setCoopRewardAuthorityStateHooksForTest(null);
    resetCoopOperationJournalLog();
    resetCoopRewardOperationState();
    // Citizenship: clear the installed op-state so the next (--no-isolate) file starts with none installed.
    setActiveCoopRuntimeOpState(null);
  });

  it("host-owned buy/skip/reroll results carry non-empty post-action state and open projection only after apply", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    const projectionOrder: string[] = [];
    registerCoopOperationLiveSink("op:reward", envelope => {
      projectionOrder.push(`render:${envelope.authoritativeState.tick}`);
      expect(appliedStates.at(-1)?.tick, "state is installed before the result can render/continue").toBe(
        envelope.authoritativeState.tick,
      );
      return true;
    });

    const actions = [
      { label: "shop", choice: 0, data: [1, 0, 0, 0], terminal: false, result: state(11, 900, "buy") },
      {
        label: "reroll",
        choice: COOP_INTERACTION_REROLL,
        data: [0x4d4f, 850],
        terminal: false,
        result: state(12, 850, "reroll"),
      },
      {
        label: "skip",
        choice: COOP_INTERACTION_LEAVE,
        data: undefined,
        terminal: true,
        result: state(13, 850, "leave"),
      },
    ] as const;

    for (const action of actions) {
      const prepared = commitRewardOwnerIntent({
        surface: "reward",
        pinned: 2,
        label: action.label,
        choice: action.choice,
        data: action.data == null ? undefined : [...action.data],
        terminal: action.terminal,
        localRole: "host",
        wave: 7,
        turn: 3,
      });
      expect(prepared?.revision, "stage one retains intent but publishes no pre-action result").toBe(0);
      expect(commitRewardAuthoritativeResult(prepared!.operationId, action.result)).toMatchObject({
        operationId: prepared!.operationId,
      });
      await flushWire();
    }

    expect(appliedStates.map(value => value.tick)).toEqual([11, 12, 13]);
    expect(projectionOrder).toEqual(["render:11", "render:12", "render:13"]);
    expect(
      getCoopOperationJournalApplied().every(envelope => envelope.authoritativeState.playerParty.length > 0),
      "no live committed envelope contains the historical empty placeholder",
    ).toBe(true);
    expect(hostManager.unackedCount(), "material application retains all three canonical results").toBe(3);
    expect(guestManager.notifyOperationContinuationSurface("sharedInput", latestAppliedOperationAddress())).toBe(3);
    await flushWire();
    expect(hostManager.unackedCount(), "the exact reward continuation releases the dense result stream").toBe(0);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("parks host terminal advance at material apply while retaining through public continuation", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestHooks = coopOperationDurabilityHooks();
    let permitMaterialApply = false;
    const guestManager = new CoopDurabilityManager(pair.guest, {
      ...guestHooks,
      apply: entry => (permitMaterialApply ? guestHooks.apply?.(entry) : "deferred"),
    });
    setCoopOperationDurability(hostManager);
    registerCoopOperationLiveSink("op:reward", () => true);

    const prepared = commitRewardOwnerIntent({
      surface: "reward",
      pinned: 2,
      label: "skip",
      choice: COOP_INTERACTION_LEAVE,
      data: undefined,
      terminal: true,
      localRole: "host",
      wave: 7,
      turn: 3,
    })!;
    expect(commitRewardAuthoritativeResult(prepared.operationId, state(14, 850, "terminal-material"))).not.toBeNull();
    let materialSettled = false;
    const material = hostManager.waitForOperationMaterialApplied(prepared.operationId).then(applied => {
      materialSettled = true;
      return applied;
    });
    await flushWire();

    expect(materialSettled, "the host engine barrier cannot release before guest state application").toBe(false);
    expect(applyCalls).toBe(0);
    expect(hostManager.unackedCount(), "the immutable terminal remains retained while apply is deferred").toBe(1);

    permitMaterialApply = true;
    expect(guestManager.retryDeferred("op:global"), "destination-runtime activation retries the exact head").toBe(1);
    await flushWire();
    expect(await material, "the exact materialApplied proof releases only the host engine barrier").toBe(true);
    expect(appliedStates.at(-1)?.tick).toBe(14);
    expect(hostManager.unackedCount(), "material apply alone cannot discard the retained terminal").toBe(1);

    expect(guestManager.notifyOperationContinuationSurface("sharedInput", latestAppliedOperationAddress())).toBe(1);
    await flushWire();
    expect(hostManager.unackedCount(), "only the addressed public continuation retires the journal entry").toBe(0);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("guest-owned intent executes only on the host; duplicate/reordered raw intent cannot execute twice", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    registerCoopOperationLiveSink("op:reward", () => true);
    let hostExecutions = 0;
    const guestExecutions = 0;
    const marketData = [0, 700, 2, 250];

    const guestProposal = commitRewardOwnerIntent({
      surface: "market",
      pinned: 1,
      label: "biomeShop",
      choice: 4,
      data: marketData,
      terminal: false,
      localRole: "guest",
      wave: 7,
      turn: 3,
    });
    expect(guestProposal).not.toBeNull();
    expect(guestExecutions, "proposing never mutates the guest engine").toBe(0);

    const first = adoptRewardWatcherChoice({
      surface: "market",
      pinned: 1,
      action: { choice: 4, data: marketData },
      terminal: false,
      localRole: "host",
      wave: 7,
      turn: 3,
    });
    expect(first).toMatchObject({ adopt: true, requiresAuthorityCommit: true });
    if (!first.adopt) {
      throw new Error("host rejected valid guest intent");
    }
    const duplicateBeforeResult = adoptRewardWatcherChoice({
      surface: "market",
      pinned: 1,
      action: { choice: 4, data: marketData },
      terminal: false,
      localRole: "host",
      wave: 7,
      turn: 3,
    });
    expect(duplicateBeforeResult).toEqual({ adopt: false, reason: "host-intent-in-flight-or-complete" });

    hostExecutions++;
    expect(commitRewardAuthoritativeResult(first.operationId!, state(21, 700, "guest-buy"))).not.toBeNull();
    await flushWire();
    expect(hostExecutions).toBe(1);
    expect(guestExecutions, "guest applies state/result but never runs the buy implementation").toBe(0);
    expect(applyCalls, "the complete host state is the guest mutation seam").toBe(1);
    expect(appliedStates[0].money).toBe(700);
    expect(
      (getCoopOperationJournalApplied().at(-1)?.pendingOperation?.payload as CoopShopBuyPayload).data,
      "the result preserves the exact nested option and host-validated price used for UI continuation",
    ).toEqual(marketData);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("dropped then retried and duplicated results apply state and project exactly once", async () => {
    const pair = wrapCoopFaultPair(createLoopbackPair(), { drop: 0, reorder: 0, delay: 0 }, { seed: 0x33a11ce });
    pair.armNextDrop("envelope", "host");
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    let projections = 0;
    registerCoopOperationLiveSink("op:reward", () => {
      projections++;
      return true;
    });

    const prepared = commitRewardOwnerIntent({
      surface: "reward",
      pinned: 4,
      label: "reward",
      choice: 2,
      data: [0],
      terminal: false,
      localRole: "host",
      wave: 7,
      turn: 3,
    })!;
    const complete = state(31, 1_100, "retained-reward");
    expect(commitRewardAuthoritativeResult(prepared.operationId, complete)).not.toBeNull();
    await flushWire();
    expect(pair.faultsInjected(), "the first complete result was actually dropped").toBe(1);
    expect(applyCalls).toBe(0);

    hostManager.reconnect();
    await flushWire();
    expect(applyCalls).toBe(1);
    expect(projections).toBe(1);
    expect(commitRewardAuthoritativeResult(prepared.operationId, state(999, 0, "must-not-recapture"))).toEqual({
      operationId: prepared.operationId,
      revision: 1,
    });
    hostManager.reconnect();
    guestManager.reconnect();
    await flushWire();
    expect(applyCalls, "duplicate retained delivery cannot apply the engine state twice").toBe(1);
    expect(projections, "duplicate retained delivery cannot reopen continuation twice").toBe(1);
    expect(reapplyCalls).toBe(0);
    hostManager.dispose();
    guestManager.dispose();
  });

  it.each([
    {
      name: "reordered",
      actionCount: 2,
      profile: { drop: 0, reorder: 1, delay: 0, maxDelay: 2 },
    },
    {
      name: "delayed",
      actionCount: 3,
      profile: { drop: 0, reorder: 0, delay: 1, maxDelay: 2 },
    },
  ] satisfies {
    name: string;
    actionCount: number;
    profile: Omit<CoopFaultProfile, "faultable">;
  }[])("$name immutable results converge in revision order before any continuation renders", async ({
    actionCount,
    profile,
  }) => {
    const faultable = (message: Parameters<NonNullable<CoopFaultProfile["faultable"]>>[0]) => message.t === "envelope";
    const pair = wrapCoopFaultPair(createLoopbackPair(), { ...profile, faultable }, { seed: 0x33c0ffee });
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    const renderedRevisions: number[] = [];
    registerCoopOperationLiveSink("op:reward", envelope => {
      renderedRevisions.push(envelope.revision);
      expect(appliedStates.at(-1)?.tick).toBe(envelope.authoritativeState.tick);
      return true;
    });

    const commit = (index: number): void => {
      const prepared = commitRewardOwnerIntent({
        surface: "reward",
        pinned: 2,
        label: "shop",
        choice: index,
        data: [1, index, 0, 0],
        terminal: false,
        localRole: "host",
        wave: 7,
        turn: 3,
      })!;
      expect(
        commitRewardAuthoritativeResult(prepared.operationId, state(51 + index, 800 - index, `r${index}`)),
      ).not.toBeNull();
    };

    // Fault exactly the first immutable result. Later sends release it behind newer revisions; the dense
    // journal must park those revisions and then render 1..N, never the arrival order.
    commit(0);
    pair.setProfile({ drop: 0, reorder: 0, delay: 0, faultable });
    for (let index = 1; index < actionCount; index++) {
      commit(index);
    }
    await flushWire();
    hostManager.reconnect();
    guestManager.reconnect();
    await flushWire();

    expect(pair.faultsInjected()).toBe(1);
    expect(getCoopOperationJournalApplied().map(envelope => envelope.revision)).toEqual(
      Array.from({ length: actionCount }, (_, index) => index + 1),
    );
    expect(appliedStates.map(authoritative => authoritative.tick)).toEqual(
      Array.from({ length: actionCount }, (_, index) => 51 + index),
    );
    expect(renderedRevisions).toEqual(Array.from({ length: actionCount }, (_, index) => index + 1));
    expect(hostManager.unackedCount(), "every materially applied result remains retained before UI readiness").toBe(
      actionCount,
    );
    expect(guestManager.notifyOperationContinuationSurface("sharedInput", latestAppliedOperationAddress())).toBe(
      actionCount,
    );
    await flushWire();
    expect(hostManager.unackedCount(), "ordered UI readiness releases every immutable result").toBe(0);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("refuses an empty placeholder and retains exact typed market terminal output", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    registerCoopOperationLiveSink("op:reward", () => true);
    const prepared = commitRewardOwnerIntent({
      surface: "market",
      pinned: 6,
      label: "biomeShop",
      choice: COOP_INTERACTION_LEAVE,
      data: undefined,
      terminal: true,
      localRole: "host",
      wave: 7,
      turn: 3,
    })!;
    const empty = { ...state(41, 500, "empty"), playerParty: [] };
    expect(commitRewardAuthoritativeResult(prepared.operationId, empty)).toBeNull();
    expect(hostManager.unackedCount()).toBe(0);

    expect(commitRewardAuthoritativeResult(prepared.operationId, state(42, 500, "terminal"))).not.toBeNull();
    await flushWire();
    const envelope = getCoopOperationJournalApplied().at(-1)!;
    expect(envelope.pendingOperation?.payload as CoopShopBuyPayload).toEqual({
      slot: COOP_INTERACTION_LEAVE,
      data: undefined,
      terminal: true,
    });
    expect((envelope.pendingOperation?.payload as CoopRewardActionPayload).terminal).toBe(true);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("publishes an async continuation through its captured runtime, never the ambient peer", async () => {
    const pairA = createLoopbackPair();
    const pairB = createLoopbackPair();
    const managerA = new CoopDurabilityManager(pairA.host);
    const managerB = new CoopDurabilityManager(pairB.host);
    const receivedA: CoopAuthoritativeBattleStateV1[] = [];
    const receivedB: CoopAuthoritativeBattleStateV1[] = [];
    pairA.guest.onMessage(message => {
      if (message.t === "envelope") {
        receivedA.push(message.envelope.authoritativeState);
      }
    });
    pairB.guest.onMessage(message => {
      if (message.t === "envelope") {
        receivedB.push(message.envelope.authoritativeState);
      }
    });

    const runtimeA = createCoopRuntimeOpState();
    setActiveCoopRuntimeOpState(runtimeA);
    setCoopOperationDurability(managerA);
    const bindingA = captureCoopRewardOperationBinding()!;
    const runtimeB = createCoopRuntimeOpState();
    setActiveCoopRuntimeOpState(runtimeB);
    setCoopOperationDurability(managerB);
    const bindingB = captureCoopRewardOperationBinding()!;

    // B remains ambient while A's simulated async callback runs. Both use the same logical identity and
    // revision, which is valid in separate client runtimes; neither cursor/journal may consume the other.
    const params = {
      surface: "reward" as const,
      pinned: 0,
      label: "reward",
      choice: 0,
      data: [0],
      terminal: false,
      localRole: "host" as const,
      wave: 7,
      turn: 3,
    };
    const preparedA = commitRewardOwnerIntent(params, bindingA)!;
    const preparedB = commitRewardOwnerIntent(params, bindingB)!;
    expect(commitRewardAuthoritativeResult(preparedA.operationId, state(61, 700, "runtime-a"), bindingA)).toEqual({
      operationId: preparedA.operationId,
      revision: 1,
    });
    expect(commitRewardAuthoritativeResult(preparedB.operationId, state(62, 600, "runtime-b"), bindingB)).toEqual({
      operationId: preparedB.operationId,
      revision: 1,
    });
    await flushWire();

    expect(receivedA.map(result => result.tick)).toEqual([61]);
    expect(receivedB.map(result => result.tick)).toEqual([62]);
    expect(managerA.unackedCount()).toBe(1);
    expect(managerB.unackedCount()).toBe(1);
    managerA.dispose();
    managerB.dispose();
  });
});
