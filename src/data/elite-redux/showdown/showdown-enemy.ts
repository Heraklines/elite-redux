/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP (C3): opponent-manifest -> ENEMY reconstruction.
//
// The host builds its ENEMY party from the opponent's validated {@linkcode ShowdownMonManifest[]}
// (the team the guest built + exchanged in C2). It reuses the co-op enemy reconstructor
// {@linkcode buildCoopEnemy}, which consumes a plain-JSON {@linkcode CoopSerializedPokemon} blob -
// the SAME shape the authoritative state stream round-trips - so a showdown enemy is
// byte-compatible with a co-op adopted enemy and needs NO new engine path.
//
// This module owns the PURE transform:
//   - {@linkcode manifestToSerializedMon}: manifest -> the identity blob buildCoopEnemy reads
//     (species / form / level / ability / nature / shiny / variant / IVs / moveset). Megas
//     already sit in their mega `formIndex` (the fork's permamega semantics), so no in-battle
//     toggle and no stone modifier is needed - the form carries the stats.
//   - {@linkcode showdownHeldItemKey}: the whitelist held-item KEY to attach to the live enemy,
//     or null for the MEGA_STONE sentinel (which maps to NO runtime modifier - the item slot
//     was "paid" by choosing the mega form) and for any empty/unknown item.
//
// Held items are attached to the LIVE enemy via the normal engine grant path at build time
// (the engine-side buildShowdownEnemyParty), exactly like co-op enemy held items, so the
// host's captureCoopAuthoritativeBattleState then serializes them into the turn stream for the
// guest verbatim. Kept OUT of the identity blob so this transform stays engine-free + pure.
// =============================================================================

import type { CoopSerializedPokemon } from "#data/elite-redux/coop/coop-transport";
import { MEGA_STONE_ITEM, type ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";

/**
 * The whitelist held-item KEY (a `modifierTypes` key, e.g. `"LEFTOVERS"`) to grant the live
 * enemy built from this manifest, or `null` when NO runtime modifier should be attached: the
 * `MEGA_STONE` sentinel (permamega - the form already carries the stats) and any empty item.
 */
export function showdownHeldItemKey(mon: ShowdownMonManifest): string | null {
  if (mon.item === MEGA_STONE_ITEM || mon.item === "") {
    return null;
  }
  return mon.item;
}

/**
 * PURE: map one showdown manifest mon to the {@linkcode CoopSerializedPokemon} identity blob that
 * {@linkcode buildCoopEnemy} consumes (species / form / level / ability / nature / shiny / variant /
 * IVs / moveset). Held items are NOT included (see the module header): they are granted to the live
 * enemy separately and then streamed by the authoritative capture. Engine-free so it is unit-testable
 * without a GameManager boot.
 */
export function manifestToSerializedMon(m: ShowdownMonManifest): CoopSerializedPokemon {
  return {
    speciesId: m.speciesId,
    // Megas sit in their mega formIndex already (permamega); buildCoopEnemy applies it verbatim.
    formIndex: m.formIndex,
    level: m.level,
    abilityIndex: m.abilityIndex,
    // nature is OPTIONAL on the manifest (showdown free nature); absent -> HARDY (0) deterministically.
    nature: m.nature ?? 0,
    shiny: m.shiny,
    variant: m.variant,
    ivs: [...m.ivs],
    moveset: [...m.moveset],
  };
}

/** PURE: map a whole opponent manifest to the identity blobs, in party order. */
export function manifestToSerializedParty(manifest: ShowdownMonManifest[]): CoopSerializedPokemon[] {
  return manifest.map(manifestToSerializedMon);
}
