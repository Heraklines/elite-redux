//! Deterministic compiler for complete pinned trainer and AI policy content.

use std::collections::{BTreeMap, BTreeSet};

use er_ai::content_v2::{
    AI_POLICY_PACK_SCHEMA_VERSION_V2, AiBehaviorBindingV2, AiBehaviorHandlerV2,
    AiCallbackEvidenceV2, AiConditionalSlotV2, AiFeatureProgramV2, AiModePolicyV2,
    AiPolicyDefinitionV2, AiPolicyPackV2, AiRatioV1, AiSelectionPolicyV2, AiSwitchPolicyV2,
    AiTargetPolicyV2, AiTieBreakPolicyV2, RegisteredTrainerMemberV2, RegisteredTrainerV2,
    TrainerAiProfileV2,
};
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::{AiPolicyId, CatalogHash, GameBehaviorUnitId, OracleSha, SafeU53};
use serde::Deserialize;
use thiserror::Error;

pub const M9_AI_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAiDocumentV2 {
    schema_version: u32,
    oracle_sha: String,
    trainer_profiles: Vec<RawTrainerProfileV2>,
    registered_trainers: Vec<RawRegisteredTrainerV2>,
    modes: Vec<RawModeV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTrainerProfileV2 {
    trainer_type: u64,
    key: String,
    enum_key: String,
    has_genders: bool,
    has_double: bool,
    double_only: bool,
    is_boss: bool,
    has_static_party: bool,
    use_same_seed_for_all_members: bool,
    allow_egg_moves: bool,
    money_multiplier: AiRatioV1,
    specialty_type: Option<u8>,
    tera_mode: u8,
    instant_tera: Vec<RawConditionalSlotV2>,
    party_template_count: u16,
    party_member_slots: Vec<i16>,
    ai_callbacks: Vec<RawCallbackV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConditionalSlotV2 {
    slot: u8,
    condition: Option<RawCallbackV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCallbackV2 {
    sha256: String,
    #[serde(rename = "async")]
    asynchronous: bool,
    source_length: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRegisteredTrainerV2 {
    stable_key: String,
    source_id: u64,
    trainer_type: u64,
    trainer_class_name: String,
    double_battle: bool,
    map_id: i64,
    default_party: Vec<RegisteredTrainerMemberV2>,
    insane_party: Option<Vec<RegisteredTrainerMemberV2>>,
    hell_party: Option<Vec<RegisteredTrainerMemberV2>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawModeV2 {
    mode_id: u64,
    key: String,
    cooperative: bool,
    challenge: bool,
    starting_level: u16,
    starting_money: u64,
    starting_biome: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorCatalogV1 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    behavior_count: usize,
    behaviors: Vec<RawBehaviorUnitV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBehaviorUnitV1 {
    #[serde(rename = "async")]
    asynchronous: bool,
    declaration_kind: String,
    domain: String,
    id: String,
    implementation_status: String,
    owner: Option<String>,
    parameter_count: u16,
    source: RawBehaviorSourceV1,
    symbol: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBehaviorSourceV1 {
    column: u32,
    line: u32,
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorImplementationDocumentV2 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    publication_state: String,
    implementation_group_count: usize,
    implementation_count: usize,
    implementations: Vec<RawBehaviorImplementationV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBehaviorImplementationV2 {
    group_id: String,
    domain: String,
    status: String,
    behavior_units: Vec<String>,
    rust_symbols: Vec<String>,
    proof_registry_group: String,
    proof_tests: Vec<String>,
    proof_execution_digest: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AiBuildErrorV2 {
    #[error("AI V2 source artifact is malformed: {0}")]
    Decode(String),
    #[error("AI V2 source identity or behavior classification is invalid")]
    Identity,
    #[error("AI V2 source contains an invalid or unresolved value")]
    Invalid,
    #[error("AI V2 pack validation failed: {0}")]
    Validation(String),
}

pub fn build_m9_engineering_ai_v2(
    ai_bytes: &[u8],
    behavior_catalog_bytes: &[u8],
    implementation_bytes: &[u8],
    known_species: &BTreeSet<SpeciesId>,
    known_moves: &BTreeSet<MoveId>,
) -> Result<AiPolicyPackV2, AiBuildErrorV2> {
    let source: RawAiDocumentV2 = decode(ai_bytes)?;
    let catalog: BehaviorCatalogV1 = decode(behavior_catalog_bytes)?;
    let implementations: BehaviorImplementationDocumentV2 = decode(implementation_bytes)?;
    if source.schema_version != 2
        || source.oracle_sha != M9_AI_ORACLE_SHA
        || catalog.schema_version != 1
        || catalog.oracle_sha != M9_AI_ORACLE_SHA
        || catalog.oracle_tree_sha.is_empty()
        || catalog.behavior_count != catalog.behaviors.len()
        || implementations.schema_version != 2
        || implementations.oracle_sha != M9_AI_ORACLE_SHA
        || implementations.oracle_tree_sha.is_empty()
        || implementations.publication_state != "QUALIFIED"
        || implementations.implementation_group_count != implementations.implementations.len()
        || implementations.implementation_count != catalog.behavior_count
    {
        return Err(AiBuildErrorV2::Identity);
    }
    validate_registered_content(&source.registered_trainers, known_species, known_moves)?;
    let policies = policies();
    let group_by_behavior = implementation_groups(&implementations.implementations)?;
    let behavior_bindings = compile_behavior_bindings(catalog.behaviors, &group_by_behavior)?;
    if behavior_bindings.len() != 2_586 {
        return Err(AiBuildErrorV2::Identity);
    }
    let trainer_profiles = source
        .trainer_profiles
        .into_iter()
        .map(compile_trainer_profile)
        .collect::<Result<Vec<_>, _>>()?;
    let registered_trainers = source
        .registered_trainers
        .into_iter()
        .map(|trainer| RegisteredTrainerV2 {
            policy: policy_id(if trainer.double_battle { 4 } else { 3 }),
            stable_key: trainer.stable_key,
            source_id: trainer.source_id,
            trainer_type: trainer.trainer_type,
            trainer_class_name: trainer.trainer_class_name,
            double_battle: trainer.double_battle,
            map_id: trainer.map_id,
            default_party: trainer.default_party,
            insane_party: trainer.insane_party,
            hell_party: trainer.hell_party,
        })
        .collect();
    let mode_policies = source
        .modes
        .into_iter()
        .map(|mode| AiModePolicyV2 {
            policy: policy_id(if mode.cooperative { 4 } else { 3 }),
            mode_id: mode.mode_id,
            key: mode.key,
            cooperative: mode.cooperative,
            challenge: mode.challenge,
            starting_level: mode.starting_level,
            starting_money: mode.starting_money,
            starting_biome: mode.starting_biome,
        })
        .collect();
    let mut pack = AiPolicyPackV2 {
        schema_version: AI_POLICY_PACK_SCHEMA_VERSION_V2,
        oracle_sha: OracleSha::parse(source.oracle_sha).map_err(|_| AiBuildErrorV2::Identity)?,
        content_hash: CatalogHash::parse("0".repeat(64)).map_err(|_| AiBuildErrorV2::Identity)?,
        policies,
        trainer_profiles,
        registered_trainers,
        mode_policies,
        behavior_bindings,
    };
    pack.content_hash = pack
        .recompute_hash()
        .map_err(|error| AiBuildErrorV2::Validation(error.to_string()))?;
    pack.validate()
        .map_err(|error| AiBuildErrorV2::Validation(error.to_string()))?;
    Ok(pack)
}

fn policies() -> Vec<AiPolicyDefinitionV2> {
    let features = vec![
        AiFeatureProgramV2::LegalActions,
        AiFeatureProgramV2::ExpectedDamage,
        AiFeatureProgramV2::KnockoutBonus,
        AiFeatureProgramV2::TargetHealthPressure,
        AiFeatureProgramV2::AllyDamagePenalty,
        AiFeatureProgramV2::SwitchValue,
    ];
    [
        (
            1,
            "FIRST_LEGAL",
            AiSelectionPolicyV2::FirstLegal,
            AiTieBreakPolicyV2::StableActionOrder,
        ),
        (
            2,
            "RANDOM_LEGAL",
            AiSelectionPolicyV2::RandomLegal,
            AiTieBreakPolicyV2::AuditedRng,
        ),
        (
            3,
            "HIGHEST_SCORE",
            AiSelectionPolicyV2::HighestScore,
            AiTieBreakPolicyV2::StableActionOrder,
        ),
        (
            4,
            "HIGHEST_JOINT_SCORE",
            AiSelectionPolicyV2::HighestJointScore,
            AiTieBreakPolicyV2::StableActionOrder,
        ),
    ]
    .into_iter()
    .map(|(id, key, selection, tie_break)| AiPolicyDefinitionV2 {
        id: policy_id(id),
        key: key.to_owned(),
        selection,
        target: AiTargetPolicyV2::HighestExpectedDamage,
        switch: AiSwitchPolicyV2::ScoreWithMoves,
        tie_break,
        features: features.clone(),
        maximum_joint_width: 3,
    })
    .collect()
}

fn compile_trainer_profile(
    profile: RawTrainerProfileV2,
) -> Result<TrainerAiProfileV2, AiBuildErrorV2> {
    let policy = if profile.is_boss || profile.has_double || profile.double_only {
        policy_id(4)
    } else {
        policy_id(3)
    };
    Ok(TrainerAiProfileV2 {
        trainer_type: profile.trainer_type,
        key: profile.key,
        enum_key: profile.enum_key,
        has_genders: profile.has_genders,
        has_double: profile.has_double,
        double_only: profile.double_only,
        is_boss: profile.is_boss,
        has_static_party: profile.has_static_party,
        use_same_seed_for_all_members: profile.use_same_seed_for_all_members,
        allow_egg_moves: profile.allow_egg_moves,
        money_multiplier: profile.money_multiplier,
        specialty_type: profile.specialty_type,
        tera_mode: profile.tera_mode,
        instant_tera: profile
            .instant_tera
            .into_iter()
            .map(|entry| AiConditionalSlotV2 {
                slot: entry.slot,
                condition: entry.condition.map(callback),
            })
            .collect(),
        party_template_count: profile.party_template_count,
        party_member_slots: profile.party_member_slots,
        callbacks: profile.ai_callbacks.into_iter().map(callback).collect(),
        policy,
    })
}

fn callback(value: RawCallbackV2) -> AiCallbackEvidenceV2 {
    AiCallbackEvidenceV2 {
        sha256: value.sha256,
        asynchronous: value.asynchronous,
        source_length: value.source_length,
    }
}

fn validate_registered_content(
    trainers: &[RawRegisteredTrainerV2],
    known_species: &BTreeSet<SpeciesId>,
    known_moves: &BTreeSet<MoveId>,
) -> Result<(), AiBuildErrorV2> {
    for member in trainers.iter().flat_map(|trainer| {
        trainer
            .default_party
            .iter()
            .chain(trainer.insane_party.iter().flatten())
            .chain(trainer.hell_party.iter().flatten())
    }) {
        let species = SpeciesId::new(safe(member.species_id)?);
        if !known_species.contains(&species)
            || member.moves.iter().any(|move_id| {
                *move_id != 0
                    && safe(*move_id)
                        .map(MoveId::new)
                        .map_or(true, |move_id| !known_moves.contains(&move_id))
            })
        {
            return Err(AiBuildErrorV2::Invalid);
        }
    }
    Ok(())
}

fn implementation_groups(
    implementations: &[RawBehaviorImplementationV2],
) -> Result<BTreeMap<String, (String, AiBehaviorHandlerV2, String)>, AiBuildErrorV2> {
    let mut groups = BTreeMap::new();
    for implementation in implementations {
        if implementation.domain != "AI_MODES" {
            continue;
        }
        if implementation.status != "BESPOKE_IMPLEMENTED"
            || implementation.group_id.is_empty()
            || implementation.behavior_units.is_empty()
            || implementation.rust_symbols.is_empty()
            || implementation.proof_registry_group != implementation.group_id
            || implementation.proof_tests.is_empty()
            || !implementation
                .proof_execution_digest
                .starts_with("blake3-v1:")
        {
            return Err(AiBuildErrorV2::Identity);
        }
        let handler = behavior_handler(&implementation.rust_symbols)?;
        for behavior in &implementation.behavior_units {
            if groups
                .insert(
                    behavior.clone(),
                    (
                        implementation.group_id.clone(),
                        handler,
                        implementation.proof_execution_digest.clone(),
                    ),
                )
                .is_some()
            {
                return Err(AiBuildErrorV2::Identity);
            }
        }
    }
    Ok(groups)
}

fn behavior_handler(symbols: &[String]) -> Result<AiBehaviorHandlerV2, AiBuildErrorV2> {
    let contains = |suffix: &str| symbols.iter().any(|symbol| symbol.ends_with(suffix));
    let handler = if contains("::legal_actions_v1") {
        AiBehaviorHandlerV2::LegalActions
    } else if contains("::highest_score_policy_v1") {
        AiBehaviorHandlerV2::ScoreActions
    } else if contains("::joint_actions_v1") {
        AiBehaviorHandlerV2::JointActions
    } else if contains("::build_trainer_v1") {
        AiBehaviorHandlerV2::TrainerConstruction
    } else if contains("::build_boss_v1") {
        AiBehaviorHandlerV2::BossConstruction
    } else if contains("::game_mode_config_v1") {
        AiBehaviorHandlerV2::ModeConfiguration
    } else if contains("::record") {
        AiBehaviorHandlerV2::RngAudit
    } else if contains("::AiRecoverySnapshotV1") {
        AiBehaviorHandlerV2::RecoverySnapshot
    } else if contains("::MoodyModeSaveV1") {
        AiBehaviorHandlerV2::MoodyMode
    } else if contains("::sanitize_ghost_profile_v1") {
        AiBehaviorHandlerV2::GhostProfile
    } else if contains("::ShowdownSessionV1") {
        AiBehaviorHandlerV2::ShowdownSession
    } else {
        return Err(AiBuildErrorV2::Identity);
    };
    Ok(handler)
}

fn compile_behavior_bindings(
    behaviors: Vec<RawBehaviorUnitV1>,
    groups: &BTreeMap<String, (String, AiBehaviorHandlerV2, String)>,
) -> Result<Vec<AiBehaviorBindingV2>, AiBuildErrorV2> {
    let mut selected = behaviors
        .into_iter()
        .filter(|behavior| behavior.domain == "AI_MODES")
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| left.id.cmp(&right.id));
    selected
        .into_iter()
        .map(|behavior| {
            if behavior.implementation_status != "REQUIRES_M7"
                || behavior.declaration_kind.is_empty()
                || behavior.owner.as_deref().is_some_and(str::is_empty)
            {
                return Err(AiBuildErrorV2::Identity);
            }
            let (group_id, handler, proof_execution_digest) =
                groups.get(&behavior.id).ok_or(AiBuildErrorV2::Identity)?;
            Ok(AiBehaviorBindingV2 {
                behavior_unit: GameBehaviorUnitId::parse(behavior.id)
                    .map_err(|_| AiBuildErrorV2::Identity)?,
                group_id: group_id.clone(),
                source_path: behavior.source.path,
                source_line: behavior.source.line,
                source_column: behavior.source.column,
                symbol: behavior.symbol,
                asynchronous: behavior.asynchronous,
                parameter_count: behavior.parameter_count,
                handler: *handler,
                proof_execution_digest: proof_execution_digest.clone(),
            })
        })
        .collect()
}

fn policy_id(value: u64) -> AiPolicyId {
    AiPolicyId::new(SafeU53::new(value).expect("static AI policy IDs are safe"))
}

fn safe(value: u64) -> Result<SafeU53, AiBuildErrorV2> {
    SafeU53::new(value).map_err(|_| AiBuildErrorV2::Invalid)
}

fn decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, AiBuildErrorV2> {
    serde_json::from_slice(bytes).map_err(|error| AiBuildErrorV2::Decode(error.to_string()))
}
