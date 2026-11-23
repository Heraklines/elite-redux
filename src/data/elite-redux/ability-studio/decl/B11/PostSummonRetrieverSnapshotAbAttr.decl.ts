/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / event-effect (Tier A: no condition at all, one effect with a memory).
//
// Read by hand from archetypes/pre-switch-out-item-restore.ts. PostSummon hook (WHEN "when I enter the battle"), constructor with no
// arguments (`super(false)`: no ability banner; activateOnGain stays true). No canApply of its own (the parent's `true`).
//   apply: no `simulated` test (the class ignores it, but the engine never previews an entry). Reads `pokemon.getHeldItems()`:
//     - one or more items: the memory (a module-level WeakMap keyed by the Pokemon) is REPLACED by a clone of each held item;
//     - none: the memory is deleted.
//   No random draw, no message.
//
// The memory is the module-level `retrieverOriginalHeldItems` WeakMap, shared with the paired restore attr
// (PreSwitchOutItemRestoreAbAttr) and read by the AI (`erRetrieverOriginalHeldItems`). A rebuilt instance uses the same map, so a
// rebuilt snapshot and a shipped restore (or the other way round) see one memory. The effect is one piece: the library has no
// block that remembers held items (request R-B11-C2-03), and there is nothing to set (it remembers every item the holder carries).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostSummonRetrieverSnapshotAbAttr } from "#data/elite-redux/archetypes/pre-switch-out-item-restore";

export default defineDecl(PostSummonRetrieverSnapshotAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Remember the items I hold when I enter",
  summary: () =>
    "When I enter the battle I note which held items I carry. Another effect can give them back later (the shipped one hands them back when I switch out empty-handed).",
  synonyms: [
    "retriever",
    "remember my item",
    "item memory",
    "note my held items",
    "record starting item",
    "original item",
  ],
  examples: ["Remember the items I came in with so I can get them back after a Knock Off"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: it always remembers every held item the holder carries when it enters (and forgets everything when it carries nothing). There is no number, type, stat or status to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "Replaces any earlier memory; when I carry nothing the memory is cleared",
    "Items are remembered as copies, so later changes to the real items do not change the memory",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "entering with the default held items", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A package, justified in the header. Only user: Retriever (5244, attr 0), which pairs it with PreSwitchOutItemRestoreAbAttr (attr 1). The memory is private to the module (a WeakMap, so it never leaks a Pokemon) and is overwritten on EVERY entry, including a re-entry after a switch: a Pokemon that came back with a different item then remembers that one. `apply` ignores `simulated`; the engine only dispatches PostSummon for real entries, so nothing observable depends on it, but a preview that called it would overwrite the memory. The memory is also read by src/data/elite-redux/ai/combat-private-state.ts, which is why it must not move out of the module.",
});
