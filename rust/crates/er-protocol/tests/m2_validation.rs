use er_protocol::{
    FrameValidator, InboundFrameResult, ValidatedFrameBody, frame_context_issues,
    frame_contexts_compatible, frame_contexts_equal, validate_inbound_frame,
};
use er_types::{FrameContext, FrameType, RawFrame};
use serde_json::{Value, json};

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

fn envelope(frame_type: &str, body: Value) -> Value {
    json!({
        "v": 2,
        "t": frame_type,
        "ctx": context_value(),
        "body": body
    })
}

fn raw(value: Value) -> RawFrame {
    RawFrame::JsonValue(value)
}

fn valid_material() -> Value {
    json!({"digest": "digest", "payload": null})
}

fn command_control() -> Value {
    json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": 1,
        "wave": 1,
        "turn": 1,
        "commands": [{"ownerSeatId": 0, "pokemonId": 1, "fieldIndex": 0}]
    })
}

fn terminal_control() -> Value {
    json!({"kind": "TERMINAL", "terminalId": "terminal"})
}

fn entry_body(kind: &str, next_control: Value) -> Value {
    json!({
        "revision": 1,
        "operationId": "operation",
        "kind": kind,
        "material": valid_material(),
        "nextControl": next_control,
        "subsumes": []
    })
}

fn receipt_body() -> Value {
    json!({
        "revision": 0,
        "operationId": "operation",
        "stage": "admitted"
    })
}

fn recovery_bundle_body() -> Value {
    json!({
        "requestId": "request",
        "material": valid_material(),
        "frontier": 0,
        "frontierOperationId": null,
        "membershipRevision": 2,
        "nextControl": null,
        "requiredTail": []
    })
}

fn expected_frame_type(frame_type: &str) -> FrameType {
    match frame_type {
        "authorityEntry" => FrameType::AuthorityEntry,
        "authorityReceipt" => FrameType::AuthorityReceipt,
        "tailRequest" => FrameType::TailRequest,
        "recoveryRequest" => FrameType::RecoveryRequest,
        "recoveryBundle" => FrameType::RecoveryBundle,
        "recoveryApplied" => FrameType::RecoveryApplied,
        "terminal" => FrameType::Terminal,
        _ => FrameType::Terminal,
    }
}

fn assert_violation(
    result: InboundFrameResult,
    frame_type: Option<&str>,
    expected_issues: &[&str],
) {
    assert!(
        matches!(&result, InboundFrameResult::ProtocolViolation { .. }),
        "expected protocol violation"
    );
    let InboundFrameResult::ProtocolViolation {
        frame_type: actual_frame_type,
        issues,
    } = result
    else {
        return;
    };
    assert_eq!(actual_frame_type.as_deref(), frame_type);
    let expected = expected_issues
        .iter()
        .map(|issue| (*issue).to_owned())
        .collect::<Vec<_>>();
    assert_eq!(issues, expected);
}

fn assert_cosmetic(result: InboundFrameResult, reason: &str) {
    assert!(
        matches!(&result, InboundFrameResult::CosmeticDrop { .. }),
        "expected cosmetic drop"
    );
    let InboundFrameResult::CosmeticDrop { reason: actual } = result else {
        return;
    };
    assert_eq!(actual, reason);
}

fn assert_valid(frame_type: &str, body: Value) {
    let original_body = body.clone();
    let result = validate_inbound_frame(&raw(envelope(frame_type, body)));
    assert!(
        matches!(&result, InboundFrameResult::Valid { .. }),
        "expected valid frame"
    );
    let InboundFrameResult::Valid { frame } = result else {
        return;
    };

    assert_eq!(frame.frame.version, 2);
    assert_eq!(frame.frame.frame_type, expected_frame_type(frame_type));
    assert_eq!(frame.frame.body, original_body);
    let typed_body_matches = matches!(
        (frame_type, frame.body),
        ("authorityEntry", ValidatedFrameBody::AuthorityEntry(_))
            | ("authorityReceipt", ValidatedFrameBody::AuthorityReceipt(_))
            | ("tailRequest", ValidatedFrameBody::TailRequest(_))
            | ("recoveryRequest", ValidatedFrameBody::RecoveryRequest(_))
            | ("recoveryBundle", ValidatedFrameBody::RecoveryBundle(_))
            | ("recoveryApplied", ValidatedFrameBody::RecoveryApplied(_))
            | ("terminal", ValidatedFrameBody::Terminal(_))
    );
    assert!(typed_body_matches, "typed body did not match frame tag");
}

#[test]
fn accepts_all_seven_known_frame_types_and_rehydrates_their_bodies() {
    let cases = [
        (
            "authorityEntry",
            entry_body("TURN_COMMIT", command_control()),
        ),
        ("authorityReceipt", receipt_body()),
        ("tailRequest", json!({"fromRevision": 0})),
        (
            "recoveryRequest",
            json!({"requestId": "request", "capturedFrontier": 0, "reason": "reconnect"}),
        ),
        ("recoveryBundle", recovery_bundle_body()),
        (
            "recoveryApplied",
            json!({"requestId": "request", "frontier": 0, "materialDigest": "digest"}),
        ),
        (
            "terminal",
            json!({"terminalId": "terminal", "reason": "protocol"}),
        ),
    ];

    for (frame_type, body) in cases {
        assert_valid(frame_type, body);
    }
}

#[test]
fn accepts_json_text_and_the_validator_instance_without_pretyped_envelope_deserialization() {
    let value = envelope("tailRequest", json!({"fromRevision": 0}));
    let serialized = serde_json::to_string(&value);
    assert!(serialized.is_ok(), "valid envelope should serialize");
    let Some(text) = serialized.ok() else {
        return;
    };
    let result = FrameValidator::new().validate(&RawFrame::JsonText(text));
    assert!(matches!(result, InboundFrameResult::Valid { .. }));
}

#[test]
fn raw_classification_precedence_is_malformed_non_object_version_tag_cosmetic_then_body() {
    assert_violation(
        validate_inbound_frame(&RawFrame::JsonText("{\"v\":2,\"t\":\"unknown\"".to_owned())),
        None,
        &["malformed JSON"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!([]))),
        None,
        &["frame is not a JSON object"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({"t": 17, "body": null}))),
        None,
        &["missing protocol version `v`"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({"v": 1, "t": null}))),
        None,
        &["unsupported frame protocol version: 1"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({"v": 2, "body": null}))),
        None,
        &["frame type `t` is missing or not a string"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({"v": 2, "t": {}}))),
        None,
        &["frame type `t` is missing or not a string"],
    );
    assert_cosmetic(
        validate_inbound_frame(&raw(json!({
            "v": 2,
            "t": "futureCosmetic",
            "ctx": null,
            "body": {"malformed": true}
        }))),
        "unknown cosmetic frame type: futureCosmetic",
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({
            "v": 2,
            "t": "tailRequest",
            "ctx": {},
            "body": null
        }))),
        Some("tailRequest"),
        &[
            "ctx.sessionId",
            "ctx.runId",
            "ctx.sessionEpoch",
            "ctx.seatMapId",
            "ctx.membershipRevision",
            "ctx.senderSeatId",
            "ctx.authoritySeatId",
            "ctx.connectionGeneration",
            "body.not an object",
        ],
    );
}

#[test]
fn unsupported_version_descriptions_preserve_the_raw_value_classification() {
    assert_violation(
        validate_inbound_frame(&raw(json!({"v": "2", "t": "terminal"}))),
        None,
        &["unsupported frame protocol version: 2"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({"v": null, "t": "terminal"}))),
        None,
        &["unsupported frame protocol version: null"],
    );
    assert_violation(
        validate_inbound_frame(&raw(json!({"v": [], "t": "terminal"}))),
        None,
        &["unsupported frame protocol version: object"],
    );
}

#[test]
fn frame_context_reports_all_eight_fields_in_wire_order() {
    let mut context = context_value();
    if let Some(context) = context.as_object_mut() {
        context.clear();
    }
    assert_eq!(
        frame_context_issues(&context),
        [
            "sessionId",
            "runId",
            "sessionEpoch",
            "seatMapId",
            "membershipRevision",
            "senderSeatId",
            "authoritySeatId",
            "connectionGeneration"
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>()
    );
    assert_eq!(
        frame_context_issues(&Value::Null),
        vec!["frame context is not an object".to_owned()]
    );

    for field in [
        "sessionId",
        "runId",
        "sessionEpoch",
        "seatMapId",
        "membershipRevision",
        "senderSeatId",
        "authoritySeatId",
        "connectionGeneration",
    ] {
        let mut candidate = context_value();
        if let Some(candidate) = candidate.as_object_mut() {
            candidate.insert(field.to_owned(), Value::Null);
        }
        assert_eq!(frame_context_issues(&candidate), vec![field.to_owned()]);
    }
}

#[test]
fn authority_entry_body_reports_layered_issue_order_and_kind_compatibility() {
    let invalid = json!({
        "revision": 0,
        "operationId": "",
        "kind": "UNKNOWN",
        "material": {},
        "nextControl": null,
        "subsumes": [0]
    });
    assert_violation(
        validate_inbound_frame(&raw(envelope("authorityEntry", invalid))),
        Some("authorityEntry"),
        &[
            "body.revision",
            "body.operationId",
            "body.kind",
            "body.material.digest",
            "body.material.payload",
            "body.nextControl: required",
            "body.subsumes",
        ],
    );

    assert_violation(
        validate_inbound_frame(&raw(envelope(
            "authorityEntry",
            entry_body("TERMINAL_COMMIT", command_control()),
        ))),
        Some("authorityEntry"),
        &["body.nextControl: incompatible with entry kind"],
    );
    assert_violation(
        validate_inbound_frame(&raw(envelope(
            "authorityEntry",
            entry_body("TURN_COMMIT", terminal_control()),
        ))),
        Some("authorityEntry"),
        &["body.nextControl: incompatible with entry kind"],
    );
}

#[test]
fn every_known_body_has_a_total_shape_error_without_throwing() {
    let cases = [
        (
            "authorityReceipt",
            json!({"revision": -1, "operationId": "", "stage": "bad", "controlId": null}),
            vec![
                "body.revision",
                "body.operationId",
                "body.stage",
                "body.controlId",
            ],
        ),
        (
            "tailRequest",
            json!({"fromRevision": -1}),
            vec!["body.fromRevision"],
        ),
        (
            "recoveryRequest",
            json!({"requestId": "", "capturedFrontier": -1, "reason": ""}),
            vec!["body.requestId", "body.capturedFrontier", "body.reason"],
        ),
        (
            "recoveryApplied",
            json!({"requestId": "", "frontier": -1, "materialDigest": "", "controlId": null}),
            vec![
                "body.requestId",
                "body.frontier",
                "body.materialDigest",
                "body.controlId",
            ],
        ),
        (
            "terminal",
            json!({"terminalId": "", "reason": ""}),
            vec!["body.terminalId", "body.reason"],
        ),
    ];

    for (frame_type, body, expected_issues) in cases {
        let result = validate_inbound_frame(&raw(envelope(frame_type, body)));
        assert_violation(result, Some(frame_type), &expected_issues);
    }
}

#[test]
fn receipt_and_recovery_applied_control_ids_are_omission_only() {
    assert_valid("authorityReceipt", receipt_body());
    assert_valid(
        "recoveryApplied",
        json!({"requestId": "request", "frontier": 0, "materialDigest": "digest"}),
    );

    let mut receipt = receipt_body();
    if let Some(receipt) = receipt.as_object_mut() {
        receipt.insert("controlId".to_owned(), Value::Null);
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("authorityReceipt", receipt))),
        Some("authorityReceipt"),
        &["body.controlId"],
    );

    let applied = json!({
        "requestId": "request",
        "frontier": 0,
        "materialDigest": "digest",
        "controlId": null
    });
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryApplied", applied))),
        Some("recoveryApplied"),
        &["body.controlId"],
    );
}

#[test]
fn recovery_bundle_enforces_required_nullable_fields_and_frontier_rules() {
    assert_valid("recoveryBundle", recovery_bundle_body());

    let mut missing_frontier_operation = recovery_bundle_body();
    if let Some(body) = missing_frontier_operation.as_object_mut() {
        body.remove("frontierOperationId");
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", missing_frontier_operation))),
        Some("recoveryBundle"),
        &["body.frontierOperationId"],
    );

    let mut missing_next_control = recovery_bundle_body();
    if let Some(body) = missing_next_control.as_object_mut() {
        body.remove("nextControl");
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", missing_next_control))),
        Some("recoveryBundle"),
        &["body.nextControl: must be null at frontier zero"],
    );

    let mut non_null_zero_operation = recovery_bundle_body();
    if let Some(body) = non_null_zero_operation.as_object_mut() {
        body.insert("frontierOperationId".to_owned(), json!("operation"));
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", non_null_zero_operation))),
        Some("recoveryBundle"),
        &["body.frontierOperationId"],
    );

    let mut positive_null_control = recovery_bundle_body();
    if let Some(body) = positive_null_control.as_object_mut() {
        body.insert("frontier".to_owned(), json!(1));
        body.insert("frontierOperationId".to_owned(), json!("operation"));
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", positive_null_control))),
        Some("recoveryBundle"),
        &["body.nextControl: required"],
    );

    let mut positive_missing_control = recovery_bundle_body();
    if let Some(body) = positive_missing_control.as_object_mut() {
        body.insert("frontier".to_owned(), json!(1));
        body.insert("frontierOperationId".to_owned(), json!("operation"));
        body.remove("nextControl");
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", positive_missing_control))),
        Some("recoveryBundle"),
        &["body.nextControl.not an object"],
    );
}

#[test]
fn required_nullable_nested_control_fields_distinguish_null_from_omission() {
    let shared = json!({
        "kind": "SHARED_INTERACTION",
        "operationId": "operation",
        "ownerSeatId": 0,
        "epoch": 1,
        "wave": 0,
        "turn": 0,
        "surfaceClass": "op:me",
        "operationKind": "ME_BUTTON",
        "successor": {"operationKinds": ["ME_BUTTON"], "operationIds": null}
    });
    assert_valid(
        "authorityEntry",
        entry_body("INTERACTION_COMMIT", shared.clone()),
    );

    let mut missing_operation_ids = shared;
    if let Some(successor) = missing_operation_ids
        .as_object_mut()
        .and_then(|control| control.get_mut("successor"))
        .and_then(Value::as_object_mut)
    {
        successor.remove("operationIds");
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope(
            "authorityEntry",
            entry_body("INTERACTION_COMMIT", missing_operation_ids),
        ))),
        Some("authorityEntry"),
        &["body.nextControl.successor.operationIds"],
    );

    let await_control = json!({
        "kind": "AWAIT_SUCCESSOR",
        "afterOperationId": "operation",
        "epoch": 1,
        "wave": 0,
        "turn": 0,
        "allowedKinds": ["INTERACTION_COMMIT"],
        "allowNextWaveStart": false,
        "expectedOperationId": null
    });
    assert_valid(
        "authorityEntry",
        entry_body("CONTROL_COMMIT", await_control.clone()),
    );

    let mut missing_expected_operation = await_control;
    if let Some(control) = missing_expected_operation.as_object_mut() {
        control.remove("expectedOperationId");
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope(
            "authorityEntry",
            entry_body("CONTROL_COMMIT", missing_expected_operation),
        ))),
        Some("authorityEntry"),
        &["body.nextControl.expectedOperationId"],
    );

    let explicit_null_optional_addresses = json!({
        "kind": "AWAIT_SUCCESSOR",
        "afterOperationId": "operation",
        "epoch": 1,
        "wave": 0,
        "turn": 0,
        "allowedKinds": ["INTERACTION_COMMIT"],
        "allowNextWaveStart": false,
        "expectedOperationId": null,
        "allowedInteractionAddresses": null
    });
    assert_violation(
        validate_inbound_frame(&raw(envelope(
            "authorityEntry",
            entry_body("CONTROL_COMMIT", explicit_null_optional_addresses),
        ))),
        Some("authorityEntry"),
        &["body.nextControl.allowedInteractionAddresses"],
    );
}

#[test]
fn unknown_properties_and_null_material_payload_remain_lossless() {
    let mut body = entry_body("TURN_COMMIT", command_control());
    if let Some(body) = body.as_object_mut() {
        body.insert(
            "futureBodyField".to_owned(),
            json!({"opaque": [null, true]}),
        );
        if let Some(material) = body.get_mut("material").and_then(Value::as_object_mut) {
            material.insert("futureMaterialField".to_owned(), json!(42));
        }
    }
    let original = body.clone();
    let result = validate_inbound_frame(&raw(envelope("authorityEntry", body)));
    assert!(
        matches!(&result, InboundFrameResult::Valid { .. }),
        "opaque fields should be accepted"
    );
    let InboundFrameResult::Valid { frame } = result else {
        return;
    };
    assert_eq!(frame.frame.body, original);
}

#[test]
fn context_equality_covers_all_fields_while_compatibility_ignores_peer_connection_fields() {
    let left_result = serde_json::from_value::<FrameContext>(context_value());
    assert!(left_result.is_ok(), "fixture context should deserialize");
    let Some(left) = left_result.ok() else {
        return;
    };
    let mut peer_context_value = context_value();
    if let Some(context) = peer_context_value.as_object_mut() {
        context.insert("senderSeatId".to_owned(), json!(0));
        context.insert("connectionGeneration".to_owned(), json!(4));
    }
    let peer_result = serde_json::from_value::<FrameContext>(peer_context_value);
    assert!(peer_result.is_ok(), "peer context should deserialize");
    let Some(peer) = peer_result.ok() else {
        return;
    };
    assert!(!frame_contexts_equal(&left, &peer));
    assert!(frame_contexts_compatible(&left, &peer));

    let mut other_session_value = context_value();
    if let Some(context) = other_session_value.as_object_mut() {
        context.insert("sessionId".to_owned(), json!("other-session"));
    }
    let other_session_result = serde_json::from_value::<FrameContext>(other_session_value);
    assert!(
        other_session_result.is_ok(),
        "other context should deserialize"
    );
    let Some(other_session) = other_session_result.ok() else {
        return;
    };
    assert!(!frame_contexts_compatible(&left, &other_session));
}
