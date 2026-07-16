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

import { allAbilities } from "#data/data-lists";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ROM_DESCRIPTIONS } from "#data/elite-redux/er-ability-rom-descriptions";
import { MANUAL_COMPOSITE_PARTS } from "#data/elite-redux/abilities/composite-newcomers";
import { ER_COMPOSITE_PARTS, type ErCompositePartRef } from "#data/elite-redux/er-composite-parts";
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

// Reverse pokerogue-ability-id → ER-ability-id map (first match wins), built
// lazily so it sees the fully-resolved ER_ID_MAP. Used to find a composite's
// constituent parts from the live pokerogue ability id shown in the UI.
let pokerogueToErAbility: Map<number, number> | null = null;
function erAbilityIdFromPokerogueId(pokerogueAbilityId: number): number | undefined {
  if (pokerogueToErAbility === null) {
    pokerogueToErAbility = new Map();
    for (const ab of ER_ABILITIES) {
      const pk = ER_ID_MAP.abilities[ab.id];
      if (pk !== undefined && !pokerogueToErAbility.has(pk)) {
        pokerogueToErAbility.set(pk, ab.id);
      }
    }
  }
  return pokerogueToErAbility.get(pokerogueAbilityId);
}

/** Resolve a composite part reference to its live pokerogue ability id. */
function partPokerogueId(part: ErCompositePartRef): number | undefined {
  return part.kind === "pokerogue" ? part.abilityId : ER_ID_MAP.abilities[part.erAbilityId];
}

/**
 * For a `composite-vanilla-mashup` ability, build a detailed description by
 * concatenating the detailed (ROM, else short) descriptions of each constituent
 * part, back-to-back and labelled by the part's ability name. Returns null when
 * the ability isn't a composite (or has no resolvable parts) so callers fall
 * back to the ability's own description.
 */
export function getErCompositeDetailedDescription(pokerogueAbilityId: number): string | null {
  // Newcomer-patch manual composites (5933+) live outside the auto-generated
  // ER_COMPOSITE_PARTS table (they have no ER source draft id). Their constituent
  // pokerogue ids are in MANUAL_COMPOSITE_PARTS — build the same constituent-detail
  // block from those.
  const manual = MANUAL_COMPOSITE_PARTS[pokerogueAbilityId];
  if (manual) {
    return buildConstituentDetail(manual.constituents);
  }
  const erId = erAbilityIdFromPokerogueId(pokerogueAbilityId);
  if (erId === undefined) {
    return null;
  }
  const entry = ER_COMPOSITE_PARTS[erId];
  if (!entry || entry.parts.length === 0) {
    return null;
  }
  return buildConstituentDetail(entry.parts.map(partPokerogueId));
}

/**
 * Concatenate the detailed (ROM, else short) descriptions of a set of
 * constituent pokerogue ability ids, labelled by ability name. Shared by the
 * draft-id and manual composite paths.
 */
function buildConstituentDetail(constituentIds: readonly (number | undefined)[]): string | null {
  const blocks: string[] = [];
  const seen = new Set<number>();
  for (const pk of constituentIds) {
    if (pk === undefined || seen.has(pk)) {
      continue;
    }
    seen.add(pk);
    const ability = allAbilities[pk];
    if (!ability) {
      continue;
    }
    const detail = getErAbilityRomDescription(ability.name) ?? map.get(pk) ?? ability.description ?? "";
    if (detail) {
      blocks.push(`${ability.name}: ${detail}`);
    }
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
