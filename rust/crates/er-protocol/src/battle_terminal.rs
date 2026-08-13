//! Typed M3 terminal material admission and commit-draft construction.
//!
//! This module owns only the protocol boundary for a `TERMINAL_COMMIT`.  It
//! does not apply battle material, mutate a game state, or infer a terminal
//! outcome.  The terminal material is a closed, exact JSON value; the
//! authority entry remains the only ordered carrier for it.

use er_canonical::canonicalize_value;
use er_types::{
    AuthorityEntry, AuthorityEntryKind, FrameContext, Material, NextControl, OperationId, Revision,
    SafeU53, TerminalControl, validate_authority_material_digest, validate_authority_operation_id,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use thiserror::Error;

use crate::authority_log::AuthorityEntryDraft;
use crate::successor::is_valid_next_control;
use crate::validation::frame_context_issues;

const TERMINAL_DIGEST_PREFIX: &str = "terminal:";
const TERMINAL_DIGEST_HEX_LENGTH: usize = 8;
const FNV1A32_OFFSET: u32 = 0x811c_9dc5;
const FNV1A32_PRIME: u32 = 0x0100_0193;

/// A protocol failure while constructing or admitting terminal material.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleTerminalMaterialError {
    #[error("malformed terminal material at {path}: {reason}")]
    Malformed { path: String, reason: String },
    #[error("terminal material has the wrong Authority entry kind: {actual}")]
    WrongEntryKind { actual: String },
    #[error("terminal material serialization failed at {path}: {reason}")]
    Serialization { path: String, reason: String },
    #[error("terminal material canonicalization failed: {reason}")]
    Canonicalization { reason: String },
    #[error("terminal material context is invalid: {reason}")]
    InvalidContext { reason: String },
    #[error("terminal material operation identity is invalid: {operation_id}: {reason}")]
    InvalidOperationId {
        operation_id: String,
        reason: String,
    },
    #[error("terminal material terminal identity is invalid: {reason}")]
    InvalidTerminalId { reason: String },
    #[error("terminal material revision is invalid at {path}: {reason}")]
    InvalidRevision { path: String, reason: String },
    #[error("terminal material subsumption is invalid: {reason}")]
    InvalidSubsumes { reason: String },
    #[error("terminal successor control is invalid: {reason}")]
    InvalidControl { reason: String },
    #[error("malformed terminal material digest {digest}")]
    MalformedDigest { digest: String },
    #[error("terminal material digest mismatch: expected {expected}, actual {actual}")]
    DigestMismatch { expected: String, actual: String },
    #[error("terminal control identity mismatch: expected {expected}, actual {actual}")]
    TerminalIdMismatch { expected: String, actual: String },
}

/// The closed material discriminant for a terminal boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum BattleTerminalKindV1 {
    #[serde(rename = "terminal")]
    Terminal,
}

/// The closed M3 terminal cause.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BattleTerminalReasonV1 {
    GameOver,
}

/// The exact typed JSON payload carried by a `TERMINAL_COMMIT` material.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BattleTerminalMaterialV1 {
    pub kind: BattleTerminalKindV1,
    pub terminal_id: String,
    pub reason: BattleTerminalReasonV1,
    pub wave: SafeU53,
    pub turn: SafeU53,
}

impl BattleTerminalMaterialV1 {
    /// Construct a validated terminal material from JSON-serializable values.
    ///
    /// The coordinate parameters intentionally use serialization at this
    /// boundary so callers can pass the existing `SafeU53`, battle-index, or
    /// integer wrappers without introducing a second numeric identity type.
    pub fn new<I, W, T>(
        terminal_id: I,
        reason: BattleTerminalReasonV1,
        wave: W,
        turn: T,
    ) -> Result<Self, BattleTerminalMaterialError>
    where
        I: Serialize,
        W: Serialize,
        T: Serialize,
    {
        let terminal_id = decode_serialized(terminal_id, "terminalId")?;
        let wave = decode_serialized(wave, "wave")?;
        let turn = decode_serialized(turn, "turn")?;
        let material = Self {
            kind: BattleTerminalKindV1::Terminal,
            terminal_id,
            reason,
            wave,
            turn,
        };
        validate_terminal_material(&material)?;
        Ok(material)
    }
}

/// Compute the frozen `terminal:<8 lowercase hex>` material digest.
pub fn battle_terminal_material_digest(
    material: &BattleTerminalMaterialV1,
) -> Result<String, BattleTerminalMaterialError> {
    validate_terminal_material(material)?;
    let value = serde_json::to_value(material).map_err(|error| serialization("material", error))?;
    let canonical = canonicalize_value(&value).map_err(|error| {
        BattleTerminalMaterialError::Canonicalization {
            reason: error.to_string(),
        }
    })?;
    Ok(format!(
        "{TERMINAL_DIGEST_PREFIX}{:08x}",
        fnv1a32_utf16(&canonical)
    ))
}

/// Build a `TERMINAL_COMMIT` draft with typed material and its exact terminal
/// successor control.
///
/// All arguments are serialized and decoded into the public protocol DTOs at
/// this boundary.  This accepts both owned and borrowed callers while still
/// rejecting values that cannot be represented by the frozen wire types.
pub fn build_battle_terminal_commit_draft<C, O, T, S>(
    context: C,
    operation_id: O,
    terminal: T,
    subsumes: S,
) -> Result<AuthorityEntryDraft, BattleTerminalMaterialError>
where
    C: Serialize,
    O: Serialize,
    T: Serialize,
    S: Serialize,
{
    let context: FrameContext = decode_serialized(context, "context")?;
    validate_context(&context)?;

    let operation_id: OperationId = decode_serialized(operation_id, "operationId")?;
    validate_operation_id(&operation_id)?;

    let terminal: BattleTerminalMaterialV1 = decode_serialized(terminal, "terminal")?;
    validate_terminal_material(&terminal)?;

    let mut subsumes: Vec<Revision> = decode_serialized(subsumes, "subsumes")?;
    normalize_subsumes(&mut subsumes)?;

    let payload = serde_json::to_value(&terminal)
        .map_err(|error| serialization("material.payload", error))?;
    let digest = battle_terminal_material_digest(&terminal)?;
    let next_control = NextControl::Terminal(TerminalControl {
        terminal_id: terminal.terminal_id.clone(),
    });

    Ok(AuthorityEntryDraft {
        context,
        operation_id,
        kind: AuthorityEntryKind::TerminalCommit,
        material: Material { digest, payload },
        next_control,
        subsumes,
    })
}

/// Validate one typed Authority entry carrying a terminal material and return
/// the admitted typed payload.
pub fn validate_battle_terminal_commit(
    entry: &AuthorityEntry,
) -> Result<BattleTerminalMaterialV1, BattleTerminalMaterialError> {
    if entry.kind != AuthorityEntryKind::TerminalCommit {
        return Err(BattleTerminalMaterialError::WrongEntryKind {
            actual: format!("{:?}", entry.kind),
        });
    }
    if entry.revision == Revision::ZERO {
        return Err(BattleTerminalMaterialError::InvalidRevision {
            path: "revision".to_owned(),
            reason: "must be greater than zero".to_owned(),
        });
    }
    validate_context(&entry.context)?;
    validate_operation_id(&entry.operation_id)?;

    if entry.subsumes.contains(&Revision::ZERO) {
        return Err(BattleTerminalMaterialError::InvalidSubsumes {
            reason: "subsumed revisions must be positive".to_owned(),
        });
    }

    let control = match &entry.next_control {
        NextControl::Terminal(control) => control,
        _ => {
            return Err(BattleTerminalMaterialError::InvalidControl {
                reason: "TERMINAL_COMMIT requires a TERMINAL successor".to_owned(),
            });
        }
    };
    let control_value = serde_json::to_value(&entry.next_control)
        .map_err(|error| serialization("nextControl", error))?;
    if !is_valid_next_control(&control_value) {
        return Err(BattleTerminalMaterialError::InvalidControl {
            reason: "failed Authority successor validation".to_owned(),
        });
    }
    validate_terminal_id(&control.terminal_id)?;

    validate_digest_shape(&entry.material.digest)?;
    let material: BattleTerminalMaterialV1 = serde_json::from_value(entry.material.payload.clone())
        .map_err(|error| BattleTerminalMaterialError::Malformed {
            path: "material.payload".to_owned(),
            reason: error.to_string(),
        })?;
    validate_terminal_material(&material)?;

    if material.terminal_id != control.terminal_id {
        return Err(BattleTerminalMaterialError::TerminalIdMismatch {
            expected: material.terminal_id,
            actual: control.terminal_id.clone(),
        });
    }

    let expected = battle_terminal_material_digest(&material)?;
    if entry.material.digest != expected {
        return Err(BattleTerminalMaterialError::DigestMismatch {
            expected,
            actual: entry.material.digest.clone(),
        });
    }
    Ok(material)
}

fn decode_serialized<T, U>(value: T, path: &str) -> Result<U, BattleTerminalMaterialError>
where
    T: Serialize,
    U: DeserializeOwned,
{
    let value = serde_json::to_value(value).map_err(|error| serialization(path, error))?;
    serde_json::from_value(value).map_err(|error| BattleTerminalMaterialError::Malformed {
        path: path.to_owned(),
        reason: error.to_string(),
    })
}

fn validate_terminal_material(
    material: &BattleTerminalMaterialV1,
) -> Result<(), BattleTerminalMaterialError> {
    if material.kind != BattleTerminalKindV1::Terminal {
        return Err(BattleTerminalMaterialError::Malformed {
            path: "material.kind".to_owned(),
            reason: "must be terminal".to_owned(),
        });
    }
    validate_terminal_id(&material.terminal_id)
}

fn validate_terminal_id(value: &str) -> Result<(), BattleTerminalMaterialError> {
    if value.is_empty() {
        return Err(BattleTerminalMaterialError::InvalidTerminalId {
            reason: "must not be empty".to_owned(),
        });
    }
    Ok(())
}

fn validate_operation_id(value: &OperationId) -> Result<(), BattleTerminalMaterialError> {
    validate_authority_operation_id(value.as_str()).map_err(|error| {
        BattleTerminalMaterialError::InvalidOperationId {
            operation_id: value.as_str().to_owned(),
            reason: error.to_string(),
        }
    })
}

fn validate_context(context: &FrameContext) -> Result<(), BattleTerminalMaterialError> {
    let value = serde_json::to_value(context).map_err(|error| serialization("context", error))?;
    let issues = frame_context_issues(&value);
    if issues.is_empty() {
        Ok(())
    } else {
        Err(BattleTerminalMaterialError::InvalidContext {
            reason: issues.join(", "),
        })
    }
}

fn normalize_subsumes(subsumes: &mut Vec<Revision>) -> Result<(), BattleTerminalMaterialError> {
    if subsumes.contains(&Revision::ZERO) {
        return Err(BattleTerminalMaterialError::InvalidSubsumes {
            reason: "subsumed revisions must be positive".to_owned(),
        });
    }
    subsumes.sort_unstable();
    subsumes.dedup();
    Ok(())
}

fn validate_digest_shape(digest: &str) -> Result<(), BattleTerminalMaterialError> {
    if validate_authority_material_digest(digest).is_err()
        || digest.len() != TERMINAL_DIGEST_PREFIX.len() + TERMINAL_DIGEST_HEX_LENGTH
        || !digest.starts_with(TERMINAL_DIGEST_PREFIX)
        || digest[TERMINAL_DIGEST_PREFIX.len()..]
            .bytes()
            .any(|byte| !matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(BattleTerminalMaterialError::MalformedDigest {
            digest: digest.to_owned(),
        });
    }
    Ok(())
}

fn fnv1a32_utf16(value: &str) -> u32 {
    let mut hash = FNV1A32_OFFSET;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV1A32_PRIME);
    }
    hash
}

fn serialization(path: &str, error: serde_json::Error) -> BattleTerminalMaterialError {
    BattleTerminalMaterialError::Serialization {
        path: path.to_owned(),
        reason: error.to_string(),
    }
}
