#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use er_canonical::canonicalize_value;
use er_protocol::{
    battle_material::{
        BattleMaterialError, ORACLE_GAME_SHA, compute_turn_material_digest,
        validate_turn_material_body, validate_turn_material_frame,
    },
    replacement_material::{
        ReplacementMaterialError, compute_replacement_material_digest,
        validate_replacement_material_body, validate_replacement_material_frame,
    },
};
use er_types::RawFrame;
use serde_json::{Value, json};

const TURN_OPERATION: &str = "battle/7/wave/2/turn/3/result";
const REPLACEMENT_OPERATION: &str = "RC/e1/b7/w2/t3/o4/f1/s0";

fn raw(value: Value) -> RawFrame {
    RawFrame::JsonValue(value)
}

fn context_value() -> Value {
    json!({
        "sessionId": "session",
        "runId": "run",
        "sessionEpoch": 1,
        "seatMapId": "seat-map",
        "membershipRevision": 2,
        "senderSeatId": 1,
        "authoritySeatId": 0,
        "connectionGeneration": 3
    })
}

fn command_frontier() -> Value {
    json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "commands": [
            {"ownerSeatId": 0, "pokemonId": 1, "fieldIndex": 0}
        ]
    })
}

fn turn_payload() -> Value {
    json!({
        "schema_version": 1,
        "oracle_game_sha": ORACLE_GAME_SHA,
        "content_hash": "content-v1",
        "operation_id": TURN_OPERATION,
        "battle_id": 7,
        "wave": 2,
        "resolved_turn": 3,
        "opaque_note": "astral-\u{1f600}",
        "opaque_array": ["b", "a"]
    })
}

fn turn_body(payload: Value) -> Value {
    let digest = compute_turn_material_digest(&payload).expect("TURN digest");
    json!({
        "revision": 1,
        "operationId": TURN_OPERATION,
        "kind": "TURN_COMMIT",
        "material": {"digest": digest, "payload": payload},
        "nextControl": command_frontier(),
        "subsumes": []
    })
}

fn turn_frame(body: Value) -> Value {
    json!({
        "v": 2,
        "t": "authorityEntry",
        "ctx": context_value(),
        "body": body
    })
}

fn replacement_payload() -> Value {
    json!({
        "schema_version": 1,
        "oracle_game_sha": ORACLE_GAME_SHA,
        "content_hash": "content-v1",
        "operation_id": REPLACEMENT_OPERATION,
        "battle_id": 7,
        "wave": 2,
        "resolved_turn": 3,
        "occurrence": {
            "id": 99,
            "source": {
                "epoch": 1,
                "wave": 2,
                "resolved_turn": 3,
                "turn_occurrence": 4
            },
            "slot": {"side": "PLAYER", "position": 1},
            "pokemon": 123,
            "owner_seat": 0,
            "replacement": {"kind": "PENDING"}
        },
        "selection": {"kind": "NO_LEGAL_REPLACEMENT"},
        "opaque_note": "replacement-\u{1f642}"
    })
}

fn replacement_body(payload: Value) -> Value {
    let digest = compute_replacement_material_digest(&payload).expect("REPLACEMENT digest");
    let operation_id = payload
        .get("operation_id")
        .and_then(Value::as_str)
        .expect("operation identity");
    json!({
        "revision": 1,
        "operationId": operation_id,
        "kind": "REPLACEMENT_COMMIT",
        "material": {"digest": digest, "payload": payload},
        "nextControl": command_frontier(),
        "subsumes": []
    })
}

fn replacement_control() -> Value {
    json!({
        "kind": "REPLACEMENT",
        "operationId": REPLACEMENT_OPERATION,
        "ownerSeatId": 0,
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "occurrence": 4,
        "fieldIndex": 1,
        "remaining": []
    })
}

fn replacement_frame(body: Value) -> Value {
    json!({
        "v": 2,
        "t": "authorityEntry",
        "ctx": context_value(),
        "body": body
    })
}

fn fnv1a64_utf16(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for unit in value.encode_utf16() {
        hash ^= u64::from(unit);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn fnv1a32_utf16(value: &str) -> u32 {
    let mut hash = 0x811c_9dc5_u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

#[test]
fn turn_digest_is_sorted_canonical_utf16_fnv1a64_and_lowercase_hex() {
    let payload = turn_payload();
    let canonical = canonicalize_value(&payload).expect("canonical TURN payload");
    let expected = format!("{:016x}", fnv1a64_utf16(&canonical));
    assert_eq!(
        compute_turn_material_digest(&payload).expect("TURN digest"),
        expected
    );
    assert_eq!(expected.len(), 16);
    assert!(
        expected
            .bytes()
            .all(|byte| { matches!(byte, b'0'..=b'9' | b'a'..=b'f') })
    );

    let mut reordered = serde_json::Map::new();
    reordered.insert("opaque_array".to_owned(), json!(["b", "a"]));
    reordered.insert("opaque_note".to_owned(), json!("astral-\u{1f600}"));
    reordered.insert("resolved_turn".to_owned(), json!(3));
    reordered.insert("wave".to_owned(), json!(2));
    reordered.insert("battle_id".to_owned(), json!(7));
    reordered.insert("operation_id".to_owned(), json!(TURN_OPERATION));
    reordered.insert("content_hash".to_owned(), json!("content-v1"));
    reordered.insert("oracle_game_sha".to_owned(), json!(ORACLE_GAME_SHA));
    reordered.insert("schema_version".to_owned(), json!(1));
    assert_eq!(
        compute_turn_material_digest(&Value::Object(reordered)).expect("reordered digest"),
        expected
    );

    let scalar_hash = canonical
        .chars()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, character| {
            (hash ^ u64::from(character as u32)).wrapping_mul(0x0000_0100_0000_01b3)
        });
    assert_ne!(
        scalar_hash,
        fnv1a64_utf16(&canonical),
        "astral vector must exercise UTF-16 surrogate units"
    );
}

#[test]
fn replacement_digest_has_utf16_length_and_fnv1a32_vector() {
    let payload = replacement_payload();
    let canonical = canonicalize_value(&payload).expect("canonical REPLACEMENT payload");
    let expected = format!(
        "rc1-{}-{:08x}",
        canonical.encode_utf16().count(),
        fnv1a32_utf16(&canonical)
    );
    let digest = compute_replacement_material_digest(&payload).expect("REPLACEMENT digest");
    assert_eq!(digest, expected);
    assert!(digest.starts_with("rc1-"));
    let hash = format!("{:08x}", fnv1a32_utf16(&canonical));
    assert!(digest.ends_with(hash.as_str()));
    assert!(
        canonical.encode_utf16().count() > canonical.chars().count(),
        "astral vector must have a two-code-unit UTF-16 representation"
    );
}

#[test]
fn valid_opaque_turn_body_and_frame_are_admitted() {
    let body = turn_body(turn_payload());
    assert!(validate_turn_material_body(&body).is_ok());
    assert!(validate_turn_material_frame(&raw(turn_frame(body))).is_ok());
}

#[test]
fn malformed_turn_digest_forms_are_rejected_before_game_decoding() {
    for malformed_digest in ["ABCDEF0123456789", "0123456789abcde", "0123456789abcdeg"] {
        let mut body = turn_body(turn_payload());
        body["material"]["digest"] = json!(malformed_digest);
        assert!(matches!(
            validate_turn_material_body(&body),
            Err(BattleMaterialError::MalformedDigest { .. })
        ));
    }

    let mut body = turn_body(turn_payload());
    body["material"]["digest"] = json!("0000000000000000");
    assert!(matches!(
        validate_turn_material_body(&body),
        Err(BattleMaterialError::DigestMismatch { .. })
    ));
}

#[test]
fn identity_and_oracle_mismatches_are_terminal_protocol_errors() {
    let mut payload = turn_payload();
    payload["operation_id"] = json!("battle/7/wave/2/turn/4/result");
    let body = turn_body(payload);
    assert!(matches!(
        validate_turn_material_body(&body),
        Err(BattleMaterialError::OperationIdentityMismatch { .. })
    ));

    let mut payload = turn_payload();
    payload["oracle_game_sha"] = json!("wrong-oracle");
    let body = turn_body(payload);
    assert!(matches!(
        validate_turn_material_body(&body),
        Err(BattleMaterialError::OracleIdentityMismatch { .. })
    ));

    let mut payload = turn_payload();
    payload["schema_version"] = json!(2);
    let body = turn_body(payload);
    assert!(matches!(
        validate_turn_material_body(&body),
        Err(BattleMaterialError::SchemaVersionMismatch { .. })
    ));
}

#[test]
fn unknown_outer_frame_body_and_material_fields_are_rejected() {
    let mut frame = turn_frame(turn_body(turn_payload()));
    frame["extra"] = json!(true);
    assert!(matches!(
        validate_turn_material_frame(&raw(frame)),
        Err(BattleMaterialError::Malformed { path, .. }) if path == "frame"
    ));

    let mut body = turn_body(turn_payload());
    body["unexpected"] = json!(true);
    assert!(matches!(
        validate_turn_material_body(&body),
        Err(BattleMaterialError::Malformed { path, .. }) if path == "body"
    ));

    let mut body = turn_body(turn_payload());
    body["material"]["unexpected"] = json!(true);
    assert!(matches!(
        validate_turn_material_body(&body),
        Err(BattleMaterialError::Malformed { path, .. }) if path == "body.material"
    ));
}

#[test]
fn replacement_operation_uses_source_turn_occurrence_not_global_occurrence_id() {
    let payload = replacement_payload();
    assert!(validate_replacement_material_body(&replacement_body(payload.clone())).is_ok());

    let mut changed_global_id = payload.clone();
    changed_global_id["occurrence"]["id"] = json!(9001);
    let changed_global_body = replacement_body(changed_global_id);
    assert!(
        validate_replacement_material_body(&changed_global_body).is_ok(),
        "diagnostic global id must not change the operation address"
    );

    let mut operation_from_global_id = payload.clone();
    operation_from_global_id["operation_id"] = json!("RC/e1/b7/w2/t3/o99/f1/s0");
    let operation_from_global_body = replacement_body(operation_from_global_id);
    assert!(matches!(
        validate_replacement_material_body(&operation_from_global_body),
        Err(ReplacementMaterialError::Malformed { .. })
            | Err(ReplacementMaterialError::OperationIdentityMismatch { .. })
    ));

    let mut changed_source_occurrence = payload;
    changed_source_occurrence["occurrence"]["source"]["turn_occurrence"] = json!(99);
    let changed_source_body = replacement_body(changed_source_occurrence);
    assert!(matches!(
        validate_replacement_material_body(&changed_source_body),
        Err(ReplacementMaterialError::Malformed { .. })
            | Err(ReplacementMaterialError::OperationIdentityMismatch { .. })
    ));
}

#[test]
fn valid_replacement_frame_binds_context_epoch_and_rejects_extra_outer_fields() {
    let payload = replacement_payload();
    let mut body = replacement_body(payload);
    body["nextControl"] = replacement_control();
    assert!(validate_replacement_material_frame(&raw(replacement_frame(body.clone()))).is_ok());

    let mut frame = replacement_frame(body);
    frame["extra"] = json!(true);
    assert!(matches!(
        validate_replacement_material_frame(&raw(frame)),
        Err(ReplacementMaterialError::Malformed { path, .. }) if path == "frame"
    ));

    let payload = replacement_payload();
    let mut epoch_frame = replacement_frame({
        let mut body = replacement_body(payload);
        body["nextControl"] = replacement_control();
        body
    });
    epoch_frame["ctx"]["sessionEpoch"] = json!(2);
    assert!(matches!(
        validate_replacement_material_frame(&raw(epoch_frame)),
        Err(ReplacementMaterialError::OperationIdentityMismatch { .. })
    ));
}

#[test]
fn malformed_replacement_digest_and_identity_are_rejected() {
    let mut body = replacement_body(replacement_payload());
    for malformed_digest in ["RC1-12-01234567", "rc1-12-0123456", "rc1-x-01234567"] {
        body["material"]["digest"] = json!(malformed_digest);
        assert!(matches!(
            validate_replacement_material_body(&body),
            Err(ReplacementMaterialError::MalformedDigest { .. })
        ));
    }

    let mut body = replacement_body(replacement_payload());
    body["material"]["digest"] = json!("rc1-12-01234567");
    assert!(matches!(
        validate_replacement_material_body(&body),
        Err(ReplacementMaterialError::DigestMismatch { .. })
            | Err(ReplacementMaterialError::MalformedDigest { .. })
    ));
}
