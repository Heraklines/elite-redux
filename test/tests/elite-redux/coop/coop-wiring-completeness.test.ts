/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #820 WIRING COMPLETENESS - the structural guard against the "two factories"
// bug class. The live meCursor failure (17:17 capture: 13 rx, zero applies)
// happened because a hook was wired in startLocalCoopSession (the DEV factory)
// but not assembleCoopRuntime (the LIVE factory): it looked shipped, passed the
// spoof-path tests, and never ran in production. The factories are consolidated
// now; these tests make a RE-fork loud:
//   1. HOOKS: every runtime hook must be installed by BOTH entry points.
//      Add every NEW runtime hook to CRITICAL_HOOKS - a hook missing here is a
//      hook that can silently die on one path again.
//   2. MESSAGES: every wire type in the CoopMessage union must have at least
//      one RECEIVER (`case "x"` / `t === "x"`) somewhere in src. A sender with
//      no receiver is the same bug one layer down.
// =============================================================================

import { setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import {
  assembleCoopRuntime,
  type CoopRuntime,
  clearCoopRuntime,
  getCoopSharedTerminalSupervisor,
  setCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { createFreshCoopP33Context } from "#data/elite-redux/coop/coop-session-binding";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  beginCoopUiRelayInput,
  endCoopUiRelayInput,
  getCoopUiRelayEdges,
  recordCoopUiRelayCarrier,
} from "#data/elite-redux/coop/coop-ui-relay-trace";
import { UiMode } from "#enums/ui-mode";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The hooks a factory MUST install. ADD EVERY NEW RUNTIME HOOK HERE - this list
 * is the tripwire that catches "wired on one path, missing on the other".
 */
const CRITICAL_HOOKS: { name: string; installed: (r: CoopRuntime) => boolean }[] = [
  { name: "controller.onMeCursor (#817 cursor mirror)", installed: r => r.controller.onMeCursor != null },
  {
    name: "interactionRelay.onRevivalPrompt (#809 revival owner-pick)",
    installed: r => r.interactionRelay.onRevivalPrompt != null,
  },
  {
    name: "interactionRelay.onCatchFullPrompt (#856 wild-catch full-party owner-pick)",
    installed: r => r.interactionRelay.onCatchFullPrompt != null,
  },
  {
    name: "battleSync slotOwnershipProbe (#812 pre-responder ownership)",
    installed: r => r.battleSync.hasSlotOwnershipProbe(),
  },
];

function assertFullyWired(runtime: CoopRuntime, label: string): void {
  for (const hook of CRITICAL_HOOKS) {
    expect(hook.installed(runtime), `${label}: ${hook.name} must be installed by the factory`).toBe(true);
  }
}

describe("#820 co-op wiring completeness (the two-factories guard)", () => {
  afterEach(() => {
    setCoopDurabilityEnabled(true);
    clearCoopRuntime();
  });

  it("runtime assembly never advertises durability when no durability manager is installed", async () => {
    setCoopDurabilityEnabled(false);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "no-durability-host" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "no-durability-guest" });
    try {
      expect(hostRuntime.durability).toBeUndefined();
      expect(guestRuntime.durability).toBeUndefined();
      hostRuntime.controller.connect();
      guestRuntime.controller.connect();
      await new Promise<void>(resolve => queueMicrotask(resolve));
      expect(
        hostRuntime.controller.compatibilityAccepted,
        "protocol 31 must fail closed instead of claiming the missing journal capability",
      ).toBe(false);
      expect(guestRuntime.controller.compatibilityAccepted).toBe(false);
    } finally {
      hostRuntime.controller.dispose();
      guestRuntime.controller.dispose();
    }
  });

  it("assembleCoopRuntime (the LIVE + harness factory) installs every critical hook", () => {
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "wiring-host" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "wiring-guest" });
    assertFullyWired(hostRuntime, "assemble(host)");
    assertFullyWired(guestRuntime, "assemble(guest)");
  });

  it("the authenticated LIVE factory owns and normally disposes one P33 terminal supervisor", () => {
    const { host } = createLoopbackPair();
    const p33 = createFreshCoopP33Context({
      pairingId: "PAIR33RUNTIME",
      pairingBearer: "T".repeat(43),
      transportRole: "answerer",
      account: {
        version: 1,
        accountId: "er-account:10",
        displayName: "Authority",
        canonicalUsername: "authority",
      },
      peerAccount: {
        version: 1,
        accountId: "er-account:20",
        displayName: "Replica",
        canonicalUsername: "replica",
      },
      connectionGeneration: 2,
      peerConnectionGeneration: 4,
    });
    expect(p33).not.toBeNull();
    if (p33 == null) {
      throw new Error("P33 runtime fixture was rejected");
    }
    const runtime = assembleCoopRuntime(host, { username: "p33-terminal-runtime", p33 });
    setCoopRuntime(runtime);
    expect(getCoopSharedTerminalSupervisor(runtime)).not.toBeNull();

    clearCoopRuntime();
    expect(
      getCoopSharedTerminalSupervisor(runtime),
      "normal teardown disposes and unregisters the supervisor",
    ).toBeNull();
  });

  it("startLocalCoopSession (the DEV factory) produces the SAME wiring", () => {
    const runtime = startLocalCoopSession({ username: "wiring-dev" });
    assertFullyWired(runtime, "startLocalCoopSession");
    // The dev extras on TOP of the shared factory, never instead of it.
    expect(runtime.spoof, "dev path attaches the spoof partner").toBeDefined();
    expect(runtime.partnerTransport, "dev path exposes the partner transport").toBeDefined();
  });

  it("clearCoopRuntime scopes UI-relay diagnostics to one session even when no runtime is active", () => {
    clearCoopRuntime();
    const inputId = beginCoopUiRelayInput(UiMode.MODIFIER_SELECT);
    recordCoopUiRelayCarrier("operation", "prior session reward", "op:reward");
    endCoopUiRelayInput(inputId);
    expect(getCoopUiRelayEdges()).toHaveLength(1);

    clearCoopRuntime();
    expect(getCoopUiRelayEdges()).toEqual([]);
  });

  it("every CoopMessage wire type has at least one RECEIVER in src (no sender-only channels)", () => {
    const root = join(__dirname, "..", "..", "..", "..", "src");
    const transportSrc = readFileSync(join(root, "data", "elite-redux", "coop", "coop-transport.ts"), "utf8");
    // The union block: every `| { t: "name"; ... }` variant.
    const types = [...transportSrc.matchAll(/\|\s*\{\s*t:\s*"([A-Za-z]+)"/g)].map(m => m[1]);
    expect(types.length, "extracted the CoopMessage union (regex sanity)").toBeGreaterThan(10);

    // Collect all sources that may receive.
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (entry.endsWith(".ts")) {
          sources.push(readFileSync(p, "utf8"));
        }
      }
    };
    walk(join(root, "data", "elite-redux", "coop"));
    walk(join(root, "phases"));
    sources.push(readFileSync(join(root, "ui", "ui.ts"), "utf8"));
    const all = sources.join("\n");

    // Wave-2e closed the operation<->durability seam: the `envelope` arm is now SENT (a committed op rides
    // it through the durability journal) AND RECEIVED (extractKey/apply in coop-operation-journal.ts,
    // `t === "envelope"`), so it is no longer declared-ahead-of-receiver. The doc's `envelopeAck` /
    // `reconnectSync` arms were RETIRED in favor of the generic class-parameterized `coopAck` / `coopResync`
    // (§4.6 wire consolidation) - they no longer exist in the union, so nothing needs allowlisting here.
    const DECLARED_AHEAD_OF_RECEIVER = new Set<string>([]);

    const missing = types.filter(t => {
      if (DECLARED_AHEAD_OF_RECEIVER.has(t)) {
        return false;
      }
      // Receiver shapes: a switch case or a direct type test. Sender calls are
      // `send({ t: "x"` and do NOT match these.
      return !(all.includes(`case "${t}"`) || all.includes(`t === "${t}"`) || all.includes(`.t == "${t}"`));
    });
    expect(
      missing,
      `wire types with NO receiver anywhere (sender-only channels - the #820 class): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("FAILURE-FIRST: every ordinary wave requests lost enemy authority instead of locally rerolling", () => {
    const encounterSource = readFileSync(
      join(__dirname, "..", "..", "..", "..", "src", "phases", "encounter-phase.ts"),
      "utf8",
    );
    expect(
      encounterSource,
      "EncounterPhase must use the existing requestEnemyParty recovery loop for the real production await",
    ).toContain("streamer.awaitEnemyPartyWithRetry(");
    expect(
      encounterSource,
      "the one-shot await is forbidden at the production wave boundary because its null path locally rerolls enemies",
    ).not.toContain("enemies = await streamer.awaitEnemyParty(");
  });

  it("keeps an authoritative guest behind the atomic encounter carrier before Mystery materialization", () => {
    const root = join(__dirname, "..", "..", "..", "..", "src");
    const encounterSource = readFileSync(join(root, "phases", "encounter-phase.ts"), "utf8");
    const battleSceneSource = readFileSync(join(root, "battle-scene.ts"), "utf8");

    const adoptionStart = encounterSource.indexOf("private async runEncounterAfterCoopAdopt(): Promise<void>");
    const adoptionEnd = encounterSource.indexOf(
      "protected async prepareCoopAuthoritativeGuestPresentationOnly",
      adoptionStart,
    );
    expect(adoptionStart, "the guest encounter carrier boundary exists").toBeGreaterThanOrEqual(0);
    expect(adoptionEnd, "the carrier boundary has a bounded source section").toBeGreaterThan(adoptionStart);
    const adoption = encounterSource.slice(adoptionStart, adoptionEnd);
    expect(
      adoption.indexOf("await this.adoptCoopHostEnemyParty("),
      "the guest awaits the complete host carrier",
    ).toBeGreaterThanOrEqual(0);
    expect(
      adoption.indexOf("this.runEncounter()"),
      "Mystery construction runs only after carrier adoption",
    ).toBeGreaterThan(adoption.indexOf("await this.adoptCoopHostEnemyParty("));

    const carrierStart = encounterSource.indexOf("private async adoptCoopHostEnemyParty(");
    const carrierEnd = encounterSource.indexOf("private broadcastCoopEnemyParty", carrierStart);
    expect(carrierStart, "the atomic carrier apply exists").toBeGreaterThanOrEqual(0);
    expect(carrierEnd, "the carrier apply has a bounded source section").toBeGreaterThan(carrierStart);
    const carrier = encounterSource.slice(carrierStart, carrierEnd);
    expect(
      carrier.indexOf("const encounter = streamer.consumeEnemyPartyEncounter("),
      "descriptor is required",
    ).toBeGreaterThanOrEqual(0);
    expect(
      carrier.indexOf("applyCoopEncounterAuthority(battle, encounter)"),
      "descriptor is applied atomically",
    ).toBeGreaterThan(carrier.indexOf("const encounter = streamer.consumeEnemyPartyEncounter("));

    const pickerStart = battleSceneSource.indexOf("getMysteryEncounter(");
    const pickerEnd = battleSceneSource.indexOf("// Check for queued encounters first", pickerStart);
    const picker = battleSceneSource.slice(pickerStart, pickerEnd);
    expect(picker, "a committed descriptor wins before any live picker").toContain(
      "encounterType != null && allMysteryEncounters[encounterType] != null",
    );
    expect(picker, "a renderer with missing authority fails closed instead of selecting locally").toContain(
      "refusing local derivation",
    );
    expect(picker.indexOf("isCoopAuthoritativeGuest()"), "the guest fence precedes the gauntlet picker").toBeLessThan(
      picker.indexOf("erGauntletActive()"),
    );
  });

  it("purges every reused-key transport buffer at a carried session boundary", () => {
    const root = join(__dirname, "..", "..", "..", "..", "src");
    const runtimeSource = readFileSync(join(root, "data", "elite-redux", "coop", "coop-runtime.ts"), "utf8");
    const gameDataSource = readFileSync(join(root, "system", "game-data.ts"), "utf8");
    const purgeStart = runtimeSource.indexOf("export function purgeCoopBufferedArrivals(reason: string): void");
    const purgeEnd = runtimeSource.indexOf("export function isCoopRuntimeActive", purgeStart);
    expect(purgeStart, "the carried-runtime purge exists").toBeGreaterThanOrEqual(0);
    expect(purgeEnd, "the purge has a bounded source section").toBeGreaterThan(purgeStart);
    const purge = runtimeSource.slice(purgeStart, purgeEnd);
    expect(purge).toContain("active?.interactionRelay.purgeBufferedArrivals(reason)");
    expect(purge).toContain("active?.rendezvous.purgeBufferedArrivals(reason)");
    expect(purge).toContain("active?.battleStream.purgeSessionBoundaryState(reason)");
    expect(gameDataSource).toContain('purgeCoopBufferedArrivals("applyCoopLaunchSession (resume/launch adopt)")');
  });

  it("publishes each complete wave carrier without waiting on a pre-commit interaction generation", () => {
    const encounterSource = readFileSync(
      join(__dirname, "..", "..", "..", "..", "src", "phases", "encounter-phase.ts"),
      "utf8",
    );
    const start = encounterSource.indexOf("private broadcastCoopEnemyParty(): void");
    const end = encounterSource.indexOf("private broadcastCoopLaunchSnapshot(", start);
    expect(start, "ordinary-wave authority publisher exists").toBeGreaterThanOrEqual(0);
    expect(end, "publisher has a bounded source section").toBeGreaterThan(start);
    const publisher = encounterSource.slice(start, end);
    expect(publisher, "the coherent carrier is actually published").toContain("streamer.sendEnemyParty(");
    expect(
      publisher,
      "publication cannot depend on an interaction counter captured before reward commit",
    ).not.toContain("awaitPartnerInteraction(");
  });

  it("finalizes encounter authority before dispatching any subtype-specific presentation", () => {
    const phaseRoot = join(__dirname, "..", "..", "..", "..", "src", "phases");
    const encounterSource = readFileSync(join(phaseRoot, "encounter-phase.ts"), "utf8");
    const nextEncounterSource = readFileSync(join(phaseRoot, "next-encounter-phase.ts"), "utf8");
    expect(nextEncounterSource, "the common next-wave phase overrides the presentation method").toContain(
      "protected override doEncounter(): void",
    );
    expect(
      encounterSource.match(/this\.doEncounter\(\)/g),
      "all virtual presentation dispatches must pass through one mandatory authority chokepoint",
    ).toHaveLength(1);
    const boundaryStart = encounterSource.indexOf("private enterEncounterPresentation(): void");
    const boundaryEnd = encounterSource.indexOf("private incrementMysteryEncounterChance", boundaryStart);
    const boundary = encounterSource.slice(boundaryStart, boundaryEnd);
    expect(boundary.indexOf("this.finalizeCoopEncounterAuthority()"), "authority is finalized first").toBeGreaterThan(
      -1,
    );
    expect(boundary.indexOf("this.doEncounter()"), "subtype presentation is dispatched afterward").toBeGreaterThan(
      boundary.indexOf("this.finalizeCoopEncounterAuthority()"),
    );
    expect(
      encounterSource.match(/this\.enterEncounterPresentation\(\)/g),
      "loaded, authoritative-guest, ephemeral, and persisted encounter branches all cross the chokepoint",
    ).toHaveLength(4);
  });

  it("routes turn and replacement publication through one all-or-nothing authority capture", () => {
    const root = join(__dirname, "..", "..", "..", "..", "src");
    const turnEnd = readFileSync(join(root, "phases", "coop-turn-commit-phase.ts"), "utf8");
    const replacement = readFileSync(join(root, "phases", "coop-push-replacement-checkpoint-phase.ts"), "utf8");
    for (const [label, source] of [
      ["turnResolution", turnEnd],
      ["replacement", replacement],
    ] as const) {
      expect(source, `${label} uses the coherent capture chokepoint`).toContain("captureCoopAuthoritativeCarrier(");
      expect(source, `${label} never turns a missing rich companion into an optional wire field`).not.toContain(
        "?? undefined",
      );
    }
    expect(turnEnd, "turn publication passes the required full field companion").toContain("carrier.fullField");
    expect(replacement, "replacement publication passes the required full field companion").toContain(
      "carrier.fullField",
    );
    const replay = readFileSync(join(root, "phases", "coop-replay-turn-phase.ts"), "utf8");
    expect(replay, "replacement retry uses the streamer's injectable scheduler").toContain(
      "streamer.scheduleAuthorityRetry(",
    );
    expect(replay, "an ambient timer cannot fire under another duo client context").not.toContain("setTimeout(");
    const terminal = readFileSync(join(root, "data", "elite-redux", "coop", "coop-authority-terminal.ts"), "utf8");
    expect(terminal, "authority phases delegate to the one retained runtime terminal contract").toContain(
      "failCoopSharedSession(reason,",
    );
    expect(terminal, "authority phases cannot bypass peer ACK retention with immediate local teardown").not.toContain(
      "clearCoopRuntime(",
    );
    expect(replay, "turn and replacement failures route through the shared terminal helper").toContain(
      "terminateCoopAuthoritySession(",
    );
  });

  it("forbids orphaned shared input surfaces from falling through to local mechanics", () => {
    const root = join(__dirname, "..", "..", "..", "..", "src");
    const runtime = readFileSync(join(root, "data", "elite-redux", "coop", "coop-runtime.ts"), "utf8");
    const command = readFileSync(join(root, "phases", "command-phase.ts"), "utf8");
    const reward = readFileSync(join(root, "phases", "select-modifier-phase.ts"), "utf8");
    const biome = readFileSync(join(root, "phases", "select-biome-phase.ts"), "utf8");

    const sharedFailureStart = runtime.indexOf("export function failCoopSharedSession(");
    const sharedFailureEnd = runtime.indexOf("export interface CoopStateRecoveryRequest", sharedFailureStart);
    const sharedFailure = runtime.slice(sharedFailureStart, sharedFailureEnd);
    expect(sharedFailureStart, "the shared terminal helper exists").toBeGreaterThanOrEqual(0);
    expect(sharedFailure, "runtime loss has an immediate local terminal fallback").toContain(
      "orphaned shared session terminal requested",
    );
    expect(sharedFailure, "the orphan fallback installs a title continuation").toContain(
      'globalScene.phaseManager.unshiftNew("TitlePhase")',
    );

    const commandStart = command.indexOf("private tryCoopCheckpointSync(): boolean");
    const commandEnd = command.indexOf("public override start(): void", commandStart);
    const commandBoundary = command.slice(commandStart, commandEnd);
    expect(commandBoundary, "the orphan guard uses scene mode rather than a runtime-backed predicate").toContain(
      "!globalScene.gameMode.isCoop && !globalScene.gameMode.isShowdown",
    );
    expect(commandBoundary, "command input requires both controller and authoritative streamer").toContain(
      "if (controller == null || streamer == null)",
    );
    expect(commandBoundary, "missing command authority terminates the session").toContain(
      'failCoopSharedSession("A shared battle reached command input without its authoritative runtime."',
    );
    expect(commandBoundary, "missing command authority cannot report a successful checkpoint").not.toContain(
      "if (controller == null || streamer == null) {\n      return true;",
    );

    const rewardStart = reward.indexOf("start() {");
    const rewardEnd = reward.indexOf("// Co-op (#633): the reward screen", rewardStart);
    const rewardBoundary = reward.slice(rewardStart, rewardEnd);
    expect(rewardBoundary, "a co-op reward cannot enter the solo roll/apply path without a runtime").toContain(
      "if (globalScene.gameMode.isCoop && getCoopController() == null)",
    );
    expect(rewardBoundary).toContain(
      'failCoopSharedSession("A shared reward surface opened without its authoritative runtime."',
    );

    const biomeStart = biome.indexOf("private setNextBiomeAndEnd(");
    const biomeEnd = biome.indexOf("private async finishGuestOwnedBiomeAfterCommit", biomeStart);
    const biomeBoundary = biome.slice(biomeStart, biomeEnd);
    expect(biomeStart, "the World Map terminal funnel exists").toBeGreaterThanOrEqual(0);
    expect(biomeEnd, "the World Map terminal funnel has a bounded source section").toBeGreaterThan(biomeStart);
    expect(biomeBoundary, "only actual solo play may use the direct World Map path").toContain(
      "if (!globalScene.gameMode.isCoop)",
    );
    expect(biomeBoundary, "a co-op World Map cannot apply locally after runtime loss").toContain(
      'failCoopSharedSession("A shared World Map choice lost its authoritative runtime."',
    );
    expect(biomeBoundary).not.toContain("!globalScene.gameMode.isCoop || getCoopController() == null");
  });

  it("publishes retained SelectBiome readiness only after each real ER_MAP surface opens", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "src", "phases", "select-biome-phase.ts"),
      "utf8",
    );
    const ownerStart = source.indexOf("private coopBiomePickOwner(");
    const ownerEnd = source.indexOf("/** OWNER terminal:", ownerStart);
    const watcherStart = source.indexOf("private async coopBiomePickWatch(");
    const watcherEnd = source.indexOf("private committedBiomePayload(", watcherStart);
    expect(ownerStart, "the owner World Map implementation exists").toBeGreaterThanOrEqual(0);
    expect(ownerEnd, "the owner implementation has a bounded source section").toBeGreaterThan(ownerStart);
    expect(watcherStart, "the watcher World Map implementation exists").toBeGreaterThanOrEqual(0);
    expect(watcherEnd, "the watcher implementation has a bounded source section").toBeGreaterThan(watcherStart);

    for (const [label, body, mirrorRole] of [
      ["owner", source.slice(ownerStart, ownerEnd), "owner"],
      ["watcher", source.slice(watcherStart, watcherEnd), "watcher"],
    ] as const) {
      const modeOpen = body.search(/setModeBoundedWhen\(\s*UiMode\.ER_MAP/);
      const supersededGuard = body.search(/===\s*"superseded"/);
      const mirrorOpen = body.search(new RegExp(`beginSession\\(\\s*"${mirrorRole}"\\s*,\\s*UiMode\\.ER_MAP`));
      const readiness = body.indexOf("notifyCoopWaveContinuationSurfaceReady(");
      expect(modeOpen, `${label} opens ER_MAP through the bounded live-phase seam`).toBeGreaterThanOrEqual(0);
      expect(supersededGuard, `${label} rejects a replaced UI transition`).toBeGreaterThan(modeOpen);
      expect(mirrorOpen, `${label} starts its real ER_MAP mirror only after replacement rejection`).toBeGreaterThan(
        supersededGuard,
      );
      expect(readiness, `${label} publishes retained readiness from the open public surface`).toBeGreaterThan(
        mirrorOpen,
      );
    }
  });

  it("retries retained reward and market claims from their real public-handler readiness edges", () => {
    const phaseRoot = join(__dirname, "..", "..", "..", "..", "src", "phases");
    const reward = readFileSync(join(phaseRoot, "select-modifier-phase.ts"), "utf8");
    const market = readFileSync(join(phaseRoot, "biome-shop-phase.ts"), "utf8");
    const rewardStart = reward.indexOf("private notifyCoopContinuationSurfaceReady(): void");
    const rewardEnd = reward.indexOf("updateSeed(): void", rewardStart);
    const marketStart = market.indexOf("private notifyCoopBiomeContinuationSurfaceReady(): void");
    const marketEnd = market.indexOf("private coopBiomeAuthoritativeStockUnavailable(", marketStart);
    expect(rewardStart, "the reward public-ready funnel exists").toBeGreaterThanOrEqual(0);
    expect(rewardEnd, "the reward public-ready funnel has a bounded source section").toBeGreaterThan(rewardStart);
    expect(marketStart, "the market public-ready funnel exists").toBeGreaterThanOrEqual(0);
    expect(marketEnd, "the market public-ready funnel has a bounded source section").toBeGreaterThan(marketStart);

    for (const [label, body] of [
      ["reward", reward.slice(rewardStart, rewardEnd)],
      ["market", market.slice(marketStart, marketEnd)],
    ] as const) {
      expect(body, `${label} preserves retained wave continuation proof`).toContain(
        "notifyCoopWaveContinuationSurfaceReady(",
      );
      expect(body, `${label} also retries the global V2 presentation claim`).toContain(
        "notifyCoopV2InteractionSurfaceReady(",
      );
    }
  });

  it("retires late replacement authority only after the retained wave continuation is durably released", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "src", "data", "elite-redux", "coop", "coop-runtime.ts"),
      "utf8",
    );
    const start = source.indexOf("function maybeMarkCoopWaveContinuationReady(");
    const end = source.indexOf("export function notifyCoopWaveContinuationSurfaceReady(", start);
    expect(start, "the retained wave readiness seam exists").toBeGreaterThanOrEqual(0);
    expect(end, "the retained wave readiness seam has a bounded source section").toBeGreaterThan(start);

    const body = source.slice(start, end);
    const durableRelease = body.indexOf("completeRetainedWaveAdvance(");
    const releaseGuard = body.indexOf("if (released)", durableRelease);
    const replacementRetirement = body.indexOf(
      "runtime.battleStream.acknowledgeReplacementsSubsumedByOperation(staged.envelope)",
      releaseGuard,
    );
    expect(durableRelease, "the exact WAVE_ADVANCE transaction must release first").toBeGreaterThanOrEqual(0);
    expect(releaseGuard, "a rejected/duplicate durability proof cannot retire replacement authority").toBeGreaterThan(
      durableRelease,
    );
    expect(
      replacementRetirement,
      "the applied WAVE_ADVANCE DATA image retires an older late replacement only after release",
    ).toBeGreaterThan(releaseGuard);
  });
});
