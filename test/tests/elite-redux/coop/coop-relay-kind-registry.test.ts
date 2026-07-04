/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #840 RELAY-KIND registry guard - the #820 wiring-completeness pattern one layer
// DOWN. #820 proves every CoopMessage wire type has a receiver; this proves every
// interactionChoice / interactionOutcome `kind` string is REGISTERED, rides a real
// seq band, is sent via the declared transport, and that the consuming machinery
// for both transports (incl. the k-discriminated outcome handlers) exists. A kind
// that ships with no registry entry - or a registered kind that never really sends -
// is the sender/consumer mismatch bug, caught at build time instead of live.
// =============================================================================

import { COOP_RELAY_KINDS, COOP_SEQ_BANDS } from "#data/elite-redux/coop/coop-seq-registry";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..", "..", "src");

/** All .ts under a dir, recursively, concatenated. */
function readAllTs(...dirs: string[]): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (entry.endsWith(".ts")) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  for (const d of dirs) {
    walk(d);
  }
  return out.join("\n");
}

const ALL_SRC = readAllTs(
  join(SRC, "data", "elite-redux", "coop"),
  join(SRC, "phases"),
  join(SRC, "data", "mystery-encounters"),
);

/** Map every `*_KIND = "value"` (or `*Kind = "value"`) constant to its string value. */
function collectKindConstValues(src: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const match of src.matchAll(/\b(\w*(?:KIND|Kind)\w*)\s*=\s*"([A-Za-z]+)"/g)) {
    m.set(match[1], match[2]);
  }
  return m;
}

const KIND_CONST_VALUES = collectKindConstValues(ALL_SRC);
const REGISTERED = new Map(COOP_RELAY_KINDS.map(k => [k.kind, k]));

/**
 * Every kind actually SENT, with the transport method(s) it is sent through. Resolved from send call
 * sites: string literals directly, and `*_KIND` constants via their known value. The seq arg (1st)
 * never contains a string, so the first string literal in a send statement is the kind.
 */
function collectSentKindTransports(src: string): Map<string, Set<"choice" | "outcome">> {
  const out = new Map<string, Set<"choice" | "outcome">>();
  const add = (kind: string, transport: "choice" | "outcome"): void => {
    const set = out.get(kind) ?? new Set();
    set.add(transport);
    out.set(kind, set);
  };
  // Literal kinds: `relay.sendInteractionChoice(<seq>, "kind", ...)` (statement-bounded so a
  // dynamic-kind call like `.sendInteractionChoice(seq, label, ...)` matches nothing spurious past
  // the `;`). The leading `.` restricts to CALL sites (excludes the method DEFINITIONS in
  // coop-interaction-relay.ts, whose bodies log a `"relay"` string).
  for (const match of src.matchAll(/\.sendInteraction(Choice|Outcome)\(([^;]*?)"([A-Za-z]+)"/g)) {
    add(match[3], match[1] === "Choice" ? "choice" : "outcome");
  }
  // Constant kinds: `relay.sendInteractionChoice(<seq>, ME_CHOICE_KIND, ...)`.
  for (const match of src.matchAll(/\.sendInteraction(Choice|Outcome)\(([^;]*?)\b(\w*(?:KIND|Kind)\w*)\b/g)) {
    const value = KIND_CONST_VALUES.get(match[3]);
    if (value != null) {
      add(value, match[1] === "Choice" ? "choice" : "outcome");
    }
  }
  return out;
}

const SENT = collectSentKindTransports(ALL_SRC);

describe("#840 co-op relay-kind registry (wiring completeness, one layer down)", () => {
  it("sanity: extracted a plausible set of sent kinds and kind-constants", () => {
    expect(SENT.size, "auto-extracted sent kinds").toBeGreaterThan(10);
    expect(KIND_CONST_VALUES.size, "auto-extracted *_KIND constants").toBeGreaterThan(3);
  });

  it("every SENT kind is REGISTERED (a new kind must be added to COOP_RELAY_KINDS)", () => {
    const unregistered = [...SENT.keys()].filter(k => !REGISTERED.has(k));
    expect(unregistered, `kinds sent in src but missing from COOP_RELAY_KINDS: ${unregistered.join(", ")}`).toEqual([]);
  });

  it("every REGISTERED kind is REAL (appears as a literal in src - no phantom entries)", () => {
    const phantom = COOP_RELAY_KINDS.filter(k => !ALL_SRC.includes(`"${k.kind}"`)).map(k => k.kind);
    expect(phantom, `registered kinds never found in src: ${phantom.join(", ")}`).toEqual([]);
  });

  it("every registered kind rides a real seq band (referential integrity)", () => {
    const bandKeys = new Set(COOP_SEQ_BANDS.map(b => b.key));
    const dangling = COOP_RELAY_KINDS.filter(k => !bandKeys.has(k.band)).map(k => `${k.kind}->${k.band}`);
    expect(dangling, `kinds whose band is not in COOP_SEQ_BANDS: ${dangling.join(", ")}`).toEqual([]);
  });

  it("each statically-resolvable kind is sent via the transport the registry declares", () => {
    const mismatches: string[] = [];
    for (const [kind, transports] of SENT) {
      const reg = REGISTERED.get(kind);
      if (reg != null && !transports.has(reg.transport)) {
        mismatches.push(`${kind}: registry says "${reg.transport}" but sent via ${[...transports].join("/")}`);
      }
    }
    expect(mismatches, mismatches.join("; ")).toEqual([]);
  });

  it("the consuming machinery for BOTH transports exists (no sender-only relay direction)", () => {
    expect(ALL_SRC.includes("awaitInteractionChoice("), "an interactionChoice consumer must exist").toBe(true);
    expect(ALL_SRC.includes("awaitInteractionOutcome("), "an interactionOutcome consumer must exist").toBe(true);
  });

  it("the k-discriminated outcome kinds (dexSync, learnMoveForward) each have a handler", () => {
    // These two rides are consumed by `outcome.k`-discriminated transport listeners, NOT by
    // awaitInteractionOutcome - so a naive await grep would falsely flag them (audit 4b). Assert the
    // real handler shape exists for each.
    for (const kind of ["dexSync", "learnMoveForward"]) {
      const handled = ALL_SRC.includes(`.k !== "${kind}"`) || ALL_SRC.includes(`.k === "${kind}"`);
      expect(handled, `outcome kind "${kind}" must have an outcome.k discriminant handler`).toBe(true);
    }
  });
});
