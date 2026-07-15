/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — reusable TYPE-GRAFT substrate (Batch 4).
//
// Extends the Batch-2 N-type substrate (`summonData.types` wholesale override +
// battle-info rendering every `getTypes()` icon) with a mechanism to graft
// EXTRA types onto ANY Pokemon that STACK on top of its existing types (base +
// `summonData.types` + the single `summonData.addedType`). Where vanilla only
// exposes ONE extra slot (`addedType`, Forest's Curse / Trick-or-Treat), this
// allows an arbitrary SET of additional types — needed by:
//   - Draconic Voodoo (5930): grafts Dragon onto opponents (one type, but must
//     persist through the target switching OUT, which `summonData.addedType`
//     does not — summonData resets on switch).
//   - Bad Splice (5932): grafts a whole OTHER party member's type set (up to 2).
//
// Persistence model (DEFAULT, documented): grafts are BATTLE (wave) scoped and
// keyed by the Pokemon INSTANCE, so they survive a switch-out/switch-in within
// the same wave (the party Pokemon object is retained) but auto-expire the
// moment the wave index advances. No external teardown hook is needed — the
// wave stamp on each record is compared against `currentBattle.waveIndex` on
// every read, and a stale record is discarded. Explicit removal
// (`ungraftType` / `clearGrafts`) is used when an effect ends mid-wave (Bad
// Splice removing its splice when the holder leaves the field).
//
// The live grafted types are folded into `Pokemon.getTypes()` (after the
// `addedType` check) so effectiveness, STAB, immunity checks and the N-type
// battle-info renderer all pick them up automatically.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";

/** A per-holder graft record, stamped with the wave it belongs to. */
interface GraftRecord {
  wave: number;
  types: Set<PokemonType>;
}

const GRAFTS = new WeakMap<Pokemon, GraftRecord>();

/** The current battle's wave index (0 when there is no active battle). */
function currentWave(): number {
  return globalScene.currentBattle?.waveIndex ?? 0;
}

/**
 * The live graft record for `pokemon` in the CURRENT wave, or `undefined`. A
 * record stamped with an earlier wave is treated as expired (and discarded).
 */
function liveRecord(pokemon: Pokemon): GraftRecord | undefined {
  const record = GRAFTS.get(pokemon);
  if (!record) {
    return;
  }
  if (record.wave !== currentWave()) {
    GRAFTS.delete(pokemon);
    return;
  }
  return record;
}

/** Ensure a live (current-wave) graft record exists for `pokemon`, resetting a stale one. */
function ensureRecord(pokemon: Pokemon): GraftRecord {
  const record = GRAFTS.get(pokemon);
  const wave = currentWave();
  if (!record || record.wave !== wave) {
    const fresh: GraftRecord = { wave, types: new Set() };
    GRAFTS.set(pokemon, fresh);
    return fresh;
  }
  return record;
}

/**
 * Graft `type` onto `pokemon` as an ADDITIONAL type for the rest of the wave.
 * No-op when the type is already present in the graft set. Returns `true` when
 * a new type was actually added (so callers can gate their entry message).
 */
export function graftType(pokemon: Pokemon, type: PokemonType): boolean {
  const record = ensureRecord(pokemon);
  if (record.types.has(type)) {
    return false;
  }
  record.types.add(type);
  pokemon.updateInfo();
  return true;
}

/**
 * Graft several `types` at once (skipping any the holder does not need). Returns
 * the subset that was newly added.
 */
export function graftTypes(pokemon: Pokemon, types: readonly PokemonType[]): PokemonType[] {
  const added: PokemonType[] = [];
  for (const type of types) {
    if (graftType(pokemon, type)) {
      added.push(type);
    }
  }
  return added;
}

/** The types currently grafted onto `pokemon` (empty when none / expired). */
export function getGraftedTypes(pokemon: Pokemon): PokemonType[] {
  const record = liveRecord(pokemon);
  return record ? [...record.types] : [];
}

/** Whether `pokemon` currently carries `type` as a grafted (not native) type. */
export function hasGraftedType(pokemon: Pokemon, type: PokemonType): boolean {
  return liveRecord(pokemon)?.types.has(type) ?? false;
}

/** Remove a single grafted `type` from `pokemon` (idempotent). */
export function ungraftType(pokemon: Pokemon, type: PokemonType): void {
  const record = liveRecord(pokemon);
  if (record?.types.delete(type)) {
    pokemon.updateInfo();
  }
}

/** Remove ALL grafts from `pokemon`, restoring its exact prior typing (idempotent). */
export function clearGrafts(pokemon: Pokemon): void {
  if (GRAFTS.delete(pokemon)) {
    pokemon.updateInfo();
  }
}
