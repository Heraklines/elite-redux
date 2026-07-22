/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ErAbilityDraft } from "#data/elite-redux/er-abilities";

export const ER_ECLIPSE_WING_ABILITY_ID = 5971;
export const ER_FINAL_SEASON_ABILITY_ID = 5972;
export const ER_FOUL_HARVEST_ABILITY_ID = 5973;
export const ER_POROUS_ABILITY_ID = 5974;
export const ER_GLAM_ROCK_ABILITY_ID = 5975;
export const ER_SEDIMENT_BLOOM_ABILITY_ID = 5976;
export const ER_TWO_FACED_UNLEASHED_ABILITY_ID = 5977;
export const ER_SKYHOOK_ABILITY_ID = 5978;
export const ER_ANNEAL_ABILITY_ID = 5979;
export const ER_LIVING_CHROME_ABILITY_ID = 5980;
export const ER_VAPOR_BODY_ABILITY_ID = 5981;
export const ER_HEAVYWEIGHT_ABILITY_ID = 5982;
export const ER_SPIRIT_PUNCH_ABILITY_ID = 5983;
export const ER_DEADEYE_DRAW_ABILITY_ID = 5984;
export const ER_BOOT_HILL_ABILITY_ID = 5985;
export const ER_GILLIE_SUIT_ABILITY_ID = 5986;
export const ER_RING_GENERAL_ABILITY_ID = 5987;
export const ER_ENCORE_SET_ABILITY_ID = 5988;
export const ER_SETLIST_ABILITY_ID = 5989;
export const ER_FAN_FAVORITE_ABILITY_ID = 5990;
export const ER_REDUCTION_ABILITY_ID = 5991;
export const ER_CRACKED_VESSEL_ABILITY_ID = 5992;
export const ER_CENTER_OF_ATTENTION_ABILITY_ID = 5993;
export const ER_SUPEREGO_ABILITY_ID = 5994;

export interface ManualSignatureAbilityDefinition {
  readonly draft: ErAbilityDraft;
  readonly pokerogueId: number;
}

function definition(id: number, name: string, description: string): ManualSignatureAbilityDefinition {
  return { draft: { id, name, description, archetype: "unknown" }, pokerogueId: id };
}

export const ER_NEWCOMER_SIGNATURE_ABILITIES: readonly ManualSignatureAbilityDefinition[] = [
  definition(
    ER_ECLIPSE_WING_ABILITY_ID,
    "Eclipse Wing",
    "Below one-third HP, Dark and Flying moves deal 1.5x damage. Once per battle, a direct hit that would knock this Pokemon out from full HP leaves it at 1 HP and triggers a 120-power Dark special counter. If that counter knocks out its target, this Pokemon faints at turn end.",
  ),
  definition(
    ER_FINAL_SEASON_ABILITY_ID,
    "Final Season",
    "On a voluntary switch-in, opposing Pokemon move last within their priority bracket for 2 turns. At that turn's end, this Pokemon sets Eerie Fog for 5 turns. During its own Eerie Fog, its Dark and Flying moves deal 1.3x damage.",
  ),
  definition(
    ER_FOUL_HARVEST_ABILITY_ID,
    "Foul Harvest",
    "Once per move, a direct hit drains 1 PP from the foe's most recently used move and stores a charge, up to 3. Draining moves heal 25% more damage per stored charge, consume one charge, and restore 1 PP to that move.",
  ),
  definition(
    ER_POROUS_ABILITY_ID,
    "Porous",
    "Takes half damage from sound moves. After taking a direct hit, its next Ground move gains 25% power, stacking up to 75%; the bonus is spent on use and resets on switch.",
  ),
  definition(
    ER_GLAM_ROCK_ABILITY_ID,
    "Glam Rock",
    "Cannot be forced out. At each turn's end, consumes one entry-hazard layer from its side and raises Defense and Sp. Def by 1.",
  ),
  definition(
    ER_SEDIMENT_BLOOM_ABILITY_ID,
    "Sediment Bloom",
    "When this Pokemon consumes or removes an entry hazard from its side, plants one removable Bloom on the opposing side. At turn end, Bloom drains 1/16 max HP from opposing Pokemon and heals this Pokemon's side by the amount drained.",
  ),
  definition(
    ER_TWO_FACED_UNLEASHED_ABILITY_ID,
    "Two-Faced Unleashed",
    "On alternating turns, damaging moves unleash this Pokemon: the move deals 1.5x damage, Electric and Dark moves deal a further 1.4x, and the user takes 15% nonlethal recoil. Cannot be copied, suppressed, or replaced.",
  ),
  definition(
    ER_SKYHOOK_ABILITY_ID,
    "Skyhook",
    "After this Pokemon directly damages a foe, it may pivot out once per turn. The incoming ally has a 20% chance to gain 1 Speed.",
  ),
  definition(
    ER_ANNEAL_ABILITY_ID,
    "Anneal",
    "After being hit by a resisted move, raises Defense for a physical move or Sp. Def for a special move. Gains at most 2 stages per switch-in and triggers once per move.",
  ),
  definition(
    ER_LIVING_CHROME_ABILITY_ID,
    "Living Chrome",
    "The first 3 genuine transformations each battle grant Shape Memory for 1 turn: resist the types of the form just left. Leaving base Eevee instead grants 25% damage reduction. Shape Memory does not change typing or stack.",
  ),
  definition(
    ER_VAPOR_BODY_ABILITY_ID,
    "Vapor Body",
    "Contact moves used against this Pokemon have 0.7x accuracy. Contact-based trapping moves cannot trap it.",
  ),
  definition(
    ER_HEAVYWEIGHT_ABILITY_ID,
    "Heavyweight",
    "Weight-based and punching moves gain 10% power per favorable weight class, up to 50%. The first such hit each turn lowers the target's Defense by 1.",
  ),
  definition(
    ER_SPIRIT_PUNCH_ABILITY_ID,
    "Spirit Punch",
    "Punching moves echo as a second Ghost hit at 30% power that ignores Defense boosts. The echo is 50% power if this Pokemon is Ghost-type, cannot crit, and cannot trigger on-KO effects.",
  ),
  definition(
    ER_DEADEYE_DRAW_ABILITY_ID,
    "Deadeye Draw",
    "Direct cannon or arrow damage marks one foe at a time. Cannon moves against the marked foe always critically hit and use its weaker defensive stat. The mark ends when either Pokemon leaves the field.",
  ),
  definition(
    ER_BOOT_HILL_ABILITY_ID,
    "Boot Hill",
    "A direct knockout plants a one-use Grave Marker on the opposing side. The next foe entering takes 1/8 max HP Ghost damage and loses 1 Speed.",
  ),
  definition(ER_GILLIE_SUIT_ABILITY_ID, "Gillie Suit", "Combines Predator and Protean."),
  definition(
    ER_RING_GENERAL_ABILITY_ID,
    "Ring General",
    "While above half HP, prevents opposing non-Ghost Pokemon without a Shed Shell from switching. Does not trap on the turn this Pokemon enters.",
  ),
  definition(
    ER_ENCORE_SET_ABILITY_ID,
    "Encore Set",
    "After using a damaging move, the next different damaging move is followed by a 40%-power echo of the previous move against the same target. The echo cannot crit or trigger Encore Set.",
  ),
  definition(
    ER_SETLIST_ABILITY_ID,
    "Setlist",
    "Records its first 2 damaging moves after entry. Alternating between them then builds a crescendo: +20% power and +10% accuracy per step, up to +40% and +20%. Other moves reset it.",
  ),
  definition(
    ER_FAN_FAVORITE_ABILITY_ID,
    "Fan Favorite",
    "Gains 5% accuracy and special damage per living benched party member, up to 25%. A bench Pokemon fainting removes its cheer immediately.",
  ),
  definition(
    ER_REDUCTION_ABILITY_ID,
    "Reduction",
    "Before its next damaging move, consumes active non-primal weather and terrain. The move deals 1.5x damage and becomes dual-type; terrain determines the added type when both were consumed.",
  ),
  definition(
    ER_CRACKED_VESSEL_ABILITY_ID,
    "Cracked Vessel",
    "Once per battle, a direct hit that would knock this Pokemon out leaves it at 1 HP, sets Eerie Fog for 4 turns, badly poisons every adjacent battler except itself, and permanently removes its last type.",
  ),
  definition(
    ER_CENTER_OF_ATTENTION_ABILITY_ID,
    "Center of Attention",
    "Spread moves deal 0.75x damage to this Pokemon even when only one target remains. A foe that damages one of this Pokemon's allies instead of it loses 1 Sp. Atk after the move.",
  ),
  definition(
    ER_SUPEREGO_ABILITY_ID,
    "Superego",
    "When a foe's stat stage rises above this Pokemon's corresponding stage, this Pokemon takes that boost and the foe is reset to this Pokemon's previous stage. Triggers once per stat each turn and ignores Egoist boosts.",
  ),
];
