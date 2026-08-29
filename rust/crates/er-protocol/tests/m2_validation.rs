#![allow(clippy::panic)]
// Explicit variant-mismatch panics are test assertions, never production paths.

use er_protocol::{
    FrameValidator, InboundFrameResult, ValidatedFrame, ValidatedFrameBody, frame_context_issues,
    frame_contexts_compatible, frame_contexts_equal, validate_inbound_frame,
};
use er_types::{
    AckStage, AuthorityEntryKind, FrameContext, FrameType, NextControl, RawFrame, TailProofPhase,
};
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

fn context_text() -> &'static str {
    r#"{"sessionId":"session","runId":"run","sessionEpoch":1,"seatMapId":"seat-map","membershipRevision":2,"senderSeatId":1,"authoritySeatId":0,"connectionGeneration":3}"#
}

fn text_envelope(frame_type: &str, context: &str, body: &str) -> RawFrame {
    RawFrame::JsonText(format!(
        r#"{{"v":2,"t":"{frame_type}","ctx":{context},"body":{body}}}"#
    ))
}

fn entry_body_text_with_payload(payload: &str) -> String {
    r#"{"revision":1,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":$PAYLOAD},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1,"wave":1,"turn":1,"commands":[{"ownerSeatId":0,"pokemonId":1,"fieldIndex":0}]},"subsumes":[]}"#
        .replacen("$PAYLOAD", payload, 1)
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
        "tailProof" => FrameType::TailProof,
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
    let (actual_frame_type, issues) = match result {
        InboundFrameResult::ProtocolViolation {
            frame_type: actual_frame_type,
            issues,
        } => (actual_frame_type, issues),
        other => panic!("expected protocol violation, got {other:?}"),
    };
    assert_eq!(actual_frame_type.as_deref(), frame_type);
    let expected = expected_issues
        .iter()
        .map(|issue| (*issue).to_owned())
        .collect::<Vec<_>>();
    assert_eq!(issues, expected);
}

fn assert_cosmetic(result: InboundFrameResult, reason: &str) {
    let actual = match result {
        InboundFrameResult::CosmeticDrop { reason: actual } => actual,
        other => panic!("expected cosmetic drop, got {other:?}"),
    };
    assert_eq!(actual, reason);
}

fn valid_frame(raw_frame: RawFrame, frame_type: &str) -> Box<ValidatedFrame> {
    let frame = match validate_inbound_frame(&raw_frame) {
        InboundFrameResult::Valid { frame } => frame,
        other => panic!("expected valid {frame_type} frame, got {other:?}"),
    };
    assert_eq!(frame.frame.frame_type, expected_frame_type(frame_type));
    frame
}

fn assert_context_values(context: &FrameContext) {
    assert_eq!(context.session_id.as_str(), "session");
    assert_eq!(context.run_id.as_str(), "run");
    assert_eq!(context.session_epoch.get(), 1);
    assert_eq!(context.seat_map_id, "seat-map");
    assert_eq!(context.membership_revision.get().get(), 2);
    assert_eq!(context.sender_seat_id.get().get(), 1);
    assert_eq!(context.authority_seat_id.get().get(), 0);
    assert_eq!(context.connection_generation.get().get(), 3);
}

fn assert_typed_body_values(frame_type: &str, body: &ValidatedFrameBody) {
    match frame_type {
        "authorityEntry" => {
            let ValidatedFrameBody::AuthorityEntry(body) = body else {
                panic!("authorityEntry did not reconstruct its concrete body");
            };
            assert_eq!(body.revision.get().get(), 1);
            assert_eq!(body.operation_id.as_str(), "operation");
            assert_eq!(body.material.digest, "digest");
            assert_eq!(body.material.payload, Value::Null);
            match body.kind {
                AuthorityEntryKind::TurnCommit => {
                    let NextControl::CommandFrontier(control) = &body.next_control else {
                        panic!("TURN_COMMIT did not reconstruct COMMAND_FRONTIER");
                    };
                    assert_eq!(control.epoch.get(), 1);
                    assert_eq!(control.wave.get(), 1);
                    assert_eq!(control.turn.get(), 1);
                    let command = control
                        .commands
                        .first()
                        .expect("fixture command must reconstruct");
                    assert_eq!(command.owner_seat_id.get().get(), 0);
                    assert_eq!(command.pokemon_id.get(), 1);
                    assert_eq!(command.field_index.get(), 0);
                }
                AuthorityEntryKind::InteractionCommit => {
                    let NextControl::SharedInteraction(control) = &body.next_control else {
                        panic!("INTERACTION_COMMIT did not reconstruct SHARED_INTERACTION");
                    };
                    assert_eq!(control.operation_id.as_str(), "operation");
                    assert_eq!(control.owner_seat_id.get().get(), 0);
                    assert_eq!(control.epoch.get(), 1);
                    assert_eq!(control.wave.get(), 0);
                    assert_eq!(control.turn.get(), 0);
                    assert_eq!(control.surface_class, "op:me");
                    assert_eq!(control.operation_kind, "ME_BUTTON");
                    assert_eq!(
                        control.successor.operation_kinds,
                        vec!["ME_BUTTON".to_owned()]
                    );
                    assert_eq!(control.successor.operation_ids, None);
                }
                AuthorityEntryKind::ControlCommit => {
                    let NextControl::AwaitSuccessor(control) = &body.next_control else {
                        panic!("CONTROL_COMMIT did not reconstruct AWAIT_SUCCESSOR");
                    };
                    assert_eq!(control.after_operation_id.as_str(), "operation");
                    assert_eq!(control.epoch.get(), 1);
                    assert_eq!(control.wave.get(), 0);
                    assert_eq!(control.turn.get(), 0);
                    assert_eq!(
                        control.allowed_kinds,
                        vec![AuthorityEntryKind::InteractionCommit]
                    );
                    assert_eq!(control.allowed_interaction_addresses, None);
                    assert_eq!(control.allowed_control_addresses, None);
                    assert!(!control.allow_next_wave_start);
                    assert_eq!(control.expected_operation_id, None);
                }
                other => panic!("unexpected valid authority-entry fixture kind {other:?}"),
            }
            assert!(body.subsumes.is_empty());
        }
        "authorityReceipt" => {
            let ValidatedFrameBody::AuthorityReceipt(body) = body else {
                panic!("authorityReceipt did not reconstruct its concrete body");
            };
            assert_eq!(body.revision.get().get(), 0);
            assert_eq!(body.operation_id.as_str(), "operation");
            assert_eq!(body.stage, AckStage::Admitted);
            assert_eq!(body.control_id, None);
        }
        "tailRequest" => {
            let ValidatedFrameBody::TailRequest(body) = body else {
                panic!("tailRequest did not reconstruct its concrete body");
            };
            assert_eq!(body.from_revision.get().get(), 0);
            if let (Some(request_id), Some(candidate_revision), Some(candidate_operation_id)) = (
                body.request_id.as_ref(),
                body.candidate_revision,
                body.candidate_operation_id.as_ref(),
            ) {
                assert_eq!(request_id.as_str(), "request");
                assert_eq!(candidate_revision.get().get(), 2);
                assert_eq!(candidate_operation_id.as_str(), "candidate");
            } else {
                assert!(body.request_id.is_none());
                assert!(body.candidate_revision.is_none());
                assert!(body.candidate_operation_id.is_none());
            }
        }
        "tailProof" => {
            let ValidatedFrameBody::TailProof(body) = body else {
                panic!("tailProof did not reconstruct its concrete body");
            };
            assert_eq!(body.phase, TailProofPhase::Manifest);
            assert_eq!(body.request_id.as_str(), "request");
            assert_eq!(body.from_revision.get().get(), 0);
            assert_eq!(body.candidate_revision.get().get(), 2);
            assert_eq!(body.candidate_operation_id.as_str(), "candidate");
            assert_eq!(body.head_revision.get().get(), 2);
            assert_eq!(
                body.source_revisions
                    .iter()
                    .map(|value| value.get().get())
                    .collect::<Vec<_>>(),
                vec![1]
            );
        }
        "recoveryRequest" => {
            let ValidatedFrameBody::RecoveryRequest(body) = body else {
                panic!("recoveryRequest did not reconstruct its concrete body");
            };
            assert_eq!(body.request_id, "request");
            assert_eq!(body.captured_frontier.get().get(), 0);
            assert_eq!(body.reason, "reconnect");
        }
        "recoveryBundle" => {
            let ValidatedFrameBody::RecoveryBundle(body) = body else {
                panic!("recoveryBundle did not reconstruct its concrete body");
            };
            assert_eq!(body.request_id, "request");
            assert_eq!(body.material.digest, "digest");
            assert_eq!(body.material.payload, Value::Null);
            assert_eq!(body.frontier.get().get(), 0);
            assert_eq!(body.frontier_operation_id, None);
            assert_eq!(body.membership_revision.get().get(), 2);
            assert_eq!(body.next_control, None);
            assert!(body.required_tail.is_empty());
        }
        "recoveryApplied" => {
            let ValidatedFrameBody::RecoveryApplied(body) = body else {
                panic!("recoveryApplied did not reconstruct its concrete body");
            };
            assert_eq!(body.request_id, "request");
            assert_eq!(body.frontier.get().get(), 0);
            assert_eq!(body.material_digest, "digest");
            assert_eq!(body.control_id, None);
        }
        "terminal" => {
            let ValidatedFrameBody::Terminal(body) = body else {
                panic!("terminal did not reconstruct its concrete body");
            };
            assert_eq!(body.terminal_id, "terminal");
            assert_eq!(body.reason, "protocol");
        }
        other => panic!("unknown fixture frame type {other}"),
    }
}

fn assert_valid(frame_type: &str, body: Value) {
    let original_body = body.clone();
    let frame = valid_frame(raw(envelope(frame_type, body)), frame_type);

    assert_eq!(frame.frame.version, 2);
    assert_eq!(frame.frame.body, original_body);
    assert_context_values(&frame.frame.context);
    assert_typed_body_values(frame_type, &frame.body);
}

fn assert_valid_text(frame_type: &str, context: &str, body: &str) -> Box<ValidatedFrame> {
    let frame = valid_frame(text_envelope(frame_type, context, body), frame_type);
    assert_eq!(frame.frame.version, 2);
    frame
}

#[test]
fn accepts_all_eight_known_frame_types_and_rehydrates_their_bodies() {
    let cases = [
        (
            "authorityEntry",
            entry_body("TURN_COMMIT", command_control()),
        ),
        ("authorityReceipt", receipt_body()),
        (
            "tailRequest",
            json!({
                "fromRevision": 0,
                "requestId": "request",
                "candidateRevision": 2,
                "candidateOperationId": "candidate"
            }),
        ),
        (
            "tailProof",
            json!({
                "phase": "manifest",
                "requestId": "request",
                "fromRevision": 0,
                "candidateRevision": 2,
                "candidateOperationId": "candidate",
                "headRevision": 2,
                "sourceRevisions": [1]
            }),
        ),
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
    let text = serde_json::to_string(&value).expect("valid envelope should serialize");
    let frame = match FrameValidator::new().validate(&RawFrame::JsonText(text)) {
        InboundFrameResult::Valid { frame } => frame,
        other => panic!("validator instance should accept serialized frame, got {other:?}"),
    };
    let ValidatedFrameBody::TailRequest(body) = &frame.body else {
        panic!("serialized frame should reconstruct a tail request");
    };
    assert_eq!(body.from_revision.get().get(), 0);
}

#[test]
fn accepts_js_integral_float_exponent_and_negative_zero_boundary_fields() {
    let context = r#"{"sessionId":"session","runId":"run","sessionEpoch":1.0,"seatMapId":"seat-map","membershipRevision":1e0,"senderSeatId":-0.0,"authoritySeatId":1.0,"connectionGeneration":1e0}"#;

    let authority = assert_valid_text(
        "authorityEntry",
        context,
        r#"{"revision":1.0,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1e0,"wave":1.0,"turn":1e0,"commands":[{"ownerSeatId":-0.0,"pokemonId":1.0,"fieldIndex":1e0}]},"subsumes":[1e0]}"#,
    );
    assert_eq!(authority.frame.context.session_epoch.get(), 1);
    assert_eq!(authority.frame.context.membership_revision.get().get(), 1);
    assert_eq!(authority.frame.context.sender_seat_id.get().get(), 0);
    assert_eq!(authority.frame.context.authority_seat_id.get().get(), 1);
    assert_eq!(authority.frame.context.connection_generation.get().get(), 1);
    let ValidatedFrameBody::AuthorityEntry(authority_body) = &authority.body else {
        panic!("float-form authority entry did not reconstruct");
    };
    assert_eq!(authority_body.revision.get().get(), 1);
    let NextControl::CommandFrontier(control) = &authority_body.next_control else {
        panic!("float-form command frontier did not reconstruct");
    };
    assert_eq!(control.epoch.get(), 1);
    assert_eq!(control.wave.get(), 1);
    assert_eq!(control.turn.get(), 1);
    let command = control
        .commands
        .first()
        .expect("float-form command must reconstruct");
    assert_eq!(command.owner_seat_id.get().get(), 0);
    assert_eq!(command.pokemon_id.get(), 1);
    assert_eq!(command.field_index.get(), 1);
    assert_eq!(authority_body.subsumes[0].get().get(), 1);

    let receipt = assert_valid_text(
        "authorityReceipt",
        context,
        r#"{"revision":-0.0,"operationId":"operation","stage":"admitted"}"#,
    );
    let ValidatedFrameBody::AuthorityReceipt(receipt_body) = &receipt.body else {
        panic!("negative-zero receipt did not reconstruct");
    };
    assert_eq!(receipt_body.revision.get().get(), 0);

    let tail = assert_valid_text("tailRequest", context, r#"{"fromRevision":1e0}"#);
    let ValidatedFrameBody::TailRequest(tail_body) = &tail.body else {
        panic!("exponent-form tail request did not reconstruct");
    };
    assert_eq!(tail_body.from_revision.get().get(), 1);

    let request = assert_valid_text(
        "recoveryRequest",
        context,
        r#"{"requestId":"request","capturedFrontier":-0.0,"reason":"reconnect"}"#,
    );
    let ValidatedFrameBody::RecoveryRequest(request_body) = &request.body else {
        panic!("negative-zero recovery request did not reconstruct");
    };
    assert_eq!(request_body.captured_frontier.get().get(), 0);

    let bundle = assert_valid_text(
        "recoveryBundle",
        context,
        r#"{"requestId":"request","material":{"digest":"digest","payload":null},"frontier":-0.0,"frontierOperationId":null,"membershipRevision":1.0,"nextControl":null,"requiredTail":[]}"#,
    );
    let ValidatedFrameBody::RecoveryBundle(bundle_body) = &bundle.body else {
        panic!("negative-zero recovery bundle did not reconstruct");
    };
    assert_eq!(bundle_body.frontier.get().get(), 0);
    assert_eq!(bundle_body.membership_revision.get().get(), 1);

    let applied = assert_valid_text(
        "recoveryApplied",
        context,
        r#"{"requestId":"request","frontier":1.0,"materialDigest":"digest"}"#,
    );
    let ValidatedFrameBody::RecoveryApplied(applied_body) = &applied.body else {
        panic!("float-form recovery proof did not reconstruct");
    };
    assert_eq!(applied_body.frontier.get().get(), 1);
}

#[test]
fn accepts_integral_float_forms_in_every_next_control_numeric_field() {
    let replacement = assert_valid_text(
        "authorityEntry",
        context_text(),
        r#"{"revision":1.0,"operationId":"operation","kind":"REPLACEMENT_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"REPLACEMENT","operationId":"operation","ownerSeatId":-0.0,"epoch":1.0,"wave":1e0,"turn":1.0,"occurrence":-0.0,"fieldIndex":1e0,"remaining":[{"operationId":"remaining","ownerSeatId":1e0,"epoch":1.0,"wave":1e0,"turn":1.0,"occurrence":1e0,"fieldIndex":1.0}]},"subsumes":[1e0]}"#,
    );
    let ValidatedFrameBody::AuthorityEntry(replacement_body) = &replacement.body else {
        panic!("float-form replacement entry did not reconstruct");
    };
    assert_eq!(replacement_body.kind, AuthorityEntryKind::ReplacementCommit);
    let NextControl::Replacement(control) = &replacement_body.next_control else {
        panic!("float-form replacement control did not reconstruct");
    };
    assert_eq!(control.operation_id.as_str(), "operation");
    assert_eq!(control.owner_seat_id.get().get(), 0);
    assert_eq!(control.epoch.get(), 1);
    assert_eq!(control.wave.get(), 1);
    assert_eq!(control.turn.get(), 1);
    assert_eq!(control.occurrence.get(), 0);
    assert_eq!(control.field_index.get(), 1);
    let remaining = control
        .remaining
        .first()
        .expect("float-form replacement tail must reconstruct");
    assert_eq!(remaining.owner_seat_id.get().get(), 1);
    assert_eq!(remaining.epoch.get(), 1);
    assert_eq!(remaining.wave.get(), 1);
    assert_eq!(remaining.turn.get(), 1);
    assert_eq!(remaining.occurrence.get(), 1);
    assert_eq!(remaining.field_index.get(), 1);

    let shared = assert_valid_text(
        "authorityEntry",
        context_text(),
        r#"{"revision":1e0,"operationId":"operation","kind":"INTERACTION_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"SHARED_INTERACTION","operationId":"operation","ownerSeatId":-0.0,"epoch":1.0,"wave":-0.0,"turn":1e0,"surfaceClass":"op:me","operationKind":"ME_BUTTON","successor":{"operationKinds":["ME_BUTTON"],"operationIds":null}},"subsumes":[1.0]}"#,
    );
    let ValidatedFrameBody::AuthorityEntry(shared_body) = &shared.body else {
        panic!("float-form shared entry did not reconstruct");
    };
    assert_eq!(shared_body.kind, AuthorityEntryKind::InteractionCommit);
    let NextControl::SharedInteraction(control) = &shared_body.next_control else {
        panic!("float-form shared control did not reconstruct");
    };
    assert_eq!(control.owner_seat_id.get().get(), 0);
    assert_eq!(control.epoch.get(), 1);
    assert_eq!(control.wave.get(), 0);
    assert_eq!(control.turn.get(), 1);

    let await_successor = assert_valid_text(
        "authorityEntry",
        context_text(),
        r#"{"revision":1.0,"operationId":"operation","kind":"CONTROL_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"AWAIT_SUCCESSOR","afterOperationId":"operation","epoch":1e0,"wave":-0.0,"turn":1.0,"allowedKinds":["INTERACTION_COMMIT","CONTROL_COMMIT"],"allowedInteractionAddresses":[{"surfaceClass":"op:me","operationKind":"ME_BUTTON","wave":-0.0,"turn":1.0}],"allowedControlAddresses":[{"materialKind":"command-open","wave":-0.0,"turn":1.0,"operationId":null}],"allowNextWaveStart":false,"expectedOperationId":null},"subsumes":[1e0]}"#,
    );
    let ValidatedFrameBody::AuthorityEntry(await_body) = &await_successor.body else {
        panic!("float-form await entry did not reconstruct");
    };
    assert_eq!(await_body.kind, AuthorityEntryKind::ControlCommit);
    let NextControl::AwaitSuccessor(control) = &await_body.next_control else {
        panic!("float-form await control did not reconstruct");
    };
    assert_eq!(control.epoch.get(), 1);
    assert_eq!(control.wave.get(), 0);
    assert_eq!(control.turn.get(), 1);
    let interaction_address = control
        .allowed_interaction_addresses
        .as_ref()
        .expect("interaction addresses must reconstruct")
        .first()
        .expect("interaction address must reconstruct");
    assert_eq!(interaction_address.wave.get(), 0);
    assert_eq!(interaction_address.turn.get(), 1);
    let control_address = control
        .allowed_control_addresses
        .as_ref()
        .expect("control addresses must reconstruct")
        .first()
        .expect("control address must reconstruct");
    assert_eq!(control_address.wave.get(), 0);
    assert_eq!(control_address.turn.get(), 1);
}

#[test]
fn accepts_and_rejects_the_exact_javascript_safe_integer_boundaries() {
    let max = 9_007_199_254_740_991_u64;
    let max_context = format!(
        r#"{{"sessionId":"session","runId":"run","sessionEpoch":{max},"seatMapId":"seat-map","membershipRevision":{max},"senderSeatId":{max},"authoritySeatId":{max},"connectionGeneration":{max}}}"#
    );
    let max_authority_body = format!(
        r#"{{"revision":{max},"operationId":"operation","kind":"TURN_COMMIT","material":{{"digest":"digest","payload":null}},"nextControl":{{"kind":"COMMAND_FRONTIER","epoch":{max},"wave":{max},"turn":{max},"commands":[{{"ownerSeatId":{max},"pokemonId":{max},"fieldIndex":{max}}}]}},"subsumes":[{max}]}}"#
    );
    let authority = assert_valid_text("authorityEntry", &max_context, &max_authority_body);
    assert_eq!(authority.frame.context.session_epoch.get(), max);
    assert_eq!(authority.frame.context.membership_revision.get().get(), max);
    let ValidatedFrameBody::AuthorityEntry(authority_body) = &authority.body else {
        panic!("maximum-bound authority entry did not reconstruct");
    };
    assert_eq!(authority_body.revision.get().get(), max);
    let NextControl::CommandFrontier(control) = &authority_body.next_control else {
        panic!("maximum-bound command frontier did not reconstruct");
    };
    assert_eq!(control.epoch.get(), max);
    assert_eq!(control.wave.get(), max);
    assert_eq!(control.turn.get(), max);
    let command = control
        .commands
        .first()
        .expect("maximum-bound command must reconstruct");
    assert_eq!(command.owner_seat_id.get().get(), max);
    assert_eq!(command.pokemon_id.get(), max);
    assert_eq!(command.field_index.get(), max);
    assert_eq!(authority_body.subsumes[0].get().get(), max);

    let max_tail = assert_valid_text(
        "tailRequest",
        &max_context,
        &format!(r#"{{"fromRevision":{max}}}"#),
    );
    let ValidatedFrameBody::TailRequest(max_tail_body) = &max_tail.body else {
        panic!("maximum-bound tail request did not reconstruct");
    };
    assert_eq!(max_tail_body.from_revision.get().get(), max);

    let over_context = format!(
        r#"{{"sessionId":"session","runId":"run","sessionEpoch":9007199254740992.0,"seatMapId":"seat-map","membershipRevision":{max},"senderSeatId":{max},"authoritySeatId":{max},"connectionGeneration":{max}}}"#
    );
    assert_violation(
        validate_inbound_frame(&text_envelope(
            "tailRequest",
            &over_context,
            r#"{"fromRevision":0}"#,
        )),
        Some("tailRequest"),
        &["ctx.sessionEpoch"],
    );
    assert_violation(
        validate_inbound_frame(&text_envelope(
            "tailRequest",
            &max_context,
            r#"{"fromRevision":9007199254740992.0}"#,
        )),
        Some("tailRequest"),
        &["body.fromRevision"],
    );
}

#[test]
fn escaped_strings_and_keys_are_decoded_without_number_scanner_collisions() {
    let frame = assert_valid_text(
        "terminal",
        r#"{"sessionId":"sess\u0069on","runId":"r\u0075n","sessionEpoch":1e0,"seatMapId":"seat-\u006dap","membershipRevision":2,"senderSeatId":1,"authoritySeatId":0,"connectionGeneration":3}"#,
        r#"{"terminalId":"term\u0069nal","reason":"proto\u0063ol","\u0066utureKey":"1e400"}"#,
    );
    assert_eq!(frame.frame.context.session_id.as_str(), "session");
    assert_eq!(frame.frame.context.run_id.as_str(), "run");
    let ValidatedFrameBody::Terminal(body) = &frame.body else {
        panic!("escaped terminal did not reconstruct");
    };
    assert_eq!(body.terminal_id, "terminal");
    assert_eq!(body.reason, "protocol");
    let body_value = frame
        .frame
        .body
        .as_object()
        .expect("terminal body must remain an object");
    assert_eq!(
        body_value.get("futureKey").and_then(Value::as_str),
        Some("1e400")
    );
}

#[test]
fn duplicate_keys_use_json_parse_last_value_semantics() {
    let context = context_text();
    let valid = format!(
        r#"{{"v":1e400,"v":2,"t":"tailRequest","ctx":{context},"body":{{"fromRevision":1e400,"fromRevision":0}}}}"#
    );
    let frame = valid_frame(RawFrame::JsonText(valid), "tailRequest");
    let ValidatedFrameBody::TailRequest(body) = &frame.body else {
        panic!("duplicate-key tail request did not reconstruct");
    };
    assert_eq!(body.from_revision.get().get(), 0);

    let invalid = format!(
        r#"{{"v":2,"t":"tailRequest","ctx":{context},"body":{{"fromRevision":0,"fromRevision":1e400}}}}"#
    );
    assert_violation(
        validate_inbound_frame(&RawFrame::JsonText(invalid)),
        Some("tailRequest"),
        &["body.fromRevision"],
    );

    let invalid_version = r#"{"v":2,"v":1e400,"t":"tailRequest"}"#.to_owned();
    assert_violation(
        validate_inbound_frame(&RawFrame::JsonText(invalid_version)),
        None,
        &["unsupported frame protocol version: Infinity"],
    );
}

#[test]
fn whitespace_and_numeric_boundaries_are_scanned_without_touching_strings() {
    let text = format!(
        r#"
        {{ "v" : 2, "t" : "tailRequest", "ctx" : {context},
           "body" : {{ "fromRevision" : -0.0,
             "futureArray" : [ 1e400, -1E400, 1e+400 ],
             "futureObject" : {{ "value" : 1e400 }},
             "futureString" : "1e400"
           }} }}
        "#,
        context = context_text()
    );
    let frame = valid_frame(RawFrame::JsonText(text), "tailRequest");
    let ValidatedFrameBody::TailRequest(body) = &frame.body else {
        panic!("whitespace tail request did not reconstruct");
    };
    assert_eq!(body.from_revision.get().get(), 0);
    let body_value = frame
        .frame
        .body
        .as_object()
        .expect("whitespace body must remain an object");
    assert_eq!(
        body_value.get("futureString").and_then(Value::as_str),
        Some("1e400")
    );
}

#[test]
fn malformed_overflow_syntax_remains_malformed_json() {
    for text in [
        r#"{"v":1e}"#,
        r#"{"v":1e400.0}"#,
        r#"{"v":-1e400x}"#,
        r#"{"v":1e400,}"#,
    ] {
        assert_violation(
            validate_inbound_frame(&RawFrame::JsonText(text.to_owned())),
            None,
            &["malformed JSON"],
        );
    }
}

#[test]
fn unknown_cosmetic_overflow_is_still_a_cosmetic_drop() {
    assert_cosmetic(
        validate_inbound_frame(&RawFrame::JsonText(
            r#"{ "v": 2, "t": "futureCosmetic", "futureMetric": 1e400, "futureList": [-1e400] }"#
                .to_owned(),
        )),
        "unknown cosmetic frame type: futureCosmetic",
    );
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
fn unsupported_json_number_versions_use_javascript_number_stringification() {
    for (token, expected) in [
        ("9007199254740993", "9007199254740992"),
        ("3.0", "3"),
        ("3e0", "3"),
        ("-0", "0"),
        ("1e20", "100000000000000000000"),
        ("1e21", "1e+21"),
        ("1e-6", "0.000001"),
        ("1e-7", "1e-7"),
    ] {
        let text = format!(r#"{{"v":{token},"t":"terminal"}}"#);
        let expected_issue = format!("unsupported frame protocol version: {expected}");
        assert_violation(
            validate_inbound_frame(&RawFrame::JsonText(text)),
            None,
            &[expected_issue.as_str()],
        );
    }
}

#[test]
fn unsupported_overflowed_json_number_versions_match_json_parse_infinity() {
    for (token, expected) in [("1e400", "Infinity"), ("-1e400", "-Infinity")] {
        let text = format!(r#"{{"v":{token},"t":"terminal"}}"#);
        let expected_issue = format!("unsupported frame protocol version: {expected}");
        assert_violation(
            validate_inbound_frame(&RawFrame::JsonText(text)),
            None,
            &[expected_issue.as_str()],
        );
    }
}

#[test]
fn overflowing_context_and_body_numbers_fail_at_their_structural_fields() {
    let overflowing_context = r#"{"sessionId":"session","runId":"run","sessionEpoch":1e400,"seatMapId":"seat-map","membershipRevision":2,"senderSeatId":1,"authoritySeatId":0,"connectionGeneration":3}"#;
    assert_violation(
        validate_inbound_frame(&text_envelope(
            "tailRequest",
            overflowing_context,
            r#"{"fromRevision":0}"#,
        )),
        Some("tailRequest"),
        &["ctx.sessionEpoch"],
    );

    let cases = [
        (
            "authorityReceipt",
            r#"{"revision":1e400,"operationId":"operation","stage":"admitted"}"#,
            vec!["body.revision"],
        ),
        (
            "tailRequest",
            r#"{"fromRevision":-1e400}"#,
            vec!["body.fromRevision"],
        ),
        (
            "recoveryRequest",
            r#"{"requestId":"request","capturedFrontier":1e400,"reason":"reconnect"}"#,
            vec!["body.capturedFrontier"],
        ),
        (
            "recoveryBundle",
            r#"{"requestId":"request","material":{"digest":"digest","payload":null},"frontier":1e400,"frontierOperationId":null,"membershipRevision":2,"nextControl":null,"requiredTail":[]}"#,
            vec!["body.frontier", "body.frontierOperationId"],
        ),
    ];

    for (frame_type, body, expected_issues) in cases {
        assert_violation(
            validate_inbound_frame(&text_envelope(frame_type, context_text(), body)),
            Some(frame_type),
            &expected_issues,
        );
    }
}

#[test]
fn overflowing_checked_fields_inside_authority_tail_keep_nested_issue_paths() {
    for (tail, expected_issue) in [
        (
            r#"{"revision":1e400,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1,"wave":1,"turn":1,"commands":[{"ownerSeatId":0,"pokemonId":1,"fieldIndex":0}]},"subsumes":[]}"#,
            "body.requiredTail[0].revision",
        ),
        (
            r#"{"revision":1,"operationId":"operation","kind":"TURN_COMMIT","material":{"digest":"digest","payload":null},"nextControl":{"kind":"COMMAND_FRONTIER","epoch":1e400,"wave":1,"turn":1,"commands":[{"ownerSeatId":0,"pokemonId":1,"fieldIndex":0}]},"subsumes":[]}"#,
            "body.requiredTail[0].nextControl.epoch",
        ),
    ] {
        let body = format!(
            r#"{{"requestId":"request","material":{{"digest":"digest","payload":null}},"frontier":0,"frontierOperationId":null,"membershipRevision":2,"nextControl":null,"requiredTail":[{tail}]}}"#
        );
        assert_violation(
            validate_inbound_frame(&text_envelope("recoveryBundle", context_text(), &body)),
            Some("recoveryBundle"),
            &[expected_issue],
        );
    }
}

#[test]
fn overflowing_number_in_a_required_string_field_is_not_coerced_to_a_string() {
    assert_violation(
        validate_inbound_frame(&text_envelope(
            "terminal",
            context_text(),
            r#"{"terminalId":1e400,"reason":"protocol"}"#,
        )),
        Some("terminal"),
        &["body.terminalId"],
    );
}

#[test]
fn overflowing_number_in_an_unknown_property_does_not_add_issues() {
    let frame = valid_frame(
        text_envelope(
            "tailRequest",
            context_text(),
            r#"{"fromRevision":0,"futureMetric":1e400}"#,
        ),
        "tailRequest",
    );
    let ValidatedFrameBody::TailRequest(body) = &frame.body else {
        panic!("unknown extension overflow must retain a typed tail body");
    };
    assert_eq!(body.from_revision.get().get(), 0);

    let mut marker_like_body =
        entry_body_text_with_payload(r#"{"\u0000er-protocol-non-finite-0":"Infinity"}"#);
    assert_eq!(
        marker_like_body
            .pop()
            .expect("entry body must end with an object brace"),
        '}'
    );
    marker_like_body.push_str(r#","futureMetric":1e400}"#);
    let frame = valid_frame(
        text_envelope("authorityEntry", context_text(), &marker_like_body),
        "authorityEntry",
    );
    let ValidatedFrameBody::AuthorityEntry(body) = &frame.body else {
        panic!("marker collision must retain a typed authority body");
    };
    assert_eq!(body.revision.get().get(), 1);
    assert_eq!(body.operation_id.as_str(), "operation");
}

#[test]
fn overflowing_material_payload_fails_closed_instead_of_becoming_semantic_json() {
    for payload in ["1e400", r#"{"nested":[null,-1e400]}"#] {
        let body = entry_body_text_with_payload(payload);
        assert_violation(
            validate_inbound_frame(&text_envelope("authorityEntry", context_text(), &body)),
            Some("authorityEntry"),
            &["body.material.payload: non-finite JSON number"],
        );
    }
}

#[test]
fn frame_context_reports_all_eight_fields_in_wire_order() {
    let mut context = context_value();
    context
        .as_object_mut()
        .expect("context fixture must be an object")
        .clear();
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
        candidate
            .as_object_mut()
            .expect("context fixture must be an object")
            .insert(field.to_owned(), Value::Null);
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
    receipt
        .as_object_mut()
        .expect("receipt fixture must be an object")
        .insert("controlId".to_owned(), Value::Null);
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
    missing_frontier_operation
        .as_object_mut()
        .expect("recovery bundle fixture must be an object")
        .remove("frontierOperationId");
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", missing_frontier_operation))),
        Some("recoveryBundle"),
        &["body.frontierOperationId"],
    );

    let mut missing_next_control = recovery_bundle_body();
    missing_next_control
        .as_object_mut()
        .expect("recovery bundle fixture must be an object")
        .remove("nextControl");
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", missing_next_control))),
        Some("recoveryBundle"),
        &["body.nextControl: must be null at frontier zero"],
    );

    let mut non_null_zero_operation = recovery_bundle_body();
    non_null_zero_operation
        .as_object_mut()
        .expect("recovery bundle fixture must be an object")
        .insert("frontierOperationId".to_owned(), json!("operation"));
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", non_null_zero_operation))),
        Some("recoveryBundle"),
        &["body.frontierOperationId"],
    );

    let mut positive_null_control = recovery_bundle_body();
    {
        let body = positive_null_control
            .as_object_mut()
            .expect("recovery bundle fixture must be an object");
        body.insert("frontier".to_owned(), json!(1));
        body.insert("frontierOperationId".to_owned(), json!("operation"));
    }
    assert_violation(
        validate_inbound_frame(&raw(envelope("recoveryBundle", positive_null_control))),
        Some("recoveryBundle"),
        &["body.nextControl: required"],
    );

    let mut positive_missing_control = recovery_bundle_body();
    let body = positive_missing_control
        .as_object_mut()
        .expect("recovery bundle fixture must be an object");
    body.insert("frontier".to_owned(), json!(1));
    body.insert("frontierOperationId".to_owned(), json!("operation"));
    body.remove("nextControl");
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

    for prototype_name in ["constructor", "prototype", "__proto__", "toString"] {
        let mut invalid_surface = shared.clone();
        invalid_surface
            .as_object_mut()
            .expect("shared control fixture must be an object")
            .insert("surfaceClass".to_owned(), json!(prototype_name));
        assert_violation(
            validate_inbound_frame(&raw(envelope(
                "authorityEntry",
                entry_body("INTERACTION_COMMIT", invalid_surface),
            ))),
            Some("authorityEntry"),
            &["body.nextControl.surfaceClass"],
        );

        let mut invalid_operation_kind = shared.clone();
        invalid_operation_kind
            .as_object_mut()
            .expect("shared control fixture must be an object")
            .insert("operationKind".to_owned(), json!(prototype_name));
        assert_violation(
            validate_inbound_frame(&raw(envelope(
                "authorityEntry",
                entry_body("INTERACTION_COMMIT", invalid_operation_kind),
            ))),
            Some("authorityEntry"),
            &["body.nextControl.operationKind"],
        );

        let mut invalid_successor_kind = shared.clone();
        invalid_successor_kind
            .as_object_mut()
            .and_then(|control| control.get_mut("successor"))
            .and_then(Value::as_object_mut)
            .expect("shared successor fixture must be an object")
            .insert("operationKinds".to_owned(), json!([prototype_name]));
        assert_violation(
            validate_inbound_frame(&raw(envelope(
                "authorityEntry",
                entry_body("INTERACTION_COMMIT", invalid_successor_kind),
            ))),
            Some("authorityEntry"),
            &["body.nextControl.successor.operationKinds[0]"],
        );
    }

    let mut missing_operation_ids = shared;
    missing_operation_ids
        .as_object_mut()
        .and_then(|control| control.get_mut("successor"))
        .and_then(Value::as_object_mut)
        .expect("shared successor fixture must be an object")
        .remove("operationIds");
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
    missing_expected_operation
        .as_object_mut()
        .expect("await-successor fixture must be an object")
        .remove("expectedOperationId");
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
    let body_object = body
        .as_object_mut()
        .expect("entry fixture must be an object");
    body_object.insert(
        "futureBodyField".to_owned(),
        json!({"opaque": [null, true]}),
    );
    body_object
        .get_mut("material")
        .and_then(Value::as_object_mut)
        .expect("material fixture must be an object")
        .insert("futureMaterialField".to_owned(), json!(42));
    let original = body.clone();
    let result = validate_inbound_frame(&raw(envelope("authorityEntry", body)));
    let frame = match result {
        InboundFrameResult::Valid { frame } => frame,
        other => panic!("opaque fields should be accepted, got {other:?}"),
    };
    assert_eq!(frame.frame.body, original);
}

#[test]
fn context_equality_covers_all_fields_while_compatibility_ignores_peer_connection_fields() {
    let left = serde_json::from_value::<FrameContext>(context_value())
        .expect("fixture context should deserialize");
    let mut peer_context_value = context_value();
    let context = peer_context_value
        .as_object_mut()
        .expect("context fixture must be an object");
    context.insert("senderSeatId".to_owned(), json!(0));
    context.insert("connectionGeneration".to_owned(), json!(4));
    let peer = serde_json::from_value::<FrameContext>(peer_context_value)
        .expect("peer context should deserialize");
    assert!(!frame_contexts_equal(&left, &peer));
    assert!(frame_contexts_compatible(&left, &peer));

    let mut other_session_value = context_value();
    other_session_value
        .as_object_mut()
        .expect("context fixture must be an object")
        .insert("sessionId".to_owned(), json!("other-session"));
    let other_session = serde_json::from_value::<FrameContext>(other_session_value)
        .expect("other context should deserialize");
    assert!(!frame_contexts_compatible(&left, &other_session));
}
