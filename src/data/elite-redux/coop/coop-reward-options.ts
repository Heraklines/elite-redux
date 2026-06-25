/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op reward-option (host-streamed) serialize / reconstruct (#633 Fix #2).
//
// The reward shop's option pool is rolled PER CLIENT (select-modifier-phase.start()),
// and party LUCK changes the NUMBER of seeded upgrade draws consumed when rolling it
// (modifier-type.ts getNewModifierTypeOption). Two clients with different party luck
// therefore (a) could roll a different pool and (b) - worse - leave the shared RNG
// cursor at different positions, poisoning every roll after the first shop.
//
// Fix: the OWNER rolls once and STREAMS its resolved option list; the WATCHER rebuilds
// these exact options instead of re-rolling, consuming NO luck-dependent RNG. This file
// is the engine-coupled (de)serializer - it imports the modifier registry + types - kept
// out of the engine-free relay so that layer stays the lowest, like CoopBattleStreamer.
// =============================================================================

import { modifierTypes } from "#data/data-lists";
import type { CoopSerializedRewardOption } from "#data/elite-redux/coop/coop-transport";
import type { ModifierTier } from "#enums/modifier-tier";
import type { Pokemon } from "#field/pokemon";
import type { ModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { ModifierTypeGenerator, ModifierTypeOption as ModifierTypeOptionCtor } from "#modifiers/modifier-type";

/**
 * OWNER: serialize a rolled reward-option list for the wire. Captures each option's
 * registry id + resolved tier + upgrade count + cost, plus a generator type's pregen
 * args (the concrete TM move / form item / ...) so a generated option round-trips
 * without re-rolling. Options whose type has no stable `id` are dropped (the watcher
 * falls back to its own roll for the whole list if ANY is missing - see the phase).
 */
export function serializeRewardOptions(options: ModifierTypeOption[]): CoopSerializedRewardOption[] {
  return options.map(opt => {
    const type = opt.type;
    const pregenArgs = readPregenArgs(type);
    return {
      id: type.id,
      tier: type.tier,
      upgradeCount: opt.upgradeCount,
      cost: opt.cost,
      ...(pregenArgs === undefined ? {} : { pregenArgs }),
    };
  });
}

/** Read a generated type's pregen args, or undefined for a non-generated type. */
function readPregenArgs(type: ModifierType): number[] | undefined {
  if ("getPregenArgs" in type && typeof (type as { getPregenArgs: unknown }).getPregenArgs === "function") {
    const args = (type as unknown as { getPregenArgs(): unknown[] }).getPregenArgs();
    // Pregen args for the reward pool are numeric ids (move id / form index / ...); keep
    // only numbers so the wire shape stays plain + the reconstruct path is type-safe.
    const nums = args.filter((a): a is number => typeof a === "number");
    return nums.length > 0 ? nums : undefined;
  }
  return undefined;
}

/**
 * WATCHER: rebuild the owner's exact reward options. Returns null if ANY option can't be
 * reconstructed (unknown id / generator returned nothing), so the caller can fall back to
 * its own locally-rolled list rather than render a partial/wrong screen. `party` is the
 * watcher's player party (generators may read it, but the result is pinned by pregenArgs).
 */
export function reconstructRewardOptions(
  serialized: CoopSerializedRewardOption[],
  party: Pokemon[],
): ModifierTypeOption[] | null {
  const out: ModifierTypeOption[] = [];
  for (const s of serialized) {
    const func = modifierTypes[s.id];
    if (func == null) {
      return null;
    }
    let type: ModifierType | null = func();
    if (type == null) {
      return null;
    }
    type.id = s.id;
    type.setTier(s.tier as ModifierTier);
    if (type instanceof ModifierTypeGenerator) {
      const generated = type.generateType(party, s.pregenArgs);
      if (generated == null) {
        return null;
      }
      generated.id = s.id;
      generated.setTier(s.tier as ModifierTier);
      type = generated;
    }
    out.push(new ModifierTypeOptionCtor(type, s.upgradeCount, s.cost));
  }
  return out;
}
