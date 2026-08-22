//! Typed M4 run materials: wave advance, interaction, and terminal commits.
//!
//! Contract: `rust/contracts/m4-run-material.md`. All roots use
//! `deny_unknown_fields`, closed SCREAMING_SNAKE_CASE kind tags, and complete
//! typed before/after `GameStateV2` values with mechanical digests. No
//! `serde_json::Value`, callbacks, or adapter-success fields.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_canonical::{CanonicalError, canonical_bytes};
use er_state::digest_v2::MechanicalStateDigestV2;
use er_state::game_v2::GameStateV2;
use er_types::battle_ids::{BattleId, WaveIndex};
use er_types::ids::OperationId;
use er_types::run_control::GameControlPlan;
use er_types::run_ids::{
    GameRunId, RunContentPackHash, RunInteractionSequence, RunSurfaceId, SurfaceDigest,
};
use er_types::run_model::{RunOutcome, RunSurfaceAction, RunSurfaceKind};
use er_types::{SeatId, battle_ids::ContentPackHash};

use crate::rng_audit::RunRngDraw;
use crate::transition::{RunMutation, RunPresentationEvent};

pub const RUN_MATERIAL_SCHEMA_VERSION: u32 = 1;
pub const WAVE_ADVANCE_MATERIAL_VERSION: u32 = 1;
pub const RUN_INTERACTION_MATERIAL_VERSION: u32 = 1;
pub const RUN_TERMINAL_MATERIAL_VERSION: u32 = 1;

/// The frozen M3 parity oracle SHA carried by every run material.
pub const RUN_MATERIAL_M3_PARITY_ORACLE_SHA: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

#[derive(Debug, Error)]
pub enum RunMaterialCodecError {
    #[error("material canonicalization failed: {0}")]
    Canonical(#[from] CanonicalError),
    #[error("material JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("material JSON is not the exact canonical encoding")]
    NonCanonicalEncoding,
}

/// Shared provenance and frontier header for every run material.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunMaterialHeader {
    pub m4_oracle_sha: String,
    pub m3_parity_oracle_sha: String,
    pub battle_content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub operation_id: OperationId,
    pub run_id: GameRunId,
    pub wave: WaveIndex,
    pub before_digest: MechanicalStateDigestV2,
    pub after_digest: MechanicalStateDigestV2,
    pub before_state: GameStateV2,
    pub after_state: GameStateV2,
    pub next_control: GameControlPlan,
}

/// Settles the source battle exactly once, folds progression effects, destroys
/// the old battle, advances the wave, and installs the exact next control.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WaveAdvanceMaterialV1 {
    pub schema_version: u32,
    pub header: RunMaterialHeader,
    pub source_battle_id: BattleId,
    pub mutations: Vec<RunMutation>,
    pub presentation: Vec<RunPresentationEvent>,
    pub rng_audit: Vec<RunRngDraw>,
}

/// Commits one progression or surface action at one action ordinal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunInteractionMaterialV1 {
    pub schema_version: u32,
    pub header: RunMaterialHeader,
    pub surface_kind: RunSurfaceKind,
    pub surface_id: RunSurfaceId,
    pub owner_seat: SeatId,
    pub interaction_sequence: RunInteractionSequence,
    pub action_ordinal: u32,
    pub action: RunSurfaceAction,
    pub mutations: Vec<RunMutation>,
    pub presentation: Vec<RunPresentationEvent>,
    pub rng_audit: Vec<RunRngDraw>,
    /// Digest of the surviving surface after a continuing action; `None` when
    /// the surface closes.
    pub surface_after_digest: Option<er_types::run_ids::SurfaceDigest>,
}

/// Records run victory or defeat and installs [`er_types::run_control::GameControl::Complete`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunTerminalMaterialV1 {
    pub schema_version: u32,
    pub header: RunMaterialHeader,
    pub outcome: RunOutcome,
    pub mutations: Vec<RunMutation>,
    pub presentation: Vec<RunPresentationEvent>,
}

/// The closed authority material vocabulary for run transitions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorityRunMaterial {
    WaveAdvance(WaveAdvanceMaterialV1),
    Interaction(RunInteractionMaterialV1),
    Terminal(RunTerminalMaterialV1),
}

impl AuthorityRunMaterial {
    /// The exact operation identity shared by header and envelope.
    pub fn operation_id(&self) -> &OperationId {
        match self {
            Self::WaveAdvance(material) => &material.header.operation_id,
            Self::Interaction(material) => &material.header.operation_id,
            Self::Terminal(material) => &material.header.operation_id,
        }
    }

    /// The complete before state carried by every variant.
    pub fn before_state(&self) -> &GameStateV2 {
        match self {
            Self::WaveAdvance(material) => &material.header.before_state,
            Self::Interaction(material) => &material.header.before_state,
            Self::Terminal(material) => &material.header.before_state,
        }
    }

    /// The complete after state carried by every variant.
    pub fn after_state(&self) -> &GameStateV2 {
        match self {
            Self::WaveAdvance(material) => &material.header.after_state,
            Self::Interaction(material) => &material.header.after_state,
            Self::Terminal(material) => &material.header.after_state,
        }
    }

    /// The exact next control installed by this material on success.
    pub fn next_control(&self) -> &GameControlPlan {
        match self {
            Self::WaveAdvance(material) => &material.header.next_control,
            Self::Interaction(material) => &material.header.next_control,
            Self::Terminal(material) => &material.header.next_control,
        }
    }
}

/// Canonical-encodes one run material payload.
pub fn encode_run_material(
    material: &AuthorityRunMaterial,
) -> Result<Vec<u8>, RunMaterialCodecError> {
    Ok(canonical_bytes(material)?)
}

/// Canonical-decodes one run material payload, rejecting noncanonical bytes.
pub fn decode_run_material(bytes: &[u8]) -> Result<AuthorityRunMaterial, RunMaterialCodecError> {
    let material: AuthorityRunMaterial = serde_json::from_slice(bytes)?;
    let reencoded = canonical_bytes(&material)?;
    if reencoded.as_slice() != bytes {
        return Err(RunMaterialCodecError::NonCanonicalEncoding);
    }
    Ok(material)
}
