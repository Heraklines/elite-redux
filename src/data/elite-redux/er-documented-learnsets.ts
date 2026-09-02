/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves, tmPoolTiers } from "#balance/tms";
import { allMoves, allSpecies } from "#data/data-lists";
import { isNewPokemonContentEnabled } from "#data/elite-redux/er-new-pokemon-gate";
import { ErMoveId } from "#enums/er-move-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";

interface DocumentedLearnset {
  name: string;
  species: number[];
  formKey?: string;
  levelSource?: number;
  mergeLevels?: boolean;
  levelExcludeTypes?: PokemonType[];
  levelKeep?: number[];
  levels: [number, number][];
  eggs?: number[];
  tmSources?: number[];
  tmAdd?: number[];
  tmExcludeTypes?: PokemonType[];
  tmKeep?: number[];
}

// Reviewed from the maintainer's Learnsets for New Mons document, 2026-09-02.
// Numeric species IDs remain append-only; source spelling does not rename saves.
export const DOCUMENTED_LEARNSETS: readonly DocumentedLearnset[] = [
  {
    name: "Power Plant/Live Current",
    species: [70045],
    levels: [
      [1, MoveId.MEGA_DRAIN],
      [1, MoveId.FLAME_BURST],
      [1, MoveId.FLOWER_SHIELD],
      [1, MoveId.GROWTH],
      [17, MoveId.MIRROR_SHOT],
      [17, MoveId.SHOCK_WAVE],
      [17, MoveId.MYSTICAL_FIRE],
      [24, MoveId.AUTOTOMIZE],
      [24, MoveId.JUNGLE_HEALING],
      [24, MoveId.SYNTHESIS],
      [37, MoveId.GIGA_DRAIN],
      [37, MoveId.PETAL_DANCE],
      [37, MoveId.ENCORE],
      [37, MoveId.FIRE_LASH],
      [46, MoveId.FIERY_DANCE],
      [46, MoveId.LEAF_STORM],
      [51, MoveId.SEED_FLARE],
      [51, ErMoveId.MERCULIGHT],
      [56, MoveId.RISING_VOLTAGE],
      [56, MoveId.DOOM_DESIRE],
      [61, MoveId.STEEL_BEAM],
    ],
    eggs: [MoveId.THUNDERCLAP, MoveId.GEAR_UP, MoveId.MATCHA_GOTCHA, MoveId.ARMOR_CANNON],
    tmSources: [SpeciesId.SUNFLORA],
    tmAdd: [MoveId.THUNDERBOLT, MoveId.FLASH_CANNON, MoveId.METAL_SOUND],
  },
  {
    name: "Rapidash R + Ponyta R",
    species: [70047, 70048],
    levels: [
      [1, MoveId.TRAILBLAZE],
      [1, MoveId.FURY_ATTACK],
      [1, MoveId.SHARPEN],
      [17, MoveId.HORN_ATTACK],
      [17, MoveId.GROWTH],
      [17, MoveId.QUICK_ATTACK],
      [24, MoveId.HORN_LEECH],
      [24, MoveId.AROMATIC_MIST],
      [24, MoveId.MIST],
      [37, MoveId.JUNGLE_HEALING],
      [37, MoveId.TWINKLE_HORN],
      [37, MoveId.SYNTHESIS],
      [46, MoveId.MEGAHORN],
      [46, MoveId.PSYSHIELD_BASH],
      [46, MoveId.MAGICAL_TORQUE],
      [51, MoveId.HYPER_DRILL],
      [51, MoveId.GRAV_APPLE],
    ],
    eggs: [MoveId.PSYBLADE, MoveId.DRILL_RUN, MoveId.EXTREME_SPEED, MoveId.NO_RETREAT],
    tmSources: [SpeciesId.TAPU_BULU],
    tmExcludeTypes: [PokemonType.FIGHTING],
    tmKeep: [ErMoveId.BERSERKER_HORN, MoveId.TAKE_DOWN],
  },
  {
    name: "Vantarrow",
    species: [70058],
    mergeLevels: true,
    levels: [
      [24, MoveId.SMOKESCREEN],
      [24, MoveId.WIDE_GUARD],
      [24, MoveId.SHARPEN],
      [37, ErMoveId.CLAY_DART],
      [37, MoveId.WICKED_TORQUE],
      [37, ErMoveId.HOMING_FLETCH],
      [46, ErMoveId.BLAZING_ARROW],
      [46, ErMoveId.DEVIOUS_SHOT],
      [51, MoveId.EXPLOSION],
      [51, ErMoveId.BRAMBLE_BLAST],
    ],
    tmSources: [SpeciesId.CHI_YU],
  },
  {
    name: "Chromighty",
    species: [70059],
    mergeLevels: true,
    levels: [
      [24, MoveId.DRAIN_PUNCH],
      [24, MoveId.BURNING_BULWARK],
      [24, MoveId.SHARPEN],
      [37, MoveId.BLAZE_KICK],
      [37, MoveId.BULLET_PUNCH],
      [37, MoveId.GEAR_GRIND],
      [46, MoveId.METEOR_MASH],
      [51, ErMoveId.OUTBURST],
      [51, MoveId.PARTING_SHOT],
    ],
    tmSources: [ErSpeciesId.KILOZUNA],
    tmExcludeTypes: [PokemonType.GROUND],
  },
  {
    name: "Falinks R",
    species: [70052],
    levels: [
      [1, MoveId.CHIP_AWAY],
      [1, MoveId.QUICK_GUARD],
      [1, MoveId.HORN_ATTACK],
      [17, MoveId.FOCUS_ENERGY],
      [17, MoveId.ANCIENT_POWER],
      [17, MoveId.HYPNOSIS],
      [24, MoveId.BEAT_UP],
      [24, MoveId.FURY_ATTACK],
      [24, MoveId.NO_RETREAT],
      [24, MoveId.SMART_STRIKE],
      [24, ErMoveId.JAGGED_HORNS],
      [37, MoveId.PSYBLADE],
      [37, MoveId.COACHING],
      [37, MoveId.ATTACK_ORDER],
      [37, MoveId.DEFEND_ORDER],
      [46, MoveId.HORN_DRILL],
      [46, MoveId.FIRST_IMPRESSION],
      [46, MoveId.SPIKY_SHIELD],
      [46, MoveId.MIND_READER],
      [51, MoveId.PSYSHIELD_BASH],
      [51, MoveId.MEGAHORN],
      [51, MoveId.HEAL_ORDER],
      [56, MoveId.HYPER_DRILL],
      [56, MoveId.FINAL_GAMBIT],
    ],
    eggs: [MoveId.SHORE_UP, MoveId.METEOR_BEAM, MoveId.TAKE_HEART, ErMoveId.ESPER_WALTZ],
    tmSources: [SpeciesId.INDEEDEE],
    tmAdd: [MoveId.POWER_GEM, MoveId.WIDE_GUARD, MoveId.STEALTH_ROCK, ErMoveId.PEBBLE_SHOWER],
  },
  {
    name: "Temporal Skull",
    species: [70060],
    levels: [
      [1, MoveId.BONE_CLUB],
      [1, MoveId.DOUBLE_HIT],
      [1, MoveId.FAKE_OUT],
      [17, MoveId.CHIP_AWAY],
      [17, MoveId.DIZZY_PUNCH],
      [24, MoveId.COMET_PUNCH],
      [24, MoveId.PERISH_SONG],
      [24, MoveId.ROCK_BLAST],
      [37, MoveId.BONEMERANG],
      [37, MoveId.RAGE],
      [37, MoveId.DOUBLE_EDGE],
      [37, ErMoveId.SEISMIC_SLAM],
      [46, MoveId.SKULL_BASH],
      [46, MoveId.IVORY_IMPACT],
      [46, MoveId.DRAGON_DANCE],
      [46, MoveId.HEADLONG_RUSH],
      [46, MoveId.WISH],
      [51, MoveId.BONE_RUSH],
      [51, ErMoveId.BLAZING_BONE],
      [56, MoveId.HEAD_SMASH],
      [56, MoveId.FISSURE],
      [56, MoveId.THRASH],
    ],
    eggs: [ErMoveId.BLOCK_DROPPER, MoveId.POWER_UP_PUNCH, MoveId.TRAILBLAZE, MoveId.REVIVAL_BLESSING],
    tmSources: [SpeciesId.KANGASKHAN, SpeciesId.MAROWAK],
  },
  {
    name: "Intangrowth/Tagela",
    species: [70055, 70056],
    levels: [
      [1, MoveId.ASTONISH],
      [1, MoveId.MAGIC_ROOM],
      [1, MoveId.WONDER_ROOM],
      [1, MoveId.SWIRLY_ROOM],
      [1, MoveId.MEMENTO],
      [1, MoveId.OMINOUS_WIND],
      [17, MoveId.SHADOW_SNEAK],
      [17, MoveId.ALLY_SWITCH],
      [24, MoveId.GUARD_SPLIT],
      [24, MoveId.POWER_WHIP],
      [37, MoveId.GIGA_DRAIN],
      [37, ErMoveId.REQUIEM],
      [37, MoveId.FLATTER],
      [46, MoveId.PAIN_SPLIT],
      [46, MoveId.INFERNAL_PARADE],
      [51, ErMoveId.RAGING_SOULS],
      [51, MoveId.DESTINY_BOND],
      [56, ErMoveId.OUTBURST],
    ],
    eggs: [MoveId.RUINATION, MoveId.STRENGTH_SAP, MoveId.MOONGEIST_BEAM, MoveId.RAGE_FIST],
    tmSources: [SpeciesId.DUSKULL],
  },
  {
    name: "Slabberigus/Yamask M",
    species: [70054],
    levels: [
      [1, MoveId.ASTONISH],
      [1, MoveId.DESTINY_BOND],
      [1, MoveId.PAIN_SPLIT],
      [1, MoveId.CRAFTY_SHIELD],
      [17, MoveId.ANCIENT_POWER],
      [17, MoveId.OMINOUS_WIND],
      [24, MoveId.SALT_CURE],
      [24, ErMoveId.PHANTOM_GLOVES],
      [24, ErMoveId.REQUIEM],
      [24, MoveId.GUARD_SPLIT],
      [24, MoveId.POWER_SPLIT],
      [24, MoveId.MAGIC_ROOM],
      [24, MoveId.ALLY_SWITCH],
      [37, MoveId.PHANTOM_FORCE],
      [37, MoveId.SWIRLY_ROOM],
      [37, MoveId.ACCELEROCK],
      [37, MoveId.ROCK_BLAST],
      [46, MoveId.SALT_CURE],
      [46, ErMoveId.DRAIN_BRAIN],
      [46, MoveId.MEMENTO],
      [51, MoveId.RECOVER],
      [51, ErMoveId.RAGING_SOULS],
      [56, MoveId.POLTERGEIST],
    ],
    eggs: [MoveId.SHORE_UP, MoveId.DIAMOND_STORM, MoveId.INFERNAL_PARADE, MoveId.SHADOW_FORCE],
    tmSources: [SpeciesId.RUNERIGUS],
    tmAdd: [MoveId.POWER_GEM, ErMoveId.PEBBLE_SHOWER],
  },
  {
    name: "Mishamanus",
    species: [70051],
    mergeLevels: true,
    levels: [
      [56, MoveId.SWIFT],
      [56, ErMoveId.BIG_BLAST],
    ],
    eggs: [MoveId.TAKE_HEART, MoveId.TERA_STARSTORM, MoveId.AURA_SPHERE, MoveId.MOONGEIST_BEAM],
  },
  {
    name: "Conkapitaturr + Gurdururr",
    species: [70034, 70035],
    levels: [
      [1, MoveId.ASSURANCE],
      [1, MoveId.BODY_SLAM],
      [1, MoveId.SMACK_DOWN],
      [1, MoveId.BRICK_BREAK],
      [17, MoveId.FAKE_OUT],
      [17, MoveId.SCARY_FACE],
      [17, MoveId.SLAM],
      [24, ErMoveId.WILD_SWING],
      [24, ErMoveId.SPINE_BREAKER],
      [24, MoveId.ACCELEROCK],
      [24, ErMoveId.RELENTLESS_CLOBBER],
      [37, ErMoveId.MEGATON_HAMMER],
      [37, MoveId.BRUTAL_SWING],
      [37, MoveId.THRASH],
      [46, MoveId.SKULL_BASH],
      [46, ErMoveId.EARTHSPLITTER],
      [46, MoveId.HAMMER_ARM],
      [51, MoveId.ROCK_POLISH],
      [51, MoveId.POWER_TRIP],
      [56, MoveId.HEAD_SMASH],
      [56, MoveId.HEADLONG_RUSH],
      [56, ErMoveId.SMASHIN_REALITIES],
      [56, MoveId.ROCK_WRECKER],
    ],
    eggs: [MoveId.ICE_HAMMER, ErMoveId.BANISHED_POWER, ErMoveId.PRIMITIVE_STRIKE, MoveId.REVIVAL_BLESSING],
    tmSources: [SpeciesId.URSHIFU],
  },
  {
    name: "Tremburr ",
    species: [70033],
    levels: [
      [1, MoveId.ASSURANCE],
      [1, MoveId.BODY_SLAM],
      [1, MoveId.SMACK_DOWN],
      [1, MoveId.BRICK_BREAK],
      [17, MoveId.FAKE_OUT],
      [17, MoveId.SCARY_FACE],
      [17, MoveId.SLAM],
      [24, ErMoveId.WILD_SWING],
      [24, ErMoveId.SPINE_BREAKER],
      [24, MoveId.ACCELEROCK],
      [37, ErMoveId.MEGATON_HAMMER],
      [37, MoveId.BRUTAL_SWING],
      [37, MoveId.THRASH],
      [37, ErMoveId.RELENTLESS_CLOBBER],
      [46, MoveId.SKULL_BASH],
      [46, ErMoveId.EARTHSPLITTER],
      [46, MoveId.HAMMER_ARM],
      [51, MoveId.ROCK_POLISH],
      [51, MoveId.POWER_TRIP],
      [56, MoveId.HEADLONG_RUSH],
      [56, ErMoveId.SMASHIN_REALITIES],
    ],
    eggs: [MoveId.ICE_HAMMER, ErMoveId.BANISHED_POWER, ErMoveId.PRIMITIVE_STRIKE, MoveId.REVIVAL_BLESSING],
    tmSources: [SpeciesId.URSHIFU],
  },
  {
    name: "Dippowdon",
    species: [70036],
    levels: [
      [1, ErMoveId.SHOT_PUT],
      [1, MoveId.BUBBLE_BEAM],
      [1, MoveId.METAL_SOUND],
      [1, MoveId.GROWL],
      [17, MoveId.WATER_GUN],
      [17, MoveId.MIRROR_SHOT],
      [17, MoveId.WATERFALL],
      [24, MoveId.ANCHOR_SHOT],
      [24, MoveId.SCALD],
      [24, ErMoveId.SCATTER_BLAST],
      [37, MoveId.AUTOTOMIZE],
      [37, MoveId.HYDRO_STEAM],
      [46, MoveId.KINGS_SHIELD],
      [46, ErMoveId.BIG_BLAST],
      [46, ErMoveId.SUPERHOT_FLAME],
      [51, MoveId.SHELL_SMASH],
      [56, MoveId.STEAM_ERUPTION],
      [56, ErMoveId.OUTBURST],
      [56, MoveId.WRING_OUT],
    ],
    eggs: [MoveId.MAKE_IT_RAIN, MoveId.SHORE_UP, MoveId.SHELTER, MoveId.WATER_SPOUT],
    tmSources: [SpeciesId.EMPOLEON],
  },
  {
    name: "Equilibra + Justyke",
    species: [70037, 70038],
    levels: [
      [1, MoveId.MUD_SLAP],
      [1, MoveId.GYRO_BALL],
      [1, MoveId.MAGNET_BOMB],
      [1, MoveId.ASTONISH],
      [1, MoveId.BARRAGE],
      [17, MoveId.RAPID_SPIN],
      [17, MoveId.GUARD_SPLIT],
      [17, MoveId.POWER_SPLIT],
      [17, ErMoveId.SCATTER_BLAST],
      [24, MoveId.QUASH],
      [24, MoveId.GRAVITY],
      [24, MoveId.BULLET_PUNCH],
      [37, MoveId.HEALING_WISH],
      [37, MoveId.PAIN_SPLIT],
      [37, MoveId.IMPRISON],
      [37, MoveId.MEMENTO],
      [46, MoveId.DESTINY_BOND],
      [46, MoveId.DOOM_DESIRE],
      [56, MoveId.STEEL_BEAM],
      [56, MoveId.JUDGMENT],
      [56, MoveId.SPIN_OUT],
      [56, ErMoveId.TRIPLE_TREMOR],
    ],
    eggs: [MoveId.RECOVER, MoveId.HAPPY_HOUR, MoveId.FISSURE, MoveId.MAKE_IT_RAIN],
    tmSources: [ErSpeciesId.PENTADUG_ALOLAN],
  },
  {
    name: "Rowlet Partner",
    species: [SpeciesId.ROWLET],
    formKey: "partner",
    levelSource: SpeciesId.DECIDUEYE,
    mergeLevels: true,
    levelExcludeTypes: [PokemonType.GHOST],
    levelKeep: [MoveId.SPIRIT_SHACKLE],
    levels: [
      [46, ErMoveId.OBSCURED_SHOT],
      [46, ErMoveId.BLAZING_ARROW],
    ],
  },
  {
    name: "Onix Partner",
    species: [SpeciesId.ONIX],
    formKey: "partner",
    levelSource: SpeciesId.ONIX,
    mergeLevels: true,
    levels: [
      [46, MoveId.DOUBLE_EDGE],
      [46, ErMoveId.GLACIER_CRASH],
      [61, MoveId.GLACIAL_LANCE],
    ],
  },
  {
    name: "Wailbore + Wailgur",
    species: [70050],
    levels: [
      [1, MoveId.ROAR],
      [1, MoveId.SELF_DESTRUCT],
      [1, MoveId.STOMPING_TANTRUM],
      [1, MoveId.SMART_STRIKE],
      [17, MoveId.ROCK_SMASH],
      [17, MoveId.FURY_ATTACK],
      [24, MoveId.SHELTER],
      [24, MoveId.STEEL_BEAM],
      [37, MoveId.GYRO_BALL],
      [37, MoveId.STRENGTH],
      [37, MoveId.MEGAHORN],
      [46, MoveId.HAMMER_DRILL],
      [46, MoveId.DRILL_BITS],
      [46, MoveId.HORN_DRILL],
      [56, MoveId.HYPER_DRILL],
      [56, MoveId.FISSURE],
      [61, MoveId.ROCK_WRECKER],
    ],
    eggs: [ErMoveId.SMOLDER_BASH, MoveId.SHORE_UP, MoveId.SHIFT_GEAR, MoveId.PRECIPICE_BLADES],
    tmSources: [SpeciesId.EXCADRILL],
  },
  {
    name: "Octillery R",
    species: [70041],
    levelSource: SpeciesId.OCTILLERY,
    mergeLevels: true,
    levels: [
      [37, MoveId.BARRAGE],
      [56, MoveId.STEEL_BEAM],
    ],
    tmSources: [SpeciesId.OCTILLERY],
    tmAdd: [MoveId.FLASH_CANNON],
  },
  {
    name: "Mangling Blade",
    species: [70040],
    levels: [
      [1, MoveId.SLASH],
      [1, MoveId.ODOR_SLEUTH],
      [1, MoveId.HORN_ATTACK],
      [17, MoveId.SHARPEN],
      [17, ErMoveId.JAGGED_HORNS],
      [17, MoveId.ACCELEROCK],
      [24, MoveId.LEAF_BLADE],
      [24, MoveId.SMART_STRIKE],
      [24, MoveId.COACHING],
      [37, ErMoveId.LEECH_BLADE],
      [37, ErMoveId.FLAME_TONGUE],
      [37, ErMoveId.SMOLDER_BASH],
      [46, MoveId.HORN_LEECH],
      [46, MoveId.SACRED_SWORD],
      [46, MoveId.SECRET_SWORD],
      [56, ErMoveId.EXCALIBUR],
      [56, MoveId.MEGAHORN],
      [61, MoveId.KOWTOW_CLEAVE],
      [81, MoveId.METEOR_ASSAULT],
    ],
    eggs: [MoveId.HYPER_DRILL, MoveId.MIGHTY_CLEAVE, MoveId.TACHYON_CUTTER, MoveId.NO_RETREAT],
    tmSources: [SpeciesId.COBALION, SpeciesId.TERRAKION, SpeciesId.VIRIZION],
  },
  {
    name: "Lickilicking",
    species: [70039],
    levelSource: SpeciesId.LICKITUNG,
    mergeLevels: true,
    levels: [
      [56, MoveId.DOUBLE_EDGE],
      [56, MoveId.HEAD_SMASH],
    ],
    tmSources: [SpeciesId.LICKITUNG],
  },
  {
    name: "Voltriever",
    species: [70049],
    levels: [
      [1, ErMoveId.SPARKLING_BARRAGE],
      [1, MoveId.WILD_CHARGE],
      [1, MoveId.MAGNETIC_FLUX],
      [17, MoveId.SWAGGER],
      [17, MoveId.PSYCHIC_FANGS],
      [24, MoveId.THUNDER_FANG],
      [24, MoveId.ROAR],
      [24, MoveId.SCARY_FACE],
      [37, MoveId.RISING_VOLTAGE],
      [37, MoveId.EXPANDING_FORCE],
      [37, MoveId.JAW_LOCK],
      [46, ErMoveId.MERCULIGHT],
      [51, MoveId.ZIPPY_ZAP],
      [51, ErMoveId.RIP_AND_TEAR],
    ],
    eggs: [MoveId.AURA_WHEEL, MoveId.FIRE_FANG, MoveId.ICE_FANG, MoveId.SHIFT_GEAR],
    tmSources: [SpeciesId.MANECTRIC],
  },
  {
    name: "Pentasnug Line",
    species: [70042, 70043, 70044],
    levels: [
      [1, MoveId.DEFENSE_CURL],
      [1, MoveId.ICE_BALL],
      [1, MoveId.ROLLOUT],
      [1, MoveId.YAWN],
      [17, MoveId.FLATTER],
      [17, MoveId.ICE_SHARD],
      [17, ErMoveId.BALL_TOSS],
      [24, MoveId.TRI_ATTACK],
      [24, MoveId.SLAM],
      [24, MoveId.FOLLOW_ME],
      [37, MoveId.AURORA_VEIL],
      [37, MoveId.HIGH_HORSEPOWER],
      [46, ErMoveId.ICE_WALL],
      [46, MoveId.SPIN_OUT],
      [46, ErMoveId.CHILLER],
      [51, MoveId.ROCK_POLISH],
      [51, MoveId.TRIPLE_AXEL],
      [51, MoveId.ENCORE],
      [56, MoveId.SHEER_COLD],
      [56, MoveId.ROCK_WRECKER],
    ],
    eggs: [ErMoveId.PARTY_FAVORS, ErMoveId.BLOCK_DROPPER, MoveId.SHELL_SMASH, MoveId.GRAV_APPLE],
    tmSources: [SpeciesId.GLALIE],
    tmExcludeTypes: [PokemonType.DARK],
  },
  {
    name: "Drawclops + Dustnoir",
    species: [70020, 70021],
    mergeLevels: true,
    levels: [
      [37, ErMoveId.SCATTER_BLAST],
      [37, MoveId.EMBER],
      [37, MoveId.HEAL_PULSE],
      [37, MoveId.MUD_SHOT],
      [37, MoveId.SUCKER_PUNCH],
      [46, ErMoveId.BIG_BLAST],
      [46, MoveId.MUD_SLAP],
      [46, MoveId.WONDER_ROOM],
      [51, MoveId.SEARING_SHOT],
      [51, MoveId.LAST_RESPECTS],
      [51, MoveId.DESTINY_BOND],
    ],
    tmSources: [],
    tmAdd: [MoveId.FLAMETHROWER, MoveId.HYPER_BEAM],
  },
  {
    name: "(Water) Lilligant R",
    species: [70057],
    levels: [
      [1, MoveId.AFTER_YOU],
      [1, MoveId.GROWTH],
      [1, MoveId.MEGA_DRAIN],
      [1, MoveId.POLLEN_PUFF],
      [1, MoveId.SWEET_SCENT],
      [17, MoveId.FAIRY_WIND],
      [17, MoveId.MOONLIGHT],
      [17, MoveId.SYNTHESIS],
      [17, MoveId.NIGHT_DAZE],
      [24, MoveId.BUBBLE_BEAM],
      [24, MoveId.AQUA_JET],
      [24, MoveId.CHILLING_WATER],
      [24, MoveId.SCALD],
      [37, MoveId.OMINOUS_WIND],
      [37, MoveId.DISARMING_VOICE],
      [37, MoveId.WATER_GUN],
      [37, MoveId.MOONLIGHT],
      [46, MoveId.ALLURING_VOICE],
      [46, MoveId.FLATTER],
      [46, MoveId.DECORATE],
      [51, MoveId.MOONGEIST_BEAM],
      [51, MoveId.DESTINY_BOND],
      [56, ErMoveId.RAIN_FLUSH],
      [56, MoveId.SPLISHY_SPLASH],
    ],
    eggs: [MoveId.THUNDEROUS_KICK, MoveId.ORIGIN_PULSE, MoveId.FLOWER_TRICK, MoveId.SPRINGTIDE_STORM],
    tmSources: [SpeciesId.JELLICENT],
    tmAdd: [MoveId.DARK_PULSE, MoveId.MOONBLAST, ErMoveId.PIXIE_BEAM, MoveId.NASTY_PLOT],
  },
  {
    name: "Pyrothon + Ekans Arida Region",
    species: [70046],
    levels: [
      [1, MoveId.COIL],
      [1, MoveId.GLARE],
      [1, MoveId.POISON_FANG],
      [1, MoveId.FIRE_FANG],
      [1, MoveId.PSYWAVE],
      [17, MoveId.PSYCHIC_FANGS],
      [17, MoveId.FLAME_BURST],
      [17, MoveId.SUPER_FANG],
      [17, MoveId.YAWN],
      [24, ErMoveId.DRACONIC_FANGS],
      [24, MoveId.CRUNCH],
      [24, MoveId.EMBER],
      [24, MoveId.HYPNOSIS],
      [37, MoveId.JAW_LOCK],
      [37, MoveId.ENCORE],
      [37, ErMoveId.MYSTIC_DANCE],
      [37, MoveId.DISABLE],
      [46, MoveId.EXPANDING_FORCE],
      [46, MoveId.BARRIER],
      [46, MoveId.MYSTICAL_FIRE],
      [51, MoveId.PSYCHO_BOOST],
      [51, MoveId.OVERHEAT],
      [51, MoveId.BURN_UP],
      [61, MoveId.BURNING_BULWARK],
    ],
    eggs: [ErMoveId.RIP_AND_TEAR, MoveId.SACRED_FIRE, MoveId.GLITZY_GLOW, MoveId.BLUE_FLARE],
    tmSources: [SpeciesId.VICTINI],
    tmExcludeTypes: [PokemonType.ELECTRIC, PokemonType.WATER],
  },
];

function allowedMove(move: number, excluded: readonly PokemonType[] = [], kept: readonly number[] = []): boolean {
  return !!allMoves[move] && (kept.includes(move) || !excluded.includes(allMoves[move].type));
}

/** Apply after inherited defaults, before staff editor overrides. Never edit donor arrays. */
export function applyDocumentedLearnsets(): void {
  if (!isNewPokemonContentEnabled()) {
    return;
  }
  const levels = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
  const forms = pokemonFormLevelMoves as Record<number, Record<number, [number, number][]>>;
  const eggs = speciesEggMoves as Record<number, number[]>;
  const tms = speciesTmMoves as Record<number, (number | [string, number])[]>;
  const reverse = tmSpecies as Record<number, (number | [number, ...string[]])[]>;
  for (const rule of DOCUMENTED_LEARNSETS) {
    for (const id of rule.species) {
      const species = allSpecies.find(species => species.speciesId === id);
      if (!species) {
        continue;
      }
      const formIndex = rule.formKey === undefined ? -1 : species.forms.findIndex(f => f.formKey === rule.formKey);
      if (rule.formKey !== undefined && formIndex < 0) {
        continue;
      }
      const source = rule.levelSource ?? id;
      const replacedMoves = new Set(rule.levels.map(([, move]) => move));
      const inherited = rule.mergeLevels ? (levels[source] ?? []).filter(([, move]) =>
        !replacedMoves.has(move) && allowedMove(move, rule.levelExcludeTypes, rule.levelKeep)) : [];
      const result = [...inherited, ...rule.levels].map(([level, move]) => [level, move] as [number, number]);
      result.sort((a, b) => a[0] - b[0]);
      if (formIndex >= 0) {
        (forms[id] ??= {})[formIndex] = result;
      } else {
        levels[id] = result;
      }
      if (rule.eggs) {
        eggs[id] = [...rule.eggs];
      }
      if (rule.tmSources === undefined) {
        continue;
      }
      // Empty donor list explicitly preserves this species' current TM set.
      const donors = rule.tmSources.length ? rule.tmSources : [id];
      const moves = new Set(donors.flatMap(donor => (tms[donor] ?? [])
        .filter(entry => !Array.isArray(entry) || entry[0] === "")
        .map(entry => Array.isArray(entry) ? entry[1] : entry))
        .filter(move => allowedMove(move, rule.tmExcludeTypes, rule.tmKeep)));
      for (const move of rule.tmAdd ?? []) {
        moves.add(move);
      }
      // Reconcile both directions, including stale inherited compatibility.
      for (const move of Object.keys(reverse).map(Number)) {
        reverse[move] = reverse[move].filter(entry => (Array.isArray(entry) ? entry[0] : entry) !== id);
      }
      tms[id] = [...moves];
      for (const move of moves) {
        (reverse[move] ??= []).push(id);
        (tmPoolTiers as Record<number, ModifierTier>)[move] ??= ModifierTier.ULTRA;
      }
    }
  }
}
