/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Ring General, part 2 of 2 (Tier B, package effect). "While my HP is above half and I did not come in this turn, foes cannot switch out or run (Ghosts and Run Away users excepted)."
//
// Source: abilities/newcomer-signature-mechanics.ts, RingGeneralTrapAbAttr (ArenaTrapAbAttr -> CheckTrappedAbAttr).
// It used to hand the base class one closure with three clauses; the closure is now `() => true` and all three clauses are
// the editable gate (they are design conditions a player may want to change, spec 1.5), in the original order:
//   gate      1. holder.getHpRatio() > 0.5      (getHpRatio rounds to whole percents, so 50.4% counts as 50%: R-B13-31)
//             2. RING_ENTRY_TURN[holder] !== "wave:turn"       (I did not come in this turn: R-B13-30)
//             3. !foe.isOfType(GHOST)
//             Bound as a legacy-closure (decl/B13/bindings.ts) until the librarian adds atoms for 1 and 2.
//   guards    none (no pure correctness rule exists in this class)
//   residual  4. ArenaTrapAbAttr.canApply: arenaTrapCondition (now always true) && !foe.isOfType(GHOST, true, true)
//                && !foe.hasAbilityWithAttr("RunSuccessAbAttr")    (the engine's own trapping rules, fixed; Ghost is repeated here)
//   apply     trapped.value = true (the base class's).
import { RingGeneralTrapAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RingGeneralTrapAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.trap-check",
  label: "Stop foes from switching out or running away",
  summary: () =>
    "While my HP is above half and I did not come in this turn, foes cannot switch out or run away. Ghost types and Pokemon with Run Away still get away.",
  synonyms: [
    "no escape",
    "cannot switch",
    "arena trap",
    "shadow tag",
    "trap the foe",
    "ring general",
    "block switching",
  ],
  examples: ["Foes cannot switch out while I am healthy, like Shadow Tag with a condition"],
  params: [],
  noParamsReason:
    "Trapping has no number or choice: the foe is either held or not. The 50% HP limit and the one-turn wait are part of the editable gate (a legacy-closure for now); they become numbers on the library conditions that R-B13-31 and R-B13-30 request.",
  conditions: [
    // Clauses 1 to 3 (HP above half, I did not come in this turn, the foe is not a Ghost): one legacy-closure gate, see
    // bindings.ts. Clause 4 is the residual.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Ghost types and Pokemon with Run Away can never be trapped (a fixed engine rule)"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The foe's move is irrelevant, but the HP axis decides the first clause; 50% is the boundary.
      name: "holder HP around half",
      axes: { hp: ["max", "50%+1", "50%", "50%-1"], foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only (`trapped = true`); the trigger (the game checks if a foe can escape) and the Ghost condition are separate blocks. Why the effect cannot be split with today's blocks: there is no 'trap the foe' effect in the library; requested as R-B13-32 (`effect.trap-foes`). The class's constructor closure moved into the editable gate (a legacy-closure binding, because the library has no atom yet for the HP rule, R-B13-31, getHpRatio rounds to 2 decimals so the existing hp.at-least cannot reproduce it, and none for 'I did not come in this turn', R-B13-30); the base class now gets an always-true closure so its residual does not test the gate again. The first review pass had left the HP and entry rules in non-editable guards; they are conditions, not correctness rules. ODDITIES (not fixed): (1) the Ghost test is written twice in the original, once plain in the closure and once with Tera and defend flags in ArenaTrapAbAttr.canApply; both are kept. (2) the ability text also says the trap ignores a Shed Shell holder, but the class does not test any item, so any Shed Shell handling is outside this class (not checked here). (3) 'came in this turn' compares the wave and turn number at entry, not how long the Pokemon has been out.",
});
