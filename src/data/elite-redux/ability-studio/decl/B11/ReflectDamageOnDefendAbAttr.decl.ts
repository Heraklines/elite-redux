/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier A: the "may it happen against this attacker" test is a constructor closure).
//
// Read by hand from archetypes/reflect-damage-on-defend.ts. PostDefend hook (WHEN "after I am hit"). The constructor takes
// `(options = {}, condition?)`: `options.cancelIfAttackerHasAbility` only feeds the DEFAULT of `condition`, which is
// `(holder, attacker, move) => !(exceptionAbility != null && attacker?.hasAbility(exceptionAbility))`; the ability studio hands
// in its own closure at constructor argument 1 (slot ctor:1, kept in the field `condition`).
//   canApply, in the ORIGINAL order:
//     1. the current battle is the Fun and Games (Wobbuffet) mystery encounter  -> false   (feasibility, guard requested R-B11-02)
//     2. the holder has fainted                                                  -> false   (guard not-fainted)
//     3. `condition(holder, attacker, move)` is false                            -> false   (CONDITION, slot ctor:1)
//     4. `!simulated && damage > 0 && attacker != null && attacker !== holder && !attacker.isFainted()`   (feasibility)
//   apply: the attacker takes `damage` back as INDIRECT damage that ignores boss health segments. No random draw.
// Only user: Soul Linker (5070), whose condition is "the attacker does not have Soul Linker either" (legacy closure for now:
// mon.has-ability cannot name an ER ability, request R-B11-14).
//
// The effect "the attacker takes the damage I took" has no library block (request R-B11-01 in requests/B11.md), so the effect
// is one piece; the rule WHEN it may happen is the condition block below, which staff can swap or extend.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ReflectDamageOnDefendAbAttr } from "#data/elite-redux/archetypes/reflect-damage-on-defend";

export default defineDecl(ReflectDamageOnDefendAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Hit the attacker back with the damage I took",
  summary: () =>
    "When a move damages me, the attacker takes the same amount of damage back, unless the condition says otherwise. Example: I lose 40 HP, the attacker loses 40 HP too. Not when either of us has fainted.",
  synonyms: ["reflect damage", "share damage", "soul link", "soul linker", "mirror the damage", "damage sharing"],
  examples: ["Whoever hits me takes the same damage back", "Share every hit I take with the Pokemon that attacked me"],
  params: [],
  noParamsReason:
    "The only setting the class ever had (an ability whose owner is spared) is now the condition block below, where staff pick the ability by name; the effect itself (the attacker takes the damage I took) takes no setting.",
  conditions: [
    // Soul Linker: "the attacker does NOT have Soul Linker" = not(mon.has-ability { other }). Staff swap or drop it.
    { slot: "ctor:1", ctx: "defend", lib: "mon.has-ability", path: "condition", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Never works during the Fun and Games (Wobbuffet) minigame",
    "Needs a real attacker that is not me and has not fainted, and the hit must have done damage; it never happens in a preview",
    "The attacker takes the damage as indirect damage, so it ignores boss health segments",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe hits me for a little and for a lot",
      axes: { hp: ["max", "50%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, justified in the header. Only user: Soul Linker, attr 0. Its condition IS not(attacker has Soul Linker), but the atom mon.has-ability cannot name an ER custom ability (R-B11-14), so it is bound as a legacy closure; the rebuild gets the shipped closure handed in. The Fun and Games clause reads `globalScene.currentBattle.mysteryEncounter`, so the L1 grid and the L2 twin never reach it; test/tests/elite-redux/decomp/B11/chunk3.test.ts drives canApply on the original and the rebuild. The effect stays one piece until R-B11-01 exists; the minigame clause stays written feasibility until R-B11-02 exists. Remark, NOT a bug: the class comment says it does not work when EITHER Pokemon is KO'd; the holder is tested by the not-fainted guard and the attacker by `attacker.isFainted()`, which covers both.",
});
