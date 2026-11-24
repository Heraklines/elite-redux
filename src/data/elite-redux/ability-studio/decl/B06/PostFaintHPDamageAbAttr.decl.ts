/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 4, Tier C event-effect with a one-piece effect. See ../PRECEDENTS.md.
//
// "When I faint, hurt the one who knocked me out by the damage of the hit that did it" (Innards Out). The class has no argument, no closure
// and `canApply` is the base `true` (PostFaintAbAttr). Every test lives in `apply`, in this ORIGINAL order, and all of them are
// effect-side (they decide whether the damage happens at all, they are not rules staff would reasonably edit):
//   1. `!move || !attacker || simulated || attacker.getAllies().includes(pokemon)`: nothing when I died to no move (poison, weather,
//      recoil), when the killer is unknown, in a preview, or when my own side's Pokemon knocked me out (the check is a list, so a second ally
//      in a triple battle counts too).
//   2. `applyAbAttrs("BlockNonDirectDamageAbAttr", attacker)`: a killer with a damage-blocking ability (Magic Guard) is not hurt.
//   3. `damage = pokemon.turnData.attacksReceived[0].damage`, then `attacker.damageAndUpdate(damage, INDIRECT)` and
//      `attacker.turnData.damageTaken += damage`.
// WHEN: faint-phase.ts passes `attacker` and `move` from `attacksReceived[0]` (the newest entry), so "the last hit I took" is exactly what
// the damage reads; without any entry the dispatch has neither and the effect does nothing.
import { PostFaintHPDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostFaintHPDamageAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.faint",
  label: "Hurt my attacker with the damage that knocked me out",
  summary: () =>
    "When a foe knocks me out with a move, that foe loses as much HP as the hit that knocked me out did to me. Example: Innards Out.",
  synonyms: [
    "innards out",
    "take them with me",
    "revenge damage on faint",
    "last hit back",
    "deal damage when knocked out",
    "damage the killer",
    "mutual damage",
  ],
  examples: ["When I am knocked out, the foe takes the damage of the final hit, like Innards Out"],
  params: [],
  noParamsReason:
    "No constructor argument: the damage is always the full damage of the hit that knocked me out and the way it is dealt is fixed (request R-B06-21).",
  conditions: [],
  guards: [],
  feasibility: [
    "I must have been knocked out by a move of a foe: no effect after poison, weather, recoil or other damage that is not a move",
    "A Pokemon on my own side that knocks me out is never hurt",
    "A foe with an ability that blocks damage that is not from a move (Magic Guard) takes nothing",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared faint scenario stops at the start of the FaintPhase, before the faint-time abilities are asked (decomp-l2-reach.json lists event.faint as unreached), so test/tests/elite-redux/decomp/B06/b06-chunk4.test.ts runs the real attr and its rebuild against a real knock-out and compares the damage dealt to the killer.",
  probes: [{ name: "knocked out by a foe at full HP and at 2 HP", axes: { hp: ["max", 2] } }],
  status: "decomposed",
  notes:
    "OWNER DECISION NEEDED (review finding): the gates (a move exists, the killer is a foe, the killer lacks Magic Guard) stay inside the package on purpose. Splitting them into condition blocks means moving them from apply to canApply, which would stop the ability pop-up when the faint was not caused by a foe move (today the pop-up still shows, e.g. after poison), so game behaviour would change. They can be split only if the owner accepts that change, or if the librarian adds the atom of request R-B06-21 with the same pop-up behaviour. Until then this package needs the explicit acceptance of the owner. PACKAGE for the effect, written reason: no library effect hurts a named Pokemon by the damage of a hit it did, and the class reads a hit record (`attacksReceived[0]`) that no slot carries (request R-B06-21: effect.damage-by-last-hit-taken, aimed at the foe who knocked me out; and a condition atom 'a foe knocked me out with a move'). The gates inside apply (killer is a foe, there was a move, not simulated) are feasibility, not IFs, because they sit in apply and not in canApply; staff may only AND more IFs on top. User (1 attr): Innards Out (215, attr 0). Oddities, not fixed: (1) the doc comment says 'the last attack' and the code reads attacksReceived[0], which is the newest entry only while the list is built with unshift; the faint phase reads the same entry for `attacker` and `move`, so the two are consistent. (2) The damage is the damage of that hit; damageAndUpdate caps it at the killer's HP. (3) The trigger message is shown before the block check, so Innards Out still shows its pop-up against Magic Guard (a TODO in the class). (4) The archetype on-faint-effect.ts mirrors this effect inline for ER archetype abilities; that is a separate class.",
});
