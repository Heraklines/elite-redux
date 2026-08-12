//! Opaque M3 REPLACEMENT material admission.
//!
//! The protocol crate validates only the authenticated capsule and the
//! address-bearing occurrence fields needed to prove the operation identity.
//! Selection, state, mutation, RNG, and presentation semantics remain owned
//! by the game layer.

use std::collections::BTreeSet;

use er_canonical::canonicalize_value;
use er_types::battle_ids::{AuthorityEpoch, BattleId, BattleSide, FieldSlot, TurnIndex, WaveIndex};
use er_types::{
    AuthorityEntry, AuthorityEntryBody, AuthorityEntryKind, FrameType, OperationId, RawFrame,
    SafeU53, SeatId, battle_command::validate_replacement_operation_id,
    validate_authority_operation_id,
};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::successor::is_valid_next_control;
use crate::validation::{InboundFrameResult, ValidatedFrame, validate_inbound_frame};

/// Frozen version of the opaque REPLACEMENT material capsule.
pub const BATTLE_REPLACEMENT_MATERIAL_SCHEMA_VERSION: u32 = 1;

/// Alias matching the contract's shorter material terminology.
pub const REPLACEMENT_MATERIAL_SCHEMA_VERSION: u32 = BATTLE_REPLACEMENT_MATERIAL_SCHEMA_VERSION;

const ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const FRAME_VERSION: u64 = 2;
const FNV1A32_OFFSET: u32 = 0x811c_9dc5;
const FNV1A32_PRIME: u32 = 0x0100_0193;

/// A malformed REPLACEMENT capsule is terminal protocol input.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReplacementMaterialError {
    #[error("malformed REPLACEMENT material at {path}: {reason}")]
    Malformed { path: String, reason: String },
    #[error("REPLACEMENT material has the wrong Authority entry kind: {actual}")]
    WrongEntryKind { actual: String },
    #[error("REPLACEMENT material schema version is {actual}; expected {expected}")]
    SchemaVersionMismatch { expected: u32, actual: u64 },
    #[error("REPLACEMENT material oracle identity is {actual}; expected {expected}")]
    OracleIdentityMismatch { expected: String, actual: String },
    #[error(
        "REPLACEMENT material operation identity mismatch: expected {expected}, actual {actual}"
    )]
    OperationIdentityMismatch { expected: String, actual: String },
    #[error("malformed REPLACEMENT material digest {digest}")]
    MalformedDigest { digest: String },
    #[error("REPLACEMENT material digest mismatch: expected {expected}, actual {actual}")]
    DigestMismatch { expected: String, actual: String },
    #[error("REPLACEMENT material canonicalization failed: {reason}")]
    Canonicalization { reason: String },
    #[error("malformed Authority frame: {reason}")]
    EnvelopeViolation { reason: String },
}

/// Compute the frozen REPLACEMENT digest over canonical JSON and UTF-16 units.
pub fn compute_replacement_material_digest(
    payload: &Value,
) -> Result<String, ReplacementMaterialError> {
    let canonical = canonical_payload(payload)?;
    Ok(format!(
        "rc1-{}-{:08x}",
        canonical.encode_utf16().count(),
        fnv1a32_utf16(&canonical)
    ))
}

/// Short alias for callers that name the digest after its material.
pub fn replacement_material_digest(payload: &Value) -> Result<String, ReplacementMaterialError> {
    compute_replacement_material_digest(payload)
}

/// Validate an already typed Authority entry carrying opaque REPLACEMENT
/// material, including its context epoch.
pub fn validate_replacement_material(
    entry: &AuthorityEntry,
) -> Result<(), ReplacementMaterialError> {
    let body = serde_json::to_value(AuthorityEntryBody::from(entry)).map_err(|error| {
        ReplacementMaterialError::Malformed {
            path: "body".to_owned(),
            reason: error.to_string(),
        }
    })?;
    validate_replacement_material_body_with_epoch(&body, Some(entry.context.session_epoch))
        .map(|_| ())
}

/// Validate the exact Authority-entry body shape and its opaque REPLACEMENT
/// capsule without a frame context.
pub fn validate_replacement_material_body(
    body: &Value,
) -> Result<AuthorityEntryBody, ReplacementMaterialError> {
    validate_replacement_material_body_with_epoch(body, None)
}

/// Validate a raw Authority frame carrying an opaque REPLACEMENT capsule.
pub fn validate_replacement_material_frame(
    raw: &RawFrame,
) -> Result<ValidatedFrame, ReplacementMaterialError> {
    let value = raw_frame_value(raw)?;
    let envelope = object_at(&value, "frame")?;
    exact_keys(envelope, &["v", "t", "ctx", "body"], "frame")?;
    let version = envelope
        .get("v")
        .and_then(Value::as_f64)
        .ok_or_else(|| malformed("frame.v", "must be a number"))?;
    if version != FRAME_VERSION as f64 {
        return Err(ReplacementMaterialError::EnvelopeViolation {
            reason: format!("unsupported frame protocol version: {version}"),
        });
    }
    if envelope.get("t").and_then(Value::as_str) != Some("authorityEntry") {
        return Err(ReplacementMaterialError::EnvelopeViolation {
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
    let session_epoch = safe_u53(
        context
            .get("sessionEpoch")
            .ok_or_else(|| malformed("frame.ctx.sessionEpoch", "missing field"))?,
        "frame.ctx.sessionEpoch",
        false,
    )?;
    let body = envelope
        .get("body")
        .ok_or_else(|| malformed("frame.body", "missing field"))?;
    validate_replacement_material_body_with_epoch(body, Some(session_epoch))?;

    let validated = match validate_inbound_frame(raw) {
        InboundFrameResult::Valid { frame } => *frame,
        InboundFrameResult::CosmeticDrop { reason } => {
            return Err(ReplacementMaterialError::EnvelopeViolation { reason });
        }
        InboundFrameResult::ProtocolViolation { issues, .. } => {
            return Err(ReplacementMaterialError::EnvelopeViolation {
                reason: issues.join("; "),
            });
        }
    };
    if validated.frame.frame_type != FrameType::AuthorityEntry {
        return Err(ReplacementMaterialError::EnvelopeViolation {
            reason: "generic validator did not produce an Authority entry".to_owned(),
        });
    }
    Ok(validated)
}

fn validate_replacement_material_body_with_epoch(
    body: &Value,
    session_epoch: Option<SafeU53>,
) -> Result<AuthorityEntryBody, ReplacementMaterialError> {
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
            ReplacementMaterialError::Malformed {
                path: "body".to_owned(),
                reason: error.to_string(),
            }
        })?;
    if typed_body.kind != AuthorityEntryKind::ReplacementCommit {
        return Err(ReplacementMaterialError::WrongEntryKind {
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
    validate_replacement_payload(payload, digest, &typed_body.operation_id, session_epoch)?;
    Ok(typed_body)
}

fn validate_replacement_payload(
    payload: &Value,
    digest: &str,
    entry_operation_id: &OperationId,
    session_epoch: Option<SafeU53>,
) -> Result<(), ReplacementMaterialError> {
    let (canonical, identity) =
        parse_replacement_identity(payload, entry_operation_id, session_epoch)?;
    validate_replacement_operation_id(
        &identity.operation_id,
        identity.epoch,
        identity.battle_id,
        identity.wave,
        identity.resolved_turn,
        identity.turn_occurrence,
        identity.field_slot,
        identity.owner_seat,
    )
    .map_err(|error| malformed("payload.operation_id", error.to_string()))?;
    validate_replacement_digest(digest, &canonical)
}

struct ReplacementIdentity {
    operation_id: OperationId,
    epoch: AuthorityEpoch,
    battle_id: BattleId,
    wave: WaveIndex,
    resolved_turn: TurnIndex,
    turn_occurrence: u32,
    field_slot: FieldSlot,
    owner_seat: SeatId,
}

fn parse_replacement_identity(
    payload: &Value,
    entry_operation_id: &OperationId,
    session_epoch: Option<SafeU53>,
) -> Result<(String, ReplacementIdentity), ReplacementMaterialError> {
    let object = object_at(payload, "body.material.payload")?;
    let canonical = canonical_payload(payload)?;

    let schema = number_at(
        object
            .get("schema_version")
            .ok_or_else(|| malformed("payload.schema_version", "missing field"))?,
        "payload.schema_version",
    )?;
    if schema != u64::from(BATTLE_REPLACEMENT_MATERIAL_SCHEMA_VERSION) {
        return Err(ReplacementMaterialError::SchemaVersionMismatch {
            expected: BATTLE_REPLACEMENT_MATERIAL_SCHEMA_VERSION,
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
        return Err(ReplacementMaterialError::OracleIdentityMismatch {
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
        return Err(ReplacementMaterialError::OperationIdentityMismatch {
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
    let resolved_turn = TurnIndex::new(safe_u53(
        object
            .get("resolved_turn")
            .ok_or_else(|| malformed("payload.resolved_turn", "missing field"))?,
        "payload.resolved_turn",
        true,
    )?)
    .map_err(|error| malformed("payload.resolved_turn", error.to_string()))?;

    let occurrence = object_at(
        object
            .get("occurrence")
            .ok_or_else(|| malformed("payload.occurrence", "missing field"))?,
        "payload.occurrence",
    )?;
    exact_keys(
        occurrence,
        &[
            "id",
            "source",
            "slot",
            "pokemon",
            "owner_seat",
            "replacement",
        ],
        "payload.occurrence",
    )?;
    let source = object_at(
        occurrence
            .get("source")
            .ok_or_else(|| malformed("payload.occurrence.source", "missing field"))?,
        "payload.occurrence.source",
    )?;
    exact_keys(
        source,
        &["epoch", "wave", "resolved_turn", "turn_occurrence"],
        "payload.occurrence.source",
    )?;
    let source_epoch = AuthorityEpoch::new(safe_u53(
        source
            .get("epoch")
            .ok_or_else(|| malformed("payload.occurrence.source.epoch", "missing field"))?,
        "payload.occurrence.source.epoch",
        true,
    )?);
    if let Some(session_epoch) = session_epoch
        && source_epoch.get() != session_epoch
    {
        return Err(ReplacementMaterialError::OperationIdentityMismatch {
            expected: format!("epoch {session_epoch}"),
            actual: format!("epoch {source_epoch}"),
        });
    }
    let source_wave = WaveIndex::new(safe_u53(
        source
            .get("wave")
            .ok_or_else(|| malformed("payload.occurrence.source.wave", "missing field"))?,
        "payload.occurrence.source.wave",
        true,
    )?)
    .map_err(|error| malformed("payload.occurrence.source.wave", error.to_string()))?;
    let source_turn = TurnIndex::new(safe_u53(
        source
            .get("resolved_turn")
            .ok_or_else(|| malformed("payload.occurrence.source.resolved_turn", "missing field"))?,
        "payload.occurrence.source.resolved_turn",
        true,
    )?)
    .map_err(|error| malformed("payload.occurrence.source.resolved_turn", error.to_string()))?;
    if source_wave != wave {
        return Err(ReplacementMaterialError::OperationIdentityMismatch {
            expected: format!("wave {wave}"),
            actual: format!("wave {source_wave}"),
        });
    }
    if source_turn != resolved_turn {
        return Err(ReplacementMaterialError::OperationIdentityMismatch {
            expected: format!("resolved_turn {resolved_turn}"),
            actual: format!("resolved_turn {source_turn}"),
        });
    }
    let turn_occurrence_value = number_at(
        source.get("turn_occurrence").ok_or_else(|| {
            malformed("payload.occurrence.source.turn_occurrence", "missing field")
        })?,
        "payload.occurrence.source.turn_occurrence",
    )?;
    let turn_occurrence = u32::try_from(turn_occurrence_value).map_err(|_| {
        malformed(
            "payload.occurrence.source.turn_occurrence",
            "must fit in u32",
        )
    })?;

    let slot = object_at(
        occurrence
            .get("slot")
            .ok_or_else(|| malformed("payload.occurrence.slot", "missing field"))?,
        "payload.occurrence.slot",
    )?;
    exact_keys(slot, &["side", "position"], "payload.occurrence.slot")?;
    if slot.get("side").and_then(Value::as_str) != Some("PLAYER") {
        return Err(malformed(
            "payload.occurrence.slot.side",
            "replacement slot must be PLAYER",
        ));
    }
    let position = number_at(
        slot.get("position")
            .ok_or_else(|| malformed("payload.occurrence.slot.position", "missing field"))?,
        "payload.occurrence.slot.position",
    )?;
    let position = u8::try_from(position)
        .map_err(|_| malformed("payload.occurrence.slot.position", "must fit in u8"))?;
    let field_slot = FieldSlot::new(BattleSide::Player, position)
        .map_err(|error| malformed("payload.occurrence.slot.position", error.to_string()))?;

    let owner_value = occurrence
        .get("owner_seat")
        .ok_or_else(|| malformed("payload.occurrence.owner_seat", "missing field"))?;
    let owner_seat = SeatId::new(safe_u53(
        owner_value,
        "payload.occurrence.owner_seat",
        false,
    )?);
    object_at(
        object
            .get("selection")
            .ok_or_else(|| malformed("payload.selection", "missing field"))?,
        "payload.selection",
    )?;

    Ok((
        canonical,
        ReplacementIdentity {
            operation_id,
            epoch: source_epoch,
            battle_id,
            wave,
            resolved_turn,
            turn_occurrence,
            field_slot,
            owner_seat,
        },
    ))
}

fn validate_replacement_digest(
    supplied: &str,
    canonical: &str,
) -> Result<(), ReplacementMaterialError> {
    let Some(rest) = supplied.strip_prefix("rc1-") else {
        return Err(ReplacementMaterialError::MalformedDigest {
            digest: supplied.to_owned(),
        });
    };
    let mut fields = rest.split('-');
    let Some(length_wire) = fields.next() else {
        return Err(ReplacementMaterialError::MalformedDigest {
            digest: supplied.to_owned(),
        });
    };
    let Some(hash_wire) = fields.next() else {
        return Err(ReplacementMaterialError::MalformedDigest {
            digest: supplied.to_owned(),
        });
    };
    if fields.next().is_some()
        || length_wire.is_empty()
        || hash_wire.len() != 8
        || length_wire.bytes().any(|byte| !byte.is_ascii_digit())
        || hash_wire
            .bytes()
            .any(|byte| !matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(ReplacementMaterialError::MalformedDigest {
            digest: supplied.to_owned(),
        });
    }
    let length =
        length_wire
            .parse::<usize>()
            .map_err(|_| ReplacementMaterialError::MalformedDigest {
                digest: supplied.to_owned(),
            })?;
    if length_wire != length.to_string() {
        return Err(ReplacementMaterialError::MalformedDigest {
            digest: supplied.to_owned(),
        });
    }
    let expected = compute_replacement_material_digest_from_canonical(canonical);
    if supplied != expected {
        return Err(ReplacementMaterialError::DigestMismatch {
            expected,
            actual: supplied.to_owned(),
        });
    }
    Ok(())
}

fn compute_replacement_material_digest_from_canonical(canonical: &str) -> String {
    format!(
        "rc1-{}-{:08x}",
        canonical.encode_utf16().count(),
        fnv1a32_utf16(canonical)
    )
}

fn fnv1a32_utf16(value: &str) -> u32 {
    let mut hash = FNV1A32_OFFSET;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV1A32_PRIME);
    }
    hash
}

fn canonical_payload(payload: &Value) -> Result<String, ReplacementMaterialError> {
    canonicalize_value(payload).map_err(|error| ReplacementMaterialError::Canonicalization {
        reason: error.to_string(),
    })
}

fn raw_frame_value(raw: &RawFrame) -> Result<Value, ReplacementMaterialError> {
    match raw {
        RawFrame::JsonText(text) => serde_json::from_str(text).map_err(|error| {
            ReplacementMaterialError::EnvelopeViolation {
                reason: format!("malformed JSON: {error}"),
            }
        }),
        RawFrame::JsonValue(value) => Ok(value.clone()),
    }
}

fn object_at<'a>(
    value: &'a Value,
    path: &str,
) -> Result<&'a Map<String, Value>, ReplacementMaterialError> {
    value
        .as_object()
        .ok_or_else(|| malformed(path, "must be an object"))
}

fn string_at<'a>(value: &'a Value, path: &str) -> Result<&'a str, ReplacementMaterialError> {
    value
        .as_str()
        .ok_or_else(|| malformed(path, "must be a string"))
}

fn number_at(value: &Value, path: &str) -> Result<u64, ReplacementMaterialError> {
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

fn safe_u53(
    value: &Value,
    path: &str,
    positive: bool,
) -> Result<SafeU53, ReplacementMaterialError> {
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
) -> Result<(), ReplacementMaterialError> {
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

fn malformed(path: &str, reason: impl Into<String>) -> ReplacementMaterialError {
    ReplacementMaterialError::Malformed {
        path: path.to_owned(),
        reason: reason.into(),
    }
}
