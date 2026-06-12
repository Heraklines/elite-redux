/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER community item batch (#387/#392) - maintainer-approved Discord items.
//
// PASSIVE HELD ITEMS (config + battle hooks live here; the modifier class is
// `ErCommunityItemModifier` in #modifiers/modifier and the ModifierType
// factory lives in #modifiers/modifier-type, both REQUIRED there so the
// vanilla save serializer can round-trip the items):
//   - Chili Sample     (ULTRA, 1): damaging moves gain +10% burn chance.
//   - Copper Rod       (ULTRA, 1): 10% paralyze on contact, BOTH directions.
//   - Rusty Claw       (ULTRA, 1): 10% poison when landing a contact move.
//   - Spiked Knuckles  (ULTRA, 1): 10% ER Bleed when landing a contact move.
//   - Loaded Dice      (ULTRA, 3): +1 minimum hit per stack on 2-5-hit moves
//                                  (3 stacks = pseudo Skill Link).
//   - Lucky Heart      (ULTRA, 2): +15 percentage points of move effect
//                                  chance per stack (stacks with Serene Grace).
//   - Omni Gem         (ROGUE, 1): once per battle, the holder's first
//                                  damaging move deals double damage.
//
// Frostbite Orb / Ability Capsule / Dex Nav reuse vanilla item plumbing in
// modifier-type.ts. Rarity rationale: the 10%-proc items match King's Rock's
// power class, Loaded Dice/Lucky Heart match Wide Lens (ULTRA); once-per-mon /
// once-per-battle effects match the Ability Randomizer class (ROGUE).
//
// Icons: existing items-atlas frames + runtime tint (Ward Stone precedent -
// no new atlas frames needed for the held items).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { ErCommunityItemModifier } from "#modifiers/modifier";
import type { NumberHolder } from "#utils/common";
import { randSeedInt } from "#utils/common";

export type ErCommunityItemKind =
  | "chiliSample"
  | "copperRod"
  | "rustyClaw"
  | "spikedKnuckles"
  | "loadedDice"
  | "luckyHeart"
  | "omniGem"
  | "powerHerb";

export interface ErCommunityItemConfig {
  name: string;
  description: string;
  /** Existing items-atlas frame, reskinned via tint. */
  icon: string;
  tint: number;
  maxStack: number;
}

export const ER_COMMUNITY_ITEM_CONFIG: Readonly<Record<ErCommunityItemKind, ErCommunityItemConfig>> = {
  chiliSample: {
    name: "Chili Sample",
    description: "The holder's damaging moves gain a 10% chance to burn the target.",
    icon: "charcoal",
    tint: 0xff5533,
    maxStack: 1,
  },
  copperRod: {
    name: "Copper Rod",
    description:
      "10% chance to paralyze on contact, both ways: striking with a contact move, or being struck by one.",
    icon: "quick_claw",
    tint: 0xd98850,
    maxStack: 1,
  },
  rustyClaw: {
    name: "Rusty Claw",
    description: "The holder's contact moves gain a 10% chance to poison the target.",
    icon: "quick_claw",
    tint: 0x9a5b33,
    maxStack: 1,
  },
  spikedKnuckles: {
    name: "Spiked Knuckles",
    description: "The holder's contact moves gain a 10% chance to make the target bleed.",
    icon: "quick_claw",
    tint: 0xb8c0c8,
    maxStack: 1,
  },
  loadedDice: {
    name: "Loaded Dice",
    description: "Raises the minimum number of strikes of the holder's 2-to-5-hit moves by 1 per stack (max 3).",
    icon: "wide_lens",
    tint: 0xe8c84a,
    maxStack: 3,
  },
  luckyHeart: {
    name: "Lucky Heart",
    description:
      "Raises the holder's move effect chances by 15% per stack (max 2). Stacks with abilities like Serene Grace.",
    icon: "healing_charm",
    tint: 0xff7faa,
    maxStack: 2,
  },
  omniGem: {
    name: "Omni Gem",
    description:
      "Doubles the damage of the holder's next damaging move. Holds 2 charges; the gem shatters once both are spent.",
    // Dedicated atlas frame: the ROM hack's elemental gem, whitened
    // (build_er_item_icons.py). 0xffffff tint = no runtime recolor.
    icon: "omni_gem",
    tint: 0xffffff,
    maxStack: 1,
  },
  powerHerb: {
    name: "Power Herb",
    description:
      "Skips the charge turn of the holder's two-turn moves. Holds 2 charges and regains one every 10 waves.",
    // Dedicated atlas frame from the ROM hack's power_herb.png icon.
    icon: "power_herb",
    tint: 0xffffff,
    maxStack: 1,
  },
};

/** Omni Gem: total double-damage charges before the gem shatters. */
export const ER_OMNI_GEM_CHARGES = 2;
/** Power Herb: maximum stored charge-turn skips. */
export const ER_POWER_HERB_CHARGES = 2;
/** Power Herb: won waves needed to regain one charge. */
export const ER_POWER_HERB_RECHARGE_WAVES = 10;

/** Every community item kind, in display order (used by the type registry). */
export const ER_COMMUNITY_ITEM_KINDS: readonly ErCommunityItemKind[] = [
  "chiliSample",
  "copperRod",
  "rustyClaw",
  "spikedKnuckles",
  "loadedDice",
  "luckyHeart",
  "omniGem",
  "powerHerb",
];

/** Per-proc chance of the contact/on-hit status items. */
const ER_STATUS_ITEM_CHANCE = 10;
/** Lucky Heart: flat percentage points added to move effect chances, per stack. */
const ER_LUCKY_HEART_BONUS = 15;

/** Total stacks of a community item kind held by `pokemon`. */
export function getErCommunityItemStacks(pokemon: Pokemon, kind: ErCommunityItemKind): number {
  let stacks = 0;
  for (const mod of pokemon.getHeldItems()) {
    if (mod instanceof ErCommunityItemModifier && mod.kind === kind) {
      stacks += mod.getStackCount();
    }
  }
  return stacks;
}

/** The holder's Omni Gem modifier, if any. */
function getOmniGem(pokemon: Pokemon): ErCommunityItemModifier | undefined {
  return pokemon
    .getHeldItems()
    .find((m): m is ErCommunityItemModifier => m instanceof ErCommunityItemModifier && m.kind === "omniGem");
}

function rollStatusProc(): boolean {
  return randSeedInt(100) < ER_STATUS_ITEM_CHANCE;
}

/**
 * Community on-hit item procs (#387). Called from MoveEffectPhase after a
 * damaging hit lands (both sides - the vanilla enemy-token path is
 * enemy-only). `makesContact` reflects the landed move.
 */
export function erApplyCommunityOnHitItems(user: Pokemon, target: Pokemon, makesContact: boolean): void {
  if (!target.isActive(true)) {
    return;
  }
  // Chili Sample: ANY damaging move, 10% burn.
  if (getErCommunityItemStacks(user, "chiliSample") > 0 && rollStatusProc()) {
    target.trySetStatus(StatusEffect.BURN, user);
  }
  if (makesContact) {
    // Rusty Claw: 10% poison on contact (offense).
    if (getErCommunityItemStacks(user, "rustyClaw") > 0 && rollStatusProc()) {
      target.trySetStatus(StatusEffect.POISON, user);
    }
    // Spiked Knuckles: 10% ER Bleed on contact (offense). Same duration band
    // as the Slash bleed rider.
    if (
      getErCommunityItemStacks(user, "spikedKnuckles") > 0
      && rollStatusProc()
      && !target.getTag(BattlerTagType.ER_BLEED)
    ) {
      target.addTag(BattlerTagType.ER_BLEED, 4 + randSeedInt(3), undefined, user.id);
    }
    // Copper Rod, offense: 10% paralyze the target.
    if (getErCommunityItemStacks(user, "copperRod") > 0 && rollStatusProc()) {
      target.trySetStatus(StatusEffect.PARALYSIS, user);
    }
    // Copper Rod, defense: the struck DEFENDER's rod can paralyze the attacker.
    if (getErCommunityItemStacks(target, "copperRod") > 0 && user.isActive(true) && rollStatusProc()) {
      user.trySetStatus(StatusEffect.PARALYSIS, target);
    }
  }
}

/** Loaded Dice: extra MINIMUM hits for 2-5-hit moves (capped by the hooks). */
export function erLoadedDiceMinHitBonus(user: Pokemon): number {
  return Math.min(getErCommunityItemStacks(user, "loadedDice"), 3);
}

/** Lucky Heart: flat percentage points added to the user's move effect chances. */
export function erLuckyHeartChanceBonus(user: Pokemon): number {
  return Math.min(getErCommunityItemStacks(user, "luckyHeart"), 2) * ER_LUCKY_HEART_BONUS;
}

/**
 * Omni Gem (#387): doubles the holder's next damaging move. The gem carries
 * {@linkcode ER_OMNI_GEM_CHARGES} charges total and SHATTERS (the modifier is
 * removed) once both are spent. Applied inside the damage calc; a charge is
 * only consumed on REAL (non-simulated) calcs so AI previews don't burn it.
 */
export function erTryApplyOmniGem(source: Pokemon, damage: NumberHolder, simulated: boolean): void {
  const gem = getOmniGem(source);
  if (!gem || gem.charges <= 0 || damage.value <= 0) {
    return;
  }
  damage.value *= 2;
  if (!simulated) {
    gem.charges--;
    if (gem.charges <= 0) {
      globalScene.removeModifier(gem, !source.isPlayer());
      globalScene.updateModifiers(source.isPlayer());
      globalScene.phaseManager.queueMessage(
        `${source.getNameToRender()}'s Omni Gem doubled the blow... and shattered!`,
      );
    } else {
      // Refresh the held-item icon so the on-icon charge counter updates live.
      globalScene.updateModifiers(source.isPlayer());
      globalScene.phaseManager.queueMessage(
        `${source.getNameToRender()}'s Omni Gem doubled the blow! (${gem.charges} charge left)`,
      );
    }
  }
}

/** The holder's Power Herb modifier, if any. */
function getPowerHerb(pokemon: Pokemon): ErCommunityItemModifier | undefined {
  return pokemon
    .getHeldItems()
    .find((m): m is ErCommunityItemModifier => m instanceof ErCommunityItemModifier && m.kind === "powerHerb");
}

/**
 * Power Herb (#401): called from MoveChargePhase when the holder begins a
 * two-turn move. Spends one charge to skip the charge turn entirely.
 * Disabled while the holder's items are locked (ER Frisk).
 */
export function erTryConsumePowerHerb(user: Pokemon): boolean {
  const herb = getPowerHerb(user);
  if (!herb || herb.charges <= 0 || user.getTag(BattlerTagType.ER_ITEM_DISABLED)) {
    return false;
  }
  herb.charges--;
  // Refresh the held-item icon so the on-icon charge counter updates live.
  globalScene.updateModifiers(user.isPlayer());
  globalScene.phaseManager.queueMessage(
    `${user.getNameToRender()} became fully charged due to its Power Herb! (${herb.charges} charge${herb.charges === 1 ? "" : "s"} left)`,
  );
  return true;
}

/**
 * Power Herb recharge (#401): +1 wave of progress per won wave; at
 * {@linkcode ER_POWER_HERB_RECHARGE_WAVES} the herb regains ONE charge
 * (capped at {@linkcode ER_POWER_HERB_CHARGES}). Called from BattleEndPhase
 * next to the Ward Stone recharger.
 */
export function erAdvanceCommunityItemCharges(): void {
  try {
    for (const mod of globalScene.findModifiers(
      m => m instanceof ErCommunityItemModifier && (m as ErCommunityItemModifier).kind === "powerHerb",
      true,
    )) {
      const herb = mod as ErCommunityItemModifier;
      if (herb.charges >= ER_POWER_HERB_CHARGES) {
        herb.waveProgress = 0;
        continue;
      }
      herb.waveProgress++;
      if (herb.waveProgress >= ER_POWER_HERB_RECHARGE_WAVES) {
        herb.charges++;
        herb.waveProgress = 0;
        // Refresh the held-item icon so the on-icon charge counter updates.
        globalScene.updateModifiers(true);
      }
    }
  } catch {
    // Recharging must never break the battle-end flow.
  }
}
