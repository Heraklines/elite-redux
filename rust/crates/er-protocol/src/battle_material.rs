//! Opaque M3 TURN material admission.
//!
//! This module deliberately stops at the protocol boundary. The battle
//! payload remains a serde_json::Value; game/state crates own decoding and
//! semantic validation after this validator has admitted the authenticated
//! envelope.

use std::collections::BTreeSet;

use er_canonical::canonicalize_value;
use er_types::battle_ids::{BattleId, TurnIndex, WaveIndex};
use er_types::{
    AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, FrameType, OperationId, RawFrame,
    SafeU53, battle_command::validate_turn_result_operation_id, validate_authority_operation_id,
};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::successor::is_valid_next_control;
use crate::validation::{InboundFrameResult, ValidatedFrame, validate_inbound_frame};

/// Frozen M3 oracle identity shared by TURN and REPLACEMENT material.
pub const ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

/// Frozen version of the opaque TURN material capsule.
pub const BATTLE_TURN_MATERIAL_SCHEMA_VERSION: u32 = 1;

/// Alias matching the contract's shorter material terminology.
pub const TURN_MATERIAL_SCHEMA_VERSION: u32 = BATTLE_TURN_MATERIAL_SCHEMA_VERSION;

const FRAME_VERSION: u64 = 2;
const FNV1A64_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV1A64_PRIME: u64 = 0x0000_0100_0000_01b3;

/// A malformed TURN capsule is terminal protocol input, not a game error.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleMaterialError {
    #[error("malformed TURN material at {path}: {reason}")]
    Malformed { path: String, reason: String },
    #[error("TURN material has the wrong Authority entry kind: {actual}")]
    WrongEntryKind { actual: String },
    #[error("TURN material schema version is {actual}; expected {expected}")]
    SchemaVersionMismatch { expected: u32, actual: u64 },
    #[error("TURN material oracle identity is {actual}; expected {expected}")]
    OracleIdentityMismatch { expected: String, actual: String },
    #[error("TURN material operation identity mismatch: expected {expected}, actual {actual}")]
    OperationIdentityMismatch { expected: String, actual: String },
    #[error("malformed TURN material digest {digest}")]
    MalformedDigest { digest: String },
    #[error("TURN material digest mismatch: expected {expected}, actual {actual}")]
    DigestMismatch { expected: String, actual: String },
    #[error("TURN material canonicalization failed: {reason}")]
    Canonicalization { reason: String },
    #[error("malformed Authority frame: {reason}")]
    EnvelopeViolation { reason: String },
}

/// Compute the frozen TURN digest over canonical JSON and UTF-16 code units.
pub fn compute_turn_material_digest(payload: &Value) -> Result<String, BattleMaterialError> {
    let canonical = canonical_payload(payload)?;
    Ok(format!("{:016x}", fnv1a64_utf16(&canonical)))
}

/// Short alias for callers that name the digest after its material.
pub fn turn_material_digest(payload: &Value) -> Result<String, BattleMaterialError> {
    compute_turn_material_digest(payload)
}

/// Validate an already typed Authority entry carrying opaque TURN material.
pub fn validate_turn_material(entry: &AuthorityEntry) -> Result<(), BattleMaterialError> {
    let body = serde_json::to_value(AuthorityEntryBody::from(entry)).map_err(|error| {
        BattleMaterialError::Malformed {
            path: "body".to_owned(),
            reason: error.to_string(),
        }
    })?;
    validate_turn_material_body(&body).map(|_| ())
}

/// Validate the exact Authority-entry body shape and its opaque TURN capsule.
pub fn validate_turn_material_body(
    body: &Value,
) -> Result<AuthorityEntryBody, BattleMaterialError> {
    let body_object = object_at(body, "body")?;
    exact_keys(
        body_object,
        &[
            "revision",
            "operationId",
            "kind",
            "material",
            "nextControl",
            "subsumes",
        ],
        "body",
    )?;
    safe_u53(
        body_object
            .get("revision")
            .ok_or_else(|| malformed("body.revision", "missing field"))?,
        "body.revision",
        true,
    )?;
    let subsumes = body_object
        .get("subsumes")
        .and_then(Value::as_array)
        .ok_or_else(|| malformed("body.subsumes", "must be an array"))?;
    for (index, revision) in subsumes.iter().enumerate() {
        safe_u53(revision, &format!("body.subsumes[{index}]"), true)?;
    }
    let next_control = body_object
        .get("nextControl")
        .ok_or_else(|| malformed("body.nextControl", "missing field"))?;
    if !is_valid_next_control(next_control) {
        return Err(malformed(
            "body.nextControl",
            "failed Authority successor validation",
        ));
    }

    let typed_body =
        serde_json::from_value::<AuthorityEntryBody>(body.clone()).map_err(|error| {
            BattleMaterialError::Malformed {
                path: "body".to_owned(),
                reason: error.to_string(),
            }
        })?;
    if typed_body.kind != AuthorityEntryKind::TurnCommit {
        return Err(BattleMaterialError::WrongEntryKind {
            actual: format!("{:?}", typed_body.kind),
        });
    }

    let material = object_at(
        body_object
            .get("material")
            .ok_or_else(|| malformed("body.material", "missing field"))?,
        "body.material",
    )?;
    exact_keys(material, &["digest", "payload"], "body.material")?;
    let digest = string_at(
        material
            .get("digest")
            .ok_or_else(|| malformed("body.material.digest", "missing field"))?,
        "body.material.digest",
    )?;
    let payload = material
        .get("payload")
        .ok_or_else(|| malformed("body.material.payload", "missing field"))?;
    validate_turn_payload(payload, digest, &typed_body.operation_id)?;
    Ok(typed_body)
}

/// Validate a raw Authority frame carrying an opaque TURN material capsule.
///
/// The generic M2 validator is still run first so JSON, context, body and
/// successor semantics retain their established classification. M3 then
/// tightens only the exact outer keys and TURN identity/digest requirements.
pub fn validate_turn_material_frame(raw: &RawFrame) -> Result<ValidatedFrame, BattleMaterialError> {
    let value = raw_frame_value(raw)?;
    let envelope = object_at(&value, "frame")?;
    exact_keys(envelope, &["v", "t", "ctx", "body"], "frame")?;
    let version = envelope
        .get("v")
        .and_then(Value::as_f64)
        .ok_or_else(|| malformed("frame.v", "must be a number"))?;
    if version != FRAME_VERSION as f64 {
        return Err(BattleMaterialError::EnvelopeViolation {
            reason: format!("unsupported frame protocol version: {version}"),
        });
    }
    if envelope.get("t").and_then(Value::as_str) != Some("authorityEntry") {
        return Err(BattleMaterialError::EnvelopeViolation {
            reason: "frame type must be authorityEntry".to_owned(),
        });
    }
    let context = object_at(
        envelope
            .get("ctx")
            .ok_or_else(|| malformed("frame.ctx", "missing field"))?,
        "frame.ctx",
    )?;
    exact_keys(
        context,
        &[
            "sessionId",
            "runId",
            "sessionEpoch",
            "seatMapId",
            "membershipRevision",
            "senderSeatId",
            "authoritySeatId",
            "connectionGeneration",
        ],
        "frame.ctx",
    )?;
    let body = envelope
        .get("body")
        .ok_or_else(|| malformed("frame.body", "missing field"))?;
    validate_turn_material_body(body)?;

    let validated = match validate_inbound_frame(raw) {
        InboundFrameResult::Valid { frame } => *frame,
        InboundFrameResult::CosmeticDrop { reason } => {
            return Err(BattleMaterialError::EnvelopeViolation { reason });
        }
        InboundFrameResult::ProtocolViolation { issues, .. } => {
            return Err(BattleMaterialError::EnvelopeViolation {
                reason: issues.join("; "),
            });
        }
    };
    if validated.frame.frame_type != FrameType::AuthorityEntry {
        return Err(BattleMaterialError::EnvelopeViolation {
            reason: "generic validator did not produce an Authority entry".to_owned(),
        });
    }
    Ok(validated)
}

fn validate_turn_payload(
    payload: &Value,
    digest: &str,
    entry_operation_id: &OperationId,
) -> Result<(), BattleMaterialError> {
    let (canonical, operation_id, battle_id, wave, turn) =
        parse_turn_identity(payload, entry_operation_id)?;
    validate_turn_result_operation_id(&operation_id, battle_id, wave, turn)
        .map_err(|error| malformed("payload.operation_id", error.to_string()))?;
    validate_turn_digest(digest, &canonical)
}

fn parse_turn_identity(
    payload: &Value,
    entry_operation_id: &OperationId,
) -> Result<(String, OperationId, BattleId, WaveIndex, TurnIndex), BattleMaterialError> {
    let object = object_at(payload, "body.material.payload")?;
    let canonical = canonical_payload(payload)?;

    let schema = number_at(
        object
            .get("schema_version")
            .ok_or_else(|| malformed("payload.schema_version", "missing field"))?,
        "payload.schema_version",
    )?;
    if schema != u64::from(BATTLE_TURN_MATERIAL_SCHEMA_VERSION) {
        return Err(BattleMaterialError::SchemaVersionMismatch {
            expected: BATTLE_TURN_MATERIAL_SCHEMA_VERSION,
            actual: schema,
        });
    }

    let oracle = string_at(
        object
            .get("oracle_game_sha")
            .ok_or_else(|| malformed("payload.oracle_game_sha", "missing field"))?,
        "payload.oracle_game_sha",
    )?;
    if oracle != ORACLE_GAME_SHA {
        return Err(BattleMaterialError::OracleIdentityMismatch {
            expected: ORACLE_GAME_SHA.to_owned(),
            actual: oracle.to_owned(),
        });
    }

    let content_hash = string_at(
        object
            .get("content_hash")
            .ok_or_else(|| malformed("payload.content_hash", "missing field"))?,
        "payload.content_hash",
    )?;
    if content_hash.is_empty() {
        return Err(malformed("payload.content_hash", "must not be empty"));
    }

    let operation_wire = string_at(
        object
            .get("operation_id")
            .ok_or_else(|| malformed("payload.operation_id", "missing field"))?,
        "payload.operation_id",
    )?;
    let operation_id = OperationId::new(operation_wire.to_owned())
        .map_err(|error| malformed("payload.operation_id", error.to_string()))?;
    validate_authority_operation_id(operation_id.as_str())
        .map_err(|error| malformed("payload.operation_id", error.to_string()))?;
    if operation_id != *entry_operation_id {
        return Err(BattleMaterialError::OperationIdentityMismatch {
            expected: entry_operation_id.as_str().to_owned(),
            actual: operation_id.as_str().to_owned(),
        });
    }

    let battle_id = BattleId::new(safe_u53(
        object
            .get("battle_id")
            .ok_or_else(|| malformed("payload.battle_id", "missing field"))?,
        "payload.battle_id",
        false,
    )?);
    let wave = WaveIndex::new(safe_u53(
        object
            .get("wave")
            .ok_or_else(|| malformed("payload.wave", "missing field"))?,
        "payload.wave",
        true,
    )?)
    .map_err(|error| malformed("payload.wave", error.to_string()))?;
    let turn = TurnIndex::new(safe_u53(
        object
            .get("resolved_turn")
            .ok_or_else(|| malformed("payload.resolved_turn", "missing field"))?,
        "payload.resolved_turn",
        true,
    )?)
    .map_err(|error| malformed("payload.resolved_turn", error.to_string()))?;

    Ok((canonical, operation_id, battle_id, wave, turn))
}

fn validate_turn_digest(supplied: &str, canonical: &str) -> Result<(), BattleMaterialError> {
    if supplied.len() != 16
        || supplied
            .bytes()
            .any(|byte| !matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(BattleMaterialError::MalformedDigest {
            digest: supplied.to_owned(),
        });
    }
    let expected = format!("{:016x}", fnv1a64_utf16(canonical));
    if supplied != expected {
        return Err(BattleMaterialError::DigestMismatch {
            expected,
            actual: supplied.to_owned(),
        });
    }
    Ok(())
}

fn fnv1a64_utf16(value: &str) -> u64 {
    let mut hash = FNV1A64_OFFSET;
    for unit in value.encode_utf16() {
        hash ^= u64::from(unit);
        hash = hash.wrapping_mul(FNV1A64_PRIME);
    }
    hash
}

fn canonical_payload(payload: &Value) -> Result<String, BattleMaterialError> {
    canonicalize_value(payload).map_err(|error| BattleMaterialError::Canonicalization {
        reason: error.to_string(),
    })
}

fn raw_frame_value(raw: &RawFrame) -> Result<Value, BattleMaterialError> {
    match raw {
        RawFrame::JsonText(text) => {
            serde_json::from_str(text).map_err(|error| BattleMaterialError::EnvelopeViolation {
                reason: format!("malformed JSON: {error}"),
            })
        }
        RawFrame::JsonValue(value) => Ok(value.clone()),
    }
}

fn object_at<'a>(
    value: &'a Value,
    path: &str,
) -> Result<&'a Map<String, Value>, BattleMaterialError> {
    value
        .as_object()
        .ok_or_else(|| malformed(path, "must be an object"))
}

fn string_at<'a>(value: &'a Value, path: &str) -> Result<&'a str, BattleMaterialError> {
    value
        .as_str()
        .ok_or_else(|| malformed(path, "must be a string"))
}

fn number_at(value: &Value, path: &str) -> Result<u64, BattleMaterialError> {
    if let Some(value) = value.as_u64() {
        return Ok(value);
    }
    let Some(value) = value.as_f64() else {
        return Err(malformed(path, "must be a non-negative integer"));
    };
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 {
        return Err(malformed(path, "must be a non-negative integer"));
    }
    if value > u64::MAX as f64 {
        return Err(malformed(path, "must fit in u64"));
    }
    Ok(value as u64)
}

fn safe_u53(value: &Value, path: &str, positive: bool) -> Result<SafeU53, BattleMaterialError> {
    let value = number_at(value, path)?;
    if positive && value == 0 {
        return Err(malformed(path, "must be greater than zero"));
    }
    SafeU53::new(value).map_err(|error| malformed(path, error.to_string()))
}

fn exact_keys(
    object: &Map<String, Value>,
    expected: &[&str],
    path: &str,
) -> Result<(), BattleMaterialError> {
    let expected_set = expected
        .iter()
        .map(|key| (*key).to_owned())
        .collect::<BTreeSet<_>>();
    let actual_set = object.keys().cloned().collect::<BTreeSet<_>>();
    if actual_set == expected_set {
        return Ok(());
    }
    let missing = expected_set
        .difference(&actual_set)
        .cloned()
        .collect::<Vec<_>>();
    let extra = actual_set
        .difference(&expected_set)
        .cloned()
        .collect::<Vec<_>>();
    Err(malformed(
        path,
        format!("expected exact keys; missing {missing:?}, extra {extra:?}"),
    ))
}

fn malformed(path: &str, reason: impl Into<String>) -> BattleMaterialError {
    BattleMaterialError::Malformed {
        path: path.to_owned(),
        reason: reason.into(),
    }
}
