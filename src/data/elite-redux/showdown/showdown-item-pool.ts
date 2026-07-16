import type { modifierTypes } from "#data/data-lists";

export type ShowdownItemKey = keyof typeof modifierTypes;

/**
 * Every HELD BATTLE ITEM legal in showdown (one per mon). B7 item 2 widened this from a
 * curated 9 to the full set of the game's held battle items (maintainer: "items are not
 * complete").
 *
 * INCLUSION RULE - a key belongs here iff `modifierTypes[key]()` yields a concrete
 * {@linkcode PokemonHeldItemModifierType} (or subclass) that attaches a per-mon
 * {@linkcode PokemonHeldItemModifier} in battle. The item rides the wire as a bare KEY and
 * is applied on both clients via `modifierTypes[key]().newModifier(pokemon)` (see
 * `showdown-enemy-build`), so ONLY keys whose factory returns a concrete held type - not a
 * `ModifierTypeGenerator` - can be fielded (a generator's `newModifier` returns null, so the
 * item would silently vanish). The `showdown-item-pool.test` instantiates every entry and
 * asserts this, so a bad key fails loudly.
 *
 * DELIBERATELY EXCLUDED:
 *  - Mega stones + form-change items - the mega rule owns that slot (the item slot of a
 *    fielded mega is force-locked to the `MEGA_STONE` sentinel).
 *  - XP / money / friendship / capture / luck / evo-tracker items (meaningless in one
 *    level-100 fight): Lucky Egg, Golden Egg, Soothe Bell, Golden Punch, the Gimmighoul
 *    tracker, Amulet Coin, Map, IV Scanner, etc.
 *  - Consumable non-held pickups (potions, revives, ethers, mints, TMs, ...).
 *  - GENERATOR-keyed items whose single registry key can't encode the variant and whose
 *    bare-key application yields null: BERRY (per-berry), ATTACK_TYPE_BOOSTER (the Silk
 *    Scarf / type-booster family), SPECIES_STAT_BOOSTER (Light Ball / Thick Club, ...),
 *    BASE_STAT_BOOSTER, TEMP_STAT_STAGE_BOOSTER. Supporting these needs a per-variant key
 *    scheme + generator resolution in the apply path - a separate follow-up, noted here.
 *
 * The FIRST entry is the fielded default when a mon's item is unset (see
 * `showdown-manifest` `DEFAULT_ITEM`), so LEFTOVERS stays index 0. The validator's item
 * whitelist (`showdown-team` `ITEM_POOL`) derives from this array, so it updates in lockstep.
 */
export const SHOWDOWN_ITEM_POOL: readonly ShowdownItemKey[] = [
  // Core competitive held items.
  "LEFTOVERS",
  "SHELL_BELL",
  "FOCUS_BAND",
  "QUICK_CLAW",
  "KINGS_ROCK",
  "SCOPE_LENS",
  "WIDE_LENS",
  "MULTI_LENS",
  "GRIP_CLAW",
  "MINI_BLACK_HOLE",
  "BATON",
  "REVIVER_SEED",
  "WHITE_HERB",
  "MYSTICAL_ROCK",
  "SOUL_DEW",
  "EVIOLITE",
  "LEEK",
  // Status orbs.
  "TOXIC_ORB",
  "FLAME_ORB",
  "FROSTBITE_ORB",
  // Held stat items (ME-sourced but genuine held battle items).
  "MYSTERY_ENCOUNTER_OLD_GATEAU",
  "MYSTERY_ENCOUNTER_MACHO_BRACE",
  // ER recreated trainer-grade held items.
  "ER_LIFE_ORB",
  "ER_ASSAULT_VEST",
  "ER_ROCKY_HELMET",
  // ER reactive items (boost a stat when hit).
  "ER_CELL_BATTERY",
  "ER_ABSORB_BULB",
  "ER_SNOWBALL",
  "ER_LUMINOUS_MOSS",
  "ER_WEAKNESS_POLICY",
  // ER tactical held items (competitive staples).
  "ER_EXPERT_BELT",
  "ER_COVERT_CLOAK",
  "ER_RED_CARD",
  "ER_EJECT_BUTTON",
  // ER tactical held items - batch 2 (PvP staples).
  "ER_HEAVY_DUTY_BOOTS",
  "ER_AIR_BALLOON",
  "ER_SAFETY_GOGGLES",
  "ER_CLEAR_AMULET",
  "ER_ABILITY_SHIELD",
  "ER_BOOSTER_ENERGY",
  "ER_THROAT_SPRAY",
  "ER_BLUNDER_POLICY",
  "ER_PUNCHING_GLOVE",
  "ER_MUSCLE_BAND",
  "ER_WISE_GLASSES",
  "ER_ZOOM_LENS",
  "ER_METRONOME_ITEM",
  "ER_EJECT_PACK",
  "ER_SHED_SHELL",
  "ER_ADRENALINE_ORB",
  "ER_ROOM_SERVICE",
  "ER_IRON_BALL",
  "ER_FLOAT_STONE",
  "ER_STICKY_BARB",
  "ER_SMOKE_BALL",
  "ER_MENTAL_HERB",
  "ER_UTILITY_UMBRELLA",
  // ER community held items (#387/#392).
  "ER_CHILI_SAMPLE",
  "ER_COPPER_ROD",
  "ER_RUSTY_CLAW",
  "ER_SPIKED_KNUCKLES",
  "ER_LOADED_DICE",
  "ER_LUCKY_HEART",
  "ER_OMNI_GEM",
  "ER_POWER_HERB",
  // ER terrain seeds (one-shot stat boost on matching terrain).
  "ER_ELECTRIC_SEED",
  "ER_GRASSY_SEED",
  "ER_MISTY_SEED",
  "ER_PSYCHIC_SEED",
  // ER elemental gems (one-shot type-move damage boost; the direct-key "type booster" set).
  "ER_NORMAL_GEM",
  "ER_FIRE_GEM",
  "ER_WATER_GEM",
  "ER_ELECTRIC_GEM",
  "ER_GRASS_GEM",
  "ER_ICE_GEM",
  "ER_FIGHTING_GEM",
  "ER_POISON_GEM",
  "ER_GROUND_GEM",
  "ER_FLYING_GEM",
  "ER_PSYCHIC_GEM",
  "ER_BUG_GEM",
  "ER_ROCK_GEM",
  "ER_GHOST_GEM",
  "ER_DRAGON_GEM",
  "ER_DARK_GEM",
  "ER_STEEL_GEM",
  "ER_FAIRY_GEM",
] as const;
