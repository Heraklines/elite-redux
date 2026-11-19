/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect, Tier C. See ../PRECEDENTS.md. PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick it up yet.
// Reason: the class has its own dispatch key, `IllusionBreakAbAttr`, which `applyOnLoseAbAttrs` (apply-ab-attrs.ts) dispatches right after
// PreLeaveFieldAbAttr, and no WHEN in WHEN_REGISTRY owns that key. `vocabulary/dispatch-keys.ts` lists it in UNEXPOSED_DISPATCH_KEYS
// ("Internal Illusion bookkeeping ... Not a staff-facing moment"), but the moment is a real one that staff understand: my ability is
// replaced, switched off or lost. The L0 rule "the WHEN's dispatch key is the class or an ancestor" cannot be met with an existing WHEN
// (`event.leave-field` owns PreLeaveFieldAbAttr, which is a different key), and a batch may not edit the library (spec 6, step 3).
// The request is requests/B07.md, R-B07-11.
//
// To finish: once the librarian has added the WHEN with dispatch key `IllusionBreakAbAttr` (and removed the key from
// UNEXPOSED_DISPATCH_KEYS), set `when` below to its id, rename this file to IllusionBreakAbAttr.decl.ts and run L0 / L1 / L2.
//
// What the class is (read from the source): `apply` is `pokemon.breakIllusion()`, there is no canApply (the base class says true) and
// no constructor, so `showAbility` is the AbAttr default true (live dump). The engine dispatches it from `applyOnLoseAbAttrs`, which is
// called when the holder's ability is replaced (`setTempAbility`), suppressed (`suppressAbility`, Gastro Acid, Neutralizing Gas arriving
// through arena-tag.ts) and before a quiet form change (`QuietFormChangePhase`). `breakIllusion()` does nothing without an illusion.
import { IllusionBreakAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IllusionBreakAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.ability-lost",
  label: "Drop my disguise when my ability is lost",
  summary: () =>
    "When my ability is replaced, switched off or I change form, my disguise (the look of another Pokemon) is dropped. Example: Gastro Acid on a disguised Zoroark.",
  synonyms: [
    "illusion",
    "zoroark",
    "disguise ends when the ability is lost",
    "gastro acid reveals",
    "neutralizing gas reveals",
    "show my real form",
  ],
  examples: ["Stop looking like a teammate when my ability gets switched off, like Zoroark"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose. The class has no constructor, so showAbility is the default (true) and is never exposed.",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when I am not disguised"],
  // No library effect says "drop my disguise"; request R-B07-9 (effect.reveal-illusion).
  effect: { id: "effect.package", params: [] },
  fixedCtorArgs: { 0: true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the holder loses its ability while disguised", axes: {} }],
  l2StaticReason:
    "The WHEN does not exist yet (R-B07-11) and no scenario template of the shared battle twin replaces or suppresses the holder's ability, so the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-3.test.ts (suppressAbility on a disguised holder).",
  status: "decomposed",
  notes:
    "Tier C, one-piece effect, PARKED until R-B07-11. User (live dump): Illusion (149, attr 1), showAbility true. The same dispatch also runs PreLeaveFieldAbAttr, so the two attrs fire together at every one of the four call sites. TODO in the source: a `canApply` that checks for an active illusion; not done here, `breakIllusion` already returns false when there is none.",
});
