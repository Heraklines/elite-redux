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
    const turnEnd = readFileSync(join(root, "phases", "turn-end-phase.ts"), "utf8");
    const turnSeal = readFileSync(join(root, "phases", "coop-seal-turn-phase.ts"), "utf8");
    const replacement = readFileSync(join(root, "phases", "coop-push-replacement-checkpoint-phase.ts"), "utf8");
    for (const [label, source] of [
      ["turnResolution", turnSeal],
      ["replacement", replacement],
    ] as const) {
      expect(source, `${label} uses the coherent capture chokepoint`).toContain("captureCoopAuthoritativeCarrier(");
      expect(source, `${label} never turns a missing rich companion into an optional wire field`).not.toContain(
        "?? undefined",
      );
    }
    expect(turnSeal, "turn publication passes the required full field companion").toContain("carrier.fullField");
    expect(turnEnd, "TurnEnd cannot publish before its state-bearing descendants settle").not.toContain(
      "captureCoopAuthoritativeCarrier(",
    );
    const phaseManager = readFileSync(join(root, "phase-manager.ts"), "utf8");
    expect(
      phaseManager,
      "the turn seal is a root sibling immediately after TurnEnd, not a child that deferred work can overtake",
    ).toMatch(/"TurnEndPhase",\s*"CoopSealTurnPhase"/);
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
    expect(turnSeal, "turn-seal failures route through the shared terminal helper").toContain(
      "terminateCoopAuthoritySession(",
    );
  });
});
