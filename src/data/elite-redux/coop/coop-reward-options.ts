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
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopSerializedRewardOption } from "#data/elite-redux/coop/coop-transport";
import { ModifierTier } from "#enums/modifier-tier";
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
  const out = options.map(opt => {
    const type = opt.type;
    const pregenArgs = readPregenArgs(type);
    // Guaranteed/custom rewards can bypass the random-pool path that normally stamps `type.tier` (Lure in
    // the deterministic multiwave gate is one real example). Tier belongs to the immutable presentation
    // contract, so infer it from the registry or use the UI's canonical COMMON fallback—never put
    // `undefined` on the wire. Stamp the normalized tier back so owner rendering and reconstruction agree.
    const tier = type.getOrInferTier() ?? ModifierTier.COMMON;
    type.setTier(tier);
    return {
      id: type.id,
      tier,
      upgradeCount: opt.upgradeCount,
      cost: opt.cost,
      ...(pregenArgs === undefined ? {} : { pregenArgs }),
    };
  });
  // Per-shop-roll (not hot): the OWNER's authoritative option list crossing the wire.
  coopLog(
    "shop",
    `serializeRewardOptions count=${out.length} ids=[${out.map(o => o.id).join(",")}] tiers=[${out.map(o => o.tier).join(",")}]`,
  );
  return out;
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
  return;
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
      // Unknown registry id => the WATCHER falls back to its OWN roll (DIVERGENT pool). Surface it.
      coopWarn(
        "shop",
        `reconstructRewardOptions FAIL id=${s.id} (unknown registry key) -> watcher falls back to own roll`,
      );
      return null;
    }
    let type: ModifierType | null = func();
    if (type == null) {
      coopWarn(
        "shop",
        `reconstructRewardOptions FAIL id=${s.id} (factory returned null) -> watcher falls back to own roll`,
      );
      return null;
    }
    type.id = s.id;
    type.setTier(s.tier as ModifierTier);
    if (type instanceof ModifierTypeGenerator) {
      const generated = type.generateType(party, s.pregenArgs);
      if (generated == null) {
        coopWarn(
          "shop",
          `reconstructRewardOptions FAIL id=${s.id} (generator returned null, pregenArgs=[${s.pregenArgs?.join(",") ?? ""}]) -> watcher falls back to own roll`,
        );
        return null;
      }
      generated.id = s.id;
      generated.setTier(s.tier as ModifierTier);
      type = generated;
    }
    out.push(new ModifierTypeOptionCtor(type, s.upgradeCount, s.cost));
  }
  // Per-shop-roll (not hot): the WATCHER successfully rebuilt the owner's exact pool (no own RNG).
  coopLog("shop", `reconstructRewardOptions OK count=${out.length} ids=[${serialized.map(s => s.id).join(",")}]`);
  return out;
}
