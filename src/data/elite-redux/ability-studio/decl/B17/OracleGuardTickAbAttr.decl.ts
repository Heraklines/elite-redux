/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Oracle, second half. Read by hand: fakemon-pitch-mechanics.ts `OracleGuardTickAbAttr`, the base PostTurnAbAttr
// (end of every turn), and the other Oracle attrs (see OracleEntryAbAttr.decl.ts).
//
// canApply is the inherited `true`, on purpose; the rule runs in `apply`, in the original order:
//   1. feasibility  not simulated
//   2. condition    a guard is running: summonData.erAbilityProvenance has a "oracle:guard:*" marker
//                   -> `gate`, run through gatedCanApply inside apply (NO ATOM: request R3 reads the marker memory)
//   3. effect       read N from the marker, remove it, and push `oracle:guard:${N - 1}` while N > 1
// The gate stays in apply because the flyout is queued at every end of turn (apply-ab-attrs.ts), also on turns where
// nothing happens. No random draw.
import { OracleGuardTickAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OracleGuardTickAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.end-of-turn",
  label: "Count a running timed guard down by one turn",
  summary: () =>
    "At the end of each turn, a running guard loses one turn. When no turns are left, the guard ends and effects that look for it stop.",
  synonyms: ["oracle", "tick down", "shield timer", "guard countdown", "temporary effect wears off", "turn counter"],
  examples: ["Make a 3 turn guard run out after 3 turns"],
  params: [],
  noParamsReason:
    "It always counts down by exactly one turn per end of turn; the length of the guard is set by the block that starts it, so this one has no number, type, stat or status of its own.",
  conditions: [
    // The gate: "a guard is running". No atom reads the marker memory yet (request R3).
    {
      slot: "gate",
      ctx: "params",
      lib: "request R3: a guard marker is running on me",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: ["It never does anything for a preview (a simulated end of turn)"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "two quiet turns", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B (gate run through gatedCanApply inside apply) with a PACKAGE effect. Written reason: the countdown parses a number out of a string marker ('oracle:guard:3'), removes it and writes the marker back with one less; there is no library effect for 'count a timed marker down' (request R9, the same marker family as the entry half) and no atom to read it (R3). The gate binding is legacy-closure-pending-request R3. Users: Oracle (6047, attr 2) only. Oddity, not changed: the marker is written by the entry half, so the tick only does anything after that half ran; marker state lives in summonData, i.e. it is dropped on a switch.",
});
