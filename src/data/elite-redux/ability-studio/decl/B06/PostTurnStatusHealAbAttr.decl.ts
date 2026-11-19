/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier B event-effect. See ../PRECEDENTS.md.
//
// "At the end of every turn, while I have one of these statuses and I am hurt, heal 1/8 of my max HP" (Poison Heal).
// Clauses, in the ORIGINAL order (`canApply` is now guards, then gate; there is no prepare or residual):
//   1. guard    `pokemon.status != null && this.effects.includes(pokemon.status.effect)` (ab-attrs.ts, PostTurnStatusHealAbAttr
//               .guards). The statuses ARE the setting of the block (param `statuses`), so they stay in the class.
//   2. gate     `!pokemon.isFullHp()`: the replaceable IF, bound as `not hp.full` (the same engine call).
//   effect-side `apply`: queues a PokemonHealPhase of `toDmgValue(maxHp / 8)` with the Poison Heal message. A simulated
//               call does nothing.
// The 1/8 is a literal in `apply` (no constructor argument), so it is not a setting; see notes and requests/B06.md.
import { PostTurnStatusHealAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(PostTurnStatusHealAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Heal each turn while I have certain statuses",
  summary: params =>
    `At the end of every turn, while I have ${params.statuses} and am not at full HP, I heal 1/8 of my max HP. Example: 160 max HP heals 20 HP.`,
  synonyms: [
    "poison heal",
    "heal while poisoned",
    "heal from status",
    "status healing",
    "recover each turn",
    "regenerate when statused",
  ],
  examples: ["Heal 1/8 of max HP at the end of every turn while poisoned, like Poison Heal"],
  params: [
    {
      id: "statuses",
      ctorIndex: 0,
      path: "effects",
      control: "text",
      label: "Statuses that heal me (comma separated, for example Poison, Toxic)",
      editable: true,
      // Only the guard reads it; the gate (not at full HP) never repeats it.
      gateIndependent: true,
      default: "POISON,TOXIC",
      // The class takes them as rest arguments.
      options: enumOptions(StatusEffect).filter(name => name !== "NONE" && name !== "FAINT"),
      codec: enumListCodec(StatusEffect, "status"),
      spread: true,
    },
  ],
  conditions: [
    // The IF staff may swap or drop: "I am not at full HP". Bound per user in bindings.ts.
    { slot: "gate", ctx: "params", lib: "hp.full", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only while I have one of the chosen statuses (the setting above, checked first)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "poisoned or badly poisoned at the HP boundaries, and a status that does not heal",
      axes: { hp: ["max", "max-1", 1], status: ["POISON", "TOXIC", "BURN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users: Poison Heal (90, attr 0, statuses Toxic and Poison, no ability-level closure). The ability also carries BlockStatusDamageAbAttr, which keeps poison damage away. The heal is 1/8 as `toDmgValue(maxHp / 8)` (floor, at least 1) written as a literal in apply; there is no constructor argument for it, so it cannot be a typed setting without a constructor change that class agents may not make (request R-B06-1: a ratio setting, and an effect whose percent is not limited to whole numbers; the effect is therefore a PACKAGE with this written reason: effect.heal-percent has a whole-number percent slider (default 25) and cannot express 12.5 percent with toDmgValue rounding, so declaring it would show a slider that does not match the shipped ability; it can retire once R-B06-1 lands). The message and the ability popup (showAbility false) are untouched. Oddity, not fixed: `canApply` ignores `simulated` but is pure, and `apply` skips simulated calls, so `simulated` is respected. Engine side: ER turn-end code checks the same ability by identity (abilityQuery POISON_HEAL_RECOVERY) for the Toxic terrain chip; that is the foundation engine-query track, not this class.",
});
