/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - "tactical" held items.
//
// Original batch (shipped d40963f4a): Expert Belt / Covert Cloak / Red Card /
// Eject Button. Batch 2 (maintainer-approved 2026-07-16) adds 20 mainline
// held items plus Utility Umbrella. Each kind is config-driven: a `kind`
// union entry + an `ER_TACTICAL_CONFIG` block + the single `ErTacticalItemModifier`
// class + `erTacticalItemType` factory + one hook function called from the
// audited engine chokepoint (never a newly-invented one).
//
// Wiring contract (see .claude/skills/er-add-item/SKILL.md): self-contained
// class + runtime ModifierType factory with a PINNED type id (persistence from
// every grant path), getArgs() round-trip of {kind, spent, waveProgress},
// er-persistent-modifiers registration for the save/coop loaders, standalone
// er-assets icons drawn holder-first on the item bar, PreventItemUseAbAttr
// (As One) + ER_ITEM_DISABLED gates on the consumable procs, and a Fetch
// lostItems tap when a single-use item fires.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erIsHeldItemDisabled } from "#data/battler-tags";
import type { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErSpeciesId } from "#enums/er-species-id";
import { HitResult } from "#enums/hit-result";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
import { WeatherType } from "#enums/weather-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { BooleanHolder, type NumberHolder, toDmgValue } from "#utils/common";

export type ErTacticalKind =
  | "expertBelt"
  | "covertCloak"
  | "redCard"
  | "ejectButton"
  // --- batch 2 ---
  | "heavyDutyBoots"
  | "airBalloon"
  | "safetyGoggles"
  | "clearAmulet"
  | "abilityShield"
  | "boosterEnergy"
  | "throatSpray"
  | "blunderPolicy"
  | "punchingGlove"
  | "muscleBand"
  | "wiseGlasses"
  | "zoomLens"
  | "metronomeItem"
  | "ejectPack"
  | "shedShell"
  | "adrenalineOrb"
  | "roomService"
  | "ironBall"
  | "floatStone"
  | "stickyBarb"
  | "smokeBall"
  | "mentalHerb"
  | "utilityUmbrella";

/** ER battle_util.c HOLD_EFFECT_EXPERT_BELT: x1.2 when effectiveness >= 2.0. */
export const ER_EXPERT_BELT_MULTIPLIER = 1.2;
/** Muscle Band / Wise Glasses / Punching Glove passive damage multiplier. */
export const ER_BOOSTER_ITEM_MULTIPLIER = 1.1;
/** Zoom Lens accuracy multiplier when the target already acted this turn. */
export const ER_ZOOM_LENS_MULTIPLIER = 1.2;
/** Metronome: +20% power per prior consecutive same-move use, capped +100%. */
export const ER_METRONOME_STEP = 0.2;
export const ER_METRONOME_MAX_STEPS = 5;
/** Booster Energy: won waves needed to recharge one spent booster. */
export const ER_BOOSTER_ENERGY_RECHARGE_WAVES = 10;
/** Sticky Barb: fraction of max HP the holder loses at turn end. */
export const ER_STICKY_BARB_FRACTION = 8;

interface ErTacticalConfig {
  name: string;
  description: string;
  /** Standalone texture key (ROM / PokeAPI sprite hosted on er-assets, loaded in loading-scene). */
  icon: string;
  /** Rarity tier for distribution (shops / reward pools). */
  tier: ModifierTier;
  /** Consumed when its effect fires (Red Card / Eject Button / Air Balloon / …). */
  singleUse: boolean;
}

export const ER_TACTICAL_CONFIG: Readonly<Record<ErTacticalKind, ErTacticalConfig>> = {
  expertBelt: {
    // ER dex: "A belt that boosts the power of super effective moves."
    name: "Expert Belt",
    description: "Boosts the power of the holder's super-effective moves by 20%.",
    icon: "er_expert_belt",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  covertCloak: {
    name: "Covert Cloak",
    description:
      "Protects the holder from the additional effects of moves. When held by Cacjack, summons Eerie Fog on entry.",
    icon: "er_covert_cloak",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  redCard: {
    // ER dex: "Switches out the foe if they hit the holder."
    name: "Red Card",
    description: "When the holder is hit by an attack, the attacker is switched out. Single use.",
    icon: "er_red_card",
    tier: ModifierTier.ULTRA,
    singleUse: true,
  },
  ejectButton: {
    // ER dex: "Switches out the user if they're hit by the foe."
    name: "Eject Button",
    description: "When the holder is hit by an attack, it switches out. Single use.",
    icon: "er_eject_button",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
  heavyDutyBoots: {
    name: "Heavy-Duty Boots",
    description: "The holder is immune to entry hazards.",
    icon: "er_heavy_duty_boots",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  airBalloon: {
    name: "Air Balloon",
    description: "The holder floats, avoiding Ground moves. It pops when the holder is hit. Single use.",
    icon: "er_air_balloon",
    tier: ModifierTier.ULTRA,
    singleUse: true,
  },
  safetyGoggles: {
    name: "Safety Goggles",
    description: "The holder is immune to weather damage and to powder moves.",
    icon: "er_safety_goggles",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  clearAmulet: {
    name: "Clear Amulet",
    description: "Prevents other Pokemon from lowering the holder's stats.",
    icon: "er_clear_amulet",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  abilityShield: {
    name: "Ability Shield",
    description: "The holder's ability cannot be changed, replaced, or suppressed.",
    icon: "er_ability_shield",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  boosterEnergy: {
    // TODO(maintainer): mainline is choice-activated (like Tera). This port
    // auto-activates on entry per the maintainer's approved fallback; the
    // choice-activated UI is a flagged residual.
    name: "Booster Energy",
    description:
      "On entry, powers up the holder's strongest stat if it has Protosynthesis or Quark Drive. Recharges after 10 won waves.",
    icon: "er_booster_energy",
    tier: ModifierTier.ROGUE,
    singleUse: false,
  },
  throatSpray: {
    name: "Throat Spray",
    description: "Raises the holder's Sp. Atk by 1 when it uses a sound-based move. Single use.",
    icon: "er_throat_spray",
    tier: ModifierTier.ULTRA,
    singleUse: true,
  },
  blunderPolicy: {
    name: "Blunder Policy",
    description: "Sharply raises the holder's Speed if it misses because of an accuracy check. Single use.",
    icon: "er_blunder_policy",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
  punchingGlove: {
    name: "Punching Glove",
    description: "Boosts the power of the holder's punching moves by 10% and stops them from making contact.",
    icon: "er_punching_glove",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  muscleBand: {
    name: "Muscle Band",
    description: "Boosts the holder's physical moves by 10%, and its Attack cannot be lowered by foes.",
    icon: "er_muscle_band",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  wiseGlasses: {
    name: "Wise Glasses",
    description: "Boosts the holder's special moves by 10%, and its Sp. Atk cannot be lowered by foes.",
    icon: "er_wise_glasses",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  zoomLens: {
    name: "Zoom Lens",
    description: "Boosts the holder's accuracy by 20% if it moves after its target.",
    icon: "er_zoom_lens",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  metronomeItem: {
    name: "Metronome",
    description: "Boosts a move's power by 20% each time it is used in a row, up to a maximum of 100%.",
    icon: "er_metronome",
    tier: ModifierTier.ROGUE,
    singleUse: false,
  },
  ejectPack: {
    name: "Eject Pack",
    description: "Switches the holder out when its stats are lowered. Single use.",
    icon: "er_eject_pack",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
  shedShell: {
    name: "Shed Shell",
    description: "The holder can always switch out, ignoring trapping effects.",
    icon: "er_shed_shell",
    tier: ModifierTier.GREAT,
    singleUse: false,
  },
  adrenalineOrb: {
    name: "Adrenaline Orb",
    description: "Raises the holder's Speed by 1 when a foe tries to lower its Attack (e.g. Intimidate). Single use.",
    icon: "er_adrenaline_orb",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
  roomService: {
    name: "Room Service",
    description: "Lowers the holder's Speed by 1 when Trick Room takes effect. Single use.",
    icon: "er_room_service",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
  ironBall: {
    name: "Iron Ball",
    description: "Halves the holder's Speed and grounds it.",
    icon: "er_iron_ball",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  floatStone: {
    name: "Float Stone",
    description: "Raises the holder's Speed by 10%.",
    icon: "er_float_stone",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  stickyBarb: {
    name: "Sticky Barb",
    description: "Damages the holder each turn, and may transfer to a foe that hits it with a contact move.",
    icon: "er_sticky_barb",
    tier: ModifierTier.GREAT,
    singleUse: false,
  },
  smokeBall: {
    name: "Smoke Ball",
    description: "The holder can always flee from wild Pokemon, even when trapped.",
    icon: "er_smoke_ball",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  mentalHerb: {
    name: "Mental Herb",
    description:
      "Cures the holder of infatuation, Taunt, Encore, Torment, Disable, or Heal Block when it would be inflicted. Single use.",
    icon: "er_mental_herb",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
  utilityUmbrella: {
    name: "Utility Umbrella",
    description: "The holder is unaffected by the sun's and rain's boosts and penalties to its own moves.",
    icon: "er_utility_umbrella",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
};

/** A tactical held item (self-contained; see the header for per-kind effects). */
export class ErTacticalItemModifier extends PokemonHeldItemModifier {
  public readonly kind: ErTacticalKind;
  /** Booster Energy: whether the stored charge has been spent (recharges over waves). */
  public spent: boolean;
  /** Booster Energy: won-wave progress toward recharging a spent charge. */
  public waveProgress: number;

  constructor(
    type: ModifierType,
    pokemonId: number,
    kind: ErTacticalKind,
    spent = false,
    waveProgress = 0,
    stackCount?: number,
  ) {
    super(type, pokemonId, stackCount);
    this.kind = kind;
    this.spent = spent;
    this.waveProgress = waveProgress;
  }

  /** Persist the tactical kind + Booster-Energy charge state so the item round-trips on save/load. */
  override getArgs(): unknown[] {
    return [...super.getArgs(), this.kind, this.spent, this.waveProgress];
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ErTacticalItemModifier && modifier.kind === this.kind;
  }

  override clone(): ErTacticalItemModifier {
    return new ErTacticalItemModifier(this.type, this.pokemonId, this.kind, this.spent, this.waveProgress, this.stackCount);
  }

  override apply(): boolean {
    return true; // effects fire at their engine hooks, not via this channel
  }

  override getMaxHeldItemCount(): number {
    return 1;
  }

  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    if (forSummary) {
      // Summary/party held-item view. super.getIcon draws `type.iconImage` as a
      // frame of the "items" ATLAS - our icons are STANDALONE er-assets textures,
      // so that rendered an invisible blank (live report 2026-07-16: "Floaty
      // Stone... disappeared from my pokemon hold items"). Draw the standalone
      // texture directly at the same (0,12) anchor the vanilla summary icon uses.
      const summary = globalScene.add.container(0, 0);
      const summaryItem = globalScene.add.sprite(0, 12, ER_TACTICAL_CONFIG[this.kind].icon);
      summaryItem.setScale(0.5);
      summaryItem.setOrigin(0, 0.5);
      summary.add(summaryItem);
      const summaryStack = this.getIconStackText();
      if (summaryStack) {
        summary.add(summaryStack);
      }
      return summary;
    }
    // Item-bar layout matching the elemental gems / reactive items: the HOLDER's
    // Pokemon icon on the left, THEN the item's standalone er-assets sprite (it
    // is NOT in the items atlas, so draw it directly rather than via super).
    const container = globalScene.add.container(0, 0);
    const pokemon = this.getPokemon();
    if (pokemon) {
      const pokemonIcon = globalScene.addPokemonIcon(pokemon, -2, 10, 0, 0.5, undefined, true);
      container.add(pokemonIcon);
      container.setName(pokemon.id.toString());
    }
    const item = globalScene.add.sprite(16, 16, ER_TACTICAL_CONFIG[this.kind].icon);
    item.setScale(0.5);
    item.setOrigin(0, 0.5);
    container.add(item);
    const stackText = this.getIconStackText();
    if (stackText) {
      container.add(stackText);
    }
    return container;
  }
}

/** Build a runtime ModifierType for a tactical item (no load-order cycle). */
export function erTacticalItemType(kind: ErTacticalKind): ModifierType {
  const cfg = ER_TACTICAL_CONFIG[kind];
  const type = new PokemonHeldItemModifierType(
    "",
    cfg.icon,
    (t, args) => new ErTacticalItemModifier(t, (args[0] as Pokemon).id, kind),
  );
  // Pin the modifierTypeInitObj id so the item persists from EVERY grant path
  // (off-pool grants keep id="" -> typeId="" -> dropped on reload). See the gem
  // fix in er-elemental-gems.ts. "expertBelt" -> "ER_EXPERT_BELT".
  type.id = `ER_${kind.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  Object.defineProperty(type, "name", { get: () => cfg.name, configurable: true });
  type.getDescription = () => cfg.description;
  // Pin the tier so the reward UI renders a ball sprite (undefined tier -> blank).
  type.setTier(cfg.tier);
  return type;
}

/** The holder's tactical item of `kind`, or undefined. */
function heldTacticalItem(holder: Pokemon, kind: ErTacticalKind): ErTacticalItemModifier | undefined {
  return holder
    .getHeldItems()
    .find((m): m is ErTacticalItemModifier => m instanceof ErTacticalItemModifier && m.kind === kind);
}

/** True if the holder carries a WORKING (not Embargo-disabled) tactical item of `kind`. */
function hasWorkingTactical(holder: Pokemon, kind: ErTacticalKind): boolean {
  const item = heldTacticalItem(holder, kind);
  return item != null && !erIsHeldItemDisabled(holder, item.type?.id);
}

/** Consume a fired single-use tactical item (+ Fetch lostItems ledger tap). */
function consumeTacticalItem(holder: Pokemon, item: ErTacticalItemModifier): void {
  globalScene.removeModifier(item, !holder.isPlayer());
  globalScene.updateModifiers(holder.isPlayer());
  // ER Fetch (er move 969) ledger: a consumed single-use item is a "lost item",
  // recorded by typeId so Fetch can rebuild it (same tap as the shattered gems).
  holder.battleData.lostItems.push({ typeId: item.type?.id ?? "" });
}

// ===========================================================================
// Passive / query hooks
// ===========================================================================

/**
 * Expert Belt hook (called from getAttackDamage beside the elemental-gem hook):
 * if the attacker holds an Expert Belt and this hit is super-effective
 * (effectiveness >= 2, mirroring ER's UQ_4_12(2.0) check), multiply the damage.
 * Passive - never consumed - so it applies to simulated calcs too (the AI sees
 * the boost it will actually deal, like Life Orb).
 */
export function erTryApplyExpertBelt(source: Pokemon, typeMultiplier: number, damage: NumberHolder): void {
  if (damage.value <= 0 || typeMultiplier < 2) {
    return;
  }
  if (!hasWorkingTactical(source, "expertBelt")) {
    return;
  }
  damage.value = toDmgValue(damage.value * ER_EXPERT_BELT_MULTIPLIER);
}

/**
 * Passive damage boosters (called from getAttackDamage beside Expert Belt):
 *   - Punching Glove: x1.1 on PUNCHING_MOVE moves.
 *   - Muscle Band:    x1.1 on physical moves.
 *   - Wise Glasses:   x1.1 on special moves.
 *   - Metronome:      +20% power per prior consecutive same-move use (cap +100%).
 * All passive (never consumed), so they apply to simulated calcs too.
 */
export function erApplyTacticalDamage(
  source: Pokemon,
  move: Move,
  moveCategory: MoveCategory,
  damage: NumberHolder,
): void {
  if (damage.value <= 0) {
    return;
  }
  let mult = 1;
  if (move.hasFlag(MoveFlags.PUNCHING_MOVE) && hasWorkingTactical(source, "punchingGlove")) {
    mult *= ER_BOOSTER_ITEM_MULTIPLIER;
  }
  if (moveCategory === MoveCategory.PHYSICAL && hasWorkingTactical(source, "muscleBand")) {
    mult *= ER_BOOSTER_ITEM_MULTIPLIER;
  }
  if (moveCategory === MoveCategory.SPECIAL && hasWorkingTactical(source, "wiseGlasses")) {
    mult *= ER_BOOSTER_ITEM_MULTIPLIER;
  }
  if (hasWorkingTactical(source, "metronomeItem")) {
    mult *= erMetronomeMultiplier(source, move);
  }
  if (mult !== 1) {
    damage.value = toDmgValue(damage.value * mult);
  }
}

/** Metronome power multiplier from the holder's consecutive same-move streak. */
function erMetronomeMultiplier(source: Pokemon, move: Move): number {
  let consecutive = 0;
  for (const tm of source.getLastXMoves(0)) {
    const succeeded = tm.result === undefined || tm.result === MoveResult.SUCCESS || tm.result === MoveResult.PENDING;
    if (tm.move === move.id && succeeded) {
      consecutive++;
    } else {
      break;
    }
  }
  const prior = Math.max(0, consecutive - 1);
  return 1 + ER_METRONOME_STEP * Math.min(prior, ER_METRONOME_MAX_STEPS);
}

/**
 * Covert Cloak check (consulted from Move.getMoveChance beside Shield Dust and
 * from the held-item flinch check): `true` when `target` holds a working Covert
 * Cloak, i.e. every additional effect a damaging move would inflict ON the
 * holder is suppressed. Passive - never consumed.
 */
export function erCovertCloakGuards(target: Pokemon): boolean {
  return hasWorkingTactical(target, "covertCloak");
}

/** Heavy-Duty Boots: the holder is immune to all entry hazards. */
export function erTacticalBlocksHazards(pokemon: Pokemon): boolean {
  return hasWorkingTactical(pokemon, "heavyDutyBoots");
}

/** Safety Goggles: the holder ignores weather chip damage. */
export function erTacticalBlocksWeatherDamage(pokemon: Pokemon): boolean {
  return hasWorkingTactical(pokemon, "safetyGoggles");
}

/** Safety Goggles: the holder is immune to powder moves. */
export function erTacticalBlocksPowder(pokemon: Pokemon): boolean {
  return hasWorkingTactical(pokemon, "safetyGoggles");
}

/** Ability Shield: the holder's ability cannot be changed, replaced, or suppressed. */
export function erTacticalProtectsAbility(pokemon: Pokemon): boolean {
  return hasWorkingTactical(pokemon, "abilityShield");
}

/** Air Balloon: the (unpopped) holder is ungrounded. */
export function erTacticalAirBalloonUngrounds(pokemon: Pokemon): boolean {
  const balloon = heldTacticalItem(pokemon, "airBalloon");
  return balloon != null && !balloon.spent && !erIsHeldItemDisabled(pokemon, balloon.type?.id);
}

/** Iron Ball: the holder is grounded (wins over any float, per maintainer). */
export function erTacticalIronBallGrounds(pokemon: Pokemon): boolean {
  return hasWorkingTactical(pokemon, "ironBall");
}

/**
 * Speed multiplier from tactical items (applied in getEffectiveStat's SPD case):
 * Iron Ball x0.5, Float Stone x1.1. Both passive.
 */
export function erTacticalSpeedMultiplier(pokemon: Pokemon): number {
  let mult = 1;
  if (hasWorkingTactical(pokemon, "ironBall")) {
    mult *= 0.5;
  }
  if (hasWorkingTactical(pokemon, "floatStone")) {
    mult *= 1.1;
  }
  return mult;
}

/**
 * Zoom Lens (applied at the end of getAccuracyMultiplier): x1.2 accuracy when the
 * target has already acted this turn. Passive.
 */
export function erTacticalZoomLensMultiplier(user: Pokemon, target: Pokemon): number {
  if (target.turnData?.acted && hasWorkingTactical(user, "zoomLens")) {
    return ER_ZOOM_LENS_MULTIPLIER;
  }
  return 1;
}

/**
 * Utility Umbrella: neutralize the sun/rain weather multiplier on the HOLDER's
 * own moves. Applied in getAttackDamage after `arenaAttackTypeMultiplier` folds
 * in the weather component - we divide that component back out so terrain/biome
 * multipliers are preserved.
 */
export function erTacticalUtilityUmbrella(source: Pokemon, moveType: PokemonType, arenaMultiplier: NumberHolder): void {
  const weather = globalScene.arena.weather;
  if (!weather || weather.isEffectSuppressed()) {
    return;
  }
  if (
    ![WeatherType.SUNNY, WeatherType.HARSH_SUN, WeatherType.RAIN, WeatherType.HEAVY_RAIN].includes(weather.weatherType)
  ) {
    return;
  }
  if (!hasWorkingTactical(source, "utilityUmbrella")) {
    return;
  }
  const weatherMult = weather.getAttackTypeMultiplier(moveType);
  if (weatherMult !== 0 && weatherMult !== 1) {
    arenaMultiplier.value /= weatherMult;
  }
}

/** Punching Glove: the holder's punching moves lose contact. */
export function erPunchingGloveStripsContact(user: Pokemon, move: Move): boolean {
  return move.hasFlag(MoveFlags.PUNCHING_MOVE) && hasWorkingTactical(user, "punchingGlove");
}

/** Shed Shell / Smoke Ball: the holder ignores trapping (always free to switch/flee). */
export function erTacticalBypassesTrap(pokemon: Pokemon): boolean {
  return hasWorkingTactical(pokemon, "shedShell") || hasWorkingTactical(pokemon, "smokeBall");
}

/** Smoke Ball: fleeing from a wild battle always succeeds. */
export function erTacticalGuaranteedFlee(): boolean {
  return globalScene.getPlayerField(true).some(p => hasWorkingTactical(p, "smokeBall"));
}

// ===========================================================================
// Battler-tag guard (Mental Herb cures, Throat Spray blocks Throat Chop)
// ===========================================================================

/** Battler tags Mental Herb cures/blocks on the holder. */
const MENTAL_HERB_TAGS = new Set<BattlerTagType>([
  BattlerTagType.INFATUATED,
  BattlerTagType.TAUNT,
  BattlerTagType.ENCORE,
  BattlerTagType.TORMENT,
  BattlerTagType.DISABLED,
  BattlerTagType.HEAL_BLOCK,
]);

/**
 * Tactical addTag guard (called from Pokemon.addTag): Mental Herb cures/blocks a
 * mental affliction (consumed); Throat Spray blocks Throat Chop while held.
 * Returns `true` when the tag must NOT be added.
 */
export function erTacticalBlocksBattlerTag(pokemon: Pokemon, tagType: BattlerTagType, sourceId?: number): boolean {
  if (tagType === BattlerTagType.THROAT_CHOPPED && hasWorkingTactical(pokemon, "throatSpray")) {
    return true;
  }
  if (MENTAL_HERB_TAGS.has(tagType) && sourceId !== pokemon.id) {
    const herb = heldTacticalItem(pokemon, "mentalHerb");
    if (herb && !erIsHeldItemDisabled(pokemon, herb.type?.id)) {
      consumeTacticalItem(pokemon, herb);
      globalScene.phaseManager.queueMessage(
        `${pokemon.getNameToRender()}'s Mental Herb cured its mental affliction!`,
      );
      return true;
    }
  }
  return false;
}

// ===========================================================================
// Stat-stage-change hooks (Clear Amulet / Muscle Band / Wise Glasses guards,
// Adrenaline Orb, Eject Pack)
// ===========================================================================

/**
 * Guard a foe-inflicted stat DROP (called from StatStageChangePhase for each
 * dropping stat, `!selfTarget && stages < 0`):
 *   - Clear Amulet blocks any stat drop; Muscle Band blocks Attack; Wise Glasses
 *     blocks Sp. Atk.
 *   - Adrenaline Orb fires on a foe's Attack-lowering ATTEMPT (even if blocked),
 *     unless an Eject Pack is about to fire on an unblocked drop.
 * Returns `true` when the drop must be cancelled.
 */
export function erTacticalGuardStatDrop(pokemon: Pokemon, stat: Stat, source?: Pokemon): boolean {
  let blocked = false;
  let blockName = "";
  if (hasWorkingTactical(pokemon, "clearAmulet")) {
    blocked = true;
    blockName = "Clear Amulet";
  } else if (stat === Stat.ATK && hasWorkingTactical(pokemon, "muscleBand")) {
    blocked = true;
    blockName = "Muscle Band";
  } else if (stat === Stat.SPATK && hasWorkingTactical(pokemon, "wiseGlasses")) {
    blocked = true;
    blockName = "Wise Glasses";
  }

  // Adrenaline Orb: a foe trying to lower the holder's Attack raises Speed once.
  if (stat === Stat.ATK && source != null && source !== pokemon) {
    const orb = heldTacticalItem(pokemon, "adrenalineOrb");
    const willDrop = !blocked;
    const ejectWins = willDrop && hasWorkingTactical(pokemon, "ejectPack");
    if (orb && !erIsHeldItemDisabled(pokemon, orb.type?.id) && !ejectWins) {
      consumeTacticalItem(pokemon, orb);
      globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Adrenaline Orb kicked in!`);
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [Stat.SPD],
        1,
      );
    }
  }

  if (blocked) {
    globalScene.phaseManager.queueMessage(
      `${pokemon.getNameToRender()}'s ${blockName} prevented its stats from being lowered!`,
    );
  }
  return blocked;
}

/**
 * After a foe-inflicted drop actually applies (called from StatStageChangePhase's
 * end): an Eject Pack switches the holder out. Consumed.
 */
export function erTacticalAfterStatDrop(pokemon: Pokemon, wasLoweredByFoe: boolean): void {
  if (!wasLoweredByFoe || !pokemon.isActive(true)) {
    return;
  }
  if (pokemon.getOpponents().some(opp => opp.hasAbilityWithAttr("PreventItemUseAbAttr"))) {
    return;
  }
  const pack = heldTacticalItem(pokemon, "ejectPack");
  if (pack && !erIsHeldItemDisabled(pokemon, pack.type?.id) && queueHolderEject(pokemon)) {
    consumeTacticalItem(pokemon, pack);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Eject Pack activated!`);
  }
}

/**
 * Room Service (called from TrickRoomTag.onAdd): every on-field holder drops
 * Speed by 1 and consumes its Room Service.
 */
export function erApplyRoomServiceOnTrickRoom(): void {
  for (const pokemon of globalScene.getField(true)) {
    const service = heldTacticalItem(pokemon, "roomService");
    if (!service || erIsHeldItemDisabled(pokemon, service.type?.id)) {
      continue;
    }
    consumeTacticalItem(pokemon, service);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Room Service kicked in!`);
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [Stat.SPD],
      -1,
    );
  }
}

// ===========================================================================
// On-summon hooks (Air Balloon message, Covert Cloak / Cacjack fog, Booster Energy)
// ===========================================================================

/** ER post-summon chokepoint (called from PostSummonPhase beside the terrain-seed hook). */
export function erTacticalOnSummon(pokemon: Pokemon): void {
  if (!pokemon.isActive(true)) {
    return;
  }

  // Air Balloon: announce the float on switch-in.
  if (erTacticalAirBalloonUngrounds(pokemon)) {
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} floats with its Air Balloon!`);
  }

  // Covert Cloak on Cacjack: summon Eerie Fog (the ER Ghost/Psychic weather).
  if (
    hasWorkingTactical(pokemon, "covertCloak")
    && pokemon.hasSpecies(ErSpeciesId.CACJACK as unknown as SpeciesId)
  ) {
    globalScene.arena.trySetWeather(WeatherType.EERIE_FOG, pokemon, 8);
  }

  // Booster Energy: power up Protosynthesis / Quark Drive if not naturally active.
  erApplyBoosterEnergyOnSummon(pokemon);
}

/**
 * Booster Energy: on entry, if the holder has Protosynthesis / Quark Drive and no
 * sun / Electric Terrain is already powering it, spend the charge to apply the
 * corresponding battler tag. The charge is marked SPENT (not removed) and
 * recharges over 10 won waves.
 */
function erApplyBoosterEnergyOnSummon(pokemon: Pokemon): void {
  const energy = heldTacticalItem(pokemon, "boosterEnergy");
  if (!energy || energy.spent || erIsHeldItemDisabled(pokemon, energy.type?.id)) {
    return;
  }
  let tag: BattlerTagType | null = null;
  if (pokemon.hasAbility(AbilityId.PROTOSYNTHESIS)) {
    tag = BattlerTagType.PROTOSYNTHESIS;
  } else if (pokemon.hasAbility(AbilityId.QUARK_DRIVE)) {
    tag = BattlerTagType.QUARK_DRIVE;
  }
  if (tag === null || pokemon.getTag(tag)) {
    // No matching ability, or the field already powered it up (don't waste a charge).
    return;
  }
  energy.spent = true;
  energy.waveProgress = 0;
  globalScene.updateModifiers(pokemon.isPlayer());
  // The Proto/Quark tag computes and boosts the holder's highest stat on add; it
  // has no weather/terrain gate in canAdd (the ability's conditionalAttr owns
  // that), so the charge forces it exactly as mainline Booster Energy does.
  pokemon.addTag(tag);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Booster Energy activated!`);
}

/**
 * Booster Energy recharge (called from BattleEndPhase next to the community-item
 * and Ward Stone rechargers): +1 wave of progress per won wave; a spent booster
 * recharges after 10 won waves.
 */
export function erAdvanceTacticalRecharges(): void {
  try {
    for (const mod of globalScene.findModifiers(
      m => m instanceof ErTacticalItemModifier && (m as ErTacticalItemModifier).kind === "boosterEnergy",
      true,
    )) {
      const energy = mod as ErTacticalItemModifier;
      if (!energy.spent) {
        energy.waveProgress = 0;
        continue;
      }
      energy.waveProgress++;
      if (energy.waveProgress >= ER_BOOSTER_ENERGY_RECHARGE_WAVES) {
        energy.spent = false;
        energy.waveProgress = 0;
        globalScene.updateModifiers(true);
      }
    }
  } catch {
    // Recharging must never break the battle-end flow.
  }
}

// ===========================================================================
// Turn-end hook (Sticky Barb)
// ===========================================================================

/** Sticky Barb (called from TurnEndPhase): 1/8 max-HP indirect damage. */
export function erApplyStickyBarbTurnEnd(pokemon: Pokemon): void {
  if (!pokemon.isActive(true) || pokemon.hp <= 0) {
    return;
  }
  if (!hasWorkingTactical(pokemon, "stickyBarb")) {
    return;
  }
  const cancelled = new BooleanHolder(false);
  // Routed as INDIRECT + honoring BlockNonDirectDamage so Magic Guard is exempt.
  applyBlockNonDirectDamage(pokemon, cancelled);
  if (cancelled.value) {
    return;
  }
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} is hurt by its Sticky Barb!`);
  pokemon.damageAndUpdate(toDmgValue(pokemon.getMaxHp() / ER_STICKY_BARB_FRACTION), {
    result: HitResult.INDIRECT,
    ignoreSegments: true,
  });
}

/** Local Magic-Guard-class check for Sticky Barb's turn-end chip. */
function applyBlockNonDirectDamage(pokemon: Pokemon, cancelled: BooleanHolder): void {
  // Magic Guard and friends carry BlockNonDirectDamageAbAttr; scan by attr name to
  // avoid importing the ability apply surface (load-order safety).
  if (pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "BlockNonDirectDamageAbAttr")) {
    cancelled.value = true;
  }
}

// ===========================================================================
// On-hit hooks (Air Balloon pop, Throat Spray, Sticky Barb transfer, switches)
// ===========================================================================

/**
 * Air Balloon pop (called from MoveEffectPhase BEFORE the switch items): a hit
 * that deals damage pops the (unpopped) balloon. Popping is not a switch, so a
 * popped balloon and an eject can both fire on the same hit.
 */
export function erPopAirBalloonOnHit(target: Pokemon, dealsDamage: boolean): void {
  if (!dealsDamage || !target.isActive(true) || target.turnData.hitsLeft > 1) {
    return;
  }
  const balloon = heldTacticalItem(target, "airBalloon");
  if (!balloon || balloon.spent) {
    return;
  }
  consumeTacticalItem(target, balloon);
  globalScene.phaseManager.queueMessage(`${target.getNameToRender()}'s Air Balloon popped!`);
}

/**
 * Sticky Barb transfer (called from MoveEffectPhase on a contact hit): the barb
 * moves from the struck holder to the attacker if the attacker doesn't already
 * carry one.
 */
export function erTransferStickyBarbOnHit(user: Pokemon, target: Pokemon, makesContact: boolean, dealsDamage: boolean): void {
  if (!dealsDamage || !makesContact || !user.isActive(true) || target.turnData.hitsLeft > 1) {
    return;
  }
  const barb = heldTacticalItem(target, "stickyBarb");
  if (!barb || erIsHeldItemDisabled(target, barb.type?.id)) {
    return;
  }
  if (heldTacticalItem(user, "stickyBarb")) {
    return; // the attacker already has a barb
  }
  // Move the modifier: remove from the target, grant a fresh one to the attacker.
  globalScene.removeModifier(barb, !target.isPlayer());
  globalScene.updateModifiers(target.isPlayer());
  const transferred = new ErTacticalItemModifier(erTacticalItemType("stickyBarb"), user.id, "stickyBarb", false, 0, 1);
  globalScene.addModifier(transferred, true, false, false, false);
  globalScene.phaseManager.queueMessage(
    `${target.getNameToRender()}'s Sticky Barb latched onto ${user.getNameToRender()}!`,
  );
}

/**
 * Throat Spray (called from MoveEffectPhase when the holder resolves a move): a
 * successful SOUND_BASED move raises the user's Sp. Atk by 1, then the spray is
 * consumed.
 */
export function erApplyThroatSprayOnUse(user: Pokemon, move: Move): void {
  if (!user.isActive(true) || !move.hasFlag(MoveFlags.SOUND_BASED)) {
    return;
  }
  const spray = heldTacticalItem(user, "throatSpray");
  if (!spray || erIsHeldItemDisabled(user, spray.type?.id)) {
    return;
  }
  consumeTacticalItem(user, spray);
  globalScene.phaseManager.queueMessage(`${user.getNameToRender()}'s Throat Spray boosted its Sp. Atk!`);
  globalScene.phaseManager.unshiftNew("StatStageChangePhase", user.getBattlerIndex(), true, [Stat.SPATK], 1);
}

/**
 * Blunder Policy (called from MoveEffectPhase's accuracy-miss branch): a move
 * that misses an accuracy roll sharply raises the holder's Speed. Consumed.
 */
export function erApplyBlunderPolicyOnMiss(user: Pokemon): void {
  if (!user.isActive(true)) {
    return;
  }
  const policy = heldTacticalItem(user, "blunderPolicy");
  if (!policy || erIsHeldItemDisabled(user, policy.type?.id)) {
    return;
  }
  consumeTacticalItem(user, policy);
  globalScene.phaseManager.queueMessage(`${user.getNameToRender()}'s Blunder Policy sharply raised its Speed!`);
  globalScene.phaseManager.unshiftNew("StatStageChangePhase", user.getBattlerIndex(), true, [Stat.SPD], 2);
}

/**
 * Fire Red Card / Eject Button on the TARGET after it survives a damaging hit.
 * Called from the move-effect phase beside the reactive-item hook, on the LAST
 * strike of a multi-hit move only. Eject Button outprioritizes Red Card when
 * (in theory) both could fire on the same hit.
 */
export function erApplyTacticalSwitchOnHit(user: Pokemon, target: Pokemon, dealsDamage: boolean): void {
  if (!dealsDamage || !target.isActive(true) || user.turnData.hitsLeft > 1) {
    return;
  }
  // As One (Calyrex riders) prevents opponents from consuming held items - the
  // same gate the reactive items and gems use.
  if (target.getOpponents().some(opp => opp.hasAbilityWithAttr("PreventItemUseAbAttr"))) {
    return;
  }

  // --- Eject Button: the HOLDER leaves the field; its side picks the switch-in.
  const ejectButton = heldTacticalItem(target, "ejectButton");
  if (ejectButton && !erIsHeldItemDisabled(target, ejectButton.type?.id) && queueHolderEject(target)) {
    consumeTacticalItem(target, ejectButton);
    globalScene.phaseManager.queueMessage(
      `${target.getNameToRender()}'s ${ER_TACTICAL_CONFIG[ejectButton.kind].name} activated!`,
    );
    return; // Eject Button outprioritizes Red Card; only one switch effect fires
  }

  // --- Red Card: the ATTACKER is dragged out for a random eligible replacement.
  const redCard = heldTacticalItem(target, "redCard");
  if (
    redCard
    && !erIsHeldItemDisabled(target, redCard.type?.id)
    && user.isActive(true)
    && !user.hasAbilityWithAttr("ForceSwitchOutImmunityAbAttr")
    && queueAttackerDragOut(user)
  ) {
    consumeTacticalItem(target, redCard);
    globalScene.phaseManager.queueMessage(
      `${target.getNameToRender()}'s ${ER_TACTICAL_CONFIG[redCard.kind].name} activated!`,
    );
  }
}

/**
 * Holder switch (Eject Button / Eject Pack): the holder returns and its side
 * chooses the replacement (modal SwitchPhase for players, next-summon index for
 * enemy trainers). Wild holders have no bench - the item cannot fire.
 * Mirrors ForceSwitchOutHelper(SwitchType.SWITCH).switchOutLogic.
 */
function queueHolderEject(holder: Pokemon): boolean {
  if (holder.isPlayer()) {
    if (globalScene.getPlayerParty().filter(p => p.isAllowedInBattle() && !p.isOnField()).length === 0) {
      return false;
    }
    globalScene.phaseManager.queueDeferred("SwitchPhase", SwitchType.SWITCH, holder.getFieldIndex(), true, true);
    return true;
  }
  if (globalScene.currentBattle.battleType === BattleType.WILD) {
    return false; // a wild holder has nothing to switch into
  }
  if (globalScene.getEnemyParty().filter(p => p.isAllowedInBattle() && !p.isOnField()).length === 0) {
    return false;
  }
  const summonIndex = globalScene.currentBattle.trainer
    ? globalScene.currentBattle.trainer.getNextSummonIndex((holder as EnemyPokemon).trainerSlot)
    : 0;
  globalScene.phaseManager.queueDeferred(
    "SwitchSummonPhase",
    SwitchType.SWITCH,
    holder.getFieldIndex(),
    summonIndex,
    false,
    false,
  );
  return true;
}

/**
 * Red Card drag-out: the attacker is replaced by a RANDOM eligible party
 * member (seeded roll). Mirrors ForceSwitchOutAttr's FORCE_SWITCH branches,
 * including the co-op #811 own-bench restriction so a dragged player keeps
 * owning a field slot. A wild attacker is unaffected (mainline fleeing would
 * end the wave and eat its rewards - deliberately out of scope).
 */
function queueAttackerDragOut(attacker: Pokemon): boolean {
  if (attacker.isPlayer()) {
    const party = globalScene.getPlayerParty();
    const eligible: number[] = [];
    party.forEach((pokemon, index) => {
      if (pokemon.isAllowedInBattle() && !pokemon.isOnField()) {
        eligible.push(index);
      }
    });
    if (eligible.length === 0) {
      return false;
    }
    // Co-op (#811): restrict the forced roll to the dragged player's OWN bench
    // when possible, so one player never ends up owning both slots.
    let pool = eligible;
    if (globalScene.gameMode?.isCoop && attacker.coopOwner != null) {
      const sameOwner = eligible.filter(i => party[i].coopOwner === attacker.coopOwner);
      if (sameOwner.length > 0) {
        pool = sameOwner;
      }
    }
    const slotIndex = pool[attacker.randBattleSeedInt(pool.length)];
    globalScene.phaseManager.queueDeferred(
      "SwitchSummonPhase",
      SwitchType.FORCE_SWITCH,
      attacker.getFieldIndex(),
      slotIndex,
      false,
      true,
    );
    return true;
  }
  if (globalScene.currentBattle.battleType === BattleType.WILD) {
    return false;
  }
  const isPartnerTrainer = globalScene.currentBattle.trainer?.isPartner();
  const eligible: number[] = [];
  globalScene.getEnemyParty().forEach((pokemon, index) => {
    if (
      pokemon.isAllowedInBattle()
      && !pokemon.isOnField()
      && (!isPartnerTrainer || pokemon.trainerSlot === (attacker as EnemyPokemon).trainerSlot)
    ) {
      eligible.push(index);
    }
  });
  if (eligible.length === 0) {
    return false;
  }
  const slotIndex = eligible[attacker.randBattleSeedInt(eligible.length)];
  globalScene.phaseManager.queueDeferred(
    "SwitchSummonPhase",
    SwitchType.FORCE_SWITCH,
    attacker.getFieldIndex(),
    slotIndex,
    false,
    false,
  );
  return true;
}
