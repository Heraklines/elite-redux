/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 4 / calc-modifier, Tier A (nothing to bind, nothing to gate in the class). Read from the source
// (archetypes/defense-stat-swap-on-statused-foe.ts, which only extends LowerDefensiveStatVsStatusedFoeAbAttr in ab-attrs.ts), the dispatch in
// Pokemon.getBaseDamage (field/pokemon.ts, the block after the Deadeye lines) and the two live users, Exploit Weakness (5022, attr 0)
// and Relentless (5473, attr 0). The class has no constructor argument, no canApply (AbAttr's always-true) and one clause in apply:
//
//   dispatch  applyAbAttrs("LowerDefensiveStatVsStatusedFoeAbAttr", { pokemon: SOURCE (the attacker, the holder), simulated, defender, statHolder })
//             but ONLY when `this.status != null && this.status.effect !== NONE && !ignoreSourceAbility` for the defender. This test is in
//             the engine call site, outside the class, so it cannot be a removable condition today (see the notes and request R-B08-40).
//   apply     no defender -> nothing; otherwise def = defender.getEffectiveStat(DEF), spDef = defender.getEffectiveStat(SPDEF) (stat stages included);
//             statHolder.value = def <= spDef ? DEF : SPDEF   (a tie picks Defense). No random draw, no state.
//
// The effect is a package PLACEHOLDER (no library effect points the damage formula at the lower defense: request R-B08-40). It has no number,
// type, stat or status to set: the choice between the two defenses is the whole rule.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DefenseStatSwapOnStatusedFoeAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-statused-foe";

export default defineDecl(DefenseStatSwapOnStatusedFoeAbAttr, {
  tier: "A",
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
    "The class takes no settings: it compares the foe's two defenses and picks the lower one. A condition (for example only against a burned foe) is a separate IF block added on top, once the game asks the class itself (request R-B08-40).",
  conditions: [],
  guards: [],
  feasibility: [
    "The game only asks when the foe has a status condition and my ability is not being ignored",
    "There must be a foe to compare",
  ],
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
    "Tier A, nothing to bind: no closure and no gate in the class. Written reason for the package placeholder effect: no library effect chooses the defensive stat of the damage formula (the WHEN calc.defensive-stat-pick modifies `statValue`); the rule is one fixed comparison with nothing to set. Request R-B08-40 asks for `effect.use-weaker-defense-stat` (shared with CritUseLowerDefensiveStatAbAttr, Deadeye) AND for two things that make its condition visible: (a) the engine call site must stop testing 'the foe has a status' itself and let the class ask (move that test into the class's canApply as a Tier B gate, atom status.has on the other Pokemon, ANY), and (b) frame.ts maps `defender` to the `other` slot for this WHEN (today `other` is empty there, because the frame reads opponent, attacker, victim, target, sourcePokemon and source only, not `defender`). Until then 'the foe has a status condition' is a locked safety line. Users (2): Exploit Weakness (5022, attr 0, the only attr) and Relentless (5473, attr 0, followed by ConditionalCritAbAttr and MovePowerBoostAbAttr, declared elsewhere). `simulated`: the class ignores it, apply only writes the stat holder. ODDITY, NOT FIXED: the engine test also requires `status.effect !== NONE`, which a Status object with NONE never satisfies; the library atom status.has ANY would read `status != null` only, a tiny difference to keep in mind when request R-B08-40 is done. showAbility is false (the parent's constructor argument). The sibling CritUseLowerDefensiveStatAbAttr (crit instead of status) and the Deadeye Draw function are separate.",
});
