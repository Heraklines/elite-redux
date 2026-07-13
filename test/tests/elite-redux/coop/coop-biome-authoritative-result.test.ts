/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P33 biome/crossroads AUTHORITATIVE RESULT conversion (the successor of the control-only placeholder).
// Mirrors coop-reward-authoritative-result.test.ts for the biome-travel surface: a host RESERVES a typed
// intent privately, runs the REAL mutation once, then retains a COMPLETE post-mutation state in ONE
// immutable envelope; a guest installs that state atomically BEFORE its transition can render/continue; a
// retry reasserts the same state tick and never re-mutates; and an empty/incomplete placeholder is refused
// fail-closed. Both BIOME_PICK and CROSSROADS_PICK carry the complete state (no gradual rollout).
//
// Engine-light (no BattleScene): the CoopDurabilityManager + LoopbackTransport prove the retained-result
// mechanics through the SAME journal/applier the live phases use, with the state seam replaced by a plain
// capture/apply model via setCoopBiomeAuthorityStateHooksForTest.
// =============================================================================

import {
  adoptBiomeWatcherChoice,
  commitBiomeAuthoritativeResult,
  commitBiomeOwnerIntent,
  resetCoopBiomeOperationState,
  setCoopBiomeAuthorityStateHooksForTest,
  setCoopBiomeOperationEnabled,
} from "#data/elite-redux/coop/coop-biome-operation";
import { CoopDurabilityManager, setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type { CoopBiomePickPayload, CoopCrossroadsPickPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  getCoopOperationJournalApplied,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import { COOP_BIOME_PICK_SEQ_BASE, COOP_CROSSROADS_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BiomeId } from "#enums/biome-id";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function flushWire(): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

/** A COMPLETE authoritative state: non-empty player party + a real tick, keyed at the source wave/turn. */
function state(tick: number, money: number, marker: string, wave = 7, turn = 0): CoopAuthoritativeBattleStateV1 {
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
    // biome-structure extent the guest ADOPTS instead of rerunning the Stay/Leave substrate locally.
    biomeOverstayAnchor: tick,
  };
}

function hostBiomePick(pinned: number, destination: BiomeId, nodeIndex = 0, wave = 7) {
  return commitBiomeOwnerIntent({
    kind: "BIOME_PICK",
    seq: COOP_BIOME_PICK_SEQ_BASE + pinned,
    pinned,
    choice: nodeIndex,
    payload: { sourceBiomeId: BiomeId.PLAINS, biomeId: destination, nodeIndex, nextWave: wave + 1 },
    localRole: "host",
    wave,
    turn: 0,
    boundarySourceBiomeId: BiomeId.PLAINS,
    boundaryNextWave: wave + 1,
    allowedRoutes: [destination],
    deterministicDestination: null,
  });
}

function hostCrossroads(pinned: number, optionIndex: 0 | 1, wave = 7) {
  return commitBiomeOwnerIntent({
    kind: "CROSSROADS_PICK",
    seq: COOP_CROSSROADS_SEQ_BASE + pinned,
    pinned,
    choice: optionIndex,
    payload: { optionIndex },
    localRole: "host",
    wave,
    turn: 0,
    boundarySourceBiomeId: BiomeId.PLAINS,
    boundaryNextWave: wave + 1,
    allowedRoutes: [],
    deterministicDestination: null,
  });
}

describe("P33 retained biome/crossroads authoritative results", () => {
  let appliedStates: CoopAuthoritativeBattleStateV1[];
  let applyCalls: number;
  let reapplyCalls: number;

  beforeEach(() => {
    setCoopDurabilityEnabled(true);
    setCoopBiomeOperationEnabled(true);
    resetCoopBiomeOperationState();
    resetCoopOperationJournalLog();
    setCoopOperationDurability(null);
    registerCoopOperationLiveSink("op:biome", null);
    appliedStates = [];
    applyCalls = 0;
    reapplyCalls = 0;
    setCoopBiomeAuthorityStateHooksForTest({
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
    registerCoopOperationLiveSink("op:biome", null);
    setCoopBiomeAuthorityStateHooksForTest(null);
    resetCoopOperationJournalLog();
    resetCoopBiomeOperationState();
  });

  it("host-owned biome pick + crossroads results carry non-empty post-mutation state and install BEFORE render", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    const projectionOrder: string[] = [];
    registerCoopOperationLiveSink("op:biome", envelope => {
      projectionOrder.push(`render:${envelope.authoritativeState.tick}`);
      // design point 4: the complete state is installed BEFORE the transition can render/continue.
      expect(appliedStates.at(-1)?.tick, "state is installed before the biome transition can render").toBe(
        envelope.authoritativeState.tick,
      );
      return true;
    });

    // A host-owned crossroads Leave (pinned 2, host seat), then its chained host-owned biome pick (pinned 4).
    const crossroads = hostCrossroads(2, 1);
    expect(crossroads?.revision, "reserve retains the intent but publishes no pre-mutation result").toBe(0);
    expect(commitBiomeAuthoritativeResult(crossroads!.operationId, state(11, 900, "leave"))).toMatchObject({
      operationId: crossroads!.operationId,
    });
    await flushWire();

    const pick = hostBiomePick(4, BiomeId.VOLCANO);
    expect(pick?.revision).toBe(0);
    expect(commitBiomeAuthoritativeResult(pick!.operationId, state(12, 900, "volcano"))).toMatchObject({
      operationId: pick!.operationId,
    });
    await flushWire();

    expect(appliedStates.map(value => value.tick)).toEqual([11, 12]);
    expect(projectionOrder).toEqual(["render:11", "render:12"]);
    expect(
      getCoopOperationJournalApplied().every(envelope => envelope.authoritativeState.playerParty.length > 0),
      "no live committed biome/crossroads envelope contains the historical empty placeholder",
    ).toBe(true);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("guest-owned biome pick executes only on the host; the complete state is the guest's sole mutation seam", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    registerCoopOperationLiveSink("op:biome", () => true);

    // pinned 1 -> odd -> guest owns; the host is the sole committer.
    const guestProposal = commitBiomeOwnerIntent({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 1,
      pinned: 1,
      choice: 0,
      payload: { sourceBiomeId: BiomeId.PLAINS, biomeId: BiomeId.SWAMP, nodeIndex: 0, nextWave: 8 },
      localRole: "guest",
      wave: 7,
      turn: 0,
      boundarySourceBiomeId: BiomeId.PLAINS,
      boundaryNextWave: 8,
      allowedRoutes: [BiomeId.SWAMP],
      deterministicDestination: null,
    });
    expect(guestProposal, "proposing never mutates any engine").not.toBeNull();
    expect(applyCalls, "proposing installs no state").toBe(0);

    const first = adoptBiomeWatcherChoice({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 1,
      pinned: 1,
      res: { choice: 0, data: [BiomeId.SWAMP] },
      localRole: "host",
      wave: 7,
      turn: 0,
      sourceBiomeId: BiomeId.PLAINS,
      nextWave: 8,
      allowedRoutes: [BiomeId.SWAMP],
      deterministicDestination: null,
    });
    expect(first).toMatchObject({ adopt: true, requiresAuthorityCommit: true });
    if (!first.adopt || first.operationId == null) {
      throw new Error("host rejected valid guest biome intent");
    }

    // A duplicate host adopt of the SAME reserved intent BEFORE the result is idempotent (the biome recovery
    // path re-enters the watch; it must not fail-closed), and never installs a second state.
    const duplicateBeforeResult = adoptBiomeWatcherChoice({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 1,
      pinned: 1,
      res: { choice: 0, data: [BiomeId.SWAMP] },
      localRole: "host",
      wave: 7,
      turn: 0,
      sourceBiomeId: BiomeId.PLAINS,
      nextWave: 8,
      allowedRoutes: [BiomeId.SWAMP],
      deterministicDestination: null,
    });
    expect(duplicateBeforeResult).toMatchObject({ adopt: true, operationId: first.operationId });

    expect(commitBiomeAuthoritativeResult(first.operationId, state(21, 700, "guest-pick"))).not.toBeNull();
    await flushWire();
    expect(applyCalls, "the complete host state is the guest's ONLY mutation seam").toBe(1);
    expect(appliedStates[0].money).toBe(700);
    expect(
      (getCoopOperationJournalApplied().at(-1)?.pendingOperation?.payload as CoopBiomePickPayload).biomeId,
      "the retained result preserves the exact host-validated destination",
    ).toBe(BiomeId.SWAMP);

    // After the result, a re-adopt is refused (the transition is complete) - it cannot execute twice.
    const afterResult = adoptBiomeWatcherChoice({
      kind: "BIOME_PICK",
      seq: COOP_BIOME_PICK_SEQ_BASE + 1,
      pinned: 1,
      res: { choice: 0, data: [BiomeId.SWAMP] },
      localRole: "host",
      wave: 7,
      turn: 0,
      sourceBiomeId: BiomeId.PLAINS,
      nextWave: 8,
      allowedRoutes: [BiomeId.SWAMP],
      deterministicDestination: null,
    });
    expect(afterResult).toEqual({ adopt: false, reason: "host-intent-complete" });
    expect(applyCalls, "a post-result re-adopt cannot install state again").toBe(1);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("dropped then retried and duplicated results apply state and project exactly once (retry reuses the tick)", async () => {
    const pair = wrapCoopFaultPair(createLoopbackPair(), { drop: 0, reorder: 0, delay: 0 }, { seed: 0xb10e5 });
    pair.armNextDrop("envelope", "host");
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    let projections = 0;
    registerCoopOperationLiveSink("op:biome", () => {
      projections++;
      return true;
    });

    const pick = hostBiomePick(2, BiomeId.VOLCANO)!;
    const complete = state(31, 1_100, "retained-biome");
    expect(commitBiomeAuthoritativeResult(pick.operationId, complete)).not.toBeNull();
    await flushWire();
    expect(pair.faultsInjected(), "the first complete result was actually dropped").toBe(1);
    expect(applyCalls).toBe(0);

    hostManager.reconnect();
    await flushWire();
    expect(applyCalls, "the resend installs the complete state exactly once").toBe(1);
    expect(projections).toBe(1);
    expect(appliedStates[0].tick).toBe(31);

    // Design point 5: a retry reuses the SAME retained tick and never recaptures/re-mutates. The bogus state
    // passed here must be IGNORED (the retained envelope wins).
    expect(commitBiomeAuthoritativeResult(pick.operationId, state(999, 0, "must-not-recapture"))).toMatchObject({
      operationId: pick.operationId,
      revision: 1,
    });
    hostManager.reconnect();
    guestManager.reconnect();
    await flushWire();
    expect(applyCalls, "duplicate retained delivery cannot install the engine state twice").toBe(1);
    expect(projections, "duplicate retained delivery cannot reopen the transition twice").toBe(1);
    expect(reapplyCalls).toBe(0);
    expect(appliedStates[0].tick, "the retained tick 31 is authoritative, never the recapture attempt").toBe(31);
    hostManager.dispose();
    guestManager.dispose();
  });

  it("refuses an empty placeholder (fail-closed) and retains the exact typed crossroads terminal", async () => {
    const pair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(pair.host);
    const guestManager = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostManager);
    registerCoopOperationLiveSink("op:biome", () => true);

    const crossroads = hostCrossroads(2, 0)!;
    // An empty placeholder (empty player party / tick 0) is REFUSED - never journaled.
    const empty = { ...state(41, 500, "empty"), playerParty: [] };
    expect(commitBiomeAuthoritativeResult(crossroads.operationId, empty)).toBeNull();
    const zeroTick = { ...state(0, 500, "zero-tick") };
    expect(commitBiomeAuthoritativeResult(crossroads.operationId, zeroTick)).toBeNull();
    expect(getCoopOperationJournalApplied().length, "no incomplete envelope was journaled").toBe(0);
    expect(applyCalls).toBe(0);

    // The complete result IS retained, carrying the exact typed Stay/Leave payload for UI continuation.
    expect(commitBiomeAuthoritativeResult(crossroads.operationId, state(42, 500, "stay"))).not.toBeNull();
    await flushWire();
    const envelope = getCoopOperationJournalApplied().at(-1)!;
    expect(envelope.pendingOperation?.payload as CoopCrossroadsPickPayload).toEqual({ optionIndex: 0 });
    expect(envelope.authoritativeState.playerParty.length).toBeGreaterThan(0);
    expect(applyCalls, "the guest installs the complete crossroads state").toBe(1);
    hostManager.dispose();
    guestManager.dispose();
  });
});
