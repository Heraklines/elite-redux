/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ErAbilityDraft } from "#data/elite-redux/er-abilities";
import { FAKEMON_PITCH_RUNTIME_ABILITY_IDS } from "#data/elite-redux/fakemon-pitch-runtime-ids";

export const ER_CRYOGENESIS_ABILITY_ID = 6004;
export const ER_HYDROMANCY_ABILITY_ID = 6005;
export const ER_BALLASTER_ABILITY_ID = 6006;
export const ER_FALSE_EQUIVALENCE_ABILITY_ID = 6007;
export const ER_BRIBERY_ABILITY_ID = 6008;
export const ER_BLIND_JUSTICE_ABILITY_ID = 6009;
export const ER_MAGISTRATE_ABILITY_ID = 6010;
export const ER_DEADLY_SENTENCING_ABILITY_ID = FAKEMON_PITCH_RUNTIME_ABILITY_IDS.DEADLY_SENTENCING;
export const ER_DAYDREAMER_ABILITY_ID = 6012;
export const ER_FREE_SPIRIT_ABILITY_ID = 6013;
export const ER_PROPHETIC_ABILITY_ID = 6014;
export const ER_PENTA_PUNCH_ABILITY_ID = 6015;
export const ER_SOUTHERN_CROSS_PUNCH_ABILITY_ID = 6016;
export const ER_STARCROSSED_ABILITY_ID = 6017;
export const ER_ASTRAL_PROJECT_ABILITY_ID = 6018;
export const ER_FLUTTERING_SPIRIT_ABILITY_ID = 6019;
export const ER_IN_THE_CLOUDS_ABILITY_ID = 6020;
export const ER_THICK_SKULLED_ABILITY_ID = 6021;
export const ER_PERPETUAL_MOTION_ABILITY_ID = 6022;
export const ER_SWORDS_NATURE_ABILITY_ID = 6023;
export const ER_CRUSHING_ANTLERS_ABILITY_ID = 6024;
export const ER_SPLASH_DAMAGE_ABILITY_ID = 6025;
export const ER_SNOWBALL_FIGHT_ABILITY_ID = 6026;
export const ER_DIRTY_SNOWBALL_ABILITY_ID = 6027;
export const ER_SOLAR_PANEL_ABILITY_ID = 6028;
export const ER_PHOENIX_FOLIAGE_ABILITY_ID = 6029;
export const ER_PHOTOVOLTAIC_ABILITY_ID = 6030;
export const ER_BURN_FATIGUE_ABILITY_ID = FAKEMON_PITCH_RUNTIME_ABILITY_IDS.BURN_FATIGUE;
export const ER_MOXIBUSTION_ABILITY_ID = 6032;
export const ER_HEAD_FIRST_ABILITY_ID = 6033;
export const ER_CONFECTIOUS_ABILITY_ID = 6034;
export const ER_IRRADIATED_FIST_ABILITY_ID = 6035;
export const ER_NUCLEUS_ABILITY_ID = 6036;
export const ER_ELECTROMANCY_ABILITY_ID = 6037;
export const ER_HIJACK_ABILITY_ID = 6038;
export const ER_DOGGED_JAW_ABILITY_ID = 6039;
export const ER_CYBERKINETIC_ABILITY_ID = 6040;
export const ER_ELECTRIFIED_ABILITY_ID = 6041;
export const ER_POWER_GRINDER_ABILITY_ID = 6042;
export const ER_AUGUR_ABILITY_ID = 6043;
export const ER_BITTER_DRILL_ABILITY_ID = 6044;
export const ER_SPLIT_MIND_ABILITY_ID = 6045;
export const ER_EULOGY_ABILITY_ID = 6046;
export const ER_ORACLE_ABILITY_ID = 6047;
export const ER_THIRD_EYE_ABILITY_ID = 6048;
export const ER_METALLOSIS_ABILITY_ID = 6049;
export const ER_CONTAMINATED_ABILITY_ID = 6050;
export const ER_DECAY_ABILITY_ID = 6051;

export interface FakemonPitchAbilityDefinition {
  readonly draft: ErAbilityDraft;
  readonly pokerogueId: number;
}

function ability(id: number, name: string, description: string): FakemonPitchAbilityDefinition {
  return { draft: { id, name, description, archetype: "unknown" }, pokerogueId: id };
}

export const ER_FAKEMON_PITCH_ABILITIES: readonly FakemonPitchAbilityDefinition[] = [
  ability(ER_CRYOGENESIS_ABILITY_ID, "Cryogenesis", "Combines Permafrost and Freezing Point."),
  ability(ER_HYDROMANCY_ABILITY_ID, "Hydromancy", "Moves inflict Drenched five times as often."),
  ability(ER_BALLASTER_ABILITY_ID, "Ballaster", "After taking two damaging hits, retaliates with an 80-power Steam Eruption. Fire- and Water-type hits trigger it immediately."),
  ability(ER_FALSE_EQUIVALENCE_ABILITY_ID, "False Equivalence", "Sets Wonder Room on entry."),
  ability(ER_BRIBERY_ABILITY_ID, "Bribery", "After taking contact damage, retaliates against the attacker with a 20-power Make It Rain."),
  ability(ER_BLIND_JUSTICE_ABILITY_ID, "Blind Justice", "At the end of each turn, disables one usable move of a random other active Pokemon for one turn."),
  ability(ER_MAGISTRATE_ABILITY_ID, "Magistrate", "Combines Equinox and Overrule."),
  ability(ER_DEADLY_SENTENCING_ABILITY_ID, "Deadly Sentencing", "While active, suppresses the abilities and innates of other Pokemon that know a Dark-type move."),
  ability(ER_DAYDREAMER_ABILITY_ID, "Daydreamer", "Combines Dream Whimsy and Wishmaker."),
  ability(ER_FREE_SPIRIT_ABILITY_ID, "Free Spirit", "Combines Serene Grace and Levitate."),
  ability(ER_PROPHETIC_ABILITY_ID, "Prophetic", "Sets a delayed Future Sight or Doom Desire, choosing the more effective attack when it resolves."),
  ability(ER_PENTA_PUNCH_ABILITY_ID, "Penta-Punch", "Grants a fifth move slot. Five-Star Fury becomes 80 power and gains one critical-hit stage and one priority."),
  ability(ER_SOUTHERN_CROSS_PUNCH_ABILITY_ID, "Southern Cross Punch", "After using a punching move, rotates later intended targets one opposing slot to the right for the rest of the turn."),
  ability(ER_STARCROSSED_ABILITY_ID, "Starcrossed", "Star-based moves hit twice at 70% power each."),
  ability(ER_ASTRAL_PROJECT_ABILITY_ID, "Astral Project", "All moves become Star-based. Takes half damage from Psychic- and Dark-type attacks."),
  ability(ER_FLUTTERING_SPIRIT_ABILITY_ID, "Fluttering Spirit", "Combines Aerilate and Aerodynamics."),
  ability(ER_IN_THE_CLOUDS_ABILITY_ID, "In the Clouds", "Combines Unaware and Cloud Nine."),
  ability(ER_THICK_SKULLED_ABILITY_ID, "Thick Skulled", "Combines Rock Head and Thick Fat."),
  ability(ER_PERPETUAL_MOTION_ABILITY_ID, "Perpetual Motion", "Uses a 20-power Rollout at the end of each turn, building power for up to four successful hits."),
  ability(ER_SWORDS_NATURE_ABILITY_ID, "Sword's Nature", "Combines Sword of Ruin and Keen Edge."),
  ability(ER_CRUSHING_ANTLERS_ABILITY_ID, "Crushing Antlers", "Combines Hunter's Horn and Rapier."),
  ability(ER_SPLASH_DAMAGE_ABILITY_ID, "Splash Damage", "After a successful single-target attack, splashes the resolved attack onto an adjacent ally of the target at half damage."),
  ability(ER_SNOWBALL_FIGHT_ABILITY_ID, "Snowball Fight", "After taking contact damage, retaliates against the attacker with a 40-power Ice Ball."),
  ability(ER_DIRTY_SNOWBALL_ABILITY_ID, "Dirty Snowball", "Combines Rocky Payload and Let's Roll."),
  ability(ER_SOLAR_PANEL_ABILITY_ID, "Solar Panel", "Combines Drought and Steelworker."),
  ability(ER_PHOENIX_FOLIAGE_ABILITY_ID, "Phoenix Foliage", "Changes into Live Current after using or being hit by a Fire- or Electric-type move. Prevents paralysis."),
  ability(ER_PHOTOVOLTAIC_ABILITY_ID, "Photovoltaic", "Combines Solar Power with a native Electric type."),
  ability(ER_BURN_FATIGUE_ABILITY_ID, "Burn Fatigue", "Burned Pokemon are treated as asleep, have a one-in-three chance to fail their action, and take 33% more damage while this Pokemon is active."),
  ability(ER_MOXIBUSTION_ABILITY_ID, "Moxibustion", "Heals 75% of the actual damage dealt to burned targets."),
  ability(ER_HEAD_FIRST_ABILITY_ID, "Head First", "The first Reckless-boosted move after entry gains one priority. Knocking out a target refreshes the effect."),
  ability(ER_CONFECTIOUS_ABILITY_ID, "Confectious", "Starts each entry Confected. Contact makes the other Pokemon Confected until it switches, causing it to count as Food-based and amplifying related effects."),
  ability(ER_IRRADIATED_FIST_ABILITY_ID, "Irradiated Fist", "Punching moves have a 50% chance to badly poison. Curing that Toxic clears positive stat stages and prevents further stat gains until switching."),
  ability(ER_NUCLEUS_ABILITY_ID, "Nucleus", "Combines Liquified and Emanate."),
  ability(ER_ELECTROMANCY_ABILITY_ID, "Electromancy", "Moves inflict paralysis five times as often."),
  ability(ER_HIJACK_ABILITY_ID, "Hijack", "Damaging an already paralyzed target with an Electric move Commands its next action, once per switch-in."),
  ability(ER_DOGGED_JAW_ABILITY_ID, "Dogged Jaw", "Biting moves hit twice at 70% power each."),
  ability(ER_CYBERKINETIC_ABILITY_ID, "Cyberkinetic", "Contact makes the target Breached until it switches, replacing its types with pure Electric and removing Electric resistance."),
  ability(ER_ELECTRIFIED_ABILITY_ID, "Electrified", "Takes half damage from non-contact moves but is twice as vulnerable to Electric damage."),
  ability(ER_POWER_GRINDER_ABILITY_ID, "Power Grinder", "Deals 1.5x damage to Steel-type targets and takes half damage from Steel-type attackers."),
  ability(ER_AUGUR_ABILITY_ID, "Augur", "Successful drill moves lower the target's Defense by one stage."),
  ability(ER_BITTER_DRILL_ABILITY_ID, "Bitter Drill", "Drill moves leave Drill Bits on the opposing side. Grounded entrants become Embedded, lose one Defense, and take double damage from drill moves."),
  ability(ER_SPLIT_MIND_ABILITY_ID, "Split Mind", "Sets Reflect and Light Screen for three turns on entry."),
  ability(ER_EULOGY_ABILITY_ID, "Eulogy", "Once per battle when this Pokemon faints, revives a fainted ally with Revival Blessing."),
  ability(ER_ORACLE_ABILITY_ID, "Oracle", "Sets Future Sight on every entry. On its first entry, incoming attacks are treated as not very effective for three turns."),
  ability(ER_THIRD_EYE_ABILITY_ID, "Third Eye", "When a Dark-type foe enters, identifies it with Miracle Eye."),
  ability(ER_METALLOSIS_ABILITY_ID, "Metallosis", "Critical hits deal 1.5x damage and poison the target."),
  ability(ER_CONTAMINATED_ABILITY_ID, "Contaminated", "Damaging moves gain one 25%-power follow-up hit for every poisoned active battler, up to the field-size limit."),
  ability(ER_DECAY_ABILITY_ID, "Decay", "On entry, becomes permanently poisoned for the battle. This poison remains visible and enables Poison-based effects but does not harm this Pokemon."),
];
