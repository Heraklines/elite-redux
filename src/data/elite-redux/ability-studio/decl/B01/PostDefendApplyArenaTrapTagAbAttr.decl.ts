/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier A event-effect. "After I am hit, IF <rule about the move and its user>, a hazard is set on the
// attacker's side of the field."
//   canApply  `this.condition(pokemon, attacker, move) && (!tag || tag.canAdd())`, in that order. Looking the tag up is
//             a pure read. The first part is the CONDITION slot (ctor:0, a `(target, user, move)` closure); the second is
//             feasibility ("another layer can still be added"), which stays in the class.
//   apply     (skipped when `simulated`, no random draw) `arena.addTag(tag, 0, undefined, holder.id, side)` with the side
//             being the OPPOSITE of the holder's (`holder.isPlayer() ? ENEMY : PLAYER`), i.e. the attacker's side.
// The hazard is a real constructor argument (ctor 1); it must be an entry hazard (the class casts it to EntryHazardTag
// and asks `canAdd()`), so the choice lists the four hazards the game has.
import { PostDefendApplyArenaTrapTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendApplyArenaTrapTagAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Scatter a hazard on the attacker's side after a certain hit",
  summary: params =>
    `After I am hit by a move that meets the rule you set, ${params.tag} is set on the attacker's side of the field. Example: toxic spikes after a contact hit, like Toxic Debris.`,
  synonyms: [
    "toxic debris",
    "set hazards when hit",
    "spikes on contact",
    "entry hazard when hit",
    "toxic spikes",
    "stealth rock",
    "hazard on hit",
  ],
  examples: ["Set toxic spikes on the attacker's side when I am hit by a contact move, like Toxic Debris"],
  params: [
    {
      id: "tag",
      ctorIndex: 1,
      path: "arenaTagType",
      control: "select",
      label: "Which hazard is set",
      editable: true,
      default: "TOXIC_SPIKES",
      options: ["SPIKES", "TOXIC_SPIKES", "STEALTH_ROCK", "STICKY_WEB"],
    },
  ],
  conditions: [
    // Required closure `(target, user, move) => boolean`, the `defend` shape.
    { slot: "ctor:0", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Another layer must still be possible (a hazard that is already at its maximum layers is not set again)",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.arena-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "contact and non-contact hits",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Toxic Debris (295 attr 0, Toxic Spikes). The ER vanilla-rebalance patcher replaces the vanilla attr with this one (init-elite-redux-vanilla-rebalance.ts:1524), so the closure was read from the live attr: `(_target, _user, move) => move.hasFlag(MAKES_CONTACT)` (the plain flag, not doesFlagEffectApply, unlike most contact abilities). It stays a legacy-closure because the library flag atom asks doesFlagEffectApply (request R-B01-10). The side the hazard lands on is not a setting: it is always the attacker's side, which the library effect arena-tag calls 'opposing side'.",
});
