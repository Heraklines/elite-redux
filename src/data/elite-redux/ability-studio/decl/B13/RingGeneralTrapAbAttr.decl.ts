/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Ring General, part 2 of 2 (Tier B, package effect). "While my HP is above half and I did not come in this turn, foes cannot switch out or run (Ghosts and Run Away users excepted)."
//
// Source: abilities/newcomer-signature-mechanics.ts, RingGeneralTrapAbAttr (ArenaTrapAbAttr -> CheckTrappedAbAttr).
// It used to hand the base class one closure with three clauses; the closure is now `() => true` and the clauses live in
// the Tier B split (same truth table, same order, all pure, no RNG):
//   guards    1. holder.getHpRatio() > 0.5      (getHpRatio rounds to whole percents, so 50.4% counts as 50%: R-B13-31)
//             2. RING_ENTRY_TURN[holder] !== "wave:turn"       (I did not come in this turn: R-B13-30)
//   gate      3. !foe.isOfType(GHOST)           -> library atom: NOT mon.has-type {other, GHOST}
//   residual  4. ArenaTrapAbAttr.canApply: arenaTrapCondition (now always true) && !foe.isOfType(GHOST, true, true)
//                && !foe.hasAbilityWithAttr("RunSuccessAbAttr")    (the engine's own trapping rules, fixed)
//   apply     trapped.value = true (the base class's).
import { RingGeneralTrapAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RingGeneralTrapAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.trap-check",
  label: "Trap foes while I am above half HP and not freshly arrived",
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
    "Trapping has no number or choice: the foe is either held or not. The 50% HP limit and the one-turn wait are rules inside the class; they become numbers on the library conditions that R-B13-31 and R-B13-30 request.",
  conditions: [
    // Clause 3: the foe is not a Ghost type (library atom, see bindings.ts). Clauses 1 and 2 are guards in the class,
    // clause 4 the residual.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "My HP must be above half, counted in whole percents (checked inside the class until the librarian adds a condition for it, R-B13-31)",
    "I must not have come in this turn (a private memory inside the class, written by the entry part, R-B13-30)",
    "Ghost types and Pokemon with Run Away can never be trapped (a fixed engine rule)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The shared scenario for this trigger (holder-switches-out) makes the HOLDER switch out, but this ability is evaluated when the FOE tries to switch or run (the engine asks the trapper's abilities, field/pokemon.ts isTrapped), so the original is never evaluated there (request R-B13-33 for the harness owner: a template where the foe tries to leave). The attr-level L1 differential covers the bound gate over the grid, and B13/chunk3.test.ts drives the HP rule, the entry turn and the Ghost rule on the original and the rebuild.",
  probes: [
    {
      // The foe's move is irrelevant, but the HP axis decides the first clause; 50% is the boundary.
      name: "holder HP around half",
      axes: { hp: ["max", "50%+1", "50%", "50%-1"], foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only (`trapped = true`); the trigger (the game checks if a foe can escape) and the Ghost condition are separate blocks. Why the effect cannot be split with today's blocks: there is no 'trap the foe' effect in the library; requested as R-B13-32 (`effect.trap-foes`). The class's constructor closure was split into guards and gate (a pure move of code, the base class now gets an always-true closure so its residual does not test the gate again). Two clauses stay in the class until the librarian adds atoms: the HP rule (R-B13-31, getHpRatio rounds to 2 decimals, so the existing hp.at-least cannot reproduce it) and 'I did not come in this turn' (R-B13-30). Users: Ring General (5987, attr 1; attr 0 is RingGeneralEntryAbAttr). ODDITIES (not fixed): (1) the Ghost test is written twice in the original, once plain in the closure and once with Tera and defend flags in ArenaTrapAbAttr.canApply; both are kept. (2) the ability text also says the trap ignores a Shed Shell holder, but the class does not test any item, so any Shed Shell handling is outside this class (not checked here). (3) 'came in this turn' compares the wave and turn number at entry, not how long the Pokemon has been out.",
});
