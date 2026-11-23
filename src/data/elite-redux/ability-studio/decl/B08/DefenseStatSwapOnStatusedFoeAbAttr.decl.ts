/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 4 / calc-modifier, Tier B. Read from the source (archetypes/defense-stat-swap-on-statused-foe.ts, which extends
// LowerDefensiveStatVsStatusedFoeAbAttr in ab-attrs.ts), the dispatch in Pokemon.getBaseDamage (field/pokemon.ts, the block after the Deadeye
// lines) and the two live users, Exploit Weakness (5022, attr 0) and Relentless (5473, attr 0). The class has no constructor argument.
// The engine used to test the foe's status itself before asking the attr; that test moved into the class (a pure move, no random draw), and the
// call site now asks whenever the ability is not being ignored. canApply is `guards && gate`:
//
//   guards   1. there is a defender                                                   (else nothing happens)
//   gate     2. the defender has a status condition: status != null && status.effect !== NONE   -> legacy closure (see bindings.ts)
//   apply    def = defender.getEffectiveStat(DEF), spDef = defender.getEffectiveStat(SPDEF) (stat stages included);
//            statHolder.value = def <= spDef ? DEF : SPDEF   (a tie picks Defense). No random draw, no state.
//
// The effect is a package PLACEHOLDER (no library effect points the damage formula at the lower defense: request R-B08-40). It has no number,
// type, stat or status to set: the choice between the two defenses is the whole rule.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DefenseStatSwapOnStatusedFoeAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-statused-foe";

export default defineDecl(DefenseStatSwapOnStatusedFoeAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.defensive-stat-pick",
  label: "Hit the foe's weaker defense when it has a status condition",
  summary: () =>
    "When I attack a foe that has a status condition, my damage uses whichever of its Defense and Sp. Def is lower (stat stages count). Example: 80 Defense against 100 Sp. Def, the 80 is used.",
  synonyms: [
    "exploit weakness",
    "relentless",
    "target the weaker defense",
    "hit statused foes harder",
    "use the lower defense",
    "burned foes take more damage",
  ],
  examples: ["Attacks against a poisoned or burned foe use its weaker defense stat"],
  params: [],
  noParamsReason:
    "The class takes no settings: it compares the foe's two defenses and picks the lower one. The foe's status condition is a separate IF block (the gate), so staff can remove it or replace it, for example only against a burned foe.",
  conditions: [
    // The gate is the foe-has-a-status test (bindings.ts, a legacy closure with a reason until the frame maps the defender).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["There must be a foe to compare", "The game does not ask while my ability is being ignored"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "ignores" },
  probes: [
    { name: "a statused foe with a lower Defense and with a lower Sp. Def", axes: { status: ["BURN", "PARALYSIS"] } },
  ],
  l2StaticReason:
    "The shared L2 harness cannot show the hook evaluated (decomp-l2-reach.json lists calc.defensive-stat-pick as unreached: its template makes the FOE crit the holder, but the engine dispatches this class on the ATTACKER, and only against a statused defender). The B08 test (test/tests/elite-redux/decomp/B08/chunk4-gates.test.ts) drives the original and the rebuilt attr with real Pokemon over both stat orders and stat stages.",
  status: "decomposed",
  notes:
    "Tier B: the foe-status test, which used to sit in the engine call site, is the class gate now (guards: there is a defender; gate: status != null and effect not NONE; both pure reads moved verbatim, and the call site keeps only the ignore-ability rule, so the dispatch happens for every defender and the class answers). Both users are bound as legacy closures with a reason (status.has ANY would miss the effect-not-NONE part and the frame does not map the defender yet). Written reason for the package placeholder effect: no library effect chooses the defensive stat of the damage formula (the WHEN calc.defensive-stat-pick modifies `statValue`); the rule is one fixed comparison with nothing to set. Request R-B08-40 asks for `effect.use-weaker-defense-stat` (shared with CritUseLowerDefensiveStatAbAttr, Deadeye) AND for making the gate a library block: frame.ts must map `defender` to the `other` slot for this WHEN (today `other` is empty there, because the frame reads opponent, attacker, victim, target, sourcePokemon and source only, not `defender`). Until then 'the foe has a status condition' is a locked safety line. Users (2): Exploit Weakness (5022, attr 0, the only attr) and Relentless (5473, attr 0, followed by ConditionalCritAbAttr and MovePowerBoostAbAttr, declared elsewhere). `simulated`: the class ignores it, apply only writes the stat holder. ODDITY, NOT FIXED: the engine test also requires `status.effect !== NONE`, which a Status object with NONE never satisfies; the library atom status.has ANY would read `status != null` only, a tiny difference to keep in mind when request R-B08-40 is done. showAbility is false (the parent's constructor argument). The sibling CritUseLowerDefensiveStatAbAttr (crit instead of status) and the Deadeye Draw function are separate.",
});
