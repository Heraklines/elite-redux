/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { CATEGORY_OPTIONS, MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveCategoryOverrideAbAttr } from "#data/elite-redux/archetypes/move-category-override";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";

// B09 chunk 4. "My moves with a certain property use the other damage category" (Mystic Blades: slicing moves become special; Magus
// Blades, Blade's Essence, Spiritual Saber, Sinister Claws, Best Offense).
//
// Source: src/data/elite-redux/archetypes/move-category-override.ts, class MoveCategoryOverrideAbAttr (extends AbAttr, no dispatch
// key). Nothing dispatches it: Pokemon.getAttackDamage (pokemon.ts:5854) loops over the attacker's active ability attrs and, for
// each attr that has a `resolveCategory` function, calls `resolveCategory(move, source)` and, when it returns a category, replaces
// the move's damage category with it. The scan is skipped when the attacker's abilities are ignored (`ignoreSourceAbility`).
// resolveCategory(move, user): `user` given -> `move.doesFlagEffectApply({ flag, user })` (so properties other abilities inject
// count); `user` missing -> `move.hasFlag(flag)`. A match returns `category`, otherwise null.
// Because the engine finds the attr by name (a duck-typed `resolveCategory`), this is an engine query, the same family as
// FloatAbAttr. Flipping the category makes the whole damage formula follow: the offensive stat becomes Sp. Atk (or Attack), the
// defensive stat the target's Sp. Def (or Defense), burn's Attack halving applies only to physical, and the matching screen
// (Light Screen or Reflect) is the relevant one.
// Constructor: ({ flag, category }), one options object; no validation; showAbility false. No random draw, no state.
// Tier C engine-query: one flag-gated rule with two settings; the property test is part of the engine query, so it is a setting,
// not a gate. It needs a flagKeys entry in the WHEN `while.active` (request R-B09-33; the line was added by this chunk, like the
// Ground Entry Hazard Immunity line of chunk 3).
export default defineDecl(MoveCategoryOverrideAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Make my moves with a property use another damage category",
  summary: params =>
    `While I have this, my moves with the ${params.flag} property are treated as ${params.category} moves for damage: the matching attack and defense stats, burn and screens follow the new category.`,
  synonyms: [
    "mystic blades",
    "slicing moves are special",
    "physical to special",
    "change move category",
    "use sp atk for physical moves",
    "category swap",
    "psyshock style",
  ],
  examples: ["My slicing moves become special moves, like Mystic Blades", "My punching moves become special moves"],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Which of my moves change category (the move property)",
      editable: true,
      default: "SLICING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "category",
      ctorIndex: 0,
      ctorOption: "category",
      path: "category",
      control: "select",
      label: "Damage category they use instead (Physical, Special or Status)",
      editable: true,
      default: "SPECIAL",
      options: CATEGORY_OPTIONS,
      codec: enumCodec(MoveCategory, "move category"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The game skips this while the attacker's ability is being ignored (a Mold Breaker style attacker)",
    "The property test counts properties that other abilities add to the move (the same rule as the game's own property check)",
    "If several abilities change the category, the last one the game reads wins",
  ],
  reusableAlone: { when: true, if: false, do: true },
  l2StaticReason:
    "The class is found by name inside Pokemon.getAttackDamage (a damage calculation, not a dispatched moment), so the twin compares whole battles of the six users instead.",
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks with a slicing move and with an ordinary move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C engine-query. 6 attrs, all { SLICING_MOVE, SPECIAL }: Mystic Blades (5235 attr 1), Blade's Essence (5242 attr 2), Best Offense (5545 attr 0), Magus Blades (5547 attr 0), Sinister Claws (5712 attr 1), Spiritual Saber (6065 attr 2). Nothing is bound (no closure). It is declared engine-query because the engine reads it by the duck-typed name `resolveCategory` (the scan in Pokemon.getAttackDamage); a different class with the same method (bernerd-roster-mechanics.ts:100) is found by the same scan and needs its own declaration (B14). The engine-side behaviour of the flip is outside the class and is not changed. No effect is named: the library has no 'change the move's damage category' effect (request R-B09-34). Oddity, not fixed: with several overriding abilities the loop keeps the LAST non-null answer, so the order of the holder's abilities decides.",
});
