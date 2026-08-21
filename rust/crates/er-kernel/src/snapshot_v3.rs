//! Closed M4 endpoint snapshot DTOs.
//!
//! This module is deliberately parallel to [`super::snapshot`].  M3 roots are
//! not widened in place: an M4 endpoint has an explicit V3 root, a V2 game
//! state, and a typed prepared transaction that can retain an encounter plan
//! before that plan is folded into material.

use er_content::pack::ContentPack;
use er_game::snapshot::{CommandAdmissionLedgerSnapshotV1, SeatControlHistorySnapshotV1};
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::game_v2::GameStateV2;
use er_run::encounter_plan::EncounterPlan;
use er_state::run_v2::{ProgressionQueue, RunCounters, RunSurfaceState};
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_control::{BattleControlPlan, SeatMenuInstanceAllocator};
use er_types::battle_ids::{CanonicalHexBytes, ContentPackHash};
use er_types::battle_ui::{BattleUiProjection, PresentationPlanDigest};
use er_types::run_ids::{RunContentPackHash, SurfaceDigest};
use er_types::{OperationId, TerminalState};
use serde::{Deserialize, Deserializer, Serialize};
use std::sync::Arc;
use thiserror::Error;

use crate::snapshot::{
    BattleKernelRuntimeIdentitySnapshotV1, InputRouterSnapshotV2, KernelSchedulerSnapshotV2,
    PendingPresentationsSnapshotV1, RngDraw,
};

pub const RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3: u32 = 3;
pub const GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3: u32 = 3;
pub const PREPARED_TRANSACTION_SNAPSHOT_SCHEMA_VERSION_V3: u32 = 3;
pub const MECHANICAL_STATE_DIGEST_SCHEMA_VERSION_V2: u32 = 2;
pub const KERNEL_DETERMINISM_DIGEST_SCHEMA_VERSION_V2: u32 = 2;

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// A checked M4 digest string.  The digest domain is carried by the owning
/// field; this wrapper only enforces the wire representation.
macro_rules! digest_type {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, SnapshotError> {
                let value = value.into();
                let Some(hex) = value.strip_prefix("blake3-v1:") else {
                    return Err(SnapshotError::Invalid {
                        path: "digest".to_owned(),
                        reason: "digest must start with blake3-v1:".to_owned(),
                    });
                };
                if hex.len() != 64
                    || !hex
                        .bytes()
                        .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
                {
                    return Err(SnapshotError::Invalid {
                        path: "digest".to_owned(),
                        reason: "digest must contain 64 lowercase hexadecimal digits".to_owned(),
                    });
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
            }
        }
    };
}

digest_type!(MechanicalStateDigestV2);
digest_type!(KernelDeterminismDigestV2);

/// Complete M4 game owner state.  The state is retained as a typed V2 graph;
/// the other fields are the runtime-owned control/admission owners that are
/// not part of mechanical state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameRuntimeSnapshotV3 {
    pub schema_version: u32,
    pub state: GameStateV2,
    pub current_control: BattleControlPlan,
    pub control_history: Vec<SeatControlHistorySnapshotV1>,
    pub command_admission: CommandAdmissionLedgerSnapshotV1,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
    pub completed: bool,
    /// Explicit copies make the M4 ownership boundary visible to capture
    /// adapters while remaining complete, typed state rather than counts.
    pub progression: ProgressionQueue,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub active_surface: Option<RunSurfaceState>,
    pub counters: RunCounters,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub surface_digest: Option<SurfaceDigest>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PreparedTransactionKindV3 {
    BattleTurn,
    BattleReplacement,
    WaveAdvance,
    RunInteraction,
    Terminal,
    Encounter,
}

/// A prepared but unpublished atomic transition.  `candidate_state` is the
/// complete typed candidate state; `canonical_material` is the exact typed
/// authority material bytes, not a summary or JSON value.  An encounter plan
/// may exist transiently until it is folded into `candidate_state`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedTransactionSnapshotV3 {
    pub schema_version: u32,
    pub kind: PreparedTransactionKindV3,
    pub operation_id: OperationId,
    pub before_state: GameStateV2,
    pub candidate_state: GameStateV2,
    pub before_control: BattleControlPlan,
    pub candidate_control: BattleControlPlan,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
    pub canonical_material: CanonicalHexBytes,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub encounter_plan: Option<EncounterPlan>,
    pub rng_audit: Vec<RngDraw>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV3 {
    pub schema_version: u32,
    pub content_hash: ContentPackHash,
    pub run_content_hash: RunContentPackHash,
    pub runtime_identity: BattleKernelRuntimeIdentitySnapshotV1,
    pub input_router: InputRouterSnapshotV2,
    pub ui: BattleUiProjection,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: ProtocolRuntimeSnapshotV2,
    pub game: GameRuntimeSnapshotV3,
    pub pending_presentations: PendingPresentationsSnapshotV1,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub terminal: Option<TerminalState>,
    pub disposed: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub prepared_transaction: Option<PreparedTransactionSnapshotV3>,
    pub mechanical_digest: MechanicalStateDigestV2,
    pub kernel_determinism_digest: KernelDeterminismDigestV2,
    pub presentation_plan_digest: PresentationPlanDigest,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub surface_digest: Option<SurfaceDigest>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotError {
    #[error("snapshot field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
    #[error("snapshot recapture differs at {path}: {reason}")]
    Recapture { path: String, reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn recapture(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Recapture {
        path: path.into(),
        reason: reason.into(),
    }
}

fn validate_hex(value: &CanonicalHexBytes, path: &str) -> Result<(), SnapshotError> {
    let text = value.as_str();
    if text.is_empty()
        || text.len() % 2 != 0
        || !text
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(invalid(
            path,
            "canonical bytes must be non-empty lowercase hexadecimal",
        ));
    }
    Ok(())
}

fn validate_digest(value: &str, path: &str) -> Result<(), SnapshotError> {
    let Some(hex) = value.strip_prefix("blake3-v1:") else {
        return Err(invalid(path, "digest must start with blake3-v1:"));
    };
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(invalid(
            path,
            "digest must contain 64 lowercase hexadecimal digits",
        ));
    }
    Ok(())
}

fn validate_digest_type<T>(value: &T, path: &str) -> Result<(), SnapshotError>
where
    T: AsRef<str>,
{
    validate_digest(value.as_ref(), path)
}

impl AsRef<str> for MechanicalStateDigestV2 {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl AsRef<str> for KernelDeterminismDigestV2 {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl GameRuntimeSnapshotV3 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3 {
            return Err(invalid(
                "game.schema_version",
                format!(
                    "expected {GAME_RUNTIME_SNAPSHOT_SCHEMA_VERSION_V3}, got {}",
                    self.schema_version
                ),
            ));
        }
        self.state
            .validate()
            .map_err(|error| invalid("game.state", error.to_string()))?;
        self.current_control
            .validate()
            .map_err(|error| invalid("game.current_control", error.to_string()))?;
        if self.progression != self.state.run.progression {
            return Err(invalid(
                "game.progression",
                "explicit progression owner differs from GameStateV2.run.progression",
            ));
        }
        if self.active_surface != self.state.run.active_surface {
            return Err(invalid(
                "game.active_surface",
                "explicit surface owner differs from GameStateV2.run.active_surface",
            ));
        }
        if self.counters != self.state.run.counters {
            return Err(invalid(
                "game.counters",
                "explicit counters owner differs from GameStateV2.run.counters",
            ));
        }
        let expected_surface_digest = self
            .active_surface
            .as_ref()
            .map(|surface| surface.header().surface_digest.clone());
        if self.surface_digest != expected_surface_digest {
            return Err(invalid(
                "game.surface_digest",
                "surface digest must equal the active surface header digest",
            ));
        }
        for (index, history) in self.control_history.iter().enumerate() {
            history.validate().map_err(|error| {
                invalid(format!("game.control_history[{index}]"), error.to_string())
            })?;
        }
        self.command_admission
            .validate()
            .map_err(|error| invalid("game.command_admission", error.to_string()))?;
        self.scripted_enemy_policy
            .validate()
            .map_err(|error| invalid("game.scripted_enemy_policy", error.to_string()))?;
        for (index, allocator) in self.menu_allocators.iter().enumerate() {
            allocator.validate().map_err(|error| {
                invalid(format!("game.menu_allocators[{index}]"), error.to_string())
            })?;
        }
        if self.current_control.menu_allocators != self.menu_allocators {
            return Err(invalid(
                "game.menu_allocators",
                "runtime allocator owner differs from current control allocator state",
            ));
        }
        Ok(())
    }
}

impl PreparedTransactionSnapshotV3 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != PREPARED_TRANSACTION_SNAPSHOT_SCHEMA_VERSION_V3 {
            return Err(invalid(
                "prepared_transaction.schema_version",
                format!(
                    "expected {PREPARED_TRANSACTION_SNAPSHOT_SCHEMA_VERSION_V3}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.operation_id.as_str().is_empty() {
            return Err(invalid(
                "prepared_transaction.operation_id",
                "operation ID must not be empty",
            ));
        }
        self.before_state
            .validate()
            .map_err(|error| invalid("prepared_transaction.before_state", error.to_string()))?;
        self.candidate_state
            .validate()
            .map_err(|error| invalid("prepared_transaction.candidate_state", error.to_string()))?;
        self.before_control
            .validate()
            .map_err(|error| invalid("prepared_transaction.before_control", error.to_string()))?;
        self.candidate_control.validate().map_err(|error| {
            invalid("prepared_transaction.candidate_control", error.to_string())
        })?;
        validate_hex(
            &self.canonical_material,
            "prepared_transaction.canonical_material",
        )?;
        for (index, allocator) in self.menu_allocators.iter().enumerate() {
            allocator.validate().map_err(|error| {
                invalid(
                    format!("prepared_transaction.menu_allocators[{index}]"),
                    error.to_string(),
                )
            })?;
        }
        if let Some(plan) = &self.encounter_plan {
            plan.validate().map_err(|error| {
                invalid(
                    "prepared_transaction.encounter_plan",
                    error.to_string(),
                )
            })?;
            if plan.enemy_party.is_empty() {
                return Err(invalid(
                    "prepared_transaction.encounter_plan.enemy_party",
                    "transaction-local encounter plan must retain at least one enemy",
                ));
            }
        }
        for (index, draw) in self.rng_audit.iter().enumerate() {
            draw.validate().map_err(|error| {
                invalid(
                    format!("prepared_transaction.rng_audit[{index}]"),
                    error.to_string(),
                )
            })?;
        }
        Ok(())
    }
}

impl RestorableKernelSnapshotV3 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3 {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V3}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.content_hash != self.game.state.battle_content_hash {
            return Err(invalid(
                "content_hash",
                "root content identity differs from GameStateV2 battle content identity",
            ));
        }
        if self.run_content_hash != self.game.state.run_content_hash {
            return Err(invalid(
                "run_content_hash",
                "root run-content identity differs from GameStateV2 run content identity",
            ));
        }
        self.game.validate()?;
        self.input_router
            .validate()
            .map_err(|error| invalid("input_router", error.to_string()))?;
        self.scheduler
            .validate()
            .map_err(|error| invalid("scheduler", error.to_string()))?;
        self.protocol
            .validate()
            .map_err(|error| invalid("protocol", error.to_string()))?;
        self.pending_presentations
            .validate()
            .map_err(|error| invalid("pending_presentations", error.to_string()))?;
        self.ui
            .validate()
            .map_err(|error| invalid("ui", error.to_string()))?;
        validate_digest_type(&self.mechanical_digest, "mechanical_digest")?;
        validate_digest_type(&self.kernel_determinism_digest, "kernel_determinism_digest")?;
        if !self
            .presentation_plan_digest
            .as_str()
            .starts_with("blake3-v1:")
        {
            return Err(invalid(
                "presentation_plan_digest",
                "presentation digest must start with blake3-v1:",
            ));
        }
        if let Some(surface_digest) = &self.surface_digest {
            validate_digest(surface_digest.as_str(), "surface_digest")?;
        }
        let expected_surface_digest = self
            .game
            .active_surface
            .as_ref()
            .map(|surface| surface.header().surface_digest.clone());
        if self.surface_digest != expected_surface_digest {
            return Err(invalid(
                "surface_digest",
                "root surface digest must equal the game active surface digest",
            ));
        }
        if let Some(transaction) = &self.prepared_transaction {
            transaction.validate()?;
            if transaction.before_state != self.game.state {
                return Err(invalid(
                    "prepared_transaction.before_state",
                    "prepared transaction must begin at the captured game state",
                ));
            }
        }
        if self.disposed && self.prepared_transaction.is_some() {
            return Err(invalid(
                "prepared_transaction",
                "disposed snapshots cannot retain prepared work",
            ));
        }
        Ok(())
    }

    pub fn validate_for_content(&self, content: &ContentPack) -> Result<(), SnapshotError> {
        if self.content_hash != content.hash {
            return Err(invalid(
                "content_hash",
                "snapshot content hash does not match supplied ContentPack",
            ));
        }
        self.validate()
    }

    pub fn recapture_equal(expected: &Self, recaptured: &Self) -> Result<(), SnapshotError> {
        expected.validate()?;
        recaptured.validate()?;
        if expected != recaptured {
            return Err(recapture(
                "snapshot",
                "recaptured complete V3 endpoint state differs from candidate",
            ));
        }
        Ok(())
    }
}

/// Pure capture-side validation.  Runtime adapters can call this after
/// detaching every owner into the DTO and before publishing the snapshot.
pub fn validate_snapshot_v3(snapshot: &RestorableKernelSnapshotV3) -> Result<(), SnapshotError> {
    snapshot.validate()
}

/// Pure restoration-side equality check.  No live owner, callback, or thread
/// is touched by this helper.
pub fn require_recapture_equality_v3(
    expected: &RestorableKernelSnapshotV3,
    recaptured: &RestorableKernelSnapshotV3,
) -> Result<(), SnapshotError> {
    RestorableKernelSnapshotV3::recapture_equal(expected, recaptured)
}

/// Validate content without integrating a `GameKernel` runtime yet.
pub fn validate_snapshot_v3_for_content(
    snapshot: &RestorableKernelSnapshotV3,
    content: &Arc<ContentPack>,
) -> Result<(), SnapshotError> {
    snapshot.validate_for_content(content.as_ref())
}
