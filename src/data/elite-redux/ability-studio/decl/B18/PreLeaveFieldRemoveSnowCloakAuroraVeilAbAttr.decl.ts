/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4, Tier C package. Snow Cloak and Glacial Ghost. "When I leave the field, DO remove the lasting field effect I made from my side".
//
// Source: ability-upgrades/attrs/snow-cloak-aurora-veil.ts over PreLeaveFieldAbAttr (constructor `(tag)`, showAbility false). Dispatch:
// applyAbAttrs("PreLeaveFieldAbAttr", { pokemon, simulated }) when a Pokemon leaves the field (switch or faint). canApply: the `tag` on the
// holder's side exists, its source is this Pokemon (`sourceId === pokemon.id`) and it has no turn limit (`turnCount <= 0`). apply: unless
// simulated, arena.removeTagOnSide(tag, holder's side). No random draw. The partner of this attr is PostSummonSnowCloakAuroraVeilAbAttr
// (it sets the effect, owned by the holder, with no turn limit).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr } from "#data/elite-redux/ability-upgrades/attrs/snow-cloak-aurora-veil";
import { FIELD_EFFECT_OPTIONS, fieldEffectCodec } from "./b18-chunk4-codecs";

export default defineDecl(PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.leave-field",
  label: "Remove the lasting field effect I made when I leave",
  summary: params =>
    `When I leave the field, the ${params.tag} I made on my side (the one with no turn limit) ends. One that came from a move stays. Example: Aurora Veil, like Snow Cloak.`,
  synonyms: [
    "snow cloak",
    "remove my aurora veil",
    "veil ends when i leave",
    "clean up my screen",
    "remove my field effect on exit",
    "lasting screen ends with me",
  ],
  examples: [
    "When I leave the field, the lasting Aurora Veil I made on my side ends, like Snow Cloak",
    "When I switch out, my side's lasting Light Screen ends",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Field effect that ends on my side",
      editable: true,
      default: "AURORA_VEIL",
      options: FIELD_EFFECT_OPTIONS,
      codec: fieldEffectCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only a field effect that I made myself and that has no turn limit is removed; one from a move, or another Pokemon's, stays",
    "Nothing happens while the game is only previewing",
    "Only my own side loses the field effect",
  ],
  effect: { id: "effect.package", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    // The holder enters in hail (its veil is set), then switches out: the veil it made is removed. Snow Cloak's own ability-level condition
    // (hail or snow) keeps the attr from being asked without that weather.
    { name: "leaving after entering in hail", axes: { weather: ["HAIL"] } },
  ],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: 'remove a field effect from a side' has no library effect (effect.arena-tag only SETS one, effect.remove-tag only removes a Pokemon's battle effect); request R-B18-18 (chunk 2) asks for one with a field effect and a side setting. The field effect is the typed `tag` setting (a trailing constructor argument added with this declaration, default Aurora Veil, so the shipped behaviour is unchanged). The trigger (event.leave-field) is a separate block; the class has no editable condition, so staff can AND any condition on top. The only clause kept in canApply is 'the field effect on my side is mine and has no turn limit', which is the effect's own precondition (it only removes what the partner attr set): it needs the field effect's owner and turn count, which no slot carries (request R-B18-38: atom field.arena-tag-owned-by-me). Users (2 attrs): Snow Cloak (81, attr 1) and Glacial Ghost (5526, attr 3, with an attr-level extraCondition that the rebuild copies). ODDITIES, not fixed: (1) the check also passes for a faint (the Pokemon leaves the field); (2) a second Snow Cloak holder on the same side replaces the first one's veil on entry (the partner replaces any veil), so the first holder's later exit finds a veil it does not own and removes nothing; (3) the attr is silent (showAbility false).",
});
