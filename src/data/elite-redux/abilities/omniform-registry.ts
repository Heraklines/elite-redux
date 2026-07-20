/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Omniform shared registry + transform snapshot (low-level state).
//
// This module holds the two pieces of state BOTH the Omniform ability
// (`omniform.ts`) and the per-evolution moveset model (`omniform-movesets.ts`)
// need, so neither has to import the other (breaking the import cycle):
//   1. the (holder species/form) -> { moveType -> target } mapping registry, and
//   2. the per-holder pre-transform identity snapshot (captured once per battle).
//
// `omniform.ts` re-exports the public surface here for backward compatibility, so
// external callers keep importing from `#data/elite-redux/abilities/omniform`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";

/** A resolved transform target: a species and (optional) form index. */
export interface OmniformTarget {
  speciesId: SpeciesId;
  formIndex: number;
}

/** Registry key for a (species, form) pair. */
function identityKey(speciesId: number, formIndex: number): string {
  return `${speciesId}:${formIndex}`;
}

/**
 * The configurable registry: (holder species/form) -> (moveType -> target).
 * Empty in production until the newcomer species init populates it. Exposed only
 * through the register/clear helpers so callers can't hold a mutable reference.
 */
const OMNIFORM_REGISTRY = new Map<string, Map<PokemonType, OmniformTarget>>();

/**
 * Permanent candy-unlock owner for each Omniform family identity. Unlike the
 * per-battle original snapshot below, this also covers a family member loaded
 * or instantiated directly (for example a saved Partner Eeveelution).
 */
const OMNIFORM_UNLOCK_OWNERS = new Map<string, OmniformTarget>();

/**
 * Register a mapping: a holder in form `(fromSpeciesId, fromFormIndex)` using a
 * move of type `moveType` transforms into `(toSpeciesId, toFormIndex)`.
 */
export function registerOmniformMapping(
  fromSpeciesId: SpeciesId,
  fromFormIndex: number,
  moveType: PokemonType,
  toSpeciesId: SpeciesId,
  toFormIndex = 0,
): void {
  const key = identityKey(fromSpeciesId, fromFormIndex);
  let byType = OMNIFORM_REGISTRY.get(key);
  if (!byType) {
    byType = new Map();
    OMNIFORM_REGISTRY.set(key, byType);
  }
  byType.set(moveType, { speciesId: toSpeciesId, formIndex: toFormIndex });
}

/**
 * Register the stable candy-unlock owner for an Omniform family member.
 * Multiple members may point to the same owner identity.
 */
export function registerOmniformUnlockOwner(
  memberSpeciesId: SpeciesId,
  memberFormIndex: number,
  ownerSpeciesId: SpeciesId,
  ownerFormIndex: number,
): void {
  OMNIFORM_UNLOCK_OWNERS.set(identityKey(memberSpeciesId, memberFormIndex), {
    speciesId: ownerSpeciesId,
    formIndex: ownerFormIndex,
  });
}

/** The stable candy-unlock owner for an Omniform identity, when registered. */
export function resolveOmniformUnlockOwnerIdentity(speciesId: number, formIndex: number): OmniformTarget | undefined {
  return OMNIFORM_UNLOCK_OWNERS.get(identityKey(speciesId, formIndex));
}

/** Remove every registered mapping and unlock owner (test isolation). */
export function clearOmniformRegistry(): void {
  OMNIFORM_REGISTRY.clear();
  OMNIFORM_UNLOCK_OWNERS.clear();
}

/** The mapped target for `pokemon`'s CURRENT form and `moveType`, or `undefined`. */
export function lookupOmniformTarget(pokemon: Pokemon, moveType: PokemonType): OmniformTarget | undefined {
  const sf = pokemon.getSpeciesForm();
  return OMNIFORM_REGISTRY.get(identityKey(sf.speciesId, sf.formIndex))?.get(moveType);
}

/** Whether `(speciesId, formIndex)` is a registered Omniform HOLDER (has at least one mapping). */
export function erOmniformIsHolderIdentity(speciesId: number, formIndex: number): boolean {
  return OMNIFORM_REGISTRY.has(identityKey(speciesId, formIndex));
}

/**
 * The ORDERED set of forms in `(speciesId, formIndex)`'s Omniform "family": the base
 * identity itself, followed by the transitive closure of every form reachable through
 * its type mappings (deduped, discovery order). For a non-holder identity the result is
 * just `[{speciesId, formIndex}]` (length 1). This is the generic "all evolutions of a
 * multi-form / Omniform mon" list every per-evolution moveset consumer iterates.
 */
export function erOmniformFamilyForms(speciesId: number, formIndex: number): OmniformTarget[] {
  const seen = new Set<string>();
  const out: OmniformTarget[] = [];
  const queue: OmniformTarget[] = [{ speciesId: speciesId as SpeciesId, formIndex }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = identityKey(cur.speciesId, cur.formIndex);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cur);
    const byType = OMNIFORM_REGISTRY.get(key);
    if (byType) {
      for (const target of byType.values()) {
        if (!seen.has(identityKey(target.speciesId, target.formIndex))) {
          queue.push({ speciesId: target.speciesId, formIndex: target.formIndex });
        }
      }
    }
  }
  return out;
}

/**
 * The UNDIRECTED connected component of `(speciesId, formIndex)` in the Omniform
 * registry: every form reachable by following mappings in EITHER direction (forward
 * targets AND holders that map INTO a reachable form). Unlike
 * {@linkcode erOmniformFamilyForms} (a directed forward closure, base-first, used for
 * the ORDERED evolution list), this resolves the WHOLE family from ANY member — a
 * partner eeveelution reaches the Partner Eevee head even though no mapping points
 * back to it. The pooled level-up learn union needs this so every family member
 * (queried by its own form) sees the same complete pool. Order is not significant.
 */
export function erOmniformConnectedForms(speciesId: number, formIndex: number): OmniformTarget[] {
  const seen = new Set<string>();
  const out: OmniformTarget[] = [];
  const queue: OmniformTarget[] = [{ speciesId: speciesId as SpeciesId, formIndex }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = identityKey(cur.speciesId, cur.formIndex);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cur);
    // Forward edges: cur's own transform targets.
    const byType = OMNIFORM_REGISTRY.get(key);
    if (byType) {
      for (const target of byType.values()) {
        if (!seen.has(identityKey(target.speciesId, target.formIndex))) {
          queue.push({ speciesId: target.speciesId, formIndex: target.formIndex });
        }
      }
    }
    // Reverse edges: any holder that maps INTO cur (so an eeveelution reaches the head).
    for (const [holderKey, holderMap] of OMNIFORM_REGISTRY.entries()) {
      if (seen.has(holderKey)) {
        continue;
      }
      for (const target of holderMap.values()) {
        if (identityKey(target.speciesId, target.formIndex) === key) {
          const [sid, fidx] = holderKey.split(":").map(Number);
          queue.push({ speciesId: sid as SpeciesId, formIndex: fidx });
          break;
        }
      }
    }
  }
  return out;
}

/** The holder's pre-transform identity, snapshotted on its FIRST transform in a battle. */
interface OmniformOriginal {
  wave: number;
  species: PokemonSpecies;
  formIndex: number;
}

const OMNIFORM_ORIGINAL = new WeakMap<Pokemon, OmniformOriginal>();

/**
 * Snapshot the holder's pre-battle species/form on its FIRST transform and NOT
 * again until the entry is cleared on `leaveField` (switch-out / faint / wave end).
 *
 * The snapshot MUST be captured once per BATTLE, not once per wave: a chained
 * transform (Eevee -> Jolteon -> Umbreon) whose links land on different wave
 * indices would, under a per-wave guard, re-snapshot the INTERMEDIATE form
 * (Jolteon) as the "original" and revert there instead of all the way back to
 * Eevee. Guarding purely on presence captures the true pre-battle identity once
 * and preserves it across the whole chain; the leaveField revert deletes the entry
 * when the holder leaves the field, so the next battle re-snapshots from base.
 */
export function snapshotOmniformOriginal(user: Pokemon): void {
  if (!OMNIFORM_ORIGINAL.has(user)) {
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    OMNIFORM_ORIGINAL.set(user, { wave, species: user.species, formIndex: user.formIndex });
  }
}

/**
 * The holder's PRE-TRANSFORM (source) species, or `undefined` if it has not
 * Omniform-transformed this battle. Used by the innate-unlock gate so a
 * transformed holder reads its innate candy-unlock state from the SOURCE species
 * (e.g. Partner Eevee) instead of the transform TARGET species (a partner
 * eeveelution, id 70012+), which the player never candy-unlocked.
 */
export function erOmniformOriginalSpecies(holder: Pokemon): PokemonSpecies | undefined {
  return OMNIFORM_ORIGINAL.get(holder)?.species;
}

/**
 * The holder's PRE-TRANSFORM (source) identity — species id + form index — or
 * `undefined` if it has not Omniform-transformed this battle. The per-evolution
 * moveset model reads this to anchor a transformed holder's persistent "base" form
 * (e.g. Partner Eevee) instead of the transient transform target it is wearing.
 */
export function erOmniformOriginalIdentity(holder: Pokemon): { speciesId: SpeciesId; formIndex: number } | undefined {
  const original = OMNIFORM_ORIGINAL.get(holder);
  return original ? { speciesId: original.species.speciesId, formIndex: original.formIndex } : undefined;
}

/** The raw pre-transform snapshot for `holder` (species + form + wave), or `undefined`. */
export function getOmniformOriginal(holder: Pokemon): { species: PokemonSpecies; formIndex: number } | undefined {
  return OMNIFORM_ORIGINAL.get(holder);
}

/** Drop `holder`'s pre-transform snapshot (on revert / leaveField). Returns whether one existed. */
export function deleteOmniformOriginal(holder: Pokemon): boolean {
  return OMNIFORM_ORIGINAL.delete(holder);
}
