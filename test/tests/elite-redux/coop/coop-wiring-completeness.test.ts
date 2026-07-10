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

import {
  assembleCoopRuntime,
  type CoopRuntime,
  clearCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
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
    clearCoopRuntime();
  });

  it("assembleCoopRuntime (the LIVE + harness factory) installs every critical hook", () => {
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "wiring-host" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "wiring-guest" });
    assertFullyWired(hostRuntime, "assemble(host)");
    assertFullyWired(guestRuntime, "assemble(guest)");
  });

  it("startLocalCoopSession (the DEV factory) produces the SAME wiring", () => {
    const runtime = startLocalCoopSession({ username: "wiring-dev" });
    assertFullyWired(runtime, "startLocalCoopSession");
    // The dev extras on TOP of the shared factory, never instead of it.
    expect(runtime.spoof, "dev path attaches the spoof partner").toBeDefined();
    expect(runtime.partnerTransport, "dev path exposes the partner transport").toBeDefined();
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
});
