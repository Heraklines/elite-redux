/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier A calc-modifier whose one constructor argument is a TWO-Pokemon closure. See ../PRECEDENTS.md.
//
// "While the game checks whether a foe can switch out or run, trap it if it passes my test" (Shadow Tag, Arena Trap, Magnet Pull, Salt
// Circle, Frenzied Phantom). The constructor stores `arenaTrapCondition(user, target)`; `user` is the holder and `target` the foe that wants
// to leave. Clauses of `canApply` (ab-attrs.ts), in the ORIGINAL order:
//   1. condition   `this.arenaTrapCondition(pokemon, opponent)`: which foes are trapped. THIS is the closure bound per user below.
//   2. feasibility `!opponent.isOfType(GHOST, true, true)`: Ghost types are never trapped.
//   3. feasibility `!opponent.hasAbilityWithAttr("RunSuccessAbAttr")`: a foe with Run Away style abilities is never trapped.
//   effect-side    `apply` sets `trapped.value = true`; `getTriggerMessage` shows the arenaTrap line.
// Clauses 2 and 3 stay in the class as safety rules (shown as "also requires"), because dropping them would break the game rule that
// Ghost types and Run Away holders can always leave (the engine's own trapped check lets Ghost types leave as well).
// THE CLOSURES: ER wraps the three vanilla closures of Shadow Tag, Magnet Pull and Arena Trap in init-elite-redux-vanilla-rebalance.ts
// (`extendArenaTrapToIgnoreGhost`: `target.isOfType(GHOST) ? false : oldPredicate`), and Frenzied Phantom's closure answers exactly like Shadow Tag's over every state tried. The
// closure of each user was read by calling the LIVE closure with stand-in targets over every Ghost, Steel, grounded and Shadow Tag state, not
// by trusting the source text (see bindings.ts).
import { ArenaTrapAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ArenaTrapAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.trap-check",
  label: "Trap foes so they cannot switch out or run away",
  summary: () =>
    "While I am on the field, foes that pass my test cannot switch out or run away. Ghost types and foes with Run Away are never trapped. Example: Arena Trap traps grounded foes.",
  synonyms: ["arena trap", "shadow tag", "magnet pull", "trap", "cannot switch", "cannot flee", "salt circle"],
  examples: ["Trap grounded foes, like Arena Trap", "Trap Steel types, like Magnet Pull"],
  params: [],
  noParamsReason: "The class takes no number, only the test of which foes are trapped, which is the condition below.",
  conditions: [
    // `(user, target) => boolean`: the holder and the foe that wants to leave. Library atoms read the foe as "other".
    { slot: "ctor:0", ctx: "attack", path: "arenaTrapCondition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Ghost types are never trapped", "A foe with Run Away or a similar escape ability is never trapped"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The attr is asked about the FOE that wants to leave (the holder is the trapper); the shared L2 template for this moment (the holder switches out) never has the foe try to leave, so the engine never asks it (decomp-l2-reach.json lists calc.trap-check as unreached). test/tests/elite-redux/decomp/B06/b06-chunk3.test.ts drives the real attrs of Arena Trap and Salt Circle and their rebuilds against Ghost, grounded, flying and Run Away foes.",
  probes: [{ name: "a foe that wants to leave the field", axes: { hp: ["max", "50%-1"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: no library effect marks a foe as trapped (request R-B06-18: effect.trap-foe, which would set the trapped flag of calc.trap-check). Users (5 attrs): Shadow Tag (23, attr 0) and Frenzied Phantom (5491, attr 2): the foe does not have Shadow Tag, bound legacy because the test is `abilityQuery(target, SHADOW_TAG_TRAP_IMMUNITY)`, which also counts role carriers, and mon.has-ability calls plain hasAbility (R-B06-17). Magnet Pull (42, attr 0): Steel types, bound legacy because the closure calls `isOfType(STEEL, true, true)` (the original types under Stellar Terastallization) and mon.has-type calls `isOfType(type)` (R-B06-17). Arena Trap (71, attr 0): not Ghost and grounded, bound with library atoms. Salt Circle (5273, attr 0): `() => true`, every foe, bound as always true. The Ghost test inside the ER wrapper is `isOfType(GHOST)` and the class tests it again with `(GHOST, true, true)`; both stay. RingGeneralTrapAbAttr (Ring General) extends this class but is its own class with its own declaration (B13). The engine also asks CheckTrappedAbAttr for Ward Stones, Shed Shell and similar items before and after; those are engine rules and are untouched. The trigger message needs showAbility false (set by the constructor), which a rebuild keeps.",
});
