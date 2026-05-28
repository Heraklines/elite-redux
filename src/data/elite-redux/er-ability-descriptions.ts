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

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import erDump from "../../../vendor/elite-redux/v2.65beta.json";

interface ErDumpAbility {
  readonly id: number;
  readonly name: string;
  readonly desc: string;
}

const dump = erDump as { abilities: ErDumpAbility[] };

const map = new Map<number, string>();
for (const ab of dump.abilities) {
  const pokerogueId = ER_ID_MAP.abilities[ab.id];
  if (pokerogueId === undefined) {
    continue;
  }
  const desc = ab.desc?.trim();
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
