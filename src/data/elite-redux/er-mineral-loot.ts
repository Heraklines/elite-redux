/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - shared "mineral / treasure" loot for the mining + delving press-your-
// luck events (Glittering Vein, Overgrown Temple). Money is paid per find by the
// host; THIS module builds the ITEM HAUL that the player cashes in as a reward
// shop when they finally bank (and loses if a party wipe ends the run first).
//
// Each find rolls (depth-weighted) a themed item: evolution stones, type-boost
// "gems / plates", vitamins, and TMs, with deeper finds favouring higher tiers.
// A RARE deep find turns up a MEGA STONE matching one of the player's lines -
// even a pre-evolution (a Charmeleon can still unearth Charizardite X). The haul
// accumulates on the host's `encounter.misc`, so it survives the continue-after-
// fight resume and only pays out (or is lost) when the loop ends.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import type { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { SpeciesFormKey } from "#enums/species-form-key";
import type { SpeciesId } from "#enums/species-id";
import {
  generateModifierTypeOption,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import type { CustomModifierSettings, ModifierTypeOption } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";

/** The two themed flavours: mining (stones/gems/vitamins) vs ruin relics (plates/TMs/evo). */
export type MineralFlavor = "mineral" | "relic";

/** The accumulating item haul, stashed on the host encounter's `misc`. */
export interface MineralLootHaul {
  /** Themed generator funcs (each draws one item of its kind at the shop). */
  funcs: ModifierTypeFunc[];
  /** Generic tier draws (used for ROGUE-tier "relics" with no themed pool). */
  tiers: ModifierTier[];
  /** Pre-genned options (the mega stone the player turned up). */
  options: ModifierTypeOption[];
  /** Guard so at most one mega stone is found per session. */
  megaFound: boolean;
}

export function emptyMineralHaul(): MineralLootHaul {
  return { funcs: [], tiers: [], options: [], megaFound: false };
}

/** Themed func pools per flavour and tier (COMMON/GREAT/ULTRA; ROGUE uses a tier draw). */
const POOLS: Record<MineralFlavor, Partial<Record<ModifierTier, ModifierTypeFunc[]>>> = {
  mineral: {
    [ModifierTier.COMMON]: [
      modifierTypes.EVOLUTION_ITEM,
      modifierTypes.ATTACK_TYPE_BOOSTER,
      modifierTypes.BASE_STAT_BOOSTER,
    ],
    [ModifierTier.GREAT]: [
      modifierTypes.RARE_EVOLUTION_ITEM,
      modifierTypes.ATTACK_TYPE_BOOSTER,
      modifierTypes.TM_GREAT,
    ],
    [ModifierTier.ULTRA]: [modifierTypes.RARE_EVOLUTION_ITEM, modifierTypes.TM_ULTRA],
  },
  relic: {
    [ModifierTier.COMMON]: [
      modifierTypes.ATTACK_TYPE_BOOSTER,
      modifierTypes.TM_COMMON,
      modifierTypes.BASE_STAT_BOOSTER,
    ],
    [ModifierTier.GREAT]: [modifierTypes.TM_GREAT, modifierTypes.EVOLUTION_ITEM, modifierTypes.ATTACK_TYPE_BOOSTER],
    [ModifierTier.ULTRA]: [modifierTypes.TM_ULTRA, modifierTypes.RARE_EVOLUTION_ITEM],
  },
};

/** Pick the item tier for a find at depth `d` (0-indexed). null = money-only this find. */
function rollFindTier(d: number): ModifierTier | null {
  const r = randSeedInt(100);
  if (d <= 1) {
    return r < 40 ? ModifierTier.COMMON : null;
  }
  if (d <= 3) {
    if (r < 25) {
      return ModifierTier.ULTRA;
    }
    if (r < 60) {
      return ModifierTier.GREAT;
    }
    if (r < 85) {
      return ModifierTier.COMMON;
    }
    return null;
  }
  // Deep finds: best odds, a real ROGUE chance.
  if (r < 12) {
    return ModifierTier.ROGUE;
  }
  if (r < 45) {
    return ModifierTier.ULTRA;
  }
  if (r < 80) {
    return ModifierTier.GREAT;
  }
  return ModifierTier.COMMON;
}

/**
 * Add one find's ITEM reward (if any) to the haul. Returns true if an item was
 * added (money-only finds return false). `d` is depth (0-indexed).
 */
export function rollMineralFind(haul: MineralLootHaul, d: number, flavor: MineralFlavor): boolean {
  const tier = rollFindTier(d);
  if (tier == null) {
    return false;
  }
  const pool = POOLS[flavor][tier];
  if (pool && pool.length > 0) {
    haul.funcs.push(randSeedItem(pool));
  } else {
    haul.tiers.push(tier); // ROGUE (or any unmapped tier) -> a generic tier draw
  }
  return true;
}

/** A species' full FORWARD evolution line (itself + every species it can evolve into). */
function evolutionLine(start: SpeciesId): SpeciesId[] {
  const seen = new Set<SpeciesId>([start]);
  const queue: SpeciesId[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const ev of pokemonEvolutions[cur] ?? []) {
      if (!seen.has(ev.speciesId)) {
        seen.add(ev.speciesId);
        queue.push(ev.speciesId);
      }
    }
  }
  return [...seen];
}

/** Every mega-stone FormChangeItem reachable from the party's lines (including pre-evos). */
function partyLineMegaStones(): FormChangeItem[] {
  const items = new Set<FormChangeItem>();
  for (const mon of globalScene.getPlayerParty()) {
    for (const sid of evolutionLine(mon.species.speciesId)) {
      for (const fc of pokemonFormChanges[sid] ?? []) {
        if (fc.formKey.indexOf(SpeciesFormKey.MEGA) === -1) {
          continue;
        }
        const trig = fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | undefined;
        if (trig?.item != null) {
          items.add(trig.item);
        }
      }
    }
  }
  return [...items];
}

/**
 * RARE deep roll for a MEGA STONE matching one of the party's lines - even a
 * pre-evolution (a Charmeleon can turn up Charizardite X). At most once per
 * session. Returns true if a stone was added to the haul.
 */
export function rollMegaStone(haul: MineralLootHaul, d: number, chancePct: number): boolean {
  if (haul.megaFound || d < 3 || randSeedInt(100) >= chancePct) {
    return false;
  }
  const stones = partyLineMegaStones();
  if (stones.length === 0) {
    return false;
  }
  const opt = generateModifierTypeOption(modifierTypes.FORM_CHANGE_ITEM, [randSeedItem(stones)]);
  if (!opt) {
    return false;
  }
  haul.options.push(opt);
  haul.megaFound = true;
  return true;
}

/** True if the haul holds any item reward (drives the prompt's "treasure" hint). */
export function mineralHaulHasItems(haul: MineralLootHaul): boolean {
  return haul.funcs.length > 0 || haul.tiers.length > 0 || haul.options.length > 0;
}

/**
 * Open the haul as a reward shop. Returns true if a shop was set (the host should
 * leave WITHOUT the safe/no-reward flag so doEncounterRewards fires); false if the
 * haul is empty (nothing to cash in).
 */
export function openMineralHaul(haul: MineralLootHaul): boolean {
  if (!mineralHaulHasItems(haul)) {
    return false;
  }
  const settings: CustomModifierSettings = { fillRemaining: false };
  if (haul.options.length > 0) {
    settings.guaranteedModifierTypeOptions = haul.options;
  }
  if (haul.funcs.length > 0) {
    settings.guaranteedModifierTypeFuncs = haul.funcs;
  }
  if (haul.tiers.length > 0) {
    settings.guaranteedModifierTiers = haul.tiers;
  }
  setEncounterRewards(settings);
  return true;
}
