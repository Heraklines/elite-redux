//! M6B Items family: modifier behavior-unit classification and routine mapping.
//!
//! The Items family owns `HELD_ITEM` / `MODIFIER_BEHAVIOR` units. Two closed
//! outcomes exist:
//!
//! - **Battle routine admission.** A unit compiles into a
//!   [`RoutineProgramSpec`] only after every exact gate passes: ownership
//!   (unit kind plus held-item source identity), the frozen schema's
//!   implementation-class evidence, effect and hook evidence, and the exact
//!   constructor operand shape. Schemas are append-only; rule ordinals are
//!   stable constants; no program IDs are allocated here.
//! - **Typed classification.** Every other recognized registry key carries a
//!   deterministic [`ItemUnitClassification`] (`RunOnly`, `PresentationOnly`,
//!   or `Inert`) or stays explicitly unresolved with a typed gap reason.
//!
//! Run-only modifiers are never admitted as battle sources: no `RunOnly`
//! classification can reach a program spec, and every admission gate fails
//! closed with `Ok(None)` — never a neutral operation.
//!
//! Frozen-catalog note (oracle b0a5f37e1): every current `HELD_ITEM` unit is
//! a `CONTENT_LOAD` type registration with an `INTRINSIC_DEFINITION` effect,
//! empty operands, and no implementation evidence, so admission yields zero
//! programs against this catalog generation; the schemas below exist so a
//! future audited per-item unit flows through without touching frozen code.

use er_content::m6_catalog::{CatalogBehaviorUnit, CatalogEffectKind};
use er_mechanics::condition_v2::{ExactRatioV2, ValueArenaV2, ValueNodeId, ValueNodeV2};
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2,
};
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_mechanics::{HookBindingV2, ProgramRange};
use er_types::{BehaviorSourceId, BehaviorUnitKind};

use crate::m6::pipeline::OPERAND_SCHEMA_MISSING_REASON;
use crate::m6::routine::{
    implementation_name, safe_integer_operand, MappingFamily, MappingRuleId, RoutineCompileError,
    RoutineProgramSpec,
};

/// Schema version of the Items family mapping rules. Bump on any change to
/// existing schemas; new schemas append new ordinals instead.
pub const ITEMS_MAPPING_SCHEMA_VERSION: u16 = 1;

/// Stable rule ordinal: critical-hit stage add at the critical-rate query.
pub const ITEMS_RULE_CRITICAL_STAGE_ADD_ORDINAL: u32 = 1;

/// Stable rule ordinal: outgoing damage fraction multiply plus max-HP recoil.
pub const ITEMS_RULE_DAMAGE_FRACTION_ORDINAL: u32 = 2;

/// Scope Lens raises the critical stage by exactly one step.
const SCOPE_LENS_CRIT_STAGE_INCREMENT: i64 = 1;

/// Life Orb multiplies outgoing damage by exactly 13/10 ...
const LIFE_ORB_DAMAGE_NUMERATOR: i32 = 13;
const LIFE_ORB_DAMAGE_DENOMINATOR: u32 = 10;
///
/// ...then deals exactly 1/10 of the holder's maximum HP in recoil.
const LIFE_ORB_RECOIL_NUMERATOR: u32 = 1;
const LIFE_ORB_RECOIL_DENOMINATOR: u32 = 10;

/// Registry keys with an admitted, fully closed battle routine schema,
/// sorted so admission checks can binary search.
pub const ITEMS_ADMITTED_REGISTRY_KEYS: &[&str] = &["ER_LIFE_ORB", "SCOPE_LENS"];

/// Typed unresolved reason: berry consumption/preservation lifecycle is the
/// ITEM_BERRY_LIFECYCLE bespoke cluster and stays a non-program outcome.
pub const BERRY_LIFECYCLE_BESPOKE_REASON: &str = "BERRY_LIFECYCLE_BESPOKE";

/// Typed unresolved reason: chance procs draw battle RNG whose site ranges
/// are still unresolved gaps; they cannot close without audited bindings.
pub const ITEM_CHANCE_RNG_GAP_REASON: &str = "ITEM_CHANCE_RNG_SITES_UNRESOLVED";

/// Typed unresolved reason: the boost ratio scales with the runtime stack
/// count, which no closed value node expresses yet.
pub const STACK_SCALED_RATIO_GAP_REASON: &str = "STACK_SCALED_RATIO_VALUE_UNRESOLVED";

/// Typed unresolved reason: the boost must be gated on which stat (or holder
/// trait) the query carries; no such condition predicate exists in V2 yet.
pub const QUERIED_STAT_MATCH_GAP_REASON: &str = "QUERIED_STAT_MATCH_PREDICATE_MISSING";

/// Typed unresolved reason: the item boosts a query and then consumes itself
/// on real calcs only; query-then-consume coupling is inexpressible because a
/// query binding rejects mutation operations.
pub const QUERY_THEN_CONSUME_GAP_REASON: &str = "QUERY_THEN_CONSUME_COUPLING_MISSING";

/// Typed unresolved reason: relic behavior is selected by per-kind runtime
/// config spanning run and battle channels; each kind needs its own audited
/// schema before any classification is honest.
pub const RELIC_KIND_CONFIG_UNRESOLVED_REASON: &str = "RELIC_KIND_CONFIG_UNRESOLVED";

/// Registry-key prefix of the relic family left unclassified this wave.
pub const RELIC_REGISTRY_KEY_PREFIX: &str = "ER_RELIC_";

/// Closed classification of a recognized modifier behavior unit.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ItemUnitClassification {
    /// Battle-visible behavior driven by held-item hooks; owned by this
    /// family. Admission additionally requires a frozen schema with exact
    /// operands, so most BattleRoutine keys still compile nothing today.
    BattleRoutine,
    /// Effect delivered through the run layer or an explicit use command
    /// (economy, spawns, bag consumables). Never admitted as a battle source.
    RunOnly,
    /// Cosmetic or informational surface only.
    PresentationOnly,
    /// No observable mechanical behavior.
    Inert,
}

/// One frozen recognition-table row: exact registry key, the implementing
/// modifier class observed in oracle source, and its typed classification.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ItemClassEvidence {
    pub registry_key: &'static str,
    pub implementation_class: &'static str,
    pub classification: ItemUnitClassification,
}

/// Deterministic recognition table over all classified held items, sorted by
/// ascending registry key so lookups binary search.
pub static ITEM_UNIT_CLASSIFICATIONS: &[ItemClassEvidence] = &[
ItemClassEvidence { registry_key: "ABILITY_CHARM", implementation_class: "MysteryEventRateBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ABILITY_RANDOMIZER", implementation_class: "PokemonRandomizeAbilityModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "AMULET_COIN", implementation_class: "MoneyMultiplierModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ATTACK_TYPE_BOOSTER", implementation_class: "AttackTypeBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "BASE_STAT_BOOSTER", implementation_class: "BaseStatModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "BATON", implementation_class: "SwitchEffectTransferModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "BERRY", implementation_class: "BerryModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "BERRY_POUCH", implementation_class: "PreserveBerryModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "BIG_NUGGET", implementation_class: "MoneyRewardModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "CANDY_JAR", implementation_class: "LevelIncrementBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "CATCHING_CHARM", implementation_class: "CriticalCatchChanceBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "COIN_CASE", implementation_class: "MoneyInterestModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "DAMAGE_CALCULATOR", implementation_class: "DamageCalculatorModifier", classification: ItemUnitClassification::PresentationOnly },
    ItemClassEvidence { registry_key: "DIRE_HIT", implementation_class: "TempCritBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "DNA_SPLICERS", implementation_class: "FusePokemonModifierType", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "DYNAMAX_BAND", implementation_class: "GigantamaxAccessModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ELIXIR", implementation_class: "PokemonAllMovePpRestoreModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ENEMY_ATTACK_BURN_CHANCE", implementation_class: "EnemyAttackStatusEffectChanceModifierType", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_ATTACK_PARALYZE_CHANCE", implementation_class: "EnemyAttackStatusEffectChanceModifierType", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_ATTACK_POISON_CHANCE", implementation_class: "EnemyAttackStatusEffectChanceModifierType", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_DAMAGE_BOOSTER", implementation_class: "EnemyDamageBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_DAMAGE_REDUCTION", implementation_class: "EnemyDamageReducerModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_ENDURE_CHANCE", implementation_class: "EnemyEndureChanceModifierType", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_FUSED_CHANCE", implementation_class: "EnemyFusionChanceModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_HEAL", implementation_class: "EnemyTurnHealModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ENEMY_STATUS_EFFECT_HEAL_CHANCE", implementation_class: "EnemyStatusEffectHealChanceModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ABILITY_CAPSULE", implementation_class: "ErAbilityCapsuleModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ER_ABILITY_SHIELD", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ABSORB_BULB", implementation_class: "ErReactiveItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ADRENALINE_ORB", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_AIR_BALLOON", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ASSAULT_VEST", implementation_class: "ErAssaultVestModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_BLUNDER_POLICY", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_BOOSTER_ENERGY", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_BUG_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_CELL_BATTERY", implementation_class: "ErReactiveItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_CHILI_SAMPLE", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_CLEAR_AMULET", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_COPPER_ROD", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_COVERT_CLOAK", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_DARK_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_DEX_NAV", implementation_class: "ErDexNavModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ER_DRAGON_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_EJECT_BUTTON", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_EJECT_PACK", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ELECTRIC_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ELECTRIC_SEED", implementation_class: "ErSeedModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_EXPERT_BELT", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_FAIRY_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_FIGHTING_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_FIRE_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_FLOAT_STONE", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_FLYING_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_GHOST_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_GRASSY_SEED", implementation_class: "ErSeedModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_GRASS_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_GREATER_ABILITY_CAPSULE", implementation_class: "ErGreaterAbilityCapsuleModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ER_GREATER_ABILITY_RANDOMIZER", implementation_class: "ErGreaterAbilityRandomizerModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ER_GREATER_GOLDEN_BALL", implementation_class: "ExtraModifierModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_GREATER_MOVE_RANDOMIZER", implementation_class: "ErGreaterMoveRandomizerModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ER_GROUND_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_HEAVY_DUTY_BOOTS", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ICE_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_IRON_BALL", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_LEARNERS_SHROOM", implementation_class: "ErLearnersShroomModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "ER_LIFE_ORB", implementation_class: "ErLifeOrbModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_LOADED_DICE", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_LUCKY_HEART", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_LUMINOUS_MOSS", implementation_class: "ErReactiveItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_MENTAL_HERB", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_METRONOME_ITEM", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_MISTY_SEED", implementation_class: "ErSeedModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_MUSCLE_BAND", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_NORMAL_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_OMNI_GEM", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_POISON_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_POWER_HERB", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_PSYCHIC_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_PSYCHIC_SEED", implementation_class: "ErSeedModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_PUNCHING_GLOVE", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_RED_CARD", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ROCKY_HELMET", implementation_class: "ErRockyHelmetModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ROCK_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ROOM_SERVICE", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_RUSTY_CLAW", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_SAFETY_GOGGLES", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_SHED_SHELL", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_SMOKE_BALL", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_SNOWBALL", implementation_class: "ErReactiveItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_SPIKED_KNUCKLES", implementation_class: "ErCommunityItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_STEEL_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_STICKY_BARB", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_THROAT_SPRAY", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_UPGRADED_MAP", implementation_class: "MapModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_UTILITY_UMBRELLA", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_WATER_GEM", implementation_class: "ErGemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_WEAKNESS_POLICY", implementation_class: "ErReactiveItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_WISE_GLASSES", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ER_ZOOM_LENS", implementation_class: "ErTacticalItemModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ETHER", implementation_class: "PokemonPpRestoreModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "EVIOLITE", implementation_class: "EvolutionStatBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "EVOLUTION_ITEM", implementation_class: "EvolutionItemModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "EVOLUTION_TRACKER_GIMMIGHOUL", implementation_class: "EvoTrackerModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "EXP_BALANCE", implementation_class: "ExpBalanceModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "EXP_CHARM", implementation_class: "ExpBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "EXP_SHARE", implementation_class: "ExpShareModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "FLAME_ORB", implementation_class: "TurnStatusEffectModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "FOCUS_BAND", implementation_class: "SurviveDamageModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "FORM_CHANGE_ITEM", implementation_class: "PokemonFormChangeItemModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "FROSTBITE_ORB", implementation_class: "TurnStatusEffectModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "FULL_HEAL", implementation_class: "PokemonStatusHealModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "FULL_RESTORE", implementation_class: "PokemonHpRestoreModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "GOLDEN_EGG", implementation_class: "PokemonExpBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "GOLDEN_EXP_CHARM", implementation_class: "ExpBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "GOLDEN_POKEBALL", implementation_class: "ExtraModifierModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "GOLDEN_PUNCH", implementation_class: "DamageMoneyRewardModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "GREAT_BALL", implementation_class: "AddPokeballModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "GRIP_CLAW", implementation_class: "ContactHeldItemTransferChanceModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "HEALING_CHARM", implementation_class: "HealingBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "HYPER_POTION", implementation_class: "PokemonHpRestoreModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "IV_SCANNER", implementation_class: "IvScannerModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "KINGS_ROCK", implementation_class: "FlinchChanceModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "LEEK", implementation_class: "SpeciesCritBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "LEFTOVERS", implementation_class: "TurnHealModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "LOCK_CAPSULE", implementation_class: "LockModifierTiersModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "LUCKY_EGG", implementation_class: "PokemonExpBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "LURE", implementation_class: "DoubleBattleChanceBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MAP", implementation_class: "MapModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "MASTER_BALL", implementation_class: "AddPokeballModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MAX_ELIXIR", implementation_class: "PokemonAllMovePpRestoreModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MAX_ETHER", implementation_class: "PokemonPpRestoreModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MAX_LURE", implementation_class: "DoubleBattleChanceBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MAX_POTION", implementation_class: "PokemonHpRestoreModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MAX_REVIVE", implementation_class: "PokemonReviveModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MEGA_BRACELET", implementation_class: "MegaEvolutionAccessModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "MEMORY_MUSHROOM", implementation_class: "RememberMoveModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MINI_BLACK_HOLE", implementation_class: "TurnHeldItemTransferModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "MINT", implementation_class: "PokemonNatureChangeModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MOVE_RANDOMIZER", implementation_class: "PokemonRandomizeMoveModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MOVE_SLOT_EXPANDER", implementation_class: "PokemonAddMoveSlotModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MULTI_LENS", implementation_class: "PokemonMultiHitModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "MYSTERY_ENCOUNTER_BLACK_SLUDGE", implementation_class: "HealShopCostModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "MYSTERY_ENCOUNTER_GOLDEN_BUG_NET", implementation_class: "BoostBugSpawnModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "MYSTERY_ENCOUNTER_MACHO_BRACE", implementation_class: "PokemonIncrementingStatModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MYSTERY_ENCOUNTER_OLD_GATEAU", implementation_class: "PokemonBaseStatFlatModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MYSTERY_ENCOUNTER_SHUCKLE_JUICE", implementation_class: "PokemonBaseStatTotalModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "MYSTICAL_ROCK", implementation_class: "FieldEffectModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "NUGGET", implementation_class: "MoneyRewardModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "OVAL_CHARM", implementation_class: "MultipleParticipantExpBonusModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "POKEBALL", implementation_class: "AddPokeballModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "POTION", implementation_class: "PokemonHpRestoreModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "PP_MAX", implementation_class: "PokemonPpUpModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "PP_UP", implementation_class: "PokemonPpUpModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "QUICK_CLAW", implementation_class: "BypassSpeedChanceModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "RARER_CANDY", implementation_class: "AllPokemonLevelIncrementModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "RARE_CANDY", implementation_class: "PokemonLevelIncrementModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "RARE_EVOLUTION_ITEM", implementation_class: "EvolutionItemModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "RARE_FORM_CHANGE_ITEM", implementation_class: "PokemonFormChangeItemModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "RARE_SPECIES_STAT_BOOSTER", implementation_class: "SpeciesStatBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "RELIC_GOLD", implementation_class: "MoneyRewardModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "REVIVE", implementation_class: "PokemonReviveModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "REVIVER_SEED", implementation_class: "PokemonInstantReviveModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ROGUE_BALL", implementation_class: "AddPokeballModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "SACRED_ASH", implementation_class: "AllPokemonFullReviveModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "SCOPE_LENS", implementation_class: "CritBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "SHELL_BELL", implementation_class: "HitHealModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "SHINY_CHARM", implementation_class: "ShinyRateBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "SILVER_POKEBALL", implementation_class: "TempExtraModifierModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "SOOTHE_BELL", implementation_class: "PokemonFriendshipBoosterModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "SOUL_DEW", implementation_class: "PokemonNatureWeightModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "SPECIES_STAT_BOOSTER", implementation_class: "SpeciesStatBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "SPEED_ORDER", implementation_class: "SpeedOrderModifier", classification: ItemUnitClassification::PresentationOnly },
    ItemClassEvidence { registry_key: "SUPER_EXP_CHARM", implementation_class: "ExpBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "SUPER_LURE", implementation_class: "DoubleBattleChanceBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "SUPER_POTION", implementation_class: "PokemonHpRestoreModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "TEMP_STAT_STAGE_BOOSTER", implementation_class: "TempStatStageBoosterModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "TERA_ORB", implementation_class: "TerastallizeAccessModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "TERA_SHARD", implementation_class: "TerastallizeModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "TM_CASE", implementation_class: "ErTmCaseModifierType", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "TM_COMMON", implementation_class: "TmModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "TM_GREAT", implementation_class: "TmModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "TM_ULTRA", implementation_class: "TmModifier", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "TOXIC_ORB", implementation_class: "TurnStatusEffectModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "ULTRA_BALL", implementation_class: "AddPokeballModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "VOUCHER", implementation_class: "AddVoucherModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "VOUCHER_PLUS", implementation_class: "AddVoucherModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "VOUCHER_PREMIUM", implementation_class: "AddVoucherModifierType", classification: ItemUnitClassification::RunOnly },
    ItemClassEvidence { registry_key: "WHITE_HERB", implementation_class: "ResetNegativeStatStageModifier", classification: ItemUnitClassification::BattleRoutine },
    ItemClassEvidence { registry_key: "WIDE_LENS", implementation_class: "PokemonMoveAccuracyBoosterModifier", classification: ItemUnitClassification::BattleRoutine },];

/// Relic registry keys left unclassified this wave, sorted ascending.
pub static UNCLASSIFIED_RELIC_KEYS: &[&str] = &[
    "ER_RELIC_ANCHOR",
    "ER_RELIC_BLOOD_PACT",
    "ER_RELIC_BONDED_CHARM",
    "ER_RELIC_CAPACITOR",
    "ER_RELIC_CARTOGRAPHERS_LENS",
    "ER_RELIC_COIN_PURSE",
    "ER_RELIC_COLLECTORS_ALBUM",
    "ER_RELIC_COVENANT",
    "ER_RELIC_CURSED_IDOL",
    "ER_RELIC_FIELD_MEDIC",
    "ER_RELIC_GAMBLERS_COIN",
    "ER_RELIC_LOOKOUT",
    "ER_RELIC_MERCHANTS_SEAL",
    "ER_RELIC_MOLTEN_CORE",
    "ER_RELIC_MOMENTUM_ENGINE",
    "ER_RELIC_MORALE_BANNER",
    "ER_RELIC_MYSTERY_CHARM",
    "ER_RELIC_PHARAOH_ANKH",
    "ER_RELIC_QUARTERMASTER",
    "ER_RELIC_SCRAP_MAGNET",
    "ER_RELIC_SECOND_WIND",
    "ER_RELIC_STORMGLASS",
    "ER_RELIC_TRAILBLAZERS_MARK",
    "ER_RELIC_TWIN_LINK",
    "ER_RELIC_WARM_INCUBATOR",
    "ER_RELIC_WEATHERVANE",];

/// Classification plus its grounding implementation class, when recognized.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ItemClassification {
    pub classification: ItemUnitClassification,
    pub implementation_class: &'static str,
}

/// Classifies one modifier behavior unit.
///
/// Returns `Ok(None)` when the family does not own the unit (any other unit
/// kind or source class) or when the registry key is not in the recognition
/// table (relic kinds stay deliberately unresolved this wave). Unrecognition
/// is data, never a conversion: it must not become a neutral operation
/// elsewhere.
pub fn classify_items_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<ItemClassification>, RoutineCompileError> {
    if !owns_unit(unit) {
        return Ok(None);
    }
    let BehaviorSourceId::HeldItem { registry_key } = &unit.id.source else {
        return Ok(None);
    };
    Ok(lookup_classification(registry_key))
}

fn lookup_classification(registry_key: &str) -> Option<ItemClassification> {
    ITEM_UNIT_CLASSIFICATIONS
        .binary_search_by(|row| row.registry_key.cmp(registry_key))
        .ok()
        .map(|index| {
            let row = &ITEM_UNIT_CLASSIFICATIONS[index];
            ItemClassification {
                classification: row.classification,
                implementation_class: row.implementation_class,
            }
        })
}

/// Exact ownership gates shared by classification and admission: the unit
/// must be modifier behavior sourced from a held item. Anything else belongs
/// to another family and yields `Ok(None)` from every entry point here.
fn owns_unit(unit: &CatalogBehaviorUnit) -> bool {
    unit.id.unit_kind == BehaviorUnitKind::ModifierBehavior
        && matches!(unit.id.source, BehaviorSourceId::HeldItem { .. })
}

/// Maps one behavior unit to its battle-visible routine program spec.
///
/// Admits `Some` only after every exact gate passes. Evidence mismatches on
/// the implementation class, hook, or effect mean this unit does not carry
/// the audited schema's mechanic and yield `Ok(None)`; malformed constructor
/// operands for an otherwise matching unit surface as typed
/// [`RoutineCompileError`]s, never silence.
pub fn map_items_unit(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !owns_unit(unit) {
        return Ok(None);
    }
    let BehaviorSourceId::HeldItem { registry_key } = &unit.id.source else {
        return Ok(None);
    };
    match registry_key.as_str() {
        "SCOPE_LENS" => map_scope_lens(unit),
        "ER_LIFE_ORB" => map_life_orb(unit),
        _ => Ok(None),
    }
}

/// SCOPE_LENS -> `CritBoosterModifier`: adds one critical stage at the
/// critical-rate query. Constructor shape: exactly one `SAFE_INTEGER(1)`
/// stage-increment operand beyond the type/holder identity.
fn map_scope_lens(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !has_implementation(unit, "CritBoosterModifier")
        || !hook_is(unit, "CRITICAL_QUERY")
        || !effect_is(unit, CatalogEffectKind::ModifyStatOrStage)
    {
        return Ok(None);
    }
    let increment = safe_integer_operand(unit, 0)?;
    if increment != SCOPE_LENS_CRIT_STAGE_INCREMENT {
        return Err(RoutineCompileError::OperandKind {
            index: 0,
            expected: "SAFE_INTEGER(1)",
        });
    }
    if unit.semantic.operands.len() != 1 {
        return Err(RoutineCompileError::OperandKind {
            index: 1,
            expected: "NO_OPERAND",
        });
    }
    RoutineProgramSpec::single_query(
        items_rule(ITEMS_RULE_CRITICAL_STAGE_ADD_ORDINAL),
        unit.id.clone(),
        MechanicHookV2::CriticalQuery,
        QueryModifierStageV2::EarlyAdd,
        QueryModifierV2::Add {
            value: ValueNodeId(0),
        },
        ValueArenaV2(vec![ValueNodeV2::Constant {
            value: SCOPE_LENS_CRIT_STAGE_INCREMENT,
        }]),
    )
    .map(Some)
}

/// ER_LIFE_ORB -> `ErLifeOrbModifier`: multiplies outgoing damage by 13/10 at
/// the damage query, then deals 1/10 max-HP recoil after the damage. The
/// constructor takes no semantic operands beyond type/holder identity.
fn map_life_orb(
    unit: &CatalogBehaviorUnit,
) -> Result<Option<RoutineProgramSpec>, RoutineCompileError> {
    if !has_implementation(unit, "ErLifeOrbModifier")
        || !hook_is(unit, "DAMAGE_QUERY")
        || !effect_is(unit, CatalogEffectKind::ModifyOrApplyDamage)
    {
        return Ok(None);
    }
    if !unit.semantic.operands.is_empty() {
        return Err(RoutineCompileError::OperandKind {
            index: 0,
            expected: "EMPTY",
        });
    }

    let behavior_unit = unit.id.clone();
    let bindings = vec![
        HookBindingV2 {
            hook: MechanicHookV2::DamageQuery,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: behavior_unit.clone(),
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        },
        HookBindingV2 {
            hook: MechanicHookV2::AfterDamage,
            authored_priority: 0,
            binding_ordinal: 1,
            behavior_unit: behavior_unit.clone(),
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 1,
                length: 1,
            },
        },
    ];
    Ok(Some(RoutineProgramSpec {
        rule: items_rule(ITEMS_RULE_DAMAGE_FRACTION_ORDINAL),
        behavior_unit,
        bindings,
        conditions: Default::default(),
        selectors: Default::default(),
        values: ValueArenaV2(Vec::new()),
        operations: vec![
            MechanicOperationV2::Query {
                query: MechanicQueryV2::Damage,
                stage: QueryModifierStageV2::EarlyMultiply,
                modifier: QueryModifierV2::Multiply {
                    ratio: ExactRatioV2 {
                        numerator: LIFE_ORB_DAMAGE_NUMERATOR,
                        denominator: LIFE_ORB_DAMAGE_DENOMINATOR,
                    },
                },
            },
            MechanicOperationV2::RecoilFraction {
                numerator: LIFE_ORB_RECOIL_NUMERATOR,
                denominator: LIFE_ORB_RECOIL_DENOMINATOR,
            },
        ],
        scheduled_events: Vec::new(),
        rng_sites: Vec::new(),
        spawned_instances: 0,
        presentation_cues: 0,
        selected_targets: 0,
    }))
}

fn items_rule(ordinal: u32) -> MappingRuleId {
    MappingRuleId {
        family: MappingFamily::Items,
        ordinal,
        version: ITEMS_MAPPING_SCHEMA_VERSION,
    }
}

fn has_implementation(unit: &CatalogBehaviorUnit, expected: &'static str) -> bool {
    implementation_name(unit) == Some(expected)
}

fn hook_is(unit: &CatalogBehaviorUnit, expected: &str) -> bool {
    unit.semantic.hook.0 == expected
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn effect_is(unit: &CatalogBehaviorUnit, expected: CatalogEffectKind) -> bool {
    unit.semantic.effect.kind == expected
}

/// Typed gap reason for a recognized BattleRoutine key that has no admitted
/// schema yet; `None` for admitted keys, non-battle classifications, and
/// unrecognized (relic) keys.
#[must_use]
pub fn battle_schema_gap(registry_key: &str) -> Option<&'static str> {
    let is_battle = lookup_classification(registry_key)?
        .classification
        == ItemUnitClassification::BattleRoutine;
    if !is_battle {
        return None;
    }
    Some(match registry_key {
        "BERRY" | "BERRY_POUCH" => BERRY_LIFECYCLE_BESPOKE_REASON,
        "FOCUS_BAND" | "QUICK_CLAW" | "KINGS_ROCK" | "ENEMY_ENDURE_CHANCE"
        | "ENEMY_FUSED_CHANCE" | "ENEMY_ATTACK_BURN_CHANCE" | "ENEMY_ATTACK_PARALYZE_CHANCE"
        | "ENEMY_ATTACK_POISON_CHANCE" | "ENEMY_STATUS_EFFECT_HEAL_CHANCE" => {
            ITEM_CHANCE_RNG_GAP_REASON
        }
        "ATTACK_TYPE_BOOSTER" | "BASE_STAT_BOOSTER" => STACK_SCALED_RATIO_GAP_REASON,
        "ER_ASSAULT_VEST" | "EVIOLITE" | "SPECIES_STAT_BOOSTER"
        | "RARE_SPECIES_STAT_BOOSTER" => QUERIED_STAT_MATCH_GAP_REASON,
        key if key.starts_with("ER_") && key.ends_with("_GEM") => QUERY_THEN_CONSUME_GAP_REASON,
        _ => OPERAND_SCHEMA_MISSING_REASON,
    })
}

/// Deterministic coverage metadata for integration tests. Counts close by
/// construction: classified keys partition across the four classifications,
/// and admitted keys are a subset of the battle-routine keys.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ItemsMappingCoverage {
    /// Classified registry keys; excludes the unresolved relic family.
    pub classified_keys: usize,
    pub battle_routine_keys: usize,
    pub run_only_keys: usize,
    pub presentation_only_keys: usize,
    pub inert_keys: usize,
    /// Registry keys with admitted battle schemas (battle-routine subset).
    pub admitted_schema_keys: usize,
    /// Relic keys deliberately left unclassified this wave.
    pub unclassified_relic_keys: usize,
}

impl ItemsMappingCoverage {
    /// Recomputes the frozen coverage counts from the recognition tables.
    #[must_use]
    pub fn snapshot() -> Self {
        let mut coverage = Self {
            classified_keys: ITEM_UNIT_CLASSIFICATIONS.len(),
            battle_routine_keys: 0,
            run_only_keys: 0,
            presentation_only_keys: 0,
            inert_keys: 0,
            admitted_schema_keys: ITEMS_ADMITTED_REGISTRY_KEYS.len(),
            unclassified_relic_keys: UNCLASSIFIED_RELIC_KEYS.len(),
        };
        for row in ITEM_UNIT_CLASSIFICATIONS {
            match row.classification {
                ItemUnitClassification::BattleRoutine => coverage.battle_routine_keys += 1,
                ItemUnitClassification::RunOnly => coverage.run_only_keys += 1,
                ItemUnitClassification::PresentationOnly => coverage.presentation_only_keys += 1,
                ItemUnitClassification::Inert => coverage.inert_keys += 1,
            }
        }
        coverage
    }

    /// Classified plus unclassified keys cover the whole item registry.
    #[must_use]
    pub fn total_keys(&self) -> usize {
        self.classified_keys + self.unclassified_relic_keys
    }
}

/// True when the given registry key belongs to the relic family that stays
/// unclassified this wave; callers keep such units unresolved with
/// [`RELIC_KIND_CONFIG_UNRESOLVED_REASON`].
#[must_use]
pub fn is_unresolved_relic_key(registry_key: &str) -> bool {
    UNCLASSIFIED_RELIC_KEYS.contains(&registry_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognition_table_is_sorted_unique_and_closed() {
        let coverage = ItemsMappingCoverage::snapshot();
        assert_eq!(
            coverage.battle_routine_keys
                + coverage.run_only_keys
                + coverage.presentation_only_keys
                + coverage.inert_keys,
            coverage.classified_keys
        );
        assert_eq!(
            coverage.admitted_schema_keys,
            ITEMS_ADMITTED_REGISTRY_KEYS.len()
        );
        for pair in ITEM_UNIT_CLASSIFICATIONS.windows(2) {
            assert!(pair[0].registry_key < pair[1].registry_key);
        }
        for pair in UNCLASSIFIED_RELIC_KEYS.windows(2) {
            assert!(pair[0] < pair[1]);
        }
        for row in ITEM_UNIT_CLASSIFICATIONS {
            assert!(!is_unresolved_relic_key(row.registry_key));
        }
    }

    #[test]
    fn admitted_keys_are_battle_routine_without_gap_reasons() {
        for key in ITEMS_ADMITTED_REGISTRY_KEYS {
            let row = lookup_classification(key).expect("admitted keys are classified");
            assert_eq!(row.classification, ItemUnitClassification::BattleRoutine);
            assert_eq!(battle_schema_gap(key), None);
        }
    }

    #[test]
    fn only_admitted_keys_admit_and_every_battle_gap_is_typed() {
        for row in ITEM_UNIT_CLASSIFICATIONS {
            let admits = ITEMS_ADMITTED_REGISTRY_KEYS.contains(&row.registry_key);
            if row.classification != ItemUnitClassification::BattleRoutine {
                assert!(!admits);
                assert_eq!(battle_schema_gap(row.registry_key), None);
            } else {
                assert_eq!(
                    battle_schema_gap(row.registry_key).is_none(),
                    admits,
                    "{}",
                    row.registry_key
                );
            }
        }
    }

    #[test]
    fn relic_keys_stay_unresolved() {
        assert!(is_unresolved_relic_key("ER_RELIC_STORMGLASS"));
        assert_eq!(lookup_classification("ER_RELIC_STORMGLASS"), None);
        assert_eq!(battle_schema_gap("ER_RELIC_STORMGLASS"), None);
        assert_eq!(battle_schema_gap("NOT_A_REAL_ITEM"), None);
    }
}
