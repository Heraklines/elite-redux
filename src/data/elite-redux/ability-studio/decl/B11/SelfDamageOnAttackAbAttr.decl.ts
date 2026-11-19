/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier C).
//
// Read by hand from archetypes/self-damage-on-attack.ts. PostAttack hook (WHEN "after my attack lands"), constructor
// `{ basis, fraction, soulLink?, cancelIfTargetHasAbility? }`, one private field each; `super()` so the attack condition is the
// default (the move is not a status move) and there is no closure to bind.
//   canApply, in the ORIGINAL order:
//     1. soulLink AND the battle is the Fun and Games (Wobbuffet) mystery encounter                -> false   (feasibility)
//     2. soulLink AND the target has fainted                                                        -> false   (feasibility)
//     3. soulLink AND the exception ability is set AND the target has it                            -> false   (feasibility, a param)
//     4. `!super.canApply(params) || simulated || damage <= 0`   (damaging move, not a preview, the hit did damage) -> false
//     5. basis "maxHp" AND the holder's `turnData.hitsLeft > 1`  (only the LAST hit of a multi-hit move pays)  -> false
//   apply: `self = toDmgValue(base * fraction, 1)` (at least 1) where base is the damage dealt or the holder's max HP; the holder
//     takes it as INDIRECT damage that ignores boss health segments. No random draw.
//
// Why Tier C: no library effect "I lose a share of the damage I dealt or of my max HP" with the choice of basis (request R-B11-09
// in requests/B11.md: effect.recoil only knows the damage), and the clauses are guards of one mechanic (Soul Linker) or feasibility
// of the effect, not rules staff would tune. The four settings are params.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfDamageOnAttackAbAttr } from "#data/elite-redux/archetypes/self-damage-on-attack";
import { optionalAbilityNumberCodec, SELF_DAMAGE_BASIS_WORDS, selfDamageBasisCodec } from "./b11-chunk3-codecs";

export default defineDecl(SelfDamageOnAttackAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Hurt myself after my attack",
  summary: params =>
    params.basis === SELF_DAMAGE_BASIS_WORDS[1]
      ? `After my damaging move hits, I lose ${params.fraction} of my max HP, once per move (0.1 = 10%). Example: 200 max HP at 0.1 = 20 HP lost.`
      : `After my damaging move hits, I lose ${params.fraction} of the damage I just dealt (0.25 = a quarter). Example: 100 damage at 0.25 = 25 HP lost.`,
  synonyms: ["recoil", "blood price", "super strain", "soul linker", "life orb", "pay hp for attacking"],
  examples: ["Lose 10% of my max HP every time I land an attack", "Take a quarter of the damage I deal as recoil"],
  params: [
    {
      id: "basis",
      ctorIndex: 0,
      ctorOption: "basis",
      path: "basis",
      control: "select",
      label: "What the HP loss is a share of",
      editable: true,
      default: SELF_DAMAGE_BASIS_WORDS[0],
      options: [...SELF_DAMAGE_BASIS_WORDS],
      codec: selfDamageBasisCodec,
    },
    {
      id: "fraction",
      ctorIndex: 0,
      ctorOption: "fraction",
      path: "fraction",
      control: "number",
      min: 0.01,
      max: 1,
      step: 0.01,
      label: "Share of HP lost (0.25 = a quarter, 1 = all of it)",
      editable: true,
      default: 0.25,
    },
    {
      id: "soulLink",
      ctorIndex: 0,
      ctorOption: "soulLink",
      path: "soulLink",
      control: "boolean",
      label: "Use the soul-link safety rules",
      editable: true,
      default: false,
    },
    {
      id: "exceptAbility",
      ctorIndex: 0,
      ctorOption: "cancelIfTargetHasAbility",
      path: "cancelIfTargetHasAbility",
      control: "number",
      min: 0,
      max: 29999,
      step: 1,
      integer: true,
      label: "Soul-link only: do nothing against targets with this ability (ability number, 0 = none)",
      editable: true,
      default: 0,
      codec: optionalAbilityNumberCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The move must be a damaging move that really did damage on this hit, and it never happens in a preview",
    "When the loss is a share of my max HP, only the last hit of a multi-hit move costs HP",
    "I always lose at least 1 HP, and the loss is indirect damage that ignores boss health segments",
    "With the soul-link rules on: never in the Fun and Games (Wobbuffet) minigame, never when this hit knocked the target out, and never against a target with the chosen ability",
  ],
  effect: { id: "effect.recoil", params: ["basis", "fraction"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a hit at full HP and at half HP",
      axes: { hp: ["max", "50%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Users: Blood Price (`maxHp`, 0.1) and Super Strain (`damageDealt`, 0.25) with the soul-link rules off, and Soul Linker (`damageDealt`, 1.0, soulLink true, exception = Soul Linker's own number). Nothing to bind. Blood Price exists under two ability numbers (463 and 536) with the class at attr 1 in both. The Fun and Games and multi-hit clauses read game state the L1 grid cannot grow, so test/tests/elite-redux/decomp/B11/chunk3.test.ts drives canApply and apply on the original and the rebuild. Remark, NOT fixed: the maxHp basis ignores `damage` for the amount but still needs `damage > 0` to trigger.",
});
