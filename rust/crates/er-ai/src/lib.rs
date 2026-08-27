//! Deterministic canonical M7 battle policies.
pub mod showdown;

use std::collections::BTreeMap;
use std::sync::Arc;

use er_types::battle_command::BattleCommand;
use er_types::battle_ids::{BattleFormat, PokemonId, TurnIndex};
use er_types::{AiPolicyId, CatalogHash, OracleSha};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const AI_POLICY_PACK_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiBattleView {
    pub turn: TurnIndex,
    pub format: BattleFormat,
    pub allies: Vec<AiPokemonView>,
    pub opponents: Vec<AiPokemonView>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPokemonView {
    pub id: PokemonId,
    pub hp: u32,
    pub max_hp: u32,
    pub status: er_types::battle_model::StatusKind,
    pub fainted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiObservation {
    pub mechanical_digest: String,
    pub legal_commands: Vec<BattleCommand>,
    pub public_battle_state: AiBattleView,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiPolicyKindV1 {
    FirstLegal,
    UniformRandom,
    PreferFight,
    PreferSwitch,
    BossPriority,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPolicyDefinitionV1 {
    pub id: AiPolicyId,
    pub key: String,
    pub kind: AiPolicyKindV1,
    pub decision_budget: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiPolicyPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub policies: Vec<AiPolicyDefinitionV1>,
}

#[derive(Clone, Debug)]
pub struct PreparedAiPolicyContentV1 {
    pack: Arc<AiPolicyPackV1>,
    indexes: BTreeMap<AiPolicyId, usize>,
}

pub trait AuditedAiRng {
    fn choose_index(&mut self, upper_exclusive: usize) -> Result<usize, AiError>;
}

pub trait DeterministicBattlePolicy {
    fn choose<R: AuditedAiRng>(
        &self,
        observation: &AiObservation,
        rng: &mut R,
    ) -> Result<BattleCommand, AiError>;
}

#[derive(Clone, Debug)]
pub struct PreparedAiPolicyV1 {
    definition: AiPolicyDefinitionV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AiError {
    #[error("AI policy pack schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("AI policy definitions must be nonempty, sorted, unique, and budgeted")]
    PolicyClosure,
    #[error("AI observation has no legal commands")]
    NoLegalCommands,
    #[error("AI RNG returned index {index} outside 0..{length}")]
    RngIndex { index: usize, length: usize },
}

impl AiPolicyPackV1 {
    pub fn validate(&self) -> Result<(), AiError> {
        if self.schema_version != AI_POLICY_PACK_SCHEMA_VERSION_V1 {
            return Err(AiError::SchemaVersion {
                expected: AI_POLICY_PACK_SCHEMA_VERSION_V1,
                actual: self.schema_version,
            });
        }
        if self.policies.is_empty()
            || self.policies.iter().any(|policy| {
                policy.id == AiPolicyId::ZERO
                    || policy.key.is_empty()
                    || policy.decision_budget == 0
            })
            || self
                .policies
                .windows(2)
                .any(|pair| pair[0].id >= pair[1].id || pair[0].key >= pair[1].key)
        {
            return Err(AiError::PolicyClosure);
        }
        Ok(())
    }
}

impl PreparedAiPolicyContentV1 {
    pub fn prepare(pack: Arc<AiPolicyPackV1>) -> Result<Self, AiError> {
        pack.validate()?;
        let indexes = pack
            .policies
            .iter()
            .enumerate()
            .map(|(index, policy)| (policy.id, index))
            .collect();
        Ok(Self { pack, indexes })
    }

    pub fn pack(&self) -> &Arc<AiPolicyPackV1> {
        &self.pack
    }

    pub fn policy(&self, id: AiPolicyId) -> Option<PreparedAiPolicyV1> {
        self.indexes
            .get(&id)
            .and_then(|index| self.pack.policies.get(*index))
            .cloned()
            .map(|definition| PreparedAiPolicyV1 { definition })
    }
}

impl DeterministicBattlePolicy for PreparedAiPolicyV1 {
    fn choose<R: AuditedAiRng>(
        &self,
        observation: &AiObservation,
        rng: &mut R,
    ) -> Result<BattleCommand, AiError> {
        if observation.legal_commands.is_empty() {
            return Err(AiError::NoLegalCommands);
        }
        let index = match self.definition.kind {
            AiPolicyKindV1::FirstLegal => 0,
            AiPolicyKindV1::UniformRandom => rng.choose_index(observation.legal_commands.len())?,
            AiPolicyKindV1::PreferFight | AiPolicyKindV1::BossPriority => observation
                .legal_commands
                .iter()
                .position(|command| matches!(command, BattleCommand::Fight { .. }))
                .unwrap_or(0),
            AiPolicyKindV1::PreferSwitch => observation
                .legal_commands
                .iter()
                .position(|command| matches!(command, BattleCommand::Switch { .. }))
                .unwrap_or(0),
        };
        observation
            .legal_commands
            .get(index)
            .cloned()
            .ok_or(AiError::RngIndex {
                index,
                length: observation.legal_commands.len(),
            })
    }
}

impl PreparedAiPolicyV1 {
    pub fn definition(&self) -> &AiPolicyDefinitionV1 {
        &self.definition
    }
}

#[cfg(test)]
mod tests {
    use er_types::battle_command::BattleCommand;
    use er_types::battle_ids::{BattleFormat, PartyIndex, PokemonId, TurnIndex};
    use er_types::{AiPolicyId, SafeU53};

    use super::{
        AiBattleView, AiError, AiObservation, AiPolicyDefinitionV1, AiPolicyKindV1, AuditedAiRng,
        DeterministicBattlePolicy, PreparedAiPolicyV1,
    };

    struct RejectRng;

    impl AuditedAiRng for RejectRng {
        fn choose_index(&mut self, _upper_exclusive: usize) -> Result<usize, AiError> {
            Err(AiError::RngIndex {
                index: usize::MAX,
                length: 0,
            })
        }
    }

    fn policy() -> PreparedAiPolicyV1 {
        PreparedAiPolicyV1 {
            definition: AiPolicyDefinitionV1 {
                id: AiPolicyId::new(SafeU53::new(1).expect("safe policy")),
                key: "first-legal".to_owned(),
                kind: AiPolicyKindV1::FirstLegal,
                decision_budget: 1,
            },
        }
    }

    fn observation(commands: Vec<BattleCommand>) -> AiObservation {
        AiObservation {
            mechanical_digest: format!("blake3-v1:{}", "0".repeat(64)),
            legal_commands: commands,
            public_battle_state: AiBattleView {
                turn: TurnIndex::new(SafeU53::new(1).expect("safe turn")).expect("positive turn"),
                format: BattleFormat::single(),
                allies: Vec::new(),
                opponents: Vec::new(),
            },
        }
    }

    #[test]
    fn first_legal_policy_is_deterministic_without_rng() {
        let command = BattleCommand::switch(
            PokemonId::new(SafeU53::new(1).expect("safe Pokémon")),
            PartyIndex::new(0).expect("party slot"),
        );
        let selected = policy()
            .choose(&observation(vec![command.clone()]), &mut RejectRng)
            .expect("first command");
        assert_eq!(selected, command);
    }

    #[test]
    fn empty_legal_set_fails_closed() {
        assert_eq!(
            policy().choose(&observation(Vec::new()), &mut RejectRng),
            Err(AiError::NoLegalCommands)
        );
    }
}
