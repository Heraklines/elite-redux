/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / event-effect, Tier B. Read from the source (archetypes/absorbant.ts) and from the live user. The Leech Seed half is
// split into WHEN + IF + DO. canApply is now `gate && residual`, in the original clause order:
//
//   gate      1. the move drains HP (PostAttackAbAttr's attackCondition: move.hasAttr("HitHealAttr"), fixed by the class
//                with showAbility false)                                                     -> atom move.drains
//             2. the target is NOT protected from added effects (hasAbilityWithAttr("IgnoreMoveEffectsAbAttr"), Shield Dust)
//                                                                                              -> atom mon.protected-from-effects
//   residual  3. the target can receive Leech Seed (target.canAddTag(SEEDED))                 (feasibility, stays in the class)
//   apply     plants SEEDED on the target with the holder as the source; skipped when simulated.
//
// No random draw. The three clauses are pure, so their order is not observable, but it is kept anyway.
//
// The OTHER job of the same class is NOT part of this declaration: HitHealAttr.getHealAmount (move.ts) scans the user's active
// attrs BY CLASS NAME ("AbsorbantAbAttr") and multiplies the heal of every draining move by 1.5 through `fire(multiplier)`. That scan
// never goes through canApply, so no WHEN, IF or DO can express it; it is an exempt engine call site, recorded here and in
// requests/B08.md (R-B08-10), and left untouched. Staff who want a different heal bonus need that request, not this block.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AbsorbantAbAttr } from "#data/elite-redux/archetypes/absorbant";

export default defineDecl(AbsorbantAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Leech Seed the target after my draining move",
  summary: () =>
    "After my draining move hits, the target gets Leech Seed (unless Shield Dust style protection or a Grass type stops it). My draining moves also heal 50% more.",
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
    "The class has no constructor argument. The Leech Seed and the x1.5 heal bonus are fixed in the class, and the draining-move test is the fixed condition its gate is made of.",
  conditions: [
    // The gate is the group [move.drains, not mon.protected-from-effects other], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The target must be able to receive Leech Seed (it is not Grass type and not already seeded)"],
  effect: { id: "effect.apply-tag", params: [] },
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
    "Tier B split by hand, a pure move of code (proved against the frozen original in test/.../B08/gate-split.test.ts: same answer for every state, every draining and non-draining move, Shield Dust on and off, a Grass or plain target). One user: Absorbant (5161 attr 0). Extermination Vector (20003 attr 4) and External Combustion (20018 attr 0) are studio-built abilities whose attr is a rule CARRIER (canApply, apply and getCondition replaced on the instance by runtime-components.ts): they are not plain users, the harness carries them over unchanged (sites.ts isRuleCarrier, rebuild.ts). EXEMPT PART, not decomposed: the x1.5 heal bonus (`fire`), read BY NAME inside HitHealAttr.getHealAmount; it is an engine call site that never calls canApply (R-B08-10). The Shield Dust test and the draining-move test are IFs staff can change or remove; the Leech Seed feasibility stays in the class.",
});
