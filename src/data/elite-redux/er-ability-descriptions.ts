// =============================================================================
// Map pokerogue ability id → ER short description.
//
// The ER ROM ability page (see Scrafster reference screenshot) shows a 1-2
// line summary per ability, matching the `desc` field on each entry in
// vendor/elite-redux/v2.65beta.json. We import that dump synchronously here
// and build a pokerogue-id-keyed map at module load.
//
// Used by:
//   - summary-ui-handler.ts: 4-row ability stack (Ability + 3 Innates) for
//     ER-style species. When a pokerogue ability id has an entry here we
//     render the short desc inline instead of pokerogue's longer desc.
//
// Resolution order in callers: lookup pokerogueAbilityId here; fall back to
// allAbilities[id].description when absent.
// =============================================================================

import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ROM_DESCRIPTIONS } from "#data/elite-redux/er-ability-rom-descriptions";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";

// IMPORTANT: build this map from ER_ABILITIES (the auto-generated draft list),
// NOT from the raw vendor/elite-redux/v2.65beta.json dump. The on-disk json was
// renumbered after ER_ABILITIES + ER_ID_MAP were generated, so its ability ids
// no longer line up with the er-id-map key space (e.g. json "Spectralize" is id
// 393 but er-abilities/er-id-map use 386). ER_ABILITIES shares the exact id
// space ER_ID_MAP is keyed on, so iterating it keeps each description attached
// to the correct pokerogue ability id. Feeding raw-json ids into ER_ID_MAP
// silently shifts descriptions onto neighbouring abilities.
const map = new Map<number, string>();
for (const ab of ER_ABILITIES) {
  const pokerogueId = ER_ID_MAP.abilities[ab.id];
  if (pokerogueId === undefined) {
    continue;
  }
  const desc = ab.description?.trim();
  if (!desc) {
    continue;
  }
  map.set(pokerogueId, desc);
}

/**
 * Look up the short ER description for a pokerogue ability id.
 * Returns null when none is registered (caller falls back to pokerogue's
 * own description).
 */
export function getErAbilityDescription(pokerogueAbilityId: number): string | null {
  return map.get(pokerogueAbilityId) ?? null;
}

/** Canonical (lowercase alphanumerics-only) key — matches the ROM-desc generator. */
function canonicalAbilityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Look up the full in-game ROM ability description (the expanded text shown on
 * the ability "Detail" view) by the ability's display name. Returns null for
 * abilities not present in the v2.65.3b ROM (beta-only customs) — callers fall
 * back to the short description.
 */
export function getErAbilityRomDescription(abilityName: string | undefined | null): string | null {
  if (!abilityName) {
    return null;
  }
  return ER_ABILITY_ROM_DESCRIPTIONS[canonicalAbilityName(abilityName)] ?? null;
}
