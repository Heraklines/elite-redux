/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - STRENGTH-TIERED mega/primal stone rarity (mandate: "some megas
// are much stronger than others and need to be properly rare").
//
// Every obtainable mega/primal stone is scored to one of the game's five reward
// tiers (COMMON < GREAT < ULTRA < ROGUE < MASTER). The score is:
//   1. the BST of the mega FORM the stone triggers (the authoritative injected
//      form's own base stats, read live from the form-change registry), mapped
//      through MEGA_BST_THRESHOLDS; then
//   2. a hand-curated OVERRIDE (ER_MEGA_TIER_OVERRIDES) that WINS over BST, for
//      the "kit >> BST" megas (Kangaskhan/Maw ile/Medicham...) and the genuinely
//      elite class (box legendaries, primal orbs, the "-Z" ultra megas) that must
//      be MASTER-rare regardless of raw stats.
//
// The two knobs the maintainer edits to re-tune the whole economy live HERE and
// are the vetoable surface documented in docs/plans/2026-07-22-item-economy-
// tuning.md: MEGA_BST_THRESHOLDS (the bulk bands) and ER_MEGA_TIER_OVERRIDES
// (per-stone line items). TIER_GEN_WEIGHT sets how rare each tier is when it
// competes for a single roll.
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
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { randSeedInt } from "#utils/common";

/** BST -> default tier bands (inclusive upper bound). Edit to re-band in bulk. */
export const MEGA_BST_THRESHOLDS: ReadonlyArray<readonly [maxBst: number, tier: ModifierTier]> = [
  [470, ModifierTier.COMMON],
  [530, ModifierTier.GREAT],
  [590, ModifierTier.ULTRA],
  [660, ModifierTier.ROGUE],
  [Number.POSITIVE_INFINITY, ModifierTier.MASTER],
];

/**
 * Per-stone tier OVERRIDES (stone enum NAME -> tier). WINS over the BST band.
 * This is the hand-curated "kit quality" + "must-be-elite" list. Unknown names
 * are harmless no-ops, so over-listing is safe.
 *
 * Two intents:
 *   MASTER  - box legendaries, primal/creation orbs, and the "-Z / -X ultra"
 *             class the mandate calls out (Mega Xerneas / Yveltal / the Z megas):
 *             genuinely rare, masterball-tier.
 *   ROGUE   - "kit far exceeds BST" megas whose ability makes them run-defining
 *             even at a modest stat total (Parental Bond, Huge/Pure Power,
 *             Speed Boost, the classic top-of-format megas).
 */
export const ER_MEGA_TIER_OVERRIDES: Readonly<Record<string, ModifierTier>> = {
  // --- MASTER: box legendaries + creation/primal orbs -----------------------
  RED_ORB: ModifierTier.MASTER, // Primal Groudon
  BLUE_ORB: ModifierTier.MASTER, // Primal Kyogre
  GRISEOUS_ORB: ModifierTier.MASTER, // Giratina
  ADAMANT_ORB: ModifierTier.MASTER, // Dialga
  LUSTROUS_ORB: ModifierTier.MASTER, // Palkia
  GALACTIC_ORB: ModifierTier.MASTER,
  PLANETARY_ORB: ModifierTier.MASTER,
  EMBRYONIC_ORB: ModifierTier.MASTER,
  VICTINI_ORB: ModifierTier.MASTER,
  MEWTWONITE_X: ModifierTier.MASTER,
  MEWTWONITE_Y: ModifierTier.MASTER,
  XERNEASITE: ModifierTier.MASTER,
  YVELTALITE: ModifierTier.MASTER,
  ZYGARDITE: ModifierTier.MASTER,
  LATIASITE: ModifierTier.MASTER,
  LATIOSITE: ModifierTier.MASTER,
  DIANCITE: ModifierTier.MASTER,
  HEATRANITE: ModifierTier.MASTER,
  DARKRANITE: ModifierTier.MASTER,
  ZERAORITE: ModifierTier.MASTER,
  MAGEARNITE: ModifierTier.MASTER,
  CHIEN_PAOITE: ModifierTier.MASTER,
  ULTRANECROZIUM_P: ModifierTier.MASTER,
  PHANTOM_METEOR: ModifierTier.MASTER,
  // --- MASTER: the "-Z / ultra" super-mega class ----------------------------
  LUCARIONITE_Z: ModifierTier.MASTER,
  CHARIZARDITE_Z: ModifierTier.MASTER,
  GARCHOMPITE_Z: ModifierTier.MASTER,
  ABSOLITE_Z: ModifierTier.MASTER,
  DRAGONINITE_Z: ModifierTier.MASTER,
  SKARMORITE_Z: ModifierTier.MASTER,
  GYARADEATHITE_X: ModifierTier.MASTER,
  GYARADEATHITE_Y: ModifierTier.MASTER,
  KILOZUNITE: ModifierTier.MASTER,
  // --- ROGUE: kit >> BST (ability makes them elite regardless of stats) ------
  KANGASKHANITE: ModifierTier.ROGUE, // Parental Bond
  MAWILITE: ModifierTier.ROGUE, // Huge Power
  MEDICHAMITE: ModifierTier.ROGUE, // Pure Power
  BLAZIKENITE: ModifierTier.ROGUE, // Speed Boost
  GENGARITE: ModifierTier.ROGUE,
  LUCARIONITE: ModifierTier.ROGUE,
  METAGROSSITE: ModifierTier.ROGUE,
  GARCHOMPITE: ModifierTier.ROGUE,
  SALAMENCITE: ModifierTier.ROGUE, // Aerilate
  TYRANITARITE: ModifierTier.ROGUE,
  SCIZORITE: ModifierTier.ROGUE, // Technician
  GARDEVOIRITE: ModifierTier.ROGUE, // Pixilate
  LOPUNNITE: ModifierTier.ROGUE, // Scrappy + High Jump Kick
  GALLADITE: ModifierTier.ROGUE,
  AGGRONITE: ModifierTier.ROGUE, // Filter + 230 Def
};

/** Roll weight per tier for the WEIGHTED stone pick. Rarer tier = far lower. */
export const TIER_GEN_WEIGHT: Readonly<Record<ModifierTier, number>> = {
  [ModifierTier.COMMON]: 64,
  [ModifierTier.GREAT]: 32,
  [ModifierTier.ULTRA]: 12,
  [ModifierTier.ROGUE]: 4,
  [ModifierTier.MASTER]: 1,
  [ModifierTier.LUXURY]: 12,
};

/**
 * ABSOLUTE per-tier APPEARANCE RATE (0..1) - maintainer-editable, documented in
 * docs/plans/2026-07-22-item-economy-tuning.md.
 *
 * This is a DIFFERENT knob from TIER_GEN_WEIGHT. TIER_GEN_WEIGHT is the
 * COMPETITIVE weighting - it decides WHICH stone wins when several are eligible
 * (a MASTER stone almost never beats a COMMON one in the same pool). But when a
 * MASTER-tier mega is a party's ONLY mega-capable mon, its stone is the sole
 * candidate (weight-1-of-1) and the competitive pick returns it every time -
 * which made a genuinely-elite stone effectively GUARANTEED in any form-change
 * slot for a mono-elite party.
 *
 * This table is the fix: after the competitive pick chooses a stone, its tier is
 * rolled against an ABSOLUTE probability to decide whether the stone MATERIALIZES
 * AT ALL. A MASTER stone clears the gate ~2% of the time even as the sole
 * candidate, so it stays genuinely rare; a COMMON stone is near-certain. On a
 * gate MISS the form-change slot yields NOTHING (the reward roll re-rolls a
 * non-form-change item in-tier; the biome-shop slot is skipped; a mining dig
 * turns up nothing) - it never crashes an empty slot.
 *
 * Reachability is preserved: every rate is > 0, so a mono-elite party can still
 * obtain its stone - it is just genuinely rare, not gated out entirely.
 */
export const TIER_APPEARANCE_RATE: Readonly<Record<ModifierTier, number>> = {
  [ModifierTier.COMMON]: 1.0, // abundant filler: always materializes
  [ModifierTier.GREAT]: 0.72,
  [ModifierTier.ULTRA]: 0.4,
  [ModifierTier.ROGUE]: 0.12,
  [ModifierTier.MASTER]: 0.02, // box legendaries / primal orbs / "-Z" ultra megas: ~2%, genuinely rare
  [ModifierTier.LUXURY]: 0.4,
};

/** Fallback tier for a stone whose triggered form can't be resolved. */
const DEFAULT_UNKNOWN_TIER = ModifierTier.ULTRA;

function defaultTierForBst(bst: number): ModifierTier {
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
      const tier = override ?? defaultTierForBst(form.getBaseStatTotal());
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
 * Weighted pick of ONE stone from an eligible pool, biased HARD toward the
 * common tiers so a strong stone rarely wins when it competes. Runs off the
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
