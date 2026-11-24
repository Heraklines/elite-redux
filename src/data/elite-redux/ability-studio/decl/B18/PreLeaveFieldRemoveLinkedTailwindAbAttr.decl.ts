/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagType } from "#enums/arena-tag-type";
// Blistering Sun (Tier C, package). "When I leave the field, DO end a field effect (Tailwind) on my side".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PreLeaveFieldAbAttr (showAbility default). Dispatch:
// applyAbAttrs("PreLeaveFieldAbAttr", { pokemon, simulated }) when a Pokemon leaves the field (switch or faint). There is no
// canApply of its own. apply: unless simulated, `arena.removeTagOnSide(tag, holder's side)`. The partner of this attr is
// syncBlisteringSunFieldPair (requested-field-effects.ts:197), which keeps the harsh sun and the own-side Tailwind alive together
// while a Blistering Sun holder is on the field.
import { PreLeaveFieldRemoveLinkedTailwindAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";

/** The field effects a staff member can pick (the names are the enum's own text, so the codec only checks them). */
const FIELD_EFFECT_NAMES = [
  "TAILWIND",
  "REFLECT",
  "LIGHT_SCREEN",
  "AURORA_VEIL",
  "MIST",
  "SAFEGUARD",
  "SPIKES",
  "TOXIC_SPIKES",
  "STEALTH_ROCK",
  "STICKY_WEB",
  "TRICK_ROOM",
].filter(name => name in ArenaTagType);

/** ArenaTagType is a string enum, so the staff value and the constructor value are the same text; an unknown name is refused. */
const fieldEffectCodec: ParamCodec = {
  toCtor: value => {
    const name = String(value);
    if (!FIELD_EFFECT_NAMES.includes(name)) {
      throw new Error(`"${name}" is not a field effect staff can pick here`);
    }
    return ArenaTagType[name as keyof typeof ArenaTagType];
  },
  fromInstance: raw => (typeof raw === "string" && FIELD_EFFECT_NAMES.includes(raw) ? raw : undefined),
};

export default defineDecl(PreLeaveFieldRemoveLinkedTailwindAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.leave-field",
  label: "End a field effect on my side when I leave the field",
  summary: params =>
    `When I leave the field (switched out or fainted), the ${params.tag} on my side ends. Example: Tailwind ends with me, which keeps it tied to my own weather.`,
  synonyms: [
    "blistering sun",
    "end tailwind",
    "clear tailwind",
    "linked tailwind",
    "tailwind ends with me",
    "remove my field effect",
  ],
  examples: ["When I leave, my side's Tailwind ends too, like Blistering Sun"],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Field effect that ends on my side",
      editable: true,
      default: "TAILWIND",
      options: FIELD_EFFECT_NAMES,
      codec: fieldEffectCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["Nothing happens while the game is only previewing", "Only the field effect on my own side is removed"],
  effect: { id: "effect.package", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder leaving with and without Tailwind on its side", axes: {} }],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'remove a field effect from a side' has no library effect (effect.arena-tag only SETS one, effect.remove-tag only removes a Pokemon's battle effect); request R-B18-18 asks for one with a field effect list and a side setting. The field effect is a typed setting (the constructor takes it, default Tailwind, added with this declaration without changing behaviour for the shipped ability). The side is always the holder's own (apply: pokemon.isPlayer() ? PLAYER : ENEMY). The trigger (event.leave-field) is a separate block and the class has no condition, so staff can AND any condition on top. Users: Blistering Sun (5572, attr 5; the other attrs of that ability are the Desolate Land weather attrs and a draft attr, copied by the ability patch). ODDITIES (not fixed): (1) the removal runs for every leave, including a faint, and also when no such effect exists (removeTagOnSide then does nothing); (2) a second Blistering Sun holder on the same side keeps its own harsh sun, but its Tailwind is removed as soon as the first one leaves, and syncBlisteringSunFieldPair then clears the sun.",
});
