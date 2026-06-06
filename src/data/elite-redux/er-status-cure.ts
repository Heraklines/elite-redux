// =============================================================================
// Elite Redux — custom-status cure helper.
//
// ER's custom statuses (BLEED, FROSTBITE, FEAR) are modelled as battler TAGS
// (see `BattlerTagType.ER_*` / the `Er*Tag` classes in `battler-tags.ts`) rather
// than vanilla `StatusEffect` entries, so pokerogue's standard status-cure
// machinery (`Pokemon.resetStatus`, Lum/Full Heal, Heal Bell, Natural Cure,
// Shed Skin, etc.) silently ignores them — those paths only look at
// `pokemon.status`.
//
// This module centralises:
//   - `ER_AILMENT_TAGS`  : the canonical set of "ailment" ER tags that a
//                          full-status cure should clear.
//   - `hasErAilment`     : predicate used to broaden `canApply`/`shouldApply`
//                          gates that previously only checked `pokemon.status`.
//   - `clearErAilments`  : remove every ER ailment tag from a Pokémon.
//
// AILMENT vs MECHANICAL tags: only genuine status/DoT/impair tags belong here.
// `ER_ITEM_DISABLED` (Frisk's held-item lock) and `ER_ICE_STATUE` (a positional
// type-override that resets on switch-out) are mechanical riders, NOT ailments,
// so they are intentionally EXCLUDED — a Full Heal / Lum Berry must not strip
// them.
// =============================================================================

import { BattlerTagType } from "#enums/battler-tag-type";
import type { Pokemon } from "#field/pokemon";

/**
 * The ER custom-status battler tags that count as curable "ailments" — i.e. the
 * ER analogues of vanilla non-volatile status conditions. A cure-ALL source
 * (Lum Berry, Full Heal/Restore, Heal Bell/Aromatherapy, Rest, and the
 * status-clearing abilities Natural Cure / Shed Skin / Hydration / Healer)
 * should clear every tag in this set.
 *
 * Status-SPECIFIC cures map by analogy (see callers):
 *   - FROSTBITE ⇆ FREEZE (Aspear Berry, Ice Heal, and the FREEZE branch of
 *     `HealStatusEffectAttr`). Frostbite is ER's freeze analogue.
 *   - BLEED / FEAR have no vanilla single-status analogue, so only the
 *     cure-ALL paths above remove them.
 */
export const ER_AILMENT_TAGS: readonly BattlerTagType[] = [
  BattlerTagType.ER_BLEED,
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_FEAR,
] as const;

/**
 * @returns `true` if the Pokémon currently carries any ER ailment tag.
 * Used to broaden cure gates that otherwise only fire on `pokemon.status`.
 */
export function hasErAilment(pokemon: Pokemon): boolean {
  return ER_AILMENT_TAGS.some(tag => pokemon.getTag(tag) != null);
}

/**
 * Remove every ER ailment tag from the given Pokémon. Safe to call when none
 * are present (no-op per missing tag). Does NOT touch vanilla `pokemon.status`
 * or the mechanical ER riders (`ER_ITEM_DISABLED`, `ER_ICE_STATUE`).
 *
 * @returns `true` if at least one ER ailment tag was removed.
 */
export function clearErAilments(pokemon: Pokemon): boolean {
  let cleared = false;
  for (const tag of ER_AILMENT_TAGS) {
    if (pokemon.getTag(tag) != null) {
      pokemon.removeTag(tag);
      cleared = true;
    }
  }
  return cleared;
}
