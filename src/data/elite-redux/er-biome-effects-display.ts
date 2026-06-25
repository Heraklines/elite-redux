/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER World Map - per-biome "Conditions" panel text (#129).
//
// A PURE, player-facing formatter that turns a biome's mechanical identity into a
// short, ordered list of effect lines for the World Map's Conditions footer. It
// only READS the existing per-biome tables (battle rules, economy, item flavor),
// so it has no GameManager / globalScene dependency and is unit-testable ungated.
//
// SCOPE: in-battle / field FLAVOR + economy + held-item gem flavor only. It does
// NOT surface spawn tables, mystery-encounter odds, boss / trainer rates, or the
// global notoriety meter - those are deliberately excluded (they are not a fixed
// per-biome "condition" the player can read off the map).
//
// NEVER use an em dash in any line (maintainer rule for player-facing text).
// =============================================================================

import { ER_BIOME_ECONOMY } from "#data/elite-redux/er-biome-economy";
import { getErBiomeItemFlavor } from "#data/elite-redux/er-biome-item-flavor";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { TerrainType } from "#data/terrain";
import { BiomeId } from "#enums/biome-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";

/** Readable, capitalized type name for the two biomes that field a typeBoost. */
function typeName(type: PokemonType): string {
  switch (type) {
    case PokemonType.FIRE:
      return "Fire";
    case PokemonType.FLYING:
      return "Flying";
    default: {
      // Generic fallback (no biome uses these today, but keep it robust + readable).
      const name = PokemonType[type] ?? "";
      return name ? name.charAt(0) + name.slice(1).toLowerCase() : "";
    }
  }
}

/** A forced weather's player-facing label, or "" if it has no Conditions line. */
function weatherLabel(weather: WeatherType): string {
  switch (weather) {
    case WeatherType.SANDSTORM:
      return "Always a sandstorm";
    case WeatherType.SNOW:
      return "Always snowing";
    case WeatherType.FOG:
      return "Always foggy";
    case WeatherType.SUNNY:
      return "Always sunny";
    case WeatherType.RAIN:
      return "Always raining";
    default:
      return "";
  }
}

/** A forced terrain's player-facing label - names the terrain so the player knows
 *  which one (Grassy heals + boosts Grass, Electric blocks sleep, Psychic blocks
 *  priority, Misty softens Dragon). "" for none. */
function terrainLabel(terrain: TerrainType): string {
  switch (terrain) {
    case TerrainType.GRASSY:
      return "Grassy terrain";
    case TerrainType.ELECTRIC:
      return "Electric terrain";
    case TerrainType.PSYCHIC:
      return "Psychic terrain";
    case TerrainType.MISTY:
      return "Misty terrain";
    default:
      return "";
  }
}

/**
 * The ordered, concise list of a biome's special mechanical CONDITIONS for the
 * World Map Conditions panel. Most-notable first (weather / terrain / ambush /
 * doubles / type boost / entry status, then the field rules, then economy, then
 * the dominant held-item gem). Capped so it fits the footer; returns [] for a
 * "vanilla-ish" biome with nothing special to say.
 */
export function getErBiomeEffectLines(biomeId: BiomeId): string[] {
  const lines: string[] = [];
  const rule = getErBiomeRule(biomeId);

  // --- Weather (forced ambient) --------------------------------------------
  // VOLCANO ("always sunny") and SEABED ("always raining") get their signature
  // weather from their vanilla weather POOL, not the rule table - special-case
  // them here so the map still reads their defining weather.
  if (rule?.weather !== undefined) {
    const label = weatherLabel(rule.weather);
    if (label) {
      lines.push(label);
    }
  } else if (biomeId === BiomeId.VOLCANO) {
    lines.push("Always sunny");
  } else if (biomeId === BiomeId.SEABED) {
    lines.push("Always raining");
  }

  // --- Terrain (forced ambient) --------------------------------------------
  if (rule?.terrain !== undefined) {
    const label = terrainLabel(rule.terrain);
    if (label) {
      lines.push(label);
    }
  }

  // --- Ambush --------------------------------------------------------------
  if (rule?.ambushChance) {
    lines.push(`${rule.ambushChance}% ambush if the foe outspeeds your lead`);
  }

  // --- Double-battle bias --------------------------------------------------
  if (rule?.doubleBattleMult && rule.doubleBattleMult > 1) {
    lines.push("Double battles twice as likely");
  }

  // --- Type damage boost ---------------------------------------------------
  if (rule?.typeBoost) {
    const pct = Math.round((rule.typeBoost.mult - 1) * 100);
    lines.push(`${typeName(rule.typeBoost.type)} moves +${pct}%`);
  }

  // --- Entry status risk ---------------------------------------------------
  if (rule?.entryStatus) {
    lines.push(`${rule.entryStatus.chance}% ${rule.entryStatus.kind} on entry`);
  }

  // --- Field rules (group C/E/F flags) -------------------------------------
  if (rule?.groundedSpdDrop || rule?.groundedAccuracyMult) {
    lines.push("Zero-g: grounded mons lose Speed and accuracy");
  }
  if (rule?.accuracyMult !== undefined && rule.accuracyMult < 1) {
    const pct = Math.round((1 - rule.accuracyMult) * 100);
    lines.push(`High winds: -${pct}% accuracy`);
  }
  if (rule?.darkness) {
    lines.push("Darkness: -10% accuracy without Flash");
  }
  if (rule?.swimmerSpdDrop) {
    lines.push("Non-swimmers lose Speed on entry");
  }
  if (rule?.bogChip) {
    lines.push("Bog: grounded non-Poison/Steel lose HP each turn");
  }
  if (rule?.darkCritBoost) {
    lines.push("Dark moves crit more easily");
  }
  if (rule?.fairyBlessing) {
    lines.push("No infatuation; sleep ends sooner");
  }
  if (rule?.berrySaveChance) {
    lines.push(`${rule.berrySaveChance}% to keep an eaten berry`);
  }
  if (rule?.runNeverFails) {
    lines.push("You can always escape");
  }
  if (rule?.wildLevelBonus) {
    lines.push(`Wild mons are +${rule.wildLevelBonus} levels`);
  }
  if (rule?.regionalBoost || rule?.reduxFormBoost) {
    lines.push("More regional and Redux forms in the wild");
  }

  // --- Economy (shop stock / pricing notes) --------------------------------
  // Read the table directly (the erBiome* lookups pull the balance-tuned price,
  // which needs globalScene - this formatter stays pure).
  const eco = ER_BIOME_ECONOMY[biomeId];
  if (eco) {
    if (eco.noShop) {
      lines.push("No shop here");
    } else {
      const sellsBerries = eco.cheap.includes("BERRY") || eco.signature.includes("BERRY");
      if (sellsBerries) {
        lines.push("Berries cheap and well stocked");
      } else if (eco.dear.includes("BERRY")) {
        lines.push("Berries sold, marked up");
      }
      if (eco.priceMod < 1) {
        lines.push("Cheap shop");
      } else if (eco.priceMod > 1) {
        lines.push("Pricey shop");
      }
    }
  }

  // --- Held-item gem flavor (one line, the dominant gem) -------------------
  const flavor = getErBiomeItemFlavor(biomeId);
  if (flavor) {
    const gem = dominantGemName(flavor.pool);
    if (gem) {
      const article = /^[AEIOU]/.test(gem) ? "an" : "a";
      lines.push(`Wild mons often hold ${article} ${gem} (${flavor.chance}%)`);
    }
  }

  // Keep the footer tidy: most-notable first, capped at six lines.
  return lines.slice(0, 6);
}

/**
 * Turn the first GEM in a biome's held-item flavor pool into a readable name
 * ("ER_FIRE_GEM" -> "Fire Gem"). Returns "" when the pool leads with a non-gem
 * synergy item (Cell Battery, Snowball, ...) so we don't print "a Cell Battery".
 */
function dominantGemName(pool: string[]): string {
  const gemKey = pool.find(k => k.startsWith("ER_") && k.endsWith("_GEM"));
  if (!gemKey) {
    return "";
  }
  const core = gemKey.slice("ER_".length, gemKey.length - "_GEM".length); // e.g. "FIRE"
  if (!core) {
    return "";
  }
  return `${core.charAt(0) + core.slice(1).toLowerCase()} Gem`;
}
