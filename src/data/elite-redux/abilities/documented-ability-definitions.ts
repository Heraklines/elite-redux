/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { ManualCompositeDef } from "#data/elite-redux/abilities/composite-newcomers";
import type { FakemonPitchAbilityDefinition } from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { AbilityId } from "#enums/ability-id";

// Append-only ids. Species/art review does not change these save-stable values.
export const DOCUMENTED_COMPOSITES: readonly ManualCompositeDef[] = [
  {
    id: 6117,
    name: "Self-Preservation",
    description: "Self Sufficient + Regenerator.",
    constituents: [5045, AbilityId.REGENERATOR],
  },
  {
    id: 6118,
    name: "Chemical Waste",
    description: "Liquified + Corrosion.",
    constituents: [5049, AbilityId.CORROSION],
  },
  {
    id: 6119,
    name: "Fossil Fueled",
    description: "Fossilized + Steam Engine.",
    constituents: [5041, AbilityId.STEAM_ENGINE],
  },
  {
    id: 6120,
    name: "Cistern",
    description: "Storm Drain + Rain Dish.",
    constituents: [AbilityId.STORM_DRAIN, AbilityId.RAIN_DISH],
  },
  {
    id: 6121,
    name: "Shiny Shell",
    description: "Shell Armor + Iron Barbs.",
    constituents: [AbilityId.SHELL_ARMOR, AbilityId.IRON_BARBS],
  },
  {
    id: 6122,
    name: "Mirror Polish",
    description: "Clear Body + Steelworker.",
    constituents: [AbilityId.CLEAR_BODY, AbilityId.STEELWORKER],
  },
  {
    id: 6123,
    name: "Bouldergeist",
    description: "Solid Rock + Haunted Spirit.",
    constituents: [AbilityId.SOLID_ROCK, 5073],
  },
  {
    id: 6124,
    name: "War of Attrition",
    description: "Battle Armor + Stamina.",
    constituents: [AbilityId.BATTLE_ARMOR, AbilityId.STAMINA],
  },
  {
    id: 6125,
    name: "Monarch's Remorse",
    description: "Supreme Overlord + Avenger.",
    constituents: [AbilityId.SUPREME_OVERLORD, 5030],
  },
  {
    id: 6126,
    name: "Translucent Skin",
    description: "Clear Body + Wonder Skin.",
    constituents: [AbilityId.CLEAR_BODY, AbilityId.WONDER_SKIN],
  },
  { id: 6127, name: "Pilferfist", description: "Combat Specialist + Phantom Thief.", constituents: [5193, 5250] },
  { id: 6128, name: "Zap Tap", description: "Static + Sharp Edges.", constituents: [AbilityId.STATIC, 5289] },
  { id: 6129, name: "Skull and Cross", description: "Bone Zone + Multi-Headed.", constituents: [5091, 5085] },
  { id: 6130, name: "Air-Headed", description: "Inflatable + Levitate.", constituents: [5028, AbilityId.LEVITATE] },
  {
    id: 6131,
    name: "Ballistic-Proof",
    description: "Bulletproof + Soundproof.",
    constituents: [AbilityId.BULLETPROOF, AbilityId.SOUNDPROOF],
  },
  {
    id: 6132,
    name: "Refract",
    description: "Prism Armor + Prism Scales.",
    constituents: [AbilityId.PRISM_ARMOR, 5010],
  },
  {
    id: 6133,
    name: "Plated",
    description: "Battle Armor + Rough Skin.",
    constituents: [AbilityId.BATTLE_ARMOR, AbilityId.ROUGH_SKIN],
  },
  {
    id: 6134,
    name: "Frootball",
    description: "Ball Fetch + Harvest.",
    constituents: [AbilityId.BALL_FETCH, AbilityId.HARVEST],
  },
  { id: 6135, name: "Sweet Tooth", description: "Sugar Rush + Growing Tooth.", constituents: [5356, 5027] },
  { id: 6136, name: "Nightstalker", description: "Deviate + Nocturnal.", constituents: [5501, 5044] },
  {
    id: 6137,
    name: "Powerhouse",
    description: "Battle Armor + Juggernaut.",
    constituents: [AbilityId.BATTLE_ARMOR, 5059],
  },
  {
    id: 6138,
    name: "Lethal Thorns",
    description: "Poison Touch + Toxic Debris.",
    constituents: [AbilityId.POISON_TOUCH, AbilityId.TOXIC_DEBRIS],
  },
  {
    id: 6139,
    name: "Impregnable",
    description: "Fort Knox + Battle Armor.",
    constituents: [5079, AbilityId.BATTLE_ARMOR],
  },
  { id: 6140, name: "Toxic Trance", description: "Neurotoxin + Corrosion.", constituents: [5451, AbilityId.CORROSION] },
  { id: 6141, name: "Unhinged", description: "Hover + Hyper Aggressive.", constituents: [5418, 5096] },
  { id: 6142, name: "Revenant", description: "Spectralize + Aftermath.", constituents: [5123, AbilityId.AFTERMATH] },
  {
    id: 6143,
    name: "Ghostlight",
    description: "Flare Boost + Low Visibility.",
    constituents: [AbilityId.FLARE_BOOST, 5323],
  },
  { id: 6144, name: "Cordyspook", description: "Jumpscare + Parasitic Spores.", constituents: [5421, 5314] },
  { id: 6145, name: "Rock It Socket", description: "Ground Shock + Fighting Spirit.", constituents: [5023, 5038] },
  { id: 6146, name: "Rotten Shaman", description: "Magician + Envenom.", constituents: [AbilityId.MAGICIAN, 5553] },
  {
    id: 6147,
    name: "Blight of Hand",
    description: "Pickpocket + Envenom.",
    constituents: [AbilityId.PICKPOCKET, 5553],
  },
  { id: 6148, name: "Fractured Mind", description: "Corrupted Mind + Split Mind.", constituents: [5475, 6045] },
  { id: 6149, name: "Guarded Knowledge", description: "Impenetrable + Enlightened.", constituents: [5064, 5219] },
  {
    id: 6150,
    name: "Soul Construct",
    description: "Soul-Heart + Power Core.",
    constituents: [AbilityId.SOUL_HEART, 5105],
  },
  {
    id: 6151,
    name: "Ironclad",
    description: "Full Metal Body + Steelworker.",
    constituents: [AbilityId.FULL_METAL_BODY, AbilityId.STEELWORKER],
  },
  {
    id: 6152,
    name: "Evil Eye",
    description: "Unnerve + Dark Aura.",
    constituents: [AbilityId.UNNERVE, AbilityId.DARK_AURA],
  },
  {
    id: 6153,
    name: "Primitive Magma",
    description: "Molten Core + Magma Armor.",
    constituents: [5573, AbilityId.MAGMA_ARMOR],
  },
  {
    id: 6154,
    name: "Metallurgy",
    description: "Steelworker + Flash Fire.",
    constituents: [AbilityId.STEELWORKER, AbilityId.FLASH_FIRE],
  },
  {
    id: 6155,
    name: "Electrical Overload",
    description: "Volt Absorb + Overcharge.",
    constituents: [AbilityId.VOLT_ABSORB, 5087],
  },
  {
    id: 6156,
    name: "Virtuoso",
    description: "Technician + Skill Link.",
    constituents: [AbilityId.TECHNICIAN, AbilityId.SKILL_LINK],
  },
  { id: 6157, name: "Rorschach", description: "Power Spot + Equinox.", constituents: [AbilityId.POWER_SPOT, 5160] },
  { id: 6158, name: "Lignivore", description: "Growing Tooth + Raw Wood.", constituents: [5027, 5075] },
];

export const ER_IRRESISTIBLE_ABILITY_ID = 6159;
export const ER_SINISTER_SPORES_ABILITY_ID = 6160;
export const ER_MOONRISE_ABILITY_ID = 6161;
export const ER_LUNAR_RUSH_ABILITY_ID = 6162;
export const ER_LUNATIC_ABILITY_ID = 6163;

export const DOCUMENTED_ABILITY_DEFINITIONS: readonly FakemonPitchAbilityDefinition[] = [
  {
    pokerogueId: ER_MOONRISE_ABILITY_ID,
    draft: {
      id: ER_MOONRISE_ABILITY_ID,
      name: "Moonrise",
      description: "Summons Full Moon for 8 turns on entry. Mystical Rock extends its duration.",
      archetype: "unknown",
    },
  },
  {
    pokerogueId: ER_LUNAR_RUSH_ABILITY_ID,
    draft: {
      id: ER_LUNAR_RUSH_ABILITY_ID,
      name: "Lunar Rush",
      description: "Speed is boosted by 50% during Full Moon.",
      archetype: "unknown",
    },
  },
  {
    pokerogueId: ER_LUNATIC_ABILITY_ID,
    draft: {
      id: ER_LUNATIC_ABILITY_ID,
      name: "Lunatic",
      description: "The higher of Attack and Sp. Atk is boosted by 50% during Full Moon.",
      archetype: "unknown",
    },
  },
  ...DOCUMENTED_COMPOSITES.map(def => ({
    pokerogueId: def.id,
    draft: { id: def.id, name: def.name, description: def.description, archetype: "unknown" },
  })),
  {
    pokerogueId: ER_IRRESISTIBLE_ABILITY_ID,
    draft: {
      id: ER_IRRESISTIBLE_ABILITY_ID,
      name: "Irresistible",
      description: "Uses Follow Me on entry.",
      archetype: "unknown",
    },
  },
  {
    pokerogueId: ER_SINISTER_SPORES_ABILITY_ID,
    draft: {
      id: ER_SINISTER_SPORES_ABILITY_ID,
      name: "Sinister Spores",
      description:
        "Contact in either direction infects non-Dark Pokemon until they switch out. Infected Pokemon lose 1/8 max HP each turn, or 1/4 during Full Moon.",
      archetype: "unknown",
    },
  },
];
