/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - STRENGTH-TIERED mega/primal stone rarity (mandate: "some megas
// are much stronger than others and need to be properly rare").
//
// Every obtainable mega/primal stone is scored from the BST of the FORM the
// stone triggers (the authoritative injected form's own base stats, read live
// from the form-change registry). Mega stones intentionally use only the three
// high reward tiers: <650 ULTRA, 650-700 ROGUE, >700 MASTER.
//
// The two knobs the maintainer edits to re-tune the whole economy live HERE and
// are the vetoable surface documented in docs/plans/2026-07-22-item-economy-
// tuning.md: MEGA_BST_THRESHOLDS. TIER_GEN_WEIGHT sets how rare each tier is
// when it competes for a single roll.
//
// The tier drives THREE circulation channels consistently:
//   - reward-roll selection (FormChangeItemModifierTypeGenerator): a weighted
//     pick, so when several stones are eligible the strong ones almost never win.
//   - biome-shop price + stock (getPlayerShopModifierTypeOptionsForWave): a
//     MASTER stone prices at the masterball-tier factor and stocks 1, a COMMON
//     stone is cheap and plentiful.
//   - mystery-encounter / mining loot (rollMegaStone): the same weighted pick,
//     so a masterball-tier stone is a very-low-chance find.
//
// Reachability is NEVER broken: every stone keeps a non-zero gen weight, so a
// party built around one elite mega can still obtain its stone - it is just rare
// and expensive, not gated out.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { resolveErStoneFormChangeItem } from "#data/elite-redux/er-mega-stones";
import {
  ER_FORM_CHANGE_KIND,
  ER_FORM_CHANGE_REGISTRY,
} from "#data/elite-redux/init-elite-redux-form-changes";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { randSeedInt } from "#utils/common";

/** BST -> default tier bands (inclusive upper bound). Edit to re-band in bulk. */
export const MEGA_BST_THRESHOLDS: ReadonlyArray<readonly [maxBst: number, tier: ModifierTier]> = [
  [649, ModifierTier.ULTRA],
  [700, ModifierTier.ROGUE],
  [Number.POSITIVE_INFINITY, ModifierTier.MASTER],
];

/**
 * Exceptional per-stone overrides. The normal table is deliberately empty:
 * rarity is BST-driven, so a sub-650 mega cannot silently become Rogue/Master
 * because of a hand-curated kit judgement. Kept as an explicit extension seam
 * for a genuinely non-BST form-change item whose triggered form cannot resolve.
 */
export const ER_MEGA_TIER_OVERRIDES: Readonly<Record<string, ModifierTier>> = {};

/** Roll weight per tier for the weighted stone pick. Stronger tiers remain rarer without being vanishingly rare. */
export const TIER_GEN_WEIGHT: Readonly<Record<ModifierTier, number>> = {
  [ModifierTier.COMMON]: 12,
  [ModifierTier.GREAT]: 10,
  [ModifierTier.ULTRA]: 8,
  [ModifierTier.ROGUE]: 6,
  [ModifierTier.MASTER]: 4,
  [ModifierTier.LUXURY]: 8,
};

/**
 * ABSOLUTE per-tier APPEARANCE RATE (0..1) - maintainer-editable, documented in
 * docs/plans/2026-07-22-item-economy-tuning.md.
 *
 * This is a DIFFERENT knob from TIER_GEN_WEIGHT. TIER_GEN_WEIGHT is the
 * COMPETITIVE weighting - it decides WHICH stone wins when several are eligible
 * (a MASTER stone is less likely than a COMMON one in the same pool). But when a
 * MASTER-tier mega is a party's ONLY mega-capable mon, its stone is the sole
 * candidate (weight-1-of-1) and the competitive pick returns it every time -
 * which made a genuinely-elite stone effectively GUARANTEED in any form-change
 * slot for a mono-elite party.
 *
 * This table is the fix: after the competitive pick chooses a stone, its tier is
 * rolled against an ABSOLUTE probability to decide whether the stone MATERIALIZES
 * AT ALL. A MASTER stone clears the gate 40% of the time even as the sole
 * candidate, so it stays special without making a mega build impractical. On a
 * gate MISS the random reward roll re-rolls a non-form-change item in-tier and a
 * mining dig turns up nothing. Biome shops intentionally do not use this gate.
 *
 * Reachability is preserved: every rate is > 0, so a mono-elite party can still
 * obtain its stone - it is rarer, not gated out entirely.
 */
export const TIER_APPEARANCE_RATE: Readonly<Record<ModifierTier, number>> = {
  [ModifierTier.COMMON]: 1.0, // abundant filler: always materializes
  [ModifierTier.GREAT]: 0.95,
  [ModifierTier.ULTRA]: 0.85,
  [ModifierTier.ROGUE]: 0.65,
  [ModifierTier.MASTER]: 0.4,
  [ModifierTier.LUXURY]: 0.85,
};

/** Fallback tier for a stone whose triggered form can't be resolved. */
const DEFAULT_UNKNOWN_TIER = ModifierTier.ULTRA;

export function megaTierForBst(bst: number): ModifierTier {
  for (const [maxBst, tier] of MEGA_BST_THRESHOLDS) {
    if (bst <= maxBst) {
      return tier;
    }
  }
  return ModifierTier.MASTER;
}

/**
 * Lazily-built stone -> tier table. Computed from the fully-initialized
 * form-change registry (post ER init), so it is populated on first use at
 * reward/shop time. Cached for the run.
 */
let tierTable: Map<FormChangeItem, ModifierTier> | null = null;

function buildTierTable(): Map<FormChangeItem, ModifierTier> {
  const table = new Map<FormChangeItem, ModifierTier>();
  const speciesById = new Map(allSpecies.map(species => [species.speciesId as number, species]));

  // ER-only megas are separate target species, so their authoritative BST lives
  // on ER_FORM_CHANGE_REGISTRY.targetSpeciesId rather than a source-species form.
  for (const change of ER_FORM_CHANGE_REGISTRY) {
    if (change.kind !== ER_FORM_CHANGE_KIND.MEGA && change.kind !== ER_FORM_CHANGE_KIND.PRIMAL) {
      continue;
    }
    const item = resolveErStoneFormChangeItem(change.requirement);
    const target = speciesById.get(change.targetSpeciesId);
    if (item == null || item === FormChangeItem.NONE || !target) {
      continue;
    }
    const tier = megaTierForBst(target.getBaseStatTotal());
    const existing = table.get(item);
    if (existing === undefined || tier > existing) {
      table.set(item, tier);
    }
  }

  // Vanilla/form-backed megas keep their BST on the source species' form.
  for (const species of allSpecies) {
    const changes = pokemonFormChanges[species.speciesId];
    if (!changes) {
      continue;
    }
    for (const fc of changes) {
      const trigger = fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | undefined;
      const item = trigger?.item;
      if (item == null || item === FormChangeItem.NONE) {
        continue;
      }
      const form = species.forms.find(f => f.formKey === fc.formKey);
      if (!form) {
        continue;
      }
      const override = ER_MEGA_TIER_OVERRIDES[FormChangeItem[item]];
      const tier = override ?? megaTierForBst(form.getBaseStatTotal());
      const existing = table.get(item);
      // Keep the STRONGEST classification if a stone maps to several forms.
      if (existing === undefined || tier > existing) {
        table.set(item, tier);
      }
    }
  }
  return table;
}

/** Force a rebuild (tests that mutate overrides / the registry). */
export function resetErMegaTierCache(): void {
  tierTable = null;
}

/** The reward tier for a mega/primal stone (COMMON..MASTER). */
export function erMegaStoneTier(item: FormChangeItem): ModifierTier {
  if (tierTable === null) {
    tierTable = buildTierTable();
  }
  const overriddenByName = ER_MEGA_TIER_OVERRIDES[FormChangeItem[item]];
  return overriddenByName ?? tierTable.get(item) ?? DEFAULT_UNKNOWN_TIER;
}

/** The roll weight for a mega/primal stone (rarer stones weigh far less). */
export function erMegaStoneGenWeight(item: FormChangeItem): number {
  return TIER_GEN_WEIGHT[erMegaStoneTier(item)] ?? TIER_GEN_WEIGHT[ModifierTier.ULTRA];
}

/**
 * Weighted pick of ONE stone from an eligible pool, moderately biased toward the
 * common tiers so strength still matters without overwhelming party composition. Runs off the
 * seeded RNG (`randSeedInt`), so callers already inside `executeWithSeedOffset`
 * stay deterministic. Every stone has weight >= 1, so reachability holds.
 */
export function pickErMegaStoneWeighted(items: readonly FormChangeItem[]): FormChangeItem {
  if (items.length === 1) {
    return items[0];
  }
  const weights = items.map(erMegaStoneGenWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return items[randSeedInt(items.length)];
  }
  let roll = randSeedInt(total);
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll < 0) {
      return items[i];
    }
  }
  return items[items.length - 1];
}

/** The absolute appearance rate (0..1) for a stone, by its strength tier. */
export function erMegaStoneAppearanceRate(item: FormChangeItem): number {
  return TIER_APPEARANCE_RATE[erMegaStoneTier(item)] ?? TIER_APPEARANCE_RATE[ModifierTier.ULTRA];
}

/**
 * The ABSOLUTE appearance gate, applied AFTER the competitive pick has chosen a
 * stone: roll the stone's tier against its `TIER_APPEARANCE_RATE`. Returns true
 * when the stone should MATERIALIZE, false when the form-change slot should yield
 * nothing this roll.
 *
 * This is independent of pool competition, so a MASTER stone stays genuinely rare
 * even when it is a party's ONLY eligible stone (weight-1-of-1 in the competitive
 * pick). Runs off the seeded RNG (`randSeedInt`), so callers already inside
 * `executeWithSeedOffset` stay deterministic (biome-shop parity across the reward
 * phase and the UI handler). Every rate is > 0, so reachability holds.
 */
export function erMegaStoneAppearsAtGate(item: FormChangeItem): boolean {
  const rate = erMegaStoneAppearanceRate(item);
  if (rate >= 1) {
    return true; // near-certain tiers short-circuit (no RNG draw, no cursor shift)
  }
  if (rate <= 0) {
    return false;
  }
  return randSeedInt(10000) < Math.round(rate * 10000);
}
