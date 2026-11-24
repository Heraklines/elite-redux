/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier C calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game rolls my chance to run away, make it certain" (Run Away and its ER kin). The class has no argument, no closure and no
// `canApply` of its own; `apply` is `chance.value = 256` (a literal), above the roll of 0..99 in attempt-run-phase.ts, which asks it for
// every player Pokemon in speed order. Two engine reads by presence: ArenaTrapAbAttr.canApply (`!opponent.hasAbilityWithAttr(...)`,
// a holder is never trapped by Arena Trap style abilities) and the wild "can teleport or flee" move condition (move-condition.ts).
import { RunSuccessAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RunSuccessAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.run-chance",
  label: "Always escape when I run from a wild battle",
  summary: () =>
    "When my side tries to run from a wild battle the escape always works, and foes' trapping abilities cannot hold me. Example: Run Away always gets out.",
  synonyms: ["run away", "escape", "flee", "guaranteed escape", "dust cloud", "always run"],
  examples: ["Always escape from wild battles, like Run Away"],
  params: [],
  noParamsReason:
    "All or nothing: the 256 is a literal in the class (anything from 100 up is certain) and there is no constructor argument, so there is no number to set (request R-B06-18).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only runs from wild battles can be attempted at all; trainer battles never ask",
    "Arena Trap style trapping abilities never trap a Pokemon with this (a rule the trapping class applies)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The attr is asked only when the player runs from a wild battle (AttemptRunPhase), which no shared L2 scenario does, so the engine never evaluates it (decomp-l2-reach.json lists calc.run-chance as unreached). test/tests/elite-redux/decomp/B06/b06-chunk3.test.ts drives the real attrs of Run Away and its ER kin and their rebuilds with the run chance holder, and the Arena Trap rule that reads the class by presence.",
  probes: [{ name: "an escape attempt", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: no library effect sets the run chance (request R-B06-18: effect.set-run-chance with a percent setting; the class would need a constructor argument for it, which class agents may not add). Users (7 attrs, none with a closure): Run Away (50, attr 0), Rattled (155, attr 3), Wimp Out (193, attr 1), Emergency Exit (194, attr 1), Coward (5165, attr 1), Dust Cloud (5210, attr 0) and Tactical Retreat (5282, attr 1). The presence reads (ArenaTrapAbAttr and the teleport condition) are engine rules about the class and are untouched; they are the reason an engine-query routing may want this class later. The class never reads `simulated`; the escape phase passes none.",
});
