//! Thin replica adapter for typed TURN/REPLACEMENT authority material.
//!
//! The adapter owns only transport decoding and the frozen error mapping.  It
//! deliberately has no mechanics path: every accepted payload enters the
//! common `er-game` material applier.

use er_game::material::{
    BattleMaterialApplyContext, BattleMaterialApplyError, ContentPack, MaterialApplyResult,
    apply_replacement_material, apply_replacement_material_trusted, apply_turn_material,
    apply_turn_material_trusted, decode_replacement_material, decode_turn_material,
};
use er_types::{AuthorityEntryKind, Material};
use thiserror::Error;

/// Shared terminal reason for a material content identity failure.
pub(crate) const M3_CONTENT_HASH_MISMATCH: &str = "M3_CONTENT_HASH_MISMATCH";
/// Shared terminal reason for a malformed material envelope or identity.
pub(crate) const M3_MALFORMED_BATTLE_MATERIAL: &str = "M3_MALFORMED_BATTLE_MATERIAL";
/// Shared terminal reason for invalid authenticated authority material.
pub(crate) const M3_INVALID_AUTHORITY_MATERIAL: &str = "M3_INVALID_AUTHORITY_MATERIAL";

/// The narrow protocol-violation classes exposed by material application.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub(crate) enum ProtocolViolation {
    #[error("material content hash does not match the local immutable content pack")]
    ContentHashMismatch,
    #[error("material is malformed or has an unsupported identity/schema")]
    MalformedBattleMaterial,
}

impl ProtocolViolation {
    pub const fn terminal_reason(self) -> &'static str {
        match self {
            Self::ContentHashMismatch => M3_CONTENT_HASH_MISMATCH,
            Self::MalformedBattleMaterial => M3_MALFORMED_BATTLE_MATERIAL,
        }
    }
}

/// Exact replica-side recoverability/terminal classes for material apply.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub(crate) enum ReplicaApplyError {
    #[error("endpoint-local state or allocator frontier does not match material")]
    BeforeDigestMismatch,
    #[error("material protocol violation: {0}")]
    ProtocolViolation(ProtocolViolation),
    #[error("authenticated material has invalid after-state/evidence/control projection")]
    InvalidAfterState,
    #[error("authenticated material violates a state invariant")]
    Invariant,
}

impl ReplicaApplyError {
    pub const fn terminal_reason(self) -> Option<&'static str> {
        match self {
            Self::BeforeDigestMismatch => None,
            Self::ProtocolViolation(violation) => Some(violation.terminal_reason()),
            Self::InvalidAfterState | Self::Invariant => Some(M3_INVALID_AUTHORITY_MATERIAL),
        }
    }

    /// Retained for the staged recovery contract until its transport caller is wired.
    #[allow(dead_code)]
    pub const fn is_recoverable(self) -> bool {
        matches!(self, Self::BeforeDigestMismatch)
    }
}

/// Apply a canonical TURN payload received from the Authority.
///
/// This private byte adapter remains staged for direct transport callers; its
/// decode-and-map semantics are part of the replica boundary.
#[allow(dead_code)]
fn apply_turn_material_bytes(
    current: &BattleMaterialApplyContext,
    bytes: &[u8],
    content: &ContentPack,
) -> Result<MaterialApplyResult, ReplicaApplyError> {
    let material = decode_turn_material(bytes).map_err(|_| {
        ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
    })?;
    apply_turn_material(current, &material, content).map_err(map_material_apply_error)
}

/// Apply a canonical REPLACEMENT payload received from the Authority.
///
/// This private byte adapter remains staged for direct transport callers; its
/// decode-and-map semantics are part of the replica boundary.
#[allow(dead_code)]
fn apply_replacement_material_bytes(
    current: &BattleMaterialApplyContext,
    bytes: &[u8],
    content: &ContentPack,
) -> Result<MaterialApplyResult, ReplicaApplyError> {
    let material = decode_replacement_material(bytes).map_err(|_| {
        ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
    })?;
    apply_replacement_material(current, &material, content).map_err(map_material_apply_error)
}

/// Apply a complete Authority material envelope, checking its declared kind.
pub(crate) fn apply_authority_material(
    current: &BattleMaterialApplyContext,
    kind: AuthorityEntryKind,
    material: &Material,
    content: &ContentPack,
) -> Result<MaterialApplyResult, ReplicaApplyError> {
    let bytes = serde_json::to_vec(&material.payload).map_err(|_| {
        ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
    })?;
    match kind {
        AuthorityEntryKind::TurnCommit => {
            let typed = decode_turn_material(&bytes).map_err(|_| {
                ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
            })?;
            if typed.canonical_digest().map_err(|_| {
                ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
            })? != material.digest
            {
                return Err(ReplicaApplyError::ProtocolViolation(
                    ProtocolViolation::MalformedBattleMaterial,
                ));
            }
            apply_turn_material_trusted(current, &typed, content).map_err(map_material_apply_error)
        }
        AuthorityEntryKind::ReplacementCommit => {
            let typed = decode_replacement_material(&bytes).map_err(|_| {
                ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
            })?;
            if typed.canonical_digest().map_err(|_| {
                ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
            })? != material.digest
            {
                return Err(ReplicaApplyError::ProtocolViolation(
                    ProtocolViolation::MalformedBattleMaterial,
                ));
            }
            apply_replacement_material_trusted(current, &typed, content)
                .map_err(map_material_apply_error)
        }
        AuthorityEntryKind::InteractionCommit
        | AuthorityEntryKind::ControlCommit
        | AuthorityEntryKind::WaveAdvance
        | AuthorityEntryKind::TerminalCommit => Err(ReplicaApplyError::ProtocolViolation(
            ProtocolViolation::MalformedBattleMaterial,
        )),
    }
}

/// Map the common applier's closed error set without broadening recovery.
pub(crate) const fn map_material_apply_error(error: BattleMaterialApplyError) -> ReplicaApplyError {
    match error {
        BattleMaterialApplyError::LocalBeforeStateMismatch => {
            ReplicaApplyError::BeforeDigestMismatch
        }
        BattleMaterialApplyError::ContentHashMismatch => {
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::ContentHashMismatch)
        }
        BattleMaterialApplyError::MalformedIdentity
        | BattleMaterialApplyError::SchemaVersionMismatch
        | BattleMaterialApplyError::OracleIdentityMismatch => {
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial)
        }
        BattleMaterialApplyError::InvalidMaterialBeforeDigest
        | BattleMaterialApplyError::InvalidEvidence
        | BattleMaterialApplyError::InvalidAfterState
        | BattleMaterialApplyError::InvalidControlProjection
        | BattleMaterialApplyError::MenuAllocatorMismatch => ReplicaApplyError::InvalidAfterState,
        BattleMaterialApplyError::Invariant => ReplicaApplyError::Invariant,
    }
}
