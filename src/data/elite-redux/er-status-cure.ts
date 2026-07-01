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
 *   - FEAR has no vanilla single-status analogue, so only the cure-ALL paths
 *     above remove it.
 *
 * BLEED is deliberately EXCLUDED: per the ER dex it is removed ONLY by using a
 * healing MOVE (Recover/Roost/Rest/...), handled in `PokemonHealPhase` via the
 * `isHealMove` discriminator. A cure-all (Lum/Full Heal/Heal Bell/Natural
 * Cure/Shed Skin/Healer) must NOT clear bleed, and switching it out must not
 * either (bleed persists across switch like a non-volatile status).
 */
export const ER_AILMENT_TAGS: readonly BattlerTagType[] = [
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_FEAR,
] as const;

/**
 * The three ER major statuses (Bleed / Frostbite / Fear). Like vanilla
 * non-volatile status conditions, these are MUTUALLY EXCLUSIVE: a Pokemon
 * already afflicted with one must NOT be overwritten by another (you cannot
 * bleed a frostbitten mon any more than you can burn a poisoned one). The guard
 * lives in each tag's `canAdd` (see the `Er*Tag` classes in `battler-tags.ts`)
 * via {@linkcode hasOtherErMajorStatus}. (Frostbite additionally blocks the
 * vanilla majors it is exclusive with — e.g. Paralysis, #294 — in
 * `Pokemon.canSetStatus`; that is a separate gate and unaffected here.)
 */
export const ER_MAJOR_STATUS_TAGS: readonly BattlerTagType[] = [
  BattlerTagType.ER_BLEED,
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_FEAR,
] as const;

/**
 * @returns `true` if the Pokemon already carries an ER major status tag OTHER
 * than `excluding`. Used by each ER status tag's `canAdd` so a second ER major
 * status cannot land on (overwrite) a mon that already has one.
 */
export function hasOtherErMajorStatus(pokemon: Pokemon, excluding: BattlerTagType): boolean {
  return ER_MAJOR_STATUS_TAGS.some(tag => tag !== excluding && pokemon.getTag(tag) != null);
}

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

/**
 * Clear EVERY ER status, INCLUDING Bleed — for the every-10-waves full-team REST
 * (`PartyHealPhase`), which is a Pokémon-Center-style full restore between waves.
 * This differs from {@linkcode clearErAilments} (which deliberately spares Bleed for
 * in-battle cure-alls per the dex): the between-wave rest should leave the party
 * fully healthy, so Bleed/Frostbite/Fear all clear.
 *
 * @returns `true` if at least one ER status tag was removed.
 */
export function clearAllErStatuses(pokemon: Pokemon): boolean {
  let cleared = clearErAilments(pokemon);
  if (pokemon.getTag(BattlerTagType.ER_BLEED) != null) {
    pokemon.removeTag(BattlerTagType.ER_BLEED);
    cleared = true;
  }
  return cleared;
}
