//! Closed M4 run capability classification and manifest validation.

use er_types::battle_ids::GameModeId;
use er_types::run_ids::{BiomeId, GrowthRateId, ModifierId, NatureId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use thiserror::Error;

pub const RUN_CAPABILITY_MANIFEST_VERSION: u32 = 1;
pub const RUN_ORACLE_GAME_SHA: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

/// Every unsupported path has a stable typed reason; no unsupported value is skipped.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Error)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnsupportedReasonCode {
    #[error("evolution execution")]
    EvolutionExecution,
    #[error("fusion or form change")]
    FusionOrFormChange,
    #[error("mystery encounter")]
    MysteryEncounter,
    #[error("capture or flee")]
    CaptureOrFlee,
    #[error("TM or remembered move")]
    TmOrRememberMove,
    #[error("dynamic modifier generator callback")]
    DynamicModifierGeneratorCallback,
    #[error("dynamic modifier apply callback")]
    DynamicModifierApplyCallback,
    #[error("trainer constructor callback")]
    TrainerConstructorCallback,
    #[error("smart or random AI")]
    SmartOrRandomAi,
    #[error("weighted or event route callback")]
    WeightedOrEventRouteCallback,
    #[error("notoriety or relic callback")]
    NotorietyOrRelicCallback,
    #[error("daily/endless/random biome")]
    DailyEndlessRandomBiome,
    #[error("unselected growth rate or nature")]
    UnselectedGrowthOrNature,
    #[error("nonfinite or unsafe price")]
    NonfiniteOrOutOfSafeIntegerPrice,
    #[error("callback, script, or trait-object content")]
    CallbackOrScriptOrTraitObjectContent,
    #[error("duplicate modifier numeric ID")]
    DuplicateModifierId,
    #[error("duplicate modifier registry key")]
    DuplicateModifierKey,
    #[error("modifier ID/key mapping mismatch")]
    ModifierIdentityMismatch,
    #[error("battle content hash mismatch")]
    BattleContentHashMismatch,
    #[error("wrong oracle SHA")]
    WrongOracle,
    #[error("replica generation is forbidden")]
    ReplicaGenerationForbidden,
    #[error("unsupported content")]
    UnsupportedContent,
}

/// Result of classifying one run-content capability.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(
    rename_all = "SCREAMING_SNAKE_CASE",
    tag = "status",
    content = "reason"
)]
pub enum RunCapabilityStatus {
    Supported,
    Unsupported(UnsupportedReasonCode),
}

/// Closed action vocabulary admitted by regular reward/shop.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RewardCapabilityAction {
    FreeSelect,
    Skip,
    Buy,
    Target,
    Reroll,
    LockToggle,
}

/// Closed action vocabulary admitted by biome market.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarketCapabilityAction {
    Buy,
    Target,
    Leave,
}

/// Closed route RNG source classification.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouteRngDomain {
    AuthorityAddressed,
    ExactAmbientState,
}

/// Closed encounter source classification.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EncounterSource {
    StaticCapturedVector,
    StaticFixedVector,
}

/// Closed enemy policy classification.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EnemyPolicy {
    ScriptedEnemyPolicyV1,
}

/// The fail-closed selected run capability manifest.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RunCapabilityManifest {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub fail_closed: bool,
    pub supported_modes: Vec<GameModeId>,
    pub supported_growth_rates: Vec<GrowthRateId>,
    pub supported_natures: Vec<NatureId>,
    pub modifier_registry_keys: Vec<String>,
    pub supported_modifier_ids: Vec<ModifierId>,
    pub regular_reward_actions: Vec<RewardCapabilityAction>,
    pub biome_market_actions: Vec<MarketCapabilityAction>,
    pub biome_ids: Vec<BiomeId>,
    pub route_rng_domains: Vec<RouteRngDomain>,
    pub encounter_sources: Vec<EncounterSource>,
    pub enemy_policies: Vec<EnemyPolicy>,
    pub unsupported: Vec<UnsupportedReasonCode>,
    pub replica_generation_forbidden: bool,
    pub production_typescript_changes_forbidden: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CapabilityManifestError {
    #[error("capability manifest schema version is {actual}, expected {expected}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("capability manifest oracle SHA is {actual}, expected {expected}")]
    OracleGameShaMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error("capability manifest must be fail-closed")]
    NotFailClosed,
    #[error("capability manifest must prohibit replica generation")]
    ReplicaGenerationAllowed,
    #[error("capability manifest permits production TypeScript changes")]
    ProductionTypescriptChangesAllowed,
    #[error("invalid selected ID {kind}={value}: {detail}")]
    InvalidSelectedId {
        kind: &'static str,
        value: u64,
        detail: String,
    },
    #[error("capability manifest has duplicate {kind} entry {value}")]
    DuplicateEntry { kind: &'static str, value: String },
    #[error("capability manifest has no supported {kind}")]
    EmptySupported { kind: &'static str },
}

impl RunCapabilityManifest {
    pub fn validate(&self) -> Result<(), CapabilityManifestError> {
        if self.schema_version != RUN_CAPABILITY_MANIFEST_VERSION {
            return Err(CapabilityManifestError::SchemaVersionMismatch {
                expected: RUN_CAPABILITY_MANIFEST_VERSION,
                actual: self.schema_version,
            });
        }
        if self.oracle_game_sha != RUN_ORACLE_GAME_SHA {
            return Err(CapabilityManifestError::OracleGameShaMismatch {
                expected: RUN_ORACLE_GAME_SHA,
                actual: self.oracle_game_sha.clone(),
            });
        }
        if !self.fail_closed {
            return Err(CapabilityManifestError::NotFailClosed);
        }
        if !self.replica_generation_forbidden {
            return Err(CapabilityManifestError::ReplicaGenerationAllowed);
        }
        if !self.production_typescript_changes_forbidden {
            return Err(CapabilityManifestError::ProductionTypescriptChangesAllowed);
        }
        ensure_nonempty("mode", self.supported_modes.len())?;
        ensure_nonempty("growth rate", self.supported_growth_rates.len())?;
        ensure_nonempty("nature", self.supported_natures.len())?;
        ensure_nonempty("modifier registry key", self.modifier_registry_keys.len())?;
        ensure_nonempty("modifier ID", self.supported_modifier_ids.len())?;
        ensure_nonempty("regular reward action", self.regular_reward_actions.len())?;
        ensure_nonempty("biome market action", self.biome_market_actions.len())?;
        ensure_nonempty("biome", self.biome_ids.len())?;
        ensure_nonempty("route RNG domain", self.route_rng_domains.len())?;
        ensure_nonempty("encounter source", self.encounter_sources.len())?;
        ensure_nonempty("enemy policy", self.enemy_policies.len())?;
        ensure_unique("mode", self.supported_modes.iter().map(ToString::to_string))?;
        ensure_unique(
            "growth rate",
            self.supported_growth_rates.iter().map(ToString::to_string),
        )?;
        ensure_unique(
            "nature",
            self.supported_natures.iter().map(ToString::to_string),
        )?;
        ensure_unique(
            "modifier registry key",
            self.modifier_registry_keys.iter().cloned(),
        )?;
        ensure_unique(
            "modifier ID",
            self.supported_modifier_ids.iter().map(ToString::to_string),
        )?;
        ensure_unique("biome", self.biome_ids.iter().map(ToString::to_string))?;
        Ok(())
    }

    pub fn classify_growth_rate(&self, id: GrowthRateId) -> RunCapabilityStatus {
        if self.supported_growth_rates.contains(&id) {
            RunCapabilityStatus::Supported
        } else {
            RunCapabilityStatus::Unsupported(UnsupportedReasonCode::UnselectedGrowthOrNature)
        }
    }

    pub fn classify_nature(&self, id: NatureId) -> RunCapabilityStatus {
        if self.supported_natures.contains(&id) {
            RunCapabilityStatus::Supported
        } else {
            RunCapabilityStatus::Unsupported(UnsupportedReasonCode::UnselectedGrowthOrNature)
        }
    }

    pub fn classify_modifier(&self, id: ModifierId, key: &str) -> RunCapabilityStatus {
        if self.supported_modifier_ids.contains(&id)
            && self.modifier_registry_keys.iter().any(|entry| entry == key)
        {
            RunCapabilityStatus::Supported
        } else {
            RunCapabilityStatus::Unsupported(UnsupportedReasonCode::UnsupportedContent)
        }
    }

    pub fn classify_biome(&self, id: BiomeId) -> RunCapabilityStatus {
        if self.biome_ids.contains(&id) {
            RunCapabilityStatus::Supported
        } else {
            RunCapabilityStatus::Unsupported(UnsupportedReasonCode::UnsupportedContent)
        }
    }

    pub const fn replica_may_generate(&self) -> bool {
        false
    }

    pub fn selected() -> Result<Self, CapabilityManifestError> {
        selected_run_capability_manifest()
    }
}

fn ensure_nonempty(kind: &'static str, length: usize) -> Result<(), CapabilityManifestError> {
    if length == 0 {
        Err(CapabilityManifestError::EmptySupported { kind })
    } else {
        Ok(())
    }
}

fn ensure_unique<I>(kind: &'static str, values: I) -> Result<(), CapabilityManifestError>
where
    I: IntoIterator<Item = String>,
{
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value.clone()) {
            return Err(CapabilityManifestError::DuplicateEntry { kind, value });
        }
    }
    Ok(())
}

pub fn selected_run_capability_manifest() -> Result<RunCapabilityManifest, CapabilityManifestError>
{
    let modifier_ids = [
        1_u64, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 200, 201, 202, 300, 301, 400, 401,
    ]
    .into_iter()
    .map(|value| {
        ModifierId::try_from_u64(value).map_err(|error| {
            CapabilityManifestError::InvalidSelectedId {
                kind: "modifier",
                value,
                detail: error.to_string(),
            }
        })
    })
    .collect::<Result<Vec<_>, _>>()?;
    let biome_ids = [0_u64, 1, 2, 4, 9, 50]
        .into_iter()
        .map(|value| {
            BiomeId::try_from_u64(value).map_err(|error| {
                CapabilityManifestError::InvalidSelectedId {
                    kind: "biome",
                    value,
                    detail: error.to_string(),
                }
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let supported_modes = [0_u64, 1]
        .into_iter()
        .map(|value| {
            GameModeId::try_from_u64(value).map_err(|error| {
                CapabilityManifestError::InvalidSelectedId {
                    kind: "mode",
                    value,
                    detail: error.to_string(),
                }
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(RunCapabilityManifest {
        schema_version: RUN_CAPABILITY_MANIFEST_VERSION,
        oracle_game_sha: RUN_ORACLE_GAME_SHA.to_owned(),
        fail_closed: true,
        supported_modes,
        supported_growth_rates: vec![GrowthRateId::new(2), GrowthRateId::new(3)],
        supported_natures: vec![
            NatureId::new(0),
            NatureId::new(3),
            NatureId::new(10),
            NatureId::new(15),
            NatureId::new(24),
        ],
        modifier_registry_keys: vec![
            "AMULET_COIN".to_owned(),
            "CANDY_JAR".to_owned(),
            "EXP_CHARM".to_owned(),
            "SUPER_EXP_CHARM".to_owned(),
            "GOLDEN_EXP_CHARM".to_owned(),
            "HEALING_CHARM".to_owned(),
            "LOCK_CAPSULE".to_owned(),
            "POTION".to_owned(),
            "SUPER_POTION".to_owned(),
            "HYPER_POTION".to_owned(),
            "MAX_POTION".to_owned(),
            "NUGGET".to_owned(),
            "BIG_NUGGET".to_owned(),
            "RELIC_GOLD".to_owned(),
            "RARE_CANDY".to_owned(),
            "RARER_CANDY".to_owned(),
            "POKEBALL".to_owned(),
            "GREAT_BALL".to_owned(),
        ],
        supported_modifier_ids: modifier_ids,
        regular_reward_actions: vec![
            RewardCapabilityAction::FreeSelect,
            RewardCapabilityAction::Skip,
            RewardCapabilityAction::Buy,
            RewardCapabilityAction::Target,
            RewardCapabilityAction::Reroll,
            RewardCapabilityAction::LockToggle,
        ],
        biome_market_actions: vec![
            MarketCapabilityAction::Buy,
            MarketCapabilityAction::Target,
            MarketCapabilityAction::Leave,
        ],
        biome_ids,
        route_rng_domains: vec![
            RouteRngDomain::AuthorityAddressed,
            RouteRngDomain::ExactAmbientState,
        ],
        encounter_sources: vec![
            EncounterSource::StaticCapturedVector,
            EncounterSource::StaticFixedVector,
        ],
        enemy_policies: vec![EnemyPolicy::ScriptedEnemyPolicyV1],
        unsupported: vec![
            UnsupportedReasonCode::EvolutionExecution,
            UnsupportedReasonCode::FusionOrFormChange,
            UnsupportedReasonCode::MysteryEncounter,
            UnsupportedReasonCode::CaptureOrFlee,
            UnsupportedReasonCode::TmOrRememberMove,
            UnsupportedReasonCode::DynamicModifierGeneratorCallback,
            UnsupportedReasonCode::DynamicModifierApplyCallback,
            UnsupportedReasonCode::TrainerConstructorCallback,
            UnsupportedReasonCode::SmartOrRandomAi,
            UnsupportedReasonCode::WeightedOrEventRouteCallback,
            UnsupportedReasonCode::NotorietyOrRelicCallback,
            UnsupportedReasonCode::DailyEndlessRandomBiome,
            UnsupportedReasonCode::UnselectedGrowthOrNature,
            UnsupportedReasonCode::NonfiniteOrOutOfSafeIntegerPrice,
            UnsupportedReasonCode::CallbackOrScriptOrTraitObjectContent,
        ],
        replica_generation_forbidden: true,
        production_typescript_changes_forbidden: true,
    })
}
