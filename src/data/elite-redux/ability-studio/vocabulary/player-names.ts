/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Enum constants ("GROUND", "HEAVY_RAIN", "SPATK") and the words a player uses
// for them ("Ground", "Heavy rain", "Sp. Atk"), both ways: `playerName` for what the picker and summaries show,
// `constantName` for reading back what staff typed into a text setting.

/** Player-facing words for enum constants whose plain title-casing would read badly. */
const PLAYER_NAMES: Readonly<Record<string, string>> = {
  ATK: "Attack",
  DEF: "Defense",
  SPATK: "Sp. Atk",
  SPDEF: "Sp. Def",
  SPD: "Speed",
  ACC: "Accuracy",
  EVA: "Evasion",
  SUNNY: "Sun",
  HARSH_SUN: "Extremely harsh sunlight",
  HEAVY_RAIN: "Heavy rain",
  STRONG_WINDS: "Strong winds",
  TEMPEST_STORM: "Tempest storm",
  SNOWY_WRATH: "Snowy wrath",
  EERIE_FOG: "Eerie fog",
  TOXIC: "Toxic",
  NONE: "None",
  BALLBOMB_MOVE: "Ball or bomb move",
};

/** A single constant such as GROUND or HEAVY_RAIN (not a lone letter, not a sentence). */
export const CONSTANT = /^[A-Z][A-Z0-9_]+$/;

/** "GROUND" -> "Ground", "HEAVY_RAIN" -> "Heavy rain", "SPATK" -> "Sp. Atk". Anything else is returned unchanged. */
export function playerName(token: string): string {
  if (!CONSTANT.test(token)) {
    return token;
  }
  const known = PLAYER_NAMES[token];
  if (known !== undefined) {
    return known;
  }
  const words = token.toLowerCase().split("_");
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

const CONSTANT_BY_PLAYER_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PLAYER_NAMES).map(([constant, name]) => [name.toUpperCase(), constant]),
);

/**
 * The reverse of playerName for typed settings: "Heavy rain" -> "HEAVY_RAIN", "Sp. Atk" -> "SPATK", "Sun" -> "SUNNY",
 * "King's Shield" -> "KINGS_SHIELD". Trims, upper-cases, drops apostrophes and full stops, and turns spaces and hyphens
 * into underscores; "HEAVY_RAIN" comes back unchanged.
 */
export function constantName(text: string): string {
  const upper = text.trim().toUpperCase();
  return CONSTANT_BY_PLAYER_NAME[upper] ?? upper.replace(/['’.]/g, "").replace(/[\s-]+/g, "_");
}
