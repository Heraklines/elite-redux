#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use er_canonical::canonicalize_value;
use er_protocol::{
    BattleTerminalKindV1, BattleTerminalMaterialV1, BattleTerminalReasonV1,
    battle_terminal_material_digest, build_battle_terminal_commit_draft,
    validate_battle_terminal_commit,
};
use er_types::{
    AuthorityEntry, AuthorityEntryKind, CommandControlTarget, ConnectionGeneration, FrameContext,
    Material, MembershipRevision, NextControl, OperationId, Revision, RunId, SafeU53, SeatId,
    SessionId, TerminalControl,
};
use serde_json::{Map, Value, json};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe integer")
}

fn revision(value: u64) -> Revision {
    Revision::new(safe(value))
}

fn context() -> FrameContext {
    FrameContext {
        session_id: SessionId::new("session").expect("session ID"),
        run_id: RunId::new("run").expect("run ID"),
        session_epoch: safe(4),
        seat_map_id: "seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(2)),
        sender_seat_id: SeatId::new(safe(0)),
        authority_seat_id: SeatId::new(safe(0)),
        connection_generation: ConnectionGeneration::new(safe(7)),
    }
}

fn operation_id() -> OperationId {
    OperationId::new("battle/7/terminal/3").expect("operation ID")
}

fn terminal() -> BattleTerminalMaterialV1 {
    BattleTerminalMaterialV1::new(
        "terminal-\u{1f600}",
        BattleTerminalReasonV1::GameOver,
        3_u64,
        2_u64,
    )
    .expect("terminal material")
}

fn entry_with(revision_value: u64, subsumes: Vec<Revision>) -> AuthorityEntry {
    let draft = build_battle_terminal_commit_draft(context(), operation_id(), terminal(), subsumes)
        .expect("terminal draft");
    AuthorityEntry {
        context: draft.context,
        revision: revision(revision_value),
        operation_id: draft.operation_id,
        kind: draft.kind,
        material: draft.material,
        next_control: draft.next_control,
        subsumes: draft.subsumes,
    }
}

fn command_frontier() -> NextControl {
    NextControl::CommandFrontier(er_types::CommandFrontierControl {
        epoch: safe(4),
        wave: safe(3),
        turn: safe(2),
        commands: vec![CommandControlTarget {
            owner_seat_id: SeatId::new(safe(0)),
            pokemon_id: safe(1),
            field_index: safe(0),
        }],
    })
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
fn material_has_exact_wire_shape_and_deterministic_utf16_digest_vector() {
    let material = terminal();
    let value = serde_json::to_value(&material).expect("material JSON");
    assert_eq!(
        value,
        json!({
            "kind": "terminal",
            "terminalId": "terminal-\u{1f600}",
            "reason": "game-over",
            "wave": 3,
            "turn": 2
        })
    );

    let canonical = canonicalize_value(&value).expect("canonical material JSON");
    assert_eq!(
        canonical,
        "{\"kind\":\"terminal\",\"reason\":\"game-over\",\"terminalId\":\"terminal-\u{1f600}\",\"turn\":2,\"wave\":3}"
    );
    let expected = format!("terminal:{:08x}", fnv1a32_utf16(&canonical));
    assert_eq!(
        battle_terminal_material_digest(&material).expect("terminal digest"),
        expected
    );
    assert_eq!(expected.len(), "terminal:".len() + 8);
    assert!(
        expected["terminal:".len()..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    );
}

#[test]
fn digest_is_independent_of_wire_object_key_order() {
    let mut reordered = Map::new();
    reordered.insert("turn".to_owned(), json!(2));
    reordered.insert("terminalId".to_owned(), json!("terminal-\u{1f600}"));
    reordered.insert("kind".to_owned(), json!("terminal"));
    reordered.insert("wave".to_owned(), json!(3));
    reordered.insert("reason".to_owned(), json!("game-over"));

    let decoded: BattleTerminalMaterialV1 =
        serde_json::from_value(Value::Object(reordered)).expect("reordered terminal");
    assert_eq!(
        battle_terminal_material_digest(&decoded).expect("reordered digest"),
        battle_terminal_material_digest(&terminal()).expect("original digest")
    );
}

#[test]
fn builder_emits_typed_identities_and_sorted_deduplicated_subsumes() {
    let supplied = vec![revision(5), revision(2), revision(5), revision(3)];
    let draft =
        build_battle_terminal_commit_draft(context(), operation_id(), terminal(), supplied.clone())
            .expect("terminal draft");

    assert_eq!(draft.context, context());
    assert_eq!(draft.operation_id, operation_id());
    assert_eq!(draft.kind, AuthorityEntryKind::TerminalCommit);
    assert_eq!(draft.subsumes, vec![revision(2), revision(3), revision(5)]);
    assert_eq!(
        supplied,
        vec![revision(5), revision(2), revision(5), revision(3)]
    );
    assert_eq!(
        draft.material.payload,
        serde_json::to_value(terminal()).expect("typed terminal payload")
    );
    assert_eq!(
        draft.material.digest,
        battle_terminal_material_digest(&terminal()).expect("terminal digest")
    );
    assert_eq!(
        draft.next_control,
        NextControl::Terminal(TerminalControl {
            terminal_id: terminal().terminal_id,
        })
    );
}

#[test]
fn validator_admits_builder_entry_and_redelivery_is_equal() {
    let first = entry_with(9, vec![revision(4), revision(1), revision(4)]);
    let second = first.clone();

    let first_material = validate_battle_terminal_commit(&first).expect("first terminal");
    let second_material = validate_battle_terminal_commit(&second).expect("redelivered terminal");
    assert_eq!(first_material, terminal());
    assert_eq!(first_material, second_material);
    assert_eq!(first, second);
}

#[test]
fn constructor_and_builder_reject_malformed_identities_and_zero_subsumes() {
    assert!(BattleTerminalMaterialV1::new("", BattleTerminalReasonV1::GameOver, 1, 2).is_err());
    assert!(
        BattleTerminalMaterialV1::new("terminal", BattleTerminalReasonV1::GameOver, -1_i64, 2)
            .is_err()
    );

    let mut bad_context = context();
    bad_context.seat_map_id.clear();
    assert!(
        build_battle_terminal_commit_draft(
            bad_context,
            operation_id(),
            terminal(),
            Vec::<Revision>::new(),
        )
        .is_err()
    );

    let bad_operation =
        OperationId::new("bad\noperation").expect("construct malformed operation ID");
    assert!(
        build_battle_terminal_commit_draft(
            context(),
            bad_operation,
            terminal(),
            Vec::<Revision>::new(),
        )
        .is_err()
    );

    let mut bad_terminal = terminal();
    bad_terminal.terminal_id.clear();
    assert!(
        build_battle_terminal_commit_draft(
            context(),
            operation_id(),
            bad_terminal,
            Vec::<Revision>::new(),
        )
        .is_err()
    );

    assert!(
        build_battle_terminal_commit_draft(
            context(),
            operation_id(),
            terminal(),
            vec![Revision::ZERO],
        )
        .is_err()
    );
}

#[test]
fn serde_rejects_unknown_fields_and_untyped_kind_or_reason() {
    let mut unknown = serde_json::to_value(terminal()).expect("terminal JSON");
    unknown["extra"] = json!(true);
    assert!(serde_json::from_value::<BattleTerminalMaterialV1>(unknown).is_err());

    let mut wrong_kind = serde_json::to_value(terminal()).expect("terminal JSON");
    wrong_kind["kind"] = json!("TERMINAL");
    assert!(serde_json::from_value::<BattleTerminalMaterialV1>(wrong_kind).is_err());

    let mut wrong_reason = serde_json::to_value(terminal()).expect("terminal JSON");
    wrong_reason["reason"] = json!("future-reason");
    assert!(serde_json::from_value::<BattleTerminalMaterialV1>(wrong_reason).is_err());

    for deferred_reason in ["final-flee", "final-boss-credits", "shared-fault"] {
        let mut deferred = serde_json::to_value(terminal()).expect("terminal JSON");
        deferred["reason"] = json!(deferred_reason);
        assert!(serde_json::from_value::<BattleTerminalMaterialV1>(deferred).is_err());
    }

    let _typed_kind = BattleTerminalKindV1::Terminal;
}

#[test]
fn validator_rejects_wrong_kind_control_payload_digest_and_revision_shapes() {
    let valid = entry_with(9, vec![revision(1)]);

    let mut wrong_kind = valid.clone();
    wrong_kind.kind = AuthorityEntryKind::TurnCommit;
    assert!(validate_battle_terminal_commit(&wrong_kind).is_err());

    let mut wrong_control = valid.clone();
    wrong_control.next_control = command_frontier();
    assert!(validate_battle_terminal_commit(&wrong_control).is_err());

    let mut mismatched_control = valid.clone();
    mismatched_control.next_control = NextControl::Terminal(TerminalControl {
        terminal_id: "another-terminal".to_owned(),
    });
    assert!(validate_battle_terminal_commit(&mismatched_control).is_err());

    let mut malformed_digest = valid.clone();
    malformed_digest.material.digest = "TERMINAL:00000000".to_owned();
    assert!(validate_battle_terminal_commit(&malformed_digest).is_err());

    let mut mismatched_digest = valid.clone();
    mismatched_digest.material.digest = "terminal:00000000".to_owned();
    assert!(validate_battle_terminal_commit(&mismatched_digest).is_err());

    let mut unknown_payload = valid.clone();
    unknown_payload.material.payload["unknown"] = json!(1);
    assert!(validate_battle_terminal_commit(&unknown_payload).is_err());

    let mut wrong_payload_kind = valid.clone();
    wrong_payload_kind.material.payload["kind"] = json!("wave-advance");
    assert!(validate_battle_terminal_commit(&wrong_payload_kind).is_err());

    let mut wrong_payload_reason = valid.clone();
    wrong_payload_reason.material.payload["reason"] = json!("not-a-reason");
    assert!(validate_battle_terminal_commit(&wrong_payload_reason).is_err());

    let mut zero_revision = valid.clone();
    zero_revision.revision = Revision::ZERO;
    assert!(validate_battle_terminal_commit(&zero_revision).is_err());

    let mut zero_subsumed = valid;
    zero_subsumed.subsumes = vec![Revision::ZERO];
    assert!(validate_battle_terminal_commit(&zero_subsumed).is_err());
}

#[test]
fn validator_rejects_invalid_context_and_operation_identity() {
    let valid = entry_with(9, Vec::new());

    let mut bad_context = valid.clone();
    bad_context.context.seat_map_id.clear();
    assert!(validate_battle_terminal_commit(&bad_context).is_err());

    let mut bad_operation = valid;
    bad_operation.operation_id =
        OperationId::new("bad\u{0000}operation").expect("construct malformed operation ID");
    assert!(validate_battle_terminal_commit(&bad_operation).is_err());
}

#[test]
fn validator_does_not_accept_non_terminal_material_shapes() {
    let mut entry = entry_with(9, Vec::new());
    entry.material = Material {
        digest: "terminal:00000000".to_owned(),
        payload: json!({
            "kind": "terminal",
            "terminalId": "terminal",
            "reason": "game-over",
            "wave": 3,
            "turn": 2,
            "authorityCarrier": {}
        }),
    };
    assert!(validate_battle_terminal_commit(&entry).is_err());
}
