//! Typed Battle Material V5 and role-neutral atomic application.

use er_battle::m7_resolver::{
    BattlePresentationCueV5, BattleTransitionV5, MechanicsOperationEvidenceV5,
};
use er_battle::resolver::BattleMutation;
use er_canonical::{canonical_bytes, content_digest};
use er_rng::audit::RngDraw;
use er_state::m7_state::GameStateV5;
use er_types::battle_command::CommandSet;
use er_types::battle_model::{BattleOutcome, ResolvedAction};
use er_types::{GameContentIdentity, GameControlKindV2, OperationId, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::PreparedGameContentV1;

pub const BATTLE_TURN_MATERIAL_SCHEMA_VERSION_V5: u32 = 5;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleTurnMaterialV5 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub authority_seat: SeatId,
    pub authority_revision: SafeU53,
    pub content_identity: GameContentIdentity,
    pub before_digest: String,
    pub after_digest: String,
    pub commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationCueV5>,
    pub mechanics_evidence: Vec<MechanicsOperationEvidenceV5>,
    pub rng_audit: Vec<RngDraw>,
    pub after_state: GameStateV5,
    pub outcome: BattleOutcome,
    pub next_control: GameControlKindV2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MaterialApplyResultV5 {
    Applied,
    Duplicate,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MaterialV5Error {
    #[error("BattleTurnMaterialV5 schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("material content identity differs from prepared content")]
    ContentIdentity,
    #[error("material before digest differs from the live frontier")]
    BeforeDigest,
    #[error("material after digest differs from its complete after-state")]
    AfterDigest,
    #[error("material after-state is invalid: {0}")]
    InvalidState(String),
    #[error("material commands are invalid: {0}")]
    Commands(String),
    #[error("material outcome or next control differs from after-state")]
    Frontier,
    #[error("canonical material encoding failed: {0}")]
    Canonical(String),
    #[error("material decode failed: {0}")]
    Decode(String),
}

impl BattleTurnMaterialV5 {
    pub fn from_transition(
        operation_id: OperationId,
        authority_seat: SeatId,
        authority_revision: SafeU53,
        content: &PreparedGameContentV1,
        transition: BattleTransitionV5,
    ) -> Self {
        Self {
            schema_version: BATTLE_TURN_MATERIAL_SCHEMA_VERSION_V5,
            operation_id,
            authority_seat,
            authority_revision,
            content_identity: content.identity().clone(),
            before_digest: transition.before_digest,
            after_digest: transition.after_digest,
            commands: transition.accepted_commands,
            action_order: transition.action_order,
            mutations: transition.mutations,
            presentation: transition.presentation,
            mechanics_evidence: transition.mechanics_evidence,
            rng_audit: transition.rng_audit,
            after_state: transition.after_state,
            outcome: transition.outcome,
            next_control: transition.next_control,
        }
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, MaterialV5Error> {
        canonical_bytes(self).map_err(|error| MaterialV5Error::Canonical(error.to_string()))
    }

    pub fn decode_canonical(bytes: &[u8]) -> Result<Self, MaterialV5Error> {
        let material: Self = serde_json::from_slice(bytes)
            .map_err(|error| MaterialV5Error::Decode(error.to_string()))?;
        let encoded = material.canonical_bytes()?;
        if encoded != bytes {
            return Err(MaterialV5Error::Canonical(
                "input bytes are not the canonical encoding".to_owned(),
            ));
        }
        Ok(material)
    }

    pub fn validate(&self, content: &PreparedGameContentV1) -> Result<(), MaterialV5Error> {
        if self.schema_version != BATTLE_TURN_MATERIAL_SCHEMA_VERSION_V5 {
            return Err(MaterialV5Error::SchemaVersion {
                expected: BATTLE_TURN_MATERIAL_SCHEMA_VERSION_V5,
                actual: self.schema_version,
            });
        }
        if &self.content_identity != content.identity()
            || self.after_state.content_identity != self.content_identity
        {
            return Err(MaterialV5Error::ContentIdentity);
        }
        self.commands
            .validate()
            .map_err(|error| MaterialV5Error::Commands(error.to_string()))?;
        self.after_state
            .validate()
            .map_err(|error| MaterialV5Error::InvalidState(error.to_string()))?;
        if mechanical_digest(&self.after_state)? != self.after_digest {
            return Err(MaterialV5Error::AfterDigest);
        }
        let run = self
            .after_state
            .active_run
            .as_ref()
            .ok_or(MaterialV5Error::Frontier)?;
        let outcome = run
            .battle
            .as_ref()
            .map_or(BattleOutcome::Ongoing, |battle| battle.outcome);
        if outcome != self.outcome || run.control.kind != self.next_control {
            return Err(MaterialV5Error::Frontier);
        }
        Ok(())
    }
}

pub fn apply_turn_material_v5(
    live: &mut GameStateV5,
    content: &PreparedGameContentV1,
    material: &BattleTurnMaterialV5,
) -> Result<MaterialApplyResultV5, MaterialV5Error> {
    material.validate(content)?;
    let live_digest = mechanical_digest(live)?;
    if live_digest == material.after_digest {
        return Ok(MaterialApplyResultV5::Duplicate);
    }
    if live_digest != material.before_digest {
        return Err(MaterialV5Error::BeforeDigest);
    }
    let staged = material.after_state.clone();
    staged
        .validate()
        .map_err(|error| MaterialV5Error::InvalidState(error.to_string()))?;
    *live = staged;
    Ok(MaterialApplyResultV5::Applied)
}

pub fn apply_serialized_turn_material_v5(
    live: &mut GameStateV5,
    content: &PreparedGameContentV1,
    bytes: &[u8],
) -> Result<MaterialApplyResultV5, MaterialV5Error> {
    let material = BattleTurnMaterialV5::decode_canonical(bytes)?;
    apply_turn_material_v5(live, content, &material)
}

fn mechanical_digest(state: &GameStateV5) -> Result<String, MaterialV5Error> {
    let digest =
        content_digest(state).map_err(|error| MaterialV5Error::Canonical(error.to_string()))?;
    Ok(format!("blake3-v1:{digest}"))
}
