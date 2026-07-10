/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `pre-switch-out-item-restore` archetype.
//
// PreSwitchOut hook that restores the holder's ORIGINAL held item on
// switch-out if it is currently holding none (stripped by Knock Off / Thief /
// Trick), plus un-marks any eaten berry so it reconstitutes on re-entry.
// Mirrors vanilla Harvest but on-switch instead of post-turn.
//
//   - The "original held item" is captured on every switch-IN by the paired
//     {@linkcode PostSummonRetrieverSnapshotAbAttr}; the switch-OUT hook then
//     re-grants a clone if the holder ends the turn empty-handed.
//   - PreSwitchOut does NOT fire on faint, so the dex's "must not have fainted"
//     clause is satisfied structurally (belt-and-braces guard kept anyway).
//
// Wires:
//   - 515 Retriever — "Retrieves its original held item on switch-out if it is
//     not currently holding one. Must not have fainted."
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr, PreSwitchOutAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";

/**
 * Per-mon snapshot of the held items a Retriever holder entered the battle
 * with. Captured on switch-in, consulted on switch-out. A `WeakMap` keeps the
 * association GC-safe (no leak when a Pokemon object is discarded) and avoids
 * bolting an ER-only field onto `summonData`.
 */
const retrieverOriginalHeldItems = new WeakMap<Pokemon, PokemonHeldItemModifier[]>();

/**
 * Snapshots the holder's current held items on switch-in so a later item loss
 * (Knock Off / Thief / Trick) can be undone by {@linkcode
 * PreSwitchOutItemRestoreAbAttr} on switch-out. Re-snapshotting each entry keeps
 * the recorded "original" in sync with what the holder is actually carrying.
 */
export class PostSummonRetrieverSnapshotAbAttr extends PostSummonAbAttr {
  constructor() {
    // No ability flash — this is bookkeeping, not an observable effect.
    super(false);
  }

  override apply({ pokemon }: AbAttrBaseParams): void {
    const held = pokemon.getHeldItems();
    if (held.length > 0) {
      retrieverOriginalHeldItems.set(
        pokemon,
        held.map(m => m.clone() as PokemonHeldItemModifier),
      );
    } else {
      retrieverOriginalHeldItems.delete(pokemon);
    }
  }
}

export class PreSwitchOutItemRestoreAbAttr extends PreSwitchOutAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    if (pokemon.isFainted()) {
      return false;
    }
    const ateBerry = (pokemon.summonData?.berriesEatenLast ?? []).length > 0;
    const canRestoreItem =
      pokemon.getHeldItems().length === 0 && (retrieverOriginalHeldItems.get(pokemon)?.length ?? 0) > 0;
    return ateBerry || canRestoreItem;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Clear the eaten-berry marker so the next entry treats berries as intact.
    // Pokerogue's persistence layer reconstitutes berries from the mon's
    // modifier list at battle start; clearing this marker is the ER-faithful
    // "you get it back on switch-out" effect.
    if (pokemon.summonData) {
      pokemon.summonData.berriesEatenLast = [];
    }

    // Re-grant the ORIGINAL held item(s) if the holder currently holds none
    // (an item removed by Knock Off / Thief / Trick). We add a fresh clone so
    // the pristine snapshot survives repeated strip/switch cycles.
    if (pokemon.getHeldItems().length === 0) {
      const originals = retrieverOriginalHeldItems.get(pokemon);
      if (originals && originals.length > 0) {
        for (const original of originals) {
          const restored = original.clone() as PokemonHeldItemModifier;
          restored.pokemonId = pokemon.id;
          globalScene.addModifier(restored, true);
        }
        globalScene.updateModifiers(pokemon.isPlayer());
      }
    }
  }
}
