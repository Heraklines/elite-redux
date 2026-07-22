/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - shared "mineral / treasure" loot for the mining + delving press-your-
// luck events (Glittering Vein, Overgrown Temple). Money is paid per find by the
// host using rollMineralMoney(); THIS module also builds the ITEM HAUL that the
// player cashes in as a reward shop when they finally bank (and loses if a party
// wipe ends the run first).
//
// The item pool is deliberately TINY and reads as something you'd dig out of
// stone:
//   - EVIOLITE and MYSTICAL ROCK are the regular item finds (an uncommon bonus
//     on a deeper strike).
//   - KING'S ROCK is a RARE find, about as rare as the mega stone (a deep, low-%
//     roll of its own).
//   - A RARE deep find still turns up a MEGA STONE matching one of the player's
//     lines, even a pre-evolution (a Charmeleon can unearth Charizardite X).
// Everything else (lenses, orbs, plates, claws, vitamins, evo stones, TMs) is
// gone - none of it reads as buried treasure.
//
// Money itself varies per strike: most strikes pay a jittered amount, a small
// chance turns up nothing (a dud), and a small chance strikes a NUGGET (a big
// payout). The haul accumulates on the host's `encounter.misc`, so it survives
// the continue-after-fight resume and only pays out (or is lost) when the loop
// ends.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { ER_RESIST_BERRY_BY_TYPE, erResistBerryModifierType } from "#data/elite-redux/er-resist-berries";
import { erMegaStoneTier, pickErMegaStoneWeighted } from "#data/elite-redux/er-mega-tiers";
import { type ErWardStoneTier, erWardStoneModifierType } from "#data/elite-redux/er-ward-stones";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import type { FormChangeItem } from "#enums/form-change-item";
import { SpeciesFormKey } from "#enums/species-form-key";
import type { SpeciesId } from "#enums/species-id";
import {
  generateModifierTypeOption,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import { type CustomModifierSettings, ModifierTypeOption } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt, randSeedItem } from "#utils/common";

/** The two themed flavours: mining a cave seam vs prying relics from a ruin. */
export type MineralFlavor = "mineral" | "relic";

/** The accumulating item haul, stashed on the host encounter's `misc`. */
export interface MineralLootHaul {
  /** Themed generator funcs (each draws one found item at the shop). */
  funcs: ModifierTypeFunc[];
  /** Pre-genned options (the mega stone the player turned up). */
  options: ModifierTypeOption[];
  /** Guard so at most one mega stone is found per session. */
  megaFound: boolean;
}

export function emptyMineralHaul(): MineralLootHaul {
  return { funcs: [], options: [], megaFound: false };
}

// --- Money ----------------------------------------------------------------- //

/** % chance a strike turns up nothing (a dud). Kept low so a dive rarely feels empty. */
const DUD_CHANCE = 6;
/** % chance a strike turns up a nugget (a big payout). */
const NUGGET_CHANCE = 8;
/** A nugget pays roughly this multiple of the strike's base value. */
const NUGGET_MULT = 5;

/** The outcome of a single money strike. */
export interface MoneyRoll {
  /** Money to pay for this strike (0 on a dud). */
  amount: number;
  /** What kind of strike it was, for the flavour message. */
  kind: "dud" | "ore" | "nugget";
}

/**
 * Roll the money for one strike worth `base`. Most strikes pay `base` jittered
 * +/-25%; a small chance turns up NOTHING (a dud), and a small chance strikes a
 * NUGGET worth ~{@linkcode NUGGET_MULT}x base. The find is treated like a
 * great-tier reward, so a dud is a real (if uncommon) outcome.
 */
export function rollMineralMoney(base: number): MoneyRoll {
  const r = randSeedInt(100);
  if (r < DUD_CHANCE) {
    return { amount: 0, kind: "dud" };
  }
  if (r < DUD_CHANCE + NUGGET_CHANCE) {
    // 85%-115% of the full nugget value.
    return { amount: Math.round(base * NUGGET_MULT * (0.85 + randSeedInt(31) / 100)), kind: "nugget" };
  }
  // Normal ore: 75%-125% of base.
  return { amount: Math.round(base * (0.75 + randSeedInt(51) / 100)), kind: "ore" };
}

// --- Items ----------------------------------------------------------------- //

/**
 * The regular item finds (an uncommon bonus on a deeper strike). Built lazily at
 * call time: `modifierTypes` is an empty object until initModifierTypes() runs, so
 * capturing these at module-eval time could freeze in `undefined` references.
 */
function itemPool(): ModifierTypeFunc[] {
  return [modifierTypes.EVIOLITE, modifierTypes.MYSTICAL_ROCK];
}

/** Percent chance per deep strike to turn up a KING'S ROCK (an uncommon deep find). */
const KINGS_ROCK_CHANCE = 7;

/**
 * Percent chance that a strike at depth `d` (0-indexed) also turns up one of the
 * regular items (Eviolite / Mystical Rock). Only the very first strike is money-
 * only; from the second strike on a curio is a real, climbing possibility - the
 * old gate (nothing before depth 2, then 14%) was so stingy that, against the
 * fast-climbing bust curve, most runs busted out before ever seeing an item.
 */
function itemFindChance(d: number): number {
  // Probabilistic from the FIRST strike (d=0) - no hard-zero gate, so a find can
  // genuinely happen right away rather than feeling pre-scripted.
  if (d <= 0) {
    return 14;
  }
  if (d === 1) {
    return 24;
  }
  if (d === 2) {
    return 36;
  }
  if (d === 3) {
    return 46;
  }
  return 55;
}

/**
 * Add one strike's regular ITEM reward (if any) to the haul. Returns true if an
 * item was added. `d` is depth (0-indexed).
 */
export function rollMineralFind(haul: MineralLootHaul, d: number, _flavor: MineralFlavor): boolean {
  if (randSeedInt(100) >= itemFindChance(d)) {
    return false;
  }
  haul.funcs.push(randSeedItem(itemPool()));
  return true;
}

/**
 * RARE deep roll for a KING'S ROCK - about as rare as the mega stone. Returns
 * true if one was added. `d` is depth (0-indexed).
 */
export function rollKingsRock(haul: MineralLootHaul, d: number): boolean {
  if (d < 3 || randSeedInt(100) >= KINGS_ROCK_CHANCE) {
    return false;
  }
  haul.funcs.push(modifierTypes.KINGS_ROCK);
  return true;
}

/** Percent chance per strike (from depth 1) to chip a raw elemental GEM from the seam. */
const GEM_CHANCE = 12;

/** The ore/crystal gem types that read as something you'd mine from a vein. */
function gemPool(): ModifierTypeFunc[] {
  return [
    modifierTypes.ER_ROCK_GEM,
    modifierTypes.ER_GROUND_GEM,
    modifierTypes.ER_STEEL_GEM,
    modifierTypes.ER_FIRE_GEM,
    modifierTypes.ER_ELECTRIC_GEM,
    modifierTypes.ER_ICE_GEM,
    modifierTypes.ER_WATER_GEM,
    modifierTypes.ER_DRAGON_GEM,
  ];
}

/**
 * A deeper strike can chip a raw elemental GEM from the glittering seam (the
 * mining theme - gems literally come out of the rock). `d` is depth (0-indexed).
 */
export function rollGem(haul: MineralLootHaul, d: number): boolean {
  if (d < 1 || randSeedInt(100) >= GEM_CHANCE) {
    return false;
  }
  haul.funcs.push(randSeedItem(gemPool()));
  return true;
}

// --- Delve special finds: Ward Stones + resist berries -------------------- //
//
// #491 - the deeper a delve goes, the more likely it turns up a defensive curio.
// These are the same Ward Stones / resist berries enemies and trainers drop, but
// here the player can DIG them out, with a find chance that climbs DRASTICALLY
// with depth (shallow strikes never turn them up; a deep dive very often does).
// Each found item is banked as a guaranteed reward OPTION (like the mega stone),
// so it shows up in the cash-in shop when the player finally banks.

/**
 * Percent chance a strike at depth `d` (0-indexed) turns up a WARD STONE. Zero in
 * the shallows, then ramps hard the deeper the delve goes.
 */
function wardStoneFindChance(d: number): number {
  if (d <= 1) {
    return 0;
  }
  if (d === 2) {
    return 15;
  }
  if (d === 3) {
    return 30;
  }
  if (d === 4) {
    return 45;
  }
  return 60;
}

/** Ward Stone tier by depth: deeper digs turn up the stronger stones. */
function wardStoneTierForDepth(d: number): ErWardStoneTier {
  if (d <= 2) {
    return "minor";
  }
  if (d <= 4) {
    return "greater";
  }
  return "prime";
}

/**
 * Percent chance a strike at depth `d` (0-indexed) turns up a RESIST BERRY. Resist
 * berries are commoner than Ward Stones, so the ramp starts a level earlier and
 * climbs higher. Zero on the very first strike.
 */
function resistBerryFindChance(d: number): number {
  if (d <= 0) {
    return 0;
  }
  if (d === 1) {
    return 12;
  }
  if (d === 2) {
    return 24;
  }
  if (d === 3) {
    return 38;
  }
  if (d === 4) {
    return 52;
  }
  return 68;
}

/**
 * Roll for a WARD STONE find at depth `d` (0-indexed). Adds a tier-scaled stone to
 * the haul's options on a hit. Returns true if one was added.
 */
export function rollWardStone(haul: MineralLootHaul, d: number): boolean {
  if (randSeedInt(100) >= wardStoneFindChance(d)) {
    return false;
  }
  const type = erWardStoneModifierType(wardStoneTierForDepth(d));
  haul.options.push(new ModifierTypeOption(type, 0));
  return true;
}

/**
 * Roll for a RESIST BERRY find at depth `d` (0-indexed). Adds a random-type resist
 * berry to the haul's options on a hit. Returns true if one was added.
 */
export function rollResistBerry(haul: MineralLootHaul, d: number): boolean {
  if (randSeedInt(100) >= resistBerryFindChance(d)) {
    return false;
  }
  const resistType = randSeedItem([...ER_RESIST_BERRY_BY_TYPE.keys()]);
  const type = erResistBerryModifierType(resistType);
  haul.options.push(new ModifierTypeOption(type, 0));
  return true;
}

/**
 * Combined delve "defensive curio" roll: rolls a Ward Stone first, then a resist
 * berry (independent rolls, so a deep strike can turn up both). Returns true if
 * EITHER was added - the host reuses its normal item-find message on a hit. `d`
 * is depth (0-indexed).
 */
export function rollDelveWardOrBerry(haul: MineralLootHaul, d: number): boolean {
  const ward = rollWardStone(haul, d);
  const berry = rollResistBerry(haul, d);
  return ward || berry;
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
    // A mon ALREADY in its mega/primal resting form can never take another mega
    // stone (ER megas are permanent), so its own line contributes nothing here.
    // Skip only THIS mon: a different not-yet-mega'd party member, or a pre-evo
    // in the same line, still adds the stone on its own iteration - so an
    // eligible target keeps the offer. Reuses the game's own isMega() detection.
    // (Reported: a mega-evolved Victreebel was still offered a Victreebelite.)
    if (mon.isMega()) {
      continue;
    }
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
  // STRENGTH-TIERED rarity (er-mega-tiers): the deep find is a WEIGHTED pick, so
  // a masterball-tier stone (legendary / primal / "-Z" ultra mega) is a very-
  // low-chance unearth even when eligible, and reads at its true rarity tier.
  const stone = pickErMegaStoneWeighted(stones);
  const opt = generateModifierTypeOption(modifierTypes.FORM_CHANGE_ITEM, [stone]);
  if (!opt) {
    return false;
  }
  opt.type.setTier(erMegaStoneTier(stone));
  haul.options.push(opt);
  haul.megaFound = true;
  return true;
}

/** True if the haul holds any item reward (drives the prompt's "treasure" hint). */
export function mineralHaulHasItems(haul: MineralLootHaul): boolean {
  return haul.funcs.length > 0 || haul.options.length > 0;
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
  setEncounterRewards(settings);
  return true;
}
