//! Source-bound M9-E AI policies, trainer construction, and prepared indexes.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_canonical::content_digest;
use er_types::{AiPolicyId, CatalogHash, GameBehaviorUnitId, OracleSha};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const AI_POLICY_PACK_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiRatioV1 {
    pub numerator: u64,
    pub denominator: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiCallbackEvidenceV2 {
    pub sha256: String,
    pub asynchronous: bool,
    pub source_length: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiConditionalSlotV2 {
    pub slot: u8,
    pub condition: Option<AiCallbackEvidenceV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiFeatureProgramV2 {
    LegalActions,
    ExpectedDamage,
    KnockoutBonus,
    TargetHealthPressure,
    AllyDamagePenalty,
    SwitchValue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiSelectionPolicyV2 {
    FirstLegal,
    RandomLegal,
    HighestScore,
    HighestJointScore,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiTargetPolicyV2 {
    LegalTargetOrder,
    HighestExpectedDamage,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiSwitchPolicyV2 {
    LegalBenchOrder,
    ScoreWithMoves,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiTieBreakPolicyV2 {
    StableActionOrder,
    AuditedRng,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPolicyDefinitionV2 {
    pub id: AiPolicyId,
    pub key: String,
    pub selection: AiSelectionPolicyV2,
    pub target: AiTargetPolicyV2,
    pub switch: AiSwitchPolicyV2,
    pub tie_break: AiTieBreakPolicyV2,
    pub features: Vec<AiFeatureProgramV2>,
    pub maximum_joint_width: u8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainerAiProfileV2 {
    pub trainer_type: u64,
    pub key: String,
    pub enum_key: String,
    pub has_genders: bool,
    pub has_double: bool,
    pub double_only: bool,
    pub is_boss: bool,
    pub has_static_party: bool,
    pub use_same_seed_for_all_members: bool,
    pub allow_egg_moves: bool,
    pub money_multiplier: AiRatioV1,
    pub specialty_type: Option<u8>,
    pub tera_mode: u8,
    pub instant_tera: Vec<AiConditionalSlotV2>,
    pub party_template_count: u16,
    pub party_member_slots: Vec<i16>,
    pub callbacks: Vec<AiCallbackEvidenceV2>,
    pub policy: AiPolicyId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisteredTrainerMemberV2 {
    pub species_id: u64,
    pub level: u16,
    pub ability_slot: u8,
    pub ivs: [u8; 6],
    pub evs: [u16; 6],
    pub item_id: u64,
    pub nature: u8,
    pub moves: Vec<u64>,
    pub hidden_power_type: u8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisteredTrainerV2 {
    pub stable_key: String,
    pub source_id: u64,
    pub trainer_type: u64,
    pub trainer_class_name: String,
    pub double_battle: bool,
    pub map_id: i64,
    pub default_party: Vec<RegisteredTrainerMemberV2>,
    pub insane_party: Option<Vec<RegisteredTrainerMemberV2>>,
    pub hell_party: Option<Vec<RegisteredTrainerMemberV2>>,
    pub policy: AiPolicyId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiModePolicyV2 {
    pub mode_id: u64,
    pub key: String,
    pub cooperative: bool,
    pub challenge: bool,
    pub starting_level: u16,
    pub starting_money: u64,
    pub starting_biome: u64,
    pub policy: AiPolicyId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiBehaviorHandlerV2 {
    LegalActions,
    ScoreActions,
    JointActions,
    TrainerConstruction,
    BossConstruction,
    ModeConfiguration,
    RngAudit,
    RecoverySnapshot,
    MoodyMode,
    GhostProfile,
    ShowdownSession,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiBehaviorBindingV2 {
    pub behavior_unit: GameBehaviorUnitId,
    pub group_id: String,
    pub source_path: String,
    pub source_line: u32,
    pub source_column: u32,
    pub symbol: String,
    pub asynchronous: bool,
    pub parameter_count: u16,
    pub handler: AiBehaviorHandlerV2,
    pub proof_execution_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPolicyPackV2 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub policies: Vec<AiPolicyDefinitionV2>,
    pub trainer_profiles: Vec<TrainerAiProfileV2>,
    pub registered_trainers: Vec<RegisteredTrainerV2>,
    pub mode_policies: Vec<AiModePolicyV2>,
    pub behavior_bindings: Vec<AiBehaviorBindingV2>,
}

#[derive(Clone, Debug)]
pub struct PreparedAiPolicyContentV2 {
    pack: Arc<AiPolicyPackV2>,
    policies: BTreeMap<AiPolicyId, usize>,
    trainers: BTreeMap<u64, usize>,
    registered_trainers: BTreeMap<String, usize>,
    modes: BTreeMap<u64, usize>,
    behaviors: BTreeMap<GameBehaviorUnitId, usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AiContentV2Error {
    #[error("AI policy V2 identity or hash is invalid")]
    Identity,
    #[error("AI policy V2 collection or definition is malformed")]
    Closure,
    #[error("AI policy V2 canonical hashing failed: {0}")]
    Hash(String),
}

#[derive(Serialize)]
struct AiHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    policies: &'a [AiPolicyDefinitionV2],
    trainer_profiles: &'a [TrainerAiProfileV2],
    registered_trainers: &'a [RegisteredTrainerV2],
    mode_policies: &'a [AiModePolicyV2],
    behavior_bindings: &'a [AiBehaviorBindingV2],
}

impl AiPolicyPackV2 {
    pub fn recompute_hash(&self) -> Result<CatalogHash, AiContentV2Error> {
        let digest = content_digest(&AiHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            policies: &self.policies,
            trainer_profiles: &self.trainer_profiles,
            registered_trainers: &self.registered_trainers,
            mode_policies: &self.mode_policies,
            behavior_bindings: &self.behavior_bindings,
        })
        .map_err(|error| AiContentV2Error::Hash(error.to_string()))?;
        CatalogHash::parse(digest).map_err(|_| AiContentV2Error::Identity)
    }

    pub fn validate(&self) -> Result<(), AiContentV2Error> {
        if self.schema_version != AI_POLICY_PACK_SCHEMA_VERSION_V2
            || self.content_hash != self.recompute_hash()?
            || self.policies.is_empty()
            || self.trainer_profiles.is_empty()
            || self.registered_trainers.is_empty()
            || self.mode_policies.is_empty()
            || self.behavior_bindings.is_empty()
            || self
                .policies
                .windows(2)
                .any(|pair| pair[0].id >= pair[1].id)
            || self
                .trainer_profiles
                .windows(2)
                .any(|pair| pair[0].trainer_type >= pair[1].trainer_type)
            || self
                .registered_trainers
                .windows(2)
                .any(|pair| pair[0].stable_key >= pair[1].stable_key)
            || self
                .mode_policies
                .windows(2)
                .any(|pair| pair[0].mode_id >= pair[1].mode_id)
            || self
                .behavior_bindings
                .windows(2)
                .any(|pair| pair[0].behavior_unit >= pair[1].behavior_unit)
        {
            return Err(AiContentV2Error::Identity);
        }
        let policy_ids = self
            .policies
            .iter()
            .map(|policy| policy.id)
            .collect::<BTreeSet<_>>();
        if self.policies.iter().any(|policy| {
            policy.key.is_empty()
                || policy.features.is_empty()
                || policy.maximum_joint_width == 0
                || policy.maximum_joint_width > 3
        }) || self.trainer_profiles.iter().any(|profile| {
            profile.key.is_empty()
                || profile.enum_key.is_empty()
                || profile.money_multiplier.denominator == 0
                || profile.party_template_count == 0
                || !policy_ids.contains(&profile.policy)
                || invalid_callbacks(&profile.callbacks)
                || profile
                    .instant_tera
                    .iter()
                    .any(|entry| entry.condition.as_ref().is_some_and(invalid_callback))
        }) || self.registered_trainers.iter().any(|trainer| {
            let no_party = trainer.default_party.is_empty()
                && trainer.insane_party.as_ref().is_none_or(Vec::is_empty)
                && trainer.hell_party.as_ref().is_none_or(Vec::is_empty);
            trainer.stable_key.is_empty()
                || trainer.trainer_class_name.is_empty()
                || no_party
                || !policy_ids.contains(&trainer.policy)
                || invalid_party(&trainer.default_party)
                || trainer.insane_party.as_deref().is_some_and(invalid_party)
                || trainer.hell_party.as_deref().is_some_and(invalid_party)
        }) || self.mode_policies.iter().any(|mode| {
            mode.key.is_empty() || mode.starting_level == 0 || !policy_ids.contains(&mode.policy)
        }) || self.behavior_bindings.iter().any(|binding| {
            binding.group_id.is_empty()
                || binding.source_path.is_empty()
                || binding.source_line == 0
                || binding.source_column == 0
                || binding.symbol.is_empty()
                || !binding.proof_execution_digest.starts_with("blake3-v1:")
        }) {
            return Err(AiContentV2Error::Closure);
        }
        Ok(())
    }

    pub fn prepare(self) -> Result<PreparedAiPolicyContentV2, AiContentV2Error> {
        self.validate()?;
        let policies = index(&self.policies, |value| value.id);
        let trainers = index(&self.trainer_profiles, |value| value.trainer_type);
        let registered_trainers =
            index(&self.registered_trainers, |value| value.stable_key.clone());
        let modes = index(&self.mode_policies, |value| value.mode_id);
        let behaviors = index(&self.behavior_bindings, |value| value.behavior_unit.clone());
        Ok(PreparedAiPolicyContentV2 {
            pack: Arc::new(self),
            policies,
            trainers,
            registered_trainers,
            modes,
            behaviors,
        })
    }
}

impl PreparedAiPolicyContentV2 {
    pub fn pack(&self) -> &AiPolicyPackV2 {
        &self.pack
    }

    pub fn policy(&self, id: AiPolicyId) -> Option<&AiPolicyDefinitionV2> {
        self.policies
            .get(&id)
            .and_then(|index| self.pack.policies.get(*index))
    }

    pub fn trainer(&self, trainer_type: u64) -> Option<&TrainerAiProfileV2> {
        self.trainers
            .get(&trainer_type)
            .and_then(|index| self.pack.trainer_profiles.get(*index))
    }

    pub fn registered_trainer(&self, key: &str) -> Option<&RegisteredTrainerV2> {
        self.registered_trainers
            .get(key)
            .and_then(|index| self.pack.registered_trainers.get(*index))
    }

    pub fn mode(&self, mode_id: u64) -> Option<&AiModePolicyV2> {
        self.modes
            .get(&mode_id)
            .and_then(|index| self.pack.mode_policies.get(*index))
    }

    pub fn behavior(&self, id: &GameBehaviorUnitId) -> Option<&AiBehaviorBindingV2> {
        self.behaviors
            .get(id)
            .and_then(|index| self.pack.behavior_bindings.get(*index))
    }
}

fn invalid_callbacks(callbacks: &[AiCallbackEvidenceV2]) -> bool {
    callbacks.iter().any(invalid_callback)
}

fn invalid_callback(callback: &AiCallbackEvidenceV2) -> bool {
    callback.source_length == 0
        || callback.sha256.len() != 64
        || !callback
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn invalid_party(party: &[RegisteredTrainerMemberV2]) -> bool {
    party.iter().any(|member| {
        member.species_id == 0
            || member.level == 0
            || member.ability_slot > 2
            || member.ivs.iter().any(|value| *value > 31)
            || member.evs.iter().any(|value| *value > 252)
            || member.nature > 24
    })
}

fn index<T, K: Ord>(values: &[T], key: impl Fn(&T) -> K) -> BTreeMap<K, usize> {
    values
        .iter()
        .enumerate()
        .map(|(index, value)| (key(value), index))
        .collect()
}
