/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier A: "may it happen against this target" is a constructor closure).
//
// Read by hand from archetypes/self-damage-on-attack.ts. PostAttack hook (WHEN "after my attack lands"), constructor
// `(options = { basis, fraction, soulLink?, cancelIfTargetHasAbility? }, condition?)`; `super()` so the attack condition is the
// default (the move is not a status move). `condition(holder, target, move)` is handed in at constructor argument 1 (slot
// ctor:1, field `condition`); its DEFAULT is "not soul-link, or the target has not fainted and does not have
// `cancelIfTargetHasAbility`".
//   canApply, in the ORIGINAL order:
//     1. soulLink AND the battle is the Fun and Games (Wobbuffet) mystery encounter                -> false   (the `soulLink` setting)
//     2. `condition(holder, target, move)` is false  (soul-link: the target fainted, or has the exception ability) -> false   (CONDITION)
//     3. `!super.canApply(params) || simulated || damage <= 0`   (damaging move, not a preview, the hit did damage) -> false   (feasibility)
//     4. basis "maxHp" AND the holder's `turnData.hitsLeft > 1`  (only the LAST hit of a multi-hit move pays)  -> false   (feasibility of the effect)
//   apply: `self = toDmgValue(base * fraction, 1)` (at least 1) where base is the damage dealt or the holder's max HP; the holder
//     takes it as INDIRECT damage that ignores boss health segments. No random draw.
//
// The effect is NOT library recoil: effect.recoil only knows "a share of the damage dealt", while this class also pays a share of
// the holder's MAX HP once per move (request R-B11-09 in requests/B11.md), so the effect is declared as one piece and the library
// recoil is not claimed. The ability to spare is no longer a number setting: it is part of the condition block (staff pick the
// ability by name there). The `soulLink` setting is now only what it really does: stay off during the Fun and Games minigame.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfDamageOnAttackAbAttr } from "#data/elite-redux/archetypes/self-damage-on-attack";
import { SELF_DAMAGE_BASIS_WORDS, selfDamageBasisCodec } from "./b11-chunk3-codecs";

export default defineDecl(SelfDamageOnAttackAbAttr, {
  tier: "A",
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
      label: "Stay off during the Fun and Games (Wobbuffet) minigame",
      editable: true,
      default: false,
    },
  ],
  conditions: [
    // Soul Linker: "the target has not fainted and is not another Soul Linker"; Blood Price and Super Strain: always.
    { slot: "ctor:1", ctx: "attack", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be a damaging move that really did damage on this hit, and it never happens in a preview",
    "When the loss is a share of my max HP, only the last hit of a multi-hit move costs HP",
    "I always lose at least 1 HP, and the loss is indirect damage that ignores boss health segments",
  ],
  effect: { id: "effect.package", params: ["basis", "fraction"] },
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
    "Tier A, justified in the header. Users: Blood Price (5264, `maxHp`, 0.1) and Super Strain (5217, `damageDealt`, 0.25), both with the always-true condition (bound `{ all: [] }`), and Soul Linker (5070, `damageDealt`, 1.0, minigame guard on) whose condition is a legacy closure: 'the target has not fainted' has no library atom (request R-B11-13: a fainted atom) and mon.has-ability cannot name Soul Linker, an ER ability (R-B11-14). The Fun and Games clause and the multi-hit clause read game state the L1 grid cannot grow, so test/tests/elite-redux/decomp/B11/chunk3.test.ts drives canApply and apply on the original and the rebuild. The effect stays one piece until R-B11-09 exists. Remark, NOT fixed: the maxHp basis ignores `damage` for the amount but still needs `damage > 0` to trigger.",
});
