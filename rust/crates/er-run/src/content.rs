//! Immutable, typed M4 run-content definitions and run-content hashing.
//!
//! The selected data below is intentionally narrow. It describes the closed
//! wave-9-through-11 slice; it does not execute progression, modifiers, route
//! generation, or encounters.

use crate::capability::{
    CapabilityManifestError, EncounterSource, EnemyPolicy, MarketCapabilityAction,
    RUN_ORACLE_GAME_SHA, RewardCapabilityAction, RouteRngDomain, RunCapabilityManifest,
    RunCapabilityStatus,
};
use crate::rng_audit::RunRngDraw;
use er_canonical::{CanonicalError, canonical_bytes};
use er_types::battle_ids::{ContentPackHash, MoveId, SpeciesId};
use er_types::run_ids::{
    BiomeId, EncounterId, GrowthRateId, ModifierId, Money, NatureId, RunContentPackHash,
};
use er_types::run_model::ModifierTier;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

pub const RUN_CONTENT_PACK_SCHEMA_VERSION: u32 = 1;
pub const RUN_CONTENT_HASH_VERSION: u32 = 1;
pub const RUN_CONTENT_HASH_DOMAIN: &str = "pokerogue-redux/m4/run-content/v1";
pub const M3_PARITY_ORACLE_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

/// Closed growth-rate formula kinds admitted by the selected slice.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrowthRateKind {
    MediumFast,
    MediumSlow,
}

/// Selected nature stat axes. HP is deliberately absent from the nature table.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NatureStat {
    Attack,
    Defense,
    SpecialAttack,
    SpecialDefense,
    Speed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GrowthRateDefinition {
    pub id: GrowthRateId,
    pub key: String,
    pub kind: GrowthRateKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NatureDefinition {
    pub id: NatureId,
    pub key: String,
    pub raised_stat: Option<NatureStat>,
    pub lowered_stat: Option<NatureStat>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LevelMoveDefinition {
    pub level: u16,
    pub move_id: MoveId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EvolutionDefinition {
    pub target_species_id: SpeciesId,
    pub minimum_level: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesProgressionDefinition {
    pub species_id: SpeciesId,
    pub key: String,
    pub growth_rate: GrowthRateId,
    pub base_experience: u16,
    pub parity_level_before: u16,
    pub parity_level_after: u16,
    pub level_moves: Vec<LevelMoveDefinition>,
    pub current_moves: [MoveId; 4],
    pub evolutions: Vec<EvolutionDefinition>,
}
/// Closed target kinds for the selected modifier definitions.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModifierTargetKind {
    Run,
    OnePokemon,
    WholeParty,
    Inventory,
}

/// Closed persistent/immediate effects admitted by M4. There is no callback arm.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModifierEffectSpec {
    MoneyMultiplier { percent: u16 },
    ExperienceMultiplier { percent: u16 },
    LevelIncrementBooster { levels_per_stack: u8 },
    HealingMultiplier { percent: u16 },
    LockCapsule,
    HpRestore { points: u16, percent: u8 },
    MoneyReward { multiplier_milli: u16 },
    LevelIncrement { levels: u8 },
    InventoryItem { key: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ModifierDefinition {
    pub id: ModifierId,
    pub oracle_registry_key: String,
    pub tier: Option<ModifierTier>,
    pub maximum_stack: u16,
    pub target: ModifierTargetKind,
    pub effect: ModifierEffectSpec,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeDefinition {
    pub id: BiomeId,
    pub key: String,
    pub base_routes: Vec<BiomeId>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EncounterPlanSource {
    OracleCaptureRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EncounterGenerationMode {
    StaticCapturedVector,
    StaticFixedVector,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EncounterPlanDefinition {
    pub id: EncounterId,
    pub biome_id: BiomeId,
    pub source: EncounterPlanSource,
    pub generation_mode: EncounterGenerationMode,
    pub enemy_policy: EnemyPolicy,
    pub captured_vector_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RewardRuleSet {
    pub supports_reroll: bool,
    pub supports_locks: bool,
    pub reroll_base_cost: Money,
    pub lock_cost_tiers: Vec<Money>,
    pub selected_modifier_keys: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MarketRuleSet {
    pub supports_reroll: bool,
    pub supports_locks: bool,
    pub maximum_stock_entries: u16,
    pub selected_modifier_keys: Vec<String>,
}

#[derive(Debug, Error)]
pub enum RunContentError {
    #[error("run-content schema version is {actual}, expected {expected}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("M4 run-content oracle SHA is {actual}, expected {expected}")]
    M4OracleGameShaMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error("run-content hash is invalid: {0}")]
    InvalidHash(String),
    #[error("run-content hash mismatch: stored {expected}, recomputed {actual}")]
    HashMismatch {
        expected: RunContentPackHash,
        actual: RunContentPackHash,
    },
    #[error("run-content battle hash mismatch: expected {expected}, actual {actual}")]
    BattleContentHashMismatch {
        expected: ContentPackHash,
        actual: ContentPackHash,
    },
    #[error("M3 parity content uses oracle SHA {actual}, expected {expected}")]
    M3ParityOracleGameShaMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error("captured battle move {id} is absent from the bound content pack")]
    MissingCapturedBattleMove { id: MoveId },
    #[error("invalid selected ID {kind}={value}: {detail}")]
    InvalidSelectedId {
        kind: &'static str,
        value: u64,
        detail: String,
    },
    #[error("duplicate {kind}: {value}")]
    Duplicate { kind: &'static str, value: String },
    #[error("invalid {kind}: {detail}")]
    InvalidDefinition { kind: &'static str, detail: String },
    #[error("unsupported {kind}: {value}")]
    Unsupported { kind: &'static str, value: String },
    #[error("capability manifest is invalid: {0}")]
    Capability(#[source] CapabilityManifestError),
    #[error("canonical run-content hashing failed: {0}")]
    Canonical(#[source] CanonicalError),
}

/// Complete immutable M4 run content.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunContentPack {
    pub schema_version: u32,
    pub m4_oracle_sha: String,
    pub m3_parity_oracle_sha: String,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub growth_rates: Vec<Option<GrowthRateDefinition>>,
    pub natures: Vec<Option<NatureDefinition>>,
    pub species_progression: Vec<Option<SpeciesProgressionDefinition>>,
    pub modifiers: Vec<Option<ModifierDefinition>>,
    pub biomes: Vec<Option<BiomeDefinition>>,
    pub encounter_plans: Vec<EncounterPlanDefinition>,
    pub reward_rules: RewardRuleSet,
    pub market_rules: MarketRuleSet,
    pub capability_manifest: RunCapabilityManifest,
}

impl<'de> Deserialize<'de> for RunContentPack {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            schema_version: u32,
            m4_oracle_sha: String,
            m3_parity_oracle_sha: String,
            battle_content_hash: ContentPackHash,
            run_content_hash: RunContentPackHash,
            growth_rates: Vec<Option<GrowthRateDefinition>>,
            natures: Vec<Option<NatureDefinition>>,
            species_progression: Vec<Option<SpeciesProgressionDefinition>>,
            modifiers: Vec<Option<ModifierDefinition>>,
            biomes: Vec<Option<BiomeDefinition>>,
            encounter_plans: Vec<EncounterPlanDefinition>,
            reward_rules: RewardRuleSet,
            market_rules: MarketRuleSet,
            capability_manifest: RunCapabilityManifest,
        }
        let wire = Wire::deserialize(deserializer)?;
        let pack = Self {
            schema_version: wire.schema_version,
            m4_oracle_sha: wire.m4_oracle_sha,
            m3_parity_oracle_sha: wire.m3_parity_oracle_sha,
            battle_content_hash: wire.battle_content_hash,
            run_content_hash: wire.run_content_hash,
            growth_rates: wire.growth_rates,
            natures: wire.natures,
            species_progression: wire.species_progression,
            modifiers: wire.modifiers,
            biomes: wire.biomes,
            encounter_plans: wire.encounter_plans,
            reward_rules: wire.reward_rules,
            market_rules: wire.market_rules,
            capability_manifest: wire.capability_manifest,
        };
        pack.validate().map_err(serde::de::Error::custom)?;
        Ok(pack)
    }
}

impl RunContentPack {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        schema_version: u32,
        m4_oracle_sha: String,
        m3_parity_oracle_sha: String,
        battle_content_hash: ContentPackHash,
        growth_rates: Vec<Option<GrowthRateDefinition>>,
        natures: Vec<Option<NatureDefinition>>,
        species_progression: Vec<Option<SpeciesProgressionDefinition>>,
        modifiers: Vec<Option<ModifierDefinition>>,
        biomes: Vec<Option<BiomeDefinition>>,
        encounter_plans: Vec<EncounterPlanDefinition>,
        reward_rules: RewardRuleSet,
        market_rules: MarketRuleSet,
        capability_manifest: RunCapabilityManifest,
    ) -> Result<Self, RunContentError> {
        let run_content_hash = hash_for_parts(
            schema_version,
            &m4_oracle_sha,
            &m3_parity_oracle_sha,
            &battle_content_hash,
            &growth_rates,
            &natures,
            &species_progression,
            &modifiers,
            &biomes,
            &encounter_plans,
            &reward_rules,
            &market_rules,
            &capability_manifest,
        )?;
        let pack = Self {
            schema_version,
            m4_oracle_sha,
            m3_parity_oracle_sha,
            battle_content_hash,
            run_content_hash,
            growth_rates,
            natures,
            species_progression,
            modifiers,
            biomes,
            encounter_plans,
            reward_rules,
            market_rules,
            capability_manifest,
        };
        pack.validate()?;
        Ok(pack)
    }

    pub fn validate(&self) -> Result<(), RunContentError> {
        if self.schema_version != RUN_CONTENT_PACK_SCHEMA_VERSION {
            return Err(RunContentError::SchemaVersionMismatch {
                expected: RUN_CONTENT_PACK_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.m4_oracle_sha != RUN_ORACLE_GAME_SHA {
            return Err(RunContentError::M4OracleGameShaMismatch {
                expected: RUN_ORACLE_GAME_SHA,
                actual: self.m4_oracle_sha.clone(),
            });
        }
        if self.m3_parity_oracle_sha != M3_PARITY_ORACLE_SHA {
            return Err(RunContentError::M3ParityOracleGameShaMismatch {
                expected: M3_PARITY_ORACLE_SHA,
                actual: self.m3_parity_oracle_sha.clone(),
            });
        }
        self.capability_manifest
            .validate()
            .map_err(RunContentError::Capability)?;
        validate_growth_rates(&self.growth_rates)?;
        validate_natures(&self.natures)?;
        validate_species(&self.species_progression, &self.capability_manifest)?;
        validate_modifiers(&self.modifiers, &self.capability_manifest)?;
        validate_biomes(&self.biomes, &self.capability_manifest)?;
        validate_encounters(&self.encounter_plans, &self.biomes)?;
        validate_rules(&self.reward_rules, &self.market_rules, &self.modifiers)?;
        let actual = self.recompute_hash()?;
        if actual != self.run_content_hash {
            return Err(RunContentError::HashMismatch {
                expected: self.run_content_hash.clone(),
                actual,
            });
        }
        Ok(())
    }

    pub fn recompute_hash(&self) -> Result<RunContentPackHash, RunContentError> {
        hash_for_parts(
            self.schema_version,
            &self.m4_oracle_sha,
            &self.m3_parity_oracle_sha,
            &self.battle_content_hash,
            &self.growth_rates,
            &self.natures,
            &self.species_progression,
            &self.modifiers,
            &self.biomes,
            &self.encounter_plans,
            &self.reward_rules,
            &self.market_rules,
            &self.capability_manifest,
        )
    }

    /// Binds run content to the complete selected battle pack. The M4
    /// oracle SHA and the captured Body Slam move are checked before a hash
    /// match is accepted.
    pub fn validate_for_battle_content(
        &self,
        battle_content: &er_content::pack::ContentPack,
    ) -> Result<(), RunContentError> {
        if battle_content.oracle_game_sha != RUN_ORACLE_GAME_SHA {
            return Err(RunContentError::M4OracleGameShaMismatch {
                expected: RUN_ORACLE_GAME_SHA,
                actual: battle_content.oracle_game_sha.clone(),
            });
        }
        if self.battle_content_hash != battle_content.hash {
            return Err(RunContentError::BattleContentHashMismatch {
                expected: battle_content.hash.clone(),
                actual: self.battle_content_hash.clone(),
            });
        }
        for id in captured_progression_move_ids()? {
            if !battle_content
                .moves
                .iter()
                .any(|definition| definition.id == id)
            {
                return Err(RunContentError::MissingCapturedBattleMove { id });
            }
        }
        self.validate()
    }

    pub fn modifier_by_id(&self, id: ModifierId) -> Option<&ModifierDefinition> {
        self.modifiers
            .iter()
            .flatten()
            .find(|definition| definition.id == id)
    }
    pub fn modifier_by_registry_key(&self, key: &str) -> Option<&ModifierDefinition> {
        self.modifiers
            .iter()
            .flatten()
            .find(|definition| definition.oracle_registry_key == key)
    }
    pub fn classify_modifier(&self, id: ModifierId, key: &str) -> RunCapabilityStatus {
        match self.modifier_by_id(id) {
            Some(definition) if definition.oracle_registry_key == key => {
                self.capability_manifest.classify_modifier(id, key)
            }
            _ => RunCapabilityStatus::Unsupported(
                crate::capability::UnsupportedReasonCode::ModifierIdentityMismatch,
            ),
        }
    }
}

#[derive(Serialize)]
struct RunContentHashView<'a> {
    schema_version: u32,
    m4_oracle_sha: &'a str,
    m3_parity_oracle_sha: &'a str,
    battle_content_hash: &'a ContentPackHash,
    growth_rates: &'a [Option<GrowthRateDefinition>],
    natures: &'a [Option<NatureDefinition>],
    species_progression: &'a [Option<SpeciesProgressionDefinition>],
    modifiers: &'a [Option<ModifierDefinition>],
    biomes: &'a [Option<BiomeDefinition>],
    encounter_plans: &'a [EncounterPlanDefinition],
    reward_rules: &'a RewardRuleSet,
    market_rules: &'a MarketRuleSet,
    capability_manifest: &'a RunCapabilityManifest,
}

#[allow(clippy::too_many_arguments)]
fn hash_for_parts(
    schema_version: u32,
    m4_oracle_sha: &str,
    m3_parity_oracle_sha: &str,
    battle_content_hash: &ContentPackHash,
    growth_rates: &[Option<GrowthRateDefinition>],
    natures: &[Option<NatureDefinition>],
    species_progression: &[Option<SpeciesProgressionDefinition>],
    modifiers: &[Option<ModifierDefinition>],
    biomes: &[Option<BiomeDefinition>],
    encounter_plans: &[EncounterPlanDefinition],
    reward_rules: &RewardRuleSet,
    market_rules: &MarketRuleSet,
    capability_manifest: &RunCapabilityManifest,
) -> Result<RunContentPackHash, RunContentError> {
    let view = RunContentHashView {
        schema_version,
        m4_oracle_sha,
        m3_parity_oracle_sha,
        battle_content_hash,
        growth_rates,
        natures,
        species_progression,
        modifiers,
        biomes,
        encounter_plans,
        reward_rules,
        market_rules,
        capability_manifest,
    };
    let canonical = canonical_bytes(&view).map_err(RunContentError::Canonical)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(RUN_CONTENT_HASH_DOMAIN.as_bytes());
    hasher.update(&[0]);
    hasher.update(&canonical);
    let digest = hasher.finalize().to_hex().to_string();
    RunContentPackHash::new(format!("blake3-v1:{digest}"))
        .map_err(|error| RunContentError::InvalidHash(error.to_string()))
}
fn captured_progression_move_ids() -> Result<[MoveId; 1], RunContentError> {
    Ok([move_id(34)?])
}
fn validate_growth_rates(values: &[Option<GrowthRateDefinition>]) -> Result<(), RunContentError> {
    let mut seen = BTreeSet::new();
    for (index, definition) in values.iter().enumerate() {
        let Some(definition) = definition else {
            continue;
        };
        if usize::from(definition.id.get()) != index {
            return Err(invalid(
                "growth rate",
                "numeric vector hole does not match ID",
            ));
        }
        if definition.key.is_empty() {
            return Err(invalid("growth rate", "empty key"));
        }
        if !seen.insert(definition.id.to_string()) {
            return Err(duplicate("growth rate ID", definition.id.to_string()));
        }
    }

    Ok(())
}
fn validate_natures(values: &[Option<NatureDefinition>]) -> Result<(), RunContentError> {
    let mut seen = BTreeSet::new();
    for (index, definition) in values.iter().enumerate() {
        let Some(definition) = definition else {
            continue;
        };
        if usize::from(definition.id.get()) != index {
            return Err(invalid("nature", "numeric vector hole does not match ID"));
        }
        if definition.key.is_empty() {
            return Err(invalid("nature", "empty key"));
        }
        if definition.raised_stat == definition.lowered_stat && definition.raised_stat.is_some() {
            return Err(invalid("nature", "raised and lowered stats are equal"));
        }
        if !seen.insert(definition.id.to_string()) {
            return Err(duplicate("nature ID", definition.id.to_string()));
        }
    }
    Ok(())
}
fn validate_species(
    values: &[Option<SpeciesProgressionDefinition>],
    capabilities: &RunCapabilityManifest,
) -> Result<(), RunContentError> {
    let mut seen = BTreeSet::new();
    for (index, definition) in values.iter().enumerate() {
        let Some(definition) = definition else {
            continue;
        };
        if u64::from(definition.species_id) != index as u64 {
            return Err(invalid(
                "species progression",
                "numeric vector hole does not match ID",
            ));
        }
        if definition.key.is_empty()
            || definition.base_experience == 0
            || definition.parity_level_before == 0
            || definition.parity_level_after <= definition.parity_level_before
        {
            return Err(invalid(
                "species progression",
                "invalid key, base experience, or parity level range",
            ));
        }
        if !seen.insert(definition.species_id.to_string()) {
            return Err(duplicate("species ID", definition.species_id.to_string()));
        }
        if !capabilities
            .supported_growth_rates
            .contains(&definition.growth_rate)
        {
            return Err(unsupported(
                "growth rate",
                definition.growth_rate.to_string(),
            ));
        }
        let mut prior_level = 0;
        let mut move_ids = BTreeSet::new();
        for move_definition in &definition.level_moves {
            if move_definition.level == 0
                || move_definition.level < prior_level
                || move_definition.level != definition.parity_level_after
            {
                return Err(invalid(
                    "level move",
                    "unordered level, zero level, or move outside parity level",
                ));
            }
            if !move_ids.insert(move_definition.move_id.to_string()) {
                return Err(duplicate(
                    "level move ID",
                    move_definition.move_id.to_string(),
                ));
            }
            prior_level = move_definition.level;
        }
        let mut current_ids = BTreeSet::new();
        for move_id in &definition.current_moves {
            if !current_ids.insert(move_id.to_string()) {
                return Err(duplicate("current move ID", move_id.to_string()));
            }
        }
        for evolution in &definition.evolutions {
            if evolution.minimum_level == 0 {
                return Err(invalid("evolution", "zero minimum level"));
            }
        }
    }
    Ok(())
}
fn validate_modifiers(
    values: &[Option<ModifierDefinition>],
    capabilities: &RunCapabilityManifest,
) -> Result<(), RunContentError> {
    if values.iter().flatten().count() != capabilities.supported_modifier_ids.len()
        || values.iter().flatten().count() != capabilities.modifier_registry_keys.len()
    {
        return Err(invalid(
            "modifier",
            "numeric ID and registry-key lists are not bijective",
        ));
    }
    let mut ids = BTreeSet::new();
    let mut keys = BTreeSet::new();
    for (index, definition) in values.iter().enumerate() {
        let Some(definition) = definition else {
            continue;
        };
        if u64::from(definition.id) != index as u64 {
            return Err(invalid("modifier", "numeric vector hole does not match ID"));
        }
        if !ids.insert(definition.id.to_string()) {
            return Err(duplicate("modifier ID", definition.id.to_string()));
        }
        if definition.oracle_registry_key.is_empty()
            || !keys.insert(definition.oracle_registry_key.clone())
        {
            return Err(duplicate(
                "modifier registry key",
                definition.oracle_registry_key.clone(),
            ));
        }
        if definition.maximum_stack == 0 {
            return Err(invalid("modifier", "zero maximum stack"));
        }
        if !capabilities
            .modifier_registry_keys
            .iter()
            .any(|key| key == &definition.oracle_registry_key)
        {
            return Err(unsupported(
                "modifier registry key",
                definition.oracle_registry_key.clone(),
            ));
        }
        if !capabilities.supported_modifier_ids.contains(&definition.id) {
            return Err(unsupported("modifier ID", definition.id.to_string()));
        }
        validate_effect(&definition.effect)?;
    }
    Ok(())
}
fn validate_effect(effect: &ModifierEffectSpec) -> Result<(), RunContentError> {
    match effect {
        ModifierEffectSpec::MoneyMultiplier { percent }
        | ModifierEffectSpec::ExperienceMultiplier { percent }
        | ModifierEffectSpec::HealingMultiplier { percent }
            if *percent == 0 || *percent > 10_000 =>
        {
            Err(invalid(
                "modifier effect",
                "percentage outside closed range",
            ))
        }
        ModifierEffectSpec::HpRestore { points, percent } if *points == 0 && *percent == 0 => {
            Err(invalid("modifier effect", "empty healing effect"))
        }
        ModifierEffectSpec::MoneyReward { multiplier_milli } if *multiplier_milli == 0 => {
            Err(invalid("modifier effect", "zero money multiplier"))
        }
        ModifierEffectSpec::InventoryItem { key } if key.is_empty() => {
            Err(invalid("modifier effect", "empty inventory key"))
        }
        _ => Ok(()),
    }
}
fn validate_biomes(
    values: &[Option<BiomeDefinition>],
    capabilities: &RunCapabilityManifest,
) -> Result<(), RunContentError> {
    let mut seen = BTreeSet::new();
    for (index, definition) in values.iter().enumerate() {
        let Some(definition) = definition else {
            continue;
        };
        if u64::from(definition.id) != index as u64 {
            return Err(invalid("biome", "numeric vector hole does not match ID"));
        }
        if definition.key.is_empty() {
            return Err(invalid("biome", "empty key"));
        }
        if !seen.insert(definition.id.to_string()) {
            return Err(duplicate("biome ID", definition.id.to_string()));
        }
        if !capabilities.biome_ids.contains(&definition.id) {
            return Err(unsupported("biome ID", definition.id.to_string()));
        }
        let mut routes = BTreeSet::new();
        for route in &definition.base_routes {
            if !routes.insert(route.to_string()) {
                return Err(duplicate("biome route", route.to_string()));
            }
        }
    }
    Ok(())
}
fn validate_encounters(
    values: &[EncounterPlanDefinition],
    biomes: &[Option<BiomeDefinition>],
) -> Result<(), RunContentError> {
    let mut ids = BTreeSet::new();
    for definition in values {
        if definition.captured_vector_key.is_empty() {
            return Err(invalid("encounter", "empty captured vector key"));
        }
        if !ids.insert(definition.id.to_string()) {
            return Err(duplicate("encounter ID", definition.id.to_string()));
        }
        if !biomes
            .iter()
            .flatten()
            .any(|biome| biome.id == definition.biome_id)
        {
            return Err(unsupported(
                "encounter biome",
                definition.biome_id.to_string(),
            ));
        }
    }
    Ok(())
}
fn validate_rules(
    reward: &RewardRuleSet,
    market: &MarketRuleSet,
    modifiers: &[Option<ModifierDefinition>],
) -> Result<(), RunContentError> {
    let definitions = modifiers.iter().flatten().collect::<Vec<_>>();
    if reward.selected_modifier_keys.iter().any(|key| {
        !definitions
            .iter()
            .any(|definition| &definition.oracle_registry_key == key && definition.tier.is_some())
    }) {
        return Err(invalid(
            "reward rules",
            "selected modifier key is not in the bijection",
        ));
    }
    if market.selected_modifier_keys.iter().any(|key| {
        !definitions
            .iter()
            .any(|definition| &definition.oracle_registry_key == key && definition.tier.is_some())
    }) {
        return Err(invalid(
            "market rules",
            "selected modifier key is not in the bijection",
        ));
    }
    if !reward.supports_reroll || !reward.supports_locks || reward.lock_cost_tiers.is_empty() {
        return Err(invalid(
            "reward rules",
            "selected regular reward surface lost reroll/lock support",
        ));
    }
    if market.supports_reroll
        || market.supports_locks
        || market.maximum_stock_entries == 0
        || market.maximum_stock_entries > 16
    {
        return Err(invalid(
            "market rules",
            "biome market reroll/lock or stock bound is invalid",
        ));
    }
    Ok(())
}
fn duplicate(kind: &'static str, value: String) -> RunContentError {
    RunContentError::Duplicate { kind, value }
}
fn invalid(kind: &'static str, detail: &'static str) -> RunContentError {
    RunContentError::InvalidDefinition {
        kind,
        detail: detail.to_owned(),
    }
}
fn unsupported(kind: &'static str, value: String) -> RunContentError {
    RunContentError::Unsupported { kind, value }
}

/// The exact typed vector of static run RNG evidence attached to encounter material.
pub type EncounterGenerationAudit = Vec<RunRngDraw>;
pub type RewardActionCapability = RewardCapabilityAction;
pub type MarketActionCapability = MarketCapabilityAction;
pub type RouteDomainCapability = RouteRngDomain;
pub type ContentEncounterSource = EncounterSource;
/// Constructs the selected run pack from typed constants. No fixture or
/// filesystem read occurs at runtime; the caller supplies the battle-pack identity.
pub fn selected_run_content_pack(
    battle_content_hash: ContentPackHash,
) -> Result<RunContentPack, RunContentError> {
    let mut growth_rates = vec![None; 4];
    growth_rates[2] = Some(GrowthRateDefinition {
        id: GrowthRateId::new(2),
        key: "MEDIUM_FAST".to_owned(),
        kind: GrowthRateKind::MediumFast,
    });
    growth_rates[3] = Some(GrowthRateDefinition {
        id: GrowthRateId::new(3),
        key: "MEDIUM_SLOW".to_owned(),
        kind: GrowthRateKind::MediumSlow,
    });
    let mut natures = vec![None; 25];
    natures[0] = Some(NatureDefinition {
        id: NatureId::new(0),
        key: "HARDY".to_owned(),
        raised_stat: None,
        lowered_stat: None,
    });
    natures[3] = Some(NatureDefinition {
        id: NatureId::new(3),
        key: "ADAMANT".to_owned(),
        raised_stat: Some(NatureStat::Attack),
        lowered_stat: Some(NatureStat::SpecialAttack),
    });
    natures[10] = Some(NatureDefinition {
        id: NatureId::new(10),
        key: "TIMID".to_owned(),
        raised_stat: Some(NatureStat::Speed),
        lowered_stat: Some(NatureStat::Attack),
    });
    natures[15] = Some(NatureDefinition {
        id: NatureId::new(15),
        key: "MODEST".to_owned(),
        raised_stat: Some(NatureStat::SpecialAttack),
        lowered_stat: Some(NatureStat::Attack),
    });
    natures[24] = Some(NatureDefinition {
        id: NatureId::new(24),
        key: "QUIRKY".to_owned(),
        raised_stat: None,
        lowered_stat: None,
    });

    let mut species_progression = vec![None; 933];
    species_progression[932] = Some(SpeciesProgressionDefinition {
        species_id: species_id(932)?,
        parity_level_before: 16,
        parity_level_after: 17,
        key: "NACLI".to_owned(),
        growth_rate: GrowthRateId::new(3),
        base_experience: 56,
        level_moves: vec![LevelMoveDefinition {
            level: 17,
            move_id: move_id(34)?,
        }],
        current_moves: [move_id(1)?, move_id(52)?, move_id(77)?, move_id(78)?],
        evolutions: vec![EvolutionDefinition {
            target_species_id: species_id(933)?,
            minimum_level: 23,
        }],
    });

    let mut modifier_slots = vec![None; 402];
    for definition in selected_modifier_definitions()? {
        let index = u64::from(definition.id) as usize;
        if index >= modifier_slots.len() {
            return Err(invalid(
                "modifier",
                "selected ID outside numeric hole vector",
            ));
        }
        modifier_slots[index] = Some(definition);
    }
    let mut biomes = vec![None; 51];
    biomes[0] = Some(BiomeDefinition {
        id: biome_id(0)?,
        key: "TOWN".to_owned(),
        base_routes: vec![biome_id(1)?],
    });
    biomes[1] = Some(BiomeDefinition {
        id: biome_id(1)?,
        key: "PLAINS".to_owned(),
        base_routes: vec![biome_id(2)?, biome_id(4)?, biome_id(9)?],
    });
    biomes[2] = Some(BiomeDefinition {
        id: biome_id(2)?,
        key: "GRASS".to_owned(),
        base_routes: vec![biome_id(3)?],
    });
    biomes[4] = Some(BiomeDefinition {
        id: biome_id(4)?,
        key: "METROPOLIS".to_owned(),
        base_routes: vec![biome_id(30)?],
    });
    biomes[9] = Some(BiomeDefinition {
        id: biome_id(9)?,
        key: "LAKE".to_owned(),
        base_routes: vec![biome_id(8)?, biome_id(7)?, biome_id(26)?],
    });
    biomes[50] = Some(BiomeDefinition {
        id: biome_id(50)?,
        key: "END".to_owned(),
        base_routes: Vec::new(),
    });
    let reward_rules = RewardRuleSet {
        supports_reroll: true,
        supports_locks: true,
        reroll_base_cost: money(250)?,
        lock_cost_tiers: vec![
            money(50)?,
            money(125)?,
            money(300)?,
            money(750)?,
            money(2000)?,
        ],
        selected_modifier_keys: vec![
            "LOCK_CAPSULE".to_owned(),
            "POTION".to_owned(),
            "NUGGET".to_owned(),
            "RARE_CANDY".to_owned(),
        ],
    };
    let market_rules = MarketRuleSet {
        supports_reroll: false,
        supports_locks: false,
        maximum_stock_entries: 16,
        selected_modifier_keys: vec!["POKEBALL".to_owned(), "GREAT_BALL".to_owned()],
    };
    let encounter_plans = vec![EncounterPlanDefinition {
        id: encounter_id(1)?,
        biome_id: biome_id(1)?,
        source: EncounterPlanSource::OracleCaptureRequired,
        generation_mode: EncounterGenerationMode::StaticCapturedVector,
        enemy_policy: EnemyPolicy::ScriptedEnemyPolicyV1,
        captured_vector_key: "plains-wave-11-captured-v1".to_owned(),
    }];
    RunContentPack::new(
        RUN_CONTENT_PACK_SCHEMA_VERSION,
        RUN_ORACLE_GAME_SHA.to_owned(),
        M3_PARITY_ORACLE_SHA.to_owned(),
        battle_content_hash,
        growth_rates,
        natures,
        species_progression,
        modifier_slots,
        biomes,
        encounter_plans,
        reward_rules,
        market_rules,
        crate::capability::selected_run_capability_manifest()
            .map_err(RunContentError::Capability)?,
    )
}

fn selected_modifier_definitions() -> Result<Vec<ModifierDefinition>, RunContentError> {
    Ok(vec![
        modifier(
            1,
            "AMULET_COIN",
            ModifierTier::Ultra,
            5,
            ModifierTargetKind::Run,
            ModifierEffectSpec::MoneyMultiplier { percent: 20 },
        )?,
        modifier(
            2,
            "CANDY_JAR",
            ModifierTier::Ultra,
            99,
            ModifierTargetKind::Run,
            ModifierEffectSpec::LevelIncrementBooster {
                levels_per_stack: 1,
            },
        )?,
        modifier(
            3,
            "EXP_CHARM",
            ModifierTier::Ultra,
            99,
            ModifierTargetKind::Run,
            ModifierEffectSpec::ExperienceMultiplier { percent: 25 },
        )?,
        modifier(
            4,
            "SUPER_EXP_CHARM",
            ModifierTier::Rogue,
            30,
            ModifierTargetKind::Run,
            ModifierEffectSpec::ExperienceMultiplier { percent: 60 },
        )?,
        modifier(
            5,
            "GOLDEN_EXP_CHARM",
            None,
            10,
            ModifierTargetKind::Run,
            ModifierEffectSpec::ExperienceMultiplier { percent: 100 },
        )?,
        modifier(
            6,
            "HEALING_CHARM",
            ModifierTier::Master,
            5,
            ModifierTargetKind::Run,
            ModifierEffectSpec::HealingMultiplier { percent: 110 },
        )?,
        modifier(
            7,
            "LOCK_CAPSULE",
            ModifierTier::Rogue,
            1,
            ModifierTargetKind::Run,
            ModifierEffectSpec::LockCapsule,
        )?,
        modifier(
            100,
            "POTION",
            ModifierTier::Common,
            1,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::HpRestore {
                points: 20,
                percent: 10,
            },
        )?,
        modifier(
            101,
            "SUPER_POTION",
            ModifierTier::Common,
            1,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::HpRestore {
                points: 50,
                percent: 25,
            },
        )?,
        modifier(
            102,
            "HYPER_POTION",
            ModifierTier::Great,
            1,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::HpRestore {
                points: 200,
                percent: 50,
            },
        )?,
        modifier(
            103,
            "MAX_POTION",
            ModifierTier::Great,
            1,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::HpRestore {
                points: 0,
                percent: 100,
            },
        )?,
        modifier(
            200,
            "NUGGET",
            ModifierTier::Great,
            1,
            ModifierTargetKind::Run,
            ModifierEffectSpec::MoneyReward {
                multiplier_milli: 1000,
            },
        )?,
        modifier(
            201,
            "BIG_NUGGET",
            ModifierTier::Ultra,
            1,
            ModifierTargetKind::Run,
            ModifierEffectSpec::MoneyReward {
                multiplier_milli: 2500,
            },
        )?,
        modifier(
            202,
            "RELIC_GOLD",
            ModifierTier::Rogue,
            1,
            ModifierTargetKind::Run,
            ModifierEffectSpec::MoneyReward {
                multiplier_milli: 10000,
            },
        )?,
        modifier(
            300,
            "RARE_CANDY",
            ModifierTier::Common,
            1,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::LevelIncrement { levels: 1 },
        )?,
        modifier(
            301,
            "RARER_CANDY",
            ModifierTier::Ultra,
            1,
            ModifierTargetKind::WholeParty,
            ModifierEffectSpec::LevelIncrement { levels: 1 },
        )?,
        modifier(
            400,
            "POKEBALL",
            ModifierTier::Common,
            1,
            ModifierTargetKind::Inventory,
            ModifierEffectSpec::InventoryItem {
                key: "POKEBALL".to_owned(),
            },
        )?,
        modifier(
            401,
            "GREAT_BALL",
            ModifierTier::Great,
            1,
            ModifierTargetKind::Inventory,
            ModifierEffectSpec::InventoryItem {
                key: "GREAT_BALL".to_owned(),
            },
        )?,
    ])
}

fn modifier(
    id: u64,
    key: &str,
    tier: impl Into<Option<ModifierTier>>,
    maximum_stack: u16,
    target: ModifierTargetKind,
    effect: ModifierEffectSpec,
) -> Result<ModifierDefinition, RunContentError> {
    Ok(ModifierDefinition {
        id: modifier_id(id)?,
        oracle_registry_key: key.to_owned(),
        tier: tier.into(),
        maximum_stack,
        target,
        effect,
    })
}
fn selected_id(kind: &'static str, value: u64, error: impl ToString) -> RunContentError {
    RunContentError::InvalidSelectedId {
        kind,
        value,
        detail: error.to_string(),
    }
}
fn modifier_id(value: u64) -> Result<ModifierId, RunContentError> {
    ModifierId::try_from_u64(value).map_err(|error| selected_id("modifier", value, error))
}
fn species_id(value: u64) -> Result<SpeciesId, RunContentError> {
    SpeciesId::try_from_u64(value).map_err(|error| selected_id("species", value, error))
}
fn move_id(value: u64) -> Result<MoveId, RunContentError> {
    MoveId::try_from_u64(value).map_err(|error| selected_id("move", value, error))
}
fn biome_id(value: u64) -> Result<BiomeId, RunContentError> {
    BiomeId::try_from_u64(value).map_err(|error| selected_id("biome", value, error))
}
fn encounter_id(value: u64) -> Result<EncounterId, RunContentError> {
    EncounterId::try_from_u64(value).map_err(|error| selected_id("encounter", value, error))
}
fn money(value: u64) -> Result<Money, RunContentError> {
    er_types::SafeU53::new(value)
        .map(Money::new)
        .map_err(|error| selected_id("money", value, error))
}
