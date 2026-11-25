/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The game rules a runtime-role marker can stand for (AbilityStudioRuntimeCapabilityAbAttr), written by hand in player words.
// Every id is one value of ABILITY_STUDIO_RUNTIME_CAPABILITIES (the 19 direct runtime effects first, then the 46 engine roles the
// game used to read by ability name); a test in B18/chunk4.test.ts fails when the game gains or loses one, so this list cannot go
// stale. The sentence is what staff see in the picker; the id is what the constructor takes.
import type { RolePick } from "./b18-chunk4-codecs";

export const ROLE_PICKS: readonly RolePick[] = [
  // ---- Direct runtime effects (what Studio-built abilities carry) ----
  { id: "accelerate-charge-skip", word: "Skip the charge turn of charging moves" },
  { id: "angels-wrath-move-rewrites", word: "Rewrite Tackle, Poison Sting, Electroweb and Bug Bite" },
  { id: "aurora-borealis-ice-weather", word: "Treat Ice weather rules as if hail or snow were active" },
  { id: "burn-fatigue-action-failure", word: "Burned Pokemon fail their action one time in three" },
  { id: "burn-fatigue-damage", word: "Burned Pokemon take 33% more damage" },
  { id: "chloroplast-sun-moves", word: "Weather Ball, solar moves, Growth and recovery moves act as in sun" },
  { id: "deadly-sentencing-suppression", word: "Suppress other Pokemon that know a Dark move" },
  { id: "dna-scramble-form-change", word: "Change Deoxys form to match the move it picks" },
  { id: "minion-control-hit-power", word: "Each extra hit of Minion Control deals 10% damage" },
  { id: "moon-spirit-moonlight-heal", word: "Moonlight restores at least 75% of max HP" },
  { id: "reap-and-sow-sun", word: "Abilities and moves act as in sun during Grassy Terrain" },
  { id: "relic-stone-stab-suppression", word: "Remove the same-type bonus (STAB) of every other Pokemon" },
  { id: "sleeping-in-repeat-block", word: "Block using the same sleep move twice in a row" },
  { id: "sleeping-in-yawn-style", word: "Sleep moves work like Yawn and last one turn" },
  { id: "spatial-magic-switch", word: "Swap both Pokemon out before a hit would knock me out" },
  { id: "symbiosis-item-transfer", word: "Pass my held item to an ally that just lost its item" },
  { id: "temporal-rupture-roar-of-time", word: "Roar of Time has 100 power, normal priority and no forced switch" },
  { id: "upcycle-food-field", word: "Every Pokemon counts as Food for Sugar Rush" },
  { id: "upcycle-poison-boost", word: "Sugar Rush deals double damage to Poison types" },
  // ---- Engine roles (the game used to ask "is this Pokemon X?" and now asks for the role) ----
  { id: "aura-break-inversion", word: "Reverse Dark Aura and Fairy Aura (like Aura Break)" },
  { id: "battle-bond-form", word: "Change into the Battle Bond form (like Battle Bond)" },
  {
    id: "berserk-volatile-boost",
    word: "Raise my better attacking stat when I get confused or enraged (like Berserk)",
  },
  { id: "comatose-sleep", word: "Count as asleep without a status (like Comatose)" },
  { id: "commander-hosting", word: "Hide inside an ally Dondozo and skip my turn (like Commander)" },
  { id: "dark-aura-field", word: "Strengthen Dark moves for everyone on the field (like Dark Aura)" },
  { id: "fairy-aura-field", word: "Strengthen Fairy moves for everyone on the field (like Fairy Aura)" },
  { id: "flower-gift-form", word: "Change Cherrim form with the weather (like Flower Gift)" },
  { id: "forecast-form", word: "Change Castform form with the weather (like Forecast)" },
  { id: "gulp-missile-form", word: "Gulp up a prey with Surf or Dive (like Gulp Missile)" },
  { id: "guts-status-boost", word: "Raise Attack while I have a status condition (like Guts)" },
  { id: "heavy-metal-weight", word: "Count as extra heavy (like Heavy Metal)" },
  { id: "ice-face-form", word: "Block a hit with an ice face and change form (like Ice Face)" },
  { id: "illuminate-dark-accuracy", word: "Cancel the accuracy loss in dark places (like Illuminate)" },
  { id: "klutz-item-suppression", word: "Make my held item do nothing (like Klutz)" },
  { id: "levitate-float", word: "Float above the ground (like Levitate)" },
  { id: "mimicry-terrain-type", word: "Take the type of the terrain (like Mimicry)" },
  { id: "minus-pairing", word: "Team up with a Plus Pokemon for a boost (like Minus)" },
  { id: "multitype-plate-forms", word: "Change form with the held plate (like Multitype)" },
  { id: "multitype-type-lock", word: "My type cannot be changed (like Multitype)" },
  { id: "overcoat-powder-immunity", word: "Immune to powder moves (like Overcoat)" },
  { id: "plus-pairing", word: "Team up with a Minus Pokemon for a boost (like Plus)" },
  { id: "poison-heal-recovery", word: "Heal instead of losing HP to poison (like Poison Heal)" },
  { id: "prankster-dark-immunity", word: "My status moves fail against Dark types (like Prankster)" },
  { id: "protosynthesis-booster", word: "Get a boost from sun or a Booster Energy item (like Protosynthesis)" },
  { id: "quark-drive-booster", word: "Get a boost from Electric Terrain or a Booster Energy item (like Quark Drive)" },
  { id: "quick-draw-target", word: "Be hit by the Quick Draw double-power bonus (like Quick Draw)" },
  { id: "rks-system-memory-forms", word: "Change form with the held memory (like Silvally's ability)" },
  { id: "rks-system-type-lock", word: "My type cannot be changed (like Silvally's ability)" },
  { id: "sand-force-moveset", word: "Let enemy move choices treat me like Sand Force" },
  { id: "shadow-tag-trap-immunity", word: "Immune to Shadow-style trapping (like the trapping ability itself)" },
  { id: "sheer-force-secondary-effects", word: "Skip Life Orb recoil on moves with extra effects (like Sheer Force)" },
  { id: "snow-warning-moveset", word: "Let enemy move choices treat me like Snow Warning" },
  { id: "solar-power-moveset", word: "Let enemy move choices treat me like Solar Power" },
  { id: "stance-change-forms", word: "Change between attack and defense stances (like Stance Change)" },
  { id: "stench-toxic-terrain", word: "Keep the field safe from Toxic Terrain damage (like Stench)" },
  { id: "truant-loafing", word: "Loaf around every other turn (like Truant)" },
  { id: "unburden-speed", word: "My Speed is never lowered by stat stages (like Unburden)" },
  { id: "wandering-spirit-swap", word: "Swap abilities with an attacker that makes contact (like Wandering Spirit)" },
  { id: "wind-power-charge", word: "Become charged when Tailwind starts (like Wind Power)" },
  { id: "wind-rider-boost", word: "Raise Attack when Tailwind starts (like Wind Rider)" },
  { id: "wonder-guard-boss-catch", word: "Can be caught while boss shield bars remain (like Wonder Guard)" },
  { id: "wonder-guard-single-hp", word: "Have exactly 1 max HP (like Wonder Guard on Shedinja)" },
];
