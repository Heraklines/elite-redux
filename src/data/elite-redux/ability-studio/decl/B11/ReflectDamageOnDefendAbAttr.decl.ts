/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier C).
//
// Read by hand from archetypes/reflect-damage-on-defend.ts. PostDefend hook (WHEN "after I am hit"), constructor
// `{ cancelIfAttackerHasAbility? }` kept in the private field of the same name; `super()`, no closure, so there is
// nothing to bind.
//   canApply, in the ORIGINAL order (every clause is a guard or feasibility, none is a rule staff would tune):
//     1. the current battle is the Fun and Games (Wobbuffet) mystery encounter  -> false
//     2. the holder has fainted                                                  -> false
//     3. the exception ability is set AND the attacker has it                    -> false   (the only settable clause: a param)
//     4. `!simulated && damage > 0 && attacker != null && attacker !== holder && !attacker.isFainted()`
//   apply: the attacker takes `damage` back as INDIRECT damage that ignores boss health segments. No random draw.
// Only user: Soul Linker (332), which hands in its own ability number as the exception, so two Soul Linkers do not link.
//
// Why Tier C and not Tier B: there is no library effect "the attacker takes the damage I took" (request R-B11-01 in
// requests/B11.md) and no atom for the mystery-encounter clause (R-B11-02), so a gate would have nothing to be rebuilt
// from. The only staff-tunable clause (clause 3) is a param; clauses 1, 2 and 4 are listed as "also requires".
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ReflectDamageOnDefendAbAttr } from "#data/elite-redux/archetypes/reflect-damage-on-defend";
import { optionalAbilityNumberCodec } from "./b11-chunk3-codecs";

export default defineDecl(ReflectDamageOnDefendAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Hit the attacker back with the damage I took",
  summary: () =>
    "When a move damages me, the attacker takes the same amount of damage back. Example: I lose 40 HP, the attacker loses 40 HP too. Not when either of us has fainted.",
  synonyms: ["reflect damage", "share damage", "soul link", "soul linker", "mirror the damage", "damage sharing"],
  examples: ["Whoever hits me takes the same damage back", "Share every hit I take with the Pokemon that attacked me"],
  params: [
    {
      id: "exceptAbility",
      ctorIndex: 0,
      ctorOption: "cancelIfAttackerHasAbility",
      path: "cancelIfAttackerHasAbility",
      control: "number",
      min: 0,
      max: 29999,
      step: 1,
      integer: true,
      label: "Do nothing against attackers with this ability (ability number, 0 = no exception)",
      editable: true,
      default: 0,
      codec: optionalAbilityNumberCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Never works during the Fun and Games (Wobbuffet) minigame",
    "Does nothing once I have fainted",
    "Does nothing when the attacker has the ability you chose above (Soul Linker does not link with another Soul Linker)",
    "Needs a real attacker that is not me and has not fainted, and the hit must have done damage; it never happens in a preview",
    "The attacker takes the damage as indirect damage, so it ignores boss health segments",
  ],
  effect: { id: "effect.package", params: ["exceptAbility"] },
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
    "Tier C, justified in the header. Only user: Soul Linker, attr 0 of the ability, which passes `cancelIfAttackerHasAbility: ER_ID_MAP.abilities[332]` (the number is read from the live instance). Soul Linker's other attr is SelfDamageOnAttackAbAttr (its own declaration). Nothing to bind: no constructor closure, no gate replaced. The Fun and Games clause reads `globalScene.currentBattle.mysteryEncounter`, so the L1 grid and the L2 twin never reach it; test/tests/elite-redux/decomp/B11/chunk3.test.ts drives canApply on the original and the rebuild. Remark, NOT a bug: the class comment says it does not work when EITHER Pokemon is KO'd; the holder is tested by `pokemon.isFainted()` and the attacker by `attacker.isFainted()`, which covers both.",
});
