/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / package (Tier C). Read from the source, not from the label:
//
//   * Extends PostAttackAbAttr. Its `attackCondition` is a CONSTRUCTOR CLOSURE OF THE PARENT that the class passes as a
//     fixed literal (`move.hasAttr("HitHealAttr")`, a draining move) with showAbility false. The class has no
//     constructor argument of its own, so there is no `ctor:N` slot to bind.
//   * canApply = super.canApply (draining move) && the target does not have IgnoreMoveEffectsAbAttr (Shield Dust)
//     && target.canAddTag(SEEDED). apply = target.addTag(SEEDED, 0, undefined, holder.id), skipped when simulated.
//   * `fire(multiplier)` is a SECOND job of the same attr: HitHealAttr.getHealAmount (move.ts) scans the user's active
//     attrs BY CLASS NAME ("AbsorbantAbAttr") and multiplies the heal of every draining move by 1.5. That scan never
//     goes through canApply, so no IF can reach it.
//
// Two engine jobs that share one class name, one fixed draining-move test and one hard-coded x1.5: splitting it would
// re-implement the class and the by-name scan, so it is a package. Staff who want only the Leech Seed half can already
// build it from "after my hit" + "apply a lasting effect" once the library has the atom "the move drains HP"
// (requests/B08.md R-B08-3).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AbsorbantAbAttr } from "#data/elite-redux/archetypes/absorbant";

export default defineDecl(AbsorbantAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.after-my-hit",
  label: "Leech Seed the target after my draining move",
  summary: () =>
    "After a draining move of mine hits, the target is planted with Leech Seed. My draining moves also heal 1.5 times as much (Drain Punch heals 50% more).",
  synonyms: [
    "leech seed",
    "draining move",
    "drain punch",
    "giga drain",
    "heal more from drain",
    "seed after drain",
    "absorb health",
  ],
  examples: ["After Drain Punch hits, the target gets Leech Seed and Drain Punch heals 50% more"],
  params: [],
  noParamsReason:
    "The class has no constructor argument. The x1.5 heal bonus and the Leech Seed are fixed in the class, and the draining-move test is a fixed closure passed to the parent PostAttackAbAttr.",
  conditions: [],
  guards: [],
  feasibility: [
    "My move must be a draining move (one that heals me by a share of the damage it deals)",
    "The target must not be protected from added effects (like Shield Dust)",
    "The target must be able to receive Leech Seed (it is not Grass type and not already seeded)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Drain Punch is the only grid-reachable drainer in the L2 twin; Tackle must NOT seed.
      name: "a damaging non-draining hit",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package, justified: the same class is read two ways (dispatched after my hit for the Leech Seed, and found BY NAME in HitHealAttr.getHealAmount for the x1.5 heal), and its draining-move test is a fixed closure of the parent class. Users: Absorbant (5161 attr 0), and two studio-built abilities that reuse the attr as a TRIGGER SOURCE (Extermination Vector 20003 attr 4, External Combustion 20018 attr 0): their instances are carriers whose canApply, apply and getCondition are replaced by the rule runtime (runtime-components.ts), so they are carried over unchanged by a rebuild and are not part of what this declaration rebuilds. Nothing to bind (no constructor closure). The by-name fire() scan is an engine call site, not a moment; it is recorded here and left untouched.",
});
