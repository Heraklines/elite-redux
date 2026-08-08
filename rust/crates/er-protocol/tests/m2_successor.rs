use er_protocol::{
    LocalPresentationInputProof, SuccessorValidator, control_allows_successor_entry, control_id_of,
    control_owner_seat_id, control_owner_seat_ids, controls_equal, is_valid_next_control,
    next_control_issues, partition_control_for_seat, same_control_address, successor_wait_allows,
    successor_wait_allows_local_presentation_input, validate_next_control,
};
use er_types::{
    AuthorityEntry, AuthorityEntryKind, AwaitSuccessorControl, CommandControlTarget,
    CommandFrontierControl, ConnectionGeneration, ControlAddress, FrameContext,
    InteractionControlAddress, InteractionSuccessor, Material, MembershipRevision, NextControl,
    OperationId, ReplacementControl, ReplacementControlAddress, RunId, SafeU53, SeatId, SessionId,
    SharedInteractionControl, TerminalControl,
};
use serde_json::{Value, json};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test coordinate must be JavaScript-safe")
}

fn operation(value: &str) -> OperationId {
    OperationId::new(value).expect("test operation id must be valid")
}

fn command_target(field_index: u64, owner_seat_id: u64, pokemon_id: u64) -> CommandControlTarget {
    CommandControlTarget {
        owner_seat_id: SeatId::new(safe(owner_seat_id)),
        pokemon_id: safe(pokemon_id),
        field_index: safe(field_index),
    }
}

fn command_control(commands: Vec<CommandControlTarget>) -> NextControl {
    NextControl::CommandFrontier(CommandFrontierControl {
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        commands,
    })
}

fn replacement_control(operation_id: &str) -> NextControl {
    NextControl::Replacement(ReplacementControl {
        operation_id: operation(operation_id),
        owner_seat_id: SeatId::new(safe(0)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        occurrence: safe(0),
        field_index: safe(0),
        remaining: vec![ReplacementControlAddress {
            operation_id: operation("replacement/tail/1"),
            owner_seat_id: SeatId::new(safe(1)),
            epoch: safe(1),
            wave: safe(2),
            turn: safe(3),
            occurrence: safe(1),
            field_index: safe(1),
        }],
    })
}

fn shared_control(operation_kind: &str, operation_ids: Option<Vec<OperationId>>) -> NextControl {
    NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/current"),
        owner_seat_id: SeatId::new(safe(1)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        surface_class: "op:reward".to_owned(),
        operation_kind: operation_kind.to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned(), "REWARD_PRESENT".to_owned()],
            operation_ids,
        },
    })
}

fn successor_wait() -> AwaitSuccessorControl {
    AwaitSuccessorControl {
        after_operation_id: operation("predecessor"),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        allowed_kinds: vec![
            AuthorityEntryKind::ControlCommit,
            AuthorityEntryKind::InteractionCommit,
            AuthorityEntryKind::WaveAdvance,
            AuthorityEntryKind::TerminalCommit,
        ],
        allowed_interaction_addresses: None,
        allowed_control_addresses: None,
        allow_next_wave_start: true,
        expected_operation_id: None,
    }
}

fn pinned_shared_control() -> NextControl {
    NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/e1/w2/t1/ability"),
        owner_seat_id: SeatId::new(safe(1)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(1),
        surface_class: "op:ability".to_owned(),
        operation_kind: "ABILITY_PRESENT".to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["ABILITY_PRESENT".to_owned()],
            operation_ids: None,
        },
    })
}

fn pinned_successor_wait() -> AwaitSuccessorControl {
    AwaitSuccessorControl {
        after_operation_id: operation("turn/e1/w2/t1"),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(1),
        allowed_kinds: vec![
            AuthorityEntryKind::TurnCommit,
            AuthorityEntryKind::ReplacementCommit,
            AuthorityEntryKind::InteractionCommit,
            AuthorityEntryKind::ControlCommit,
            AuthorityEntryKind::WaveAdvance,
            AuthorityEntryKind::TerminalCommit,
        ],
        allowed_interaction_addresses: Some(vec![InteractionControlAddress {
            surface_class: "op:me".to_owned(),
            operation_kind: "ME_BUTTON".to_owned(),
            wave: safe(2),
            turn: safe(1),
        }]),
        allowed_control_addresses: Some(vec![ControlAddress {
            material_kind: "command-open".to_owned(),
            wave: safe(2),
            turn: safe(2),
            operation_id: None,
        }]),
        allow_next_wave_start: false,
        expected_operation_id: None,
    }
}

fn duplicate_control_address_issues(
    first_operation_id: Option<Value>,
    second_operation_id: &str,
) -> Vec<String> {
    let mut raw = serde_json::to_value(NextControl::AwaitSuccessor(pinned_successor_wait()))
        .expect("pinned wait serializes");
    let base_address = json!({
        "materialKind": "command-open",
        "wave": 2,
        "turn": 2
    });
    let mut first_address = base_address.clone();
    if let Some(operation_id) = first_operation_id {
        first_address["operationId"] = operation_id;
    }
    let mut second_address = base_address;
    second_address["operationId"] = json!(second_operation_id);
    raw["allowedControlAddresses"] = json!([first_address, second_address]);
    next_control_issues(&raw)
}

fn context() -> FrameContext {
    FrameContext {
        session_id: SessionId::new("session").expect("test session id must be valid"),
        run_id: RunId::new("run").expect("test run id must be valid"),
        session_epoch: safe(1),
        seat_map_id: "seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: SeatId::new(safe(0)),
        authority_seat_id: SeatId::new(safe(0)),
        connection_generation: ConnectionGeneration::new(safe(1)),
    }
}

fn entry(
    kind: AuthorityEntryKind,
    operation_id: &str,
    payload: Value,
    next_control: NextControl,
) -> AuthorityEntry {
    AuthorityEntry {
        context: context(),
        revision: er_types::Revision::new(safe(1)),
        operation_id: operation(operation_id),
        kind,
        material: Material {
            digest: "digest".to_owned(),
            payload,
        },
        next_control,
        subsumes: Vec::new(),
    }
}

#[test]
fn control_ids_match_the_pinned_next_control_fixture() {
    let fixtures = [
        (
            "command-frontier",
            json!({
                "kind": "COMMAND_FRONTIER",
                "epoch": 1,
                "wave": 2,
                "turn": 1,
                "commands": [
                    {"fieldIndex": 1, "ownerSeatId": 1, "pokemonId": 202},
                    {"fieldIndex": 0, "ownerSeatId": 0, "pokemonId": 101}
                ]
            }),
            "COMMAND_FRONTIER/e1/w2/t1/f0:s0:p101,f1:s1:p202",
        ),
        (
            "replacement",
            json!({
                "kind": "REPLACEMENT",
                "operationId": "replacement/e1/w2/t1/o0/f0",
                "ownerSeatId": 0,
                "epoch": 1,
                "wave": 2,
                "turn": 1,
                "occurrence": 0,
                "fieldIndex": 0,
                "remaining": [{
                    "operationId": "replacement/e1/w2/t1/o1/f1",
                    "ownerSeatId": 1,
                    "epoch": 1,
                    "wave": 2,
                    "turn": 1,
                    "occurrence": 1,
                    "fieldIndex": 1
                }]
            }),
            "REPLACEMENT/replacement%2Fe1%2Fw2%2Ft1%2Fo0%2Ff0/s0/e1/w2/t1/o0/f0/remaining:replacement%2Fe1%2Fw2%2Ft1%2Fo1%2Ff1:s1:e1:w2:t1:o1:f1",
        ),
        (
            "shared-interaction",
            json!({
                "kind": "SHARED_INTERACTION",
                "operationId": "interaction/e1/w2/t1/ability",
                "ownerSeatId": 1,
                "epoch": 1,
                "wave": 2,
                "turn": 1,
                "surfaceClass": "op:ability",
                "operationKind": "ABILITY_PRESENT",
                "successor": {
                    "operationKinds": ["ABILITY_PRESENT"],
                    "operationIds": null
                }
            }),
            "SHARED_INTERACTION/op%3Aability/ABILITY_PRESENT/interaction%2Fe1%2Fw2%2Ft1%2Fability/s1/e1/w2/t1/results:ABILITY_PRESENT/resultIds:*",
        ),
        (
            "await-successor",
            json!({
                "kind": "AWAIT_SUCCESSOR",
                "afterOperationId": "turn/e1/w2/t1",
                "epoch": 1,
                "wave": 2,
                "turn": 1,
                "allowedKinds": [
                    "TURN_COMMIT",
                    "REPLACEMENT_COMMIT",
                    "INTERACTION_COMMIT",
                    "CONTROL_COMMIT",
                    "WAVE_ADVANCE",
                    "TERMINAL_COMMIT"
                ],
                "allowedInteractionAddresses": [{
                    "surfaceClass": "op:me",
                    "operationKind": "ME_BUTTON",
                    "wave": 2,
                    "turn": 1
                }],
                "allowedControlAddresses": [{
                    "materialKind": "command-open",
                    "wave": 2,
                    "turn": 2,
                    "operationId": null
                }],
                "allowNextWaveStart": false,
                "expectedOperationId": null
            }),
            "AWAIT_SUCCESSOR/turn%2Fe1%2Fw2%2Ft1/e1/w2/t1/TURN_COMMIT,REPLACEMENT_COMMIT,INTERACTION_COMMIT,CONTROL_COMMIT,WAVE_ADVANCE,TERMINAL_COMMIT/interactionAddresses:op%3Ame:ME_BUTTON:w2:t1/controlAddresses:command-open:w2:t2:id*/nextWave:0/next:*",
        ),
        (
            "terminal",
            json!({"kind": "TERMINAL", "terminalId": "terminal/e1/w2"}),
            "TERMINAL/terminal%2Fe1%2Fw2",
        ),
    ];

    for (name, raw, expected_id) in fixtures {
        assert!(
            next_control_issues(&raw).is_empty(),
            "{name} fixture must be valid"
        );
        let control = validate_next_control(&raw).expect("pinned fixture must deserialize");
        assert_eq!(control_id_of(&control), expected_id, "{name} fixture ID");
    }
}

#[test]
fn control_ids_preserve_the_pinned_wildcard_collision() {
    let shared_wildcard = pinned_shared_control();
    let mut shared_literal = pinned_shared_control();
    if let NextControl::SharedInteraction(control) = &mut shared_literal {
        control.successor.operation_ids = Some(vec![operation("*")]);
    }
    assert_eq!(
        control_id_of(&shared_wildcard),
        control_id_of(&shared_literal),
        "null and literal '*' successor IDs retain the legacy shared collision"
    );

    let wait_wildcard = NextControl::AwaitSuccessor(pinned_successor_wait());
    let mut wait_literal = pinned_successor_wait();
    wait_literal.expected_operation_id = Some(operation("*"));
    let wait_literal_control = NextControl::AwaitSuccessor(wait_literal);
    assert_eq!(
        control_id_of(&wait_wildcard),
        control_id_of(&wait_literal_control),
        "null and literal '*' expected IDs retain the legacy wait collision"
    );

    let mut address_wildcard = pinned_successor_wait();
    let mut address_literal = pinned_successor_wait();
    address_wildcard
        .allowed_control_addresses
        .as_mut()
        .expect("pinned control address")
        .first_mut()
        .expect("pinned control address")
        .operation_id = None;
    address_literal
        .allowed_control_addresses
        .as_mut()
        .expect("pinned control address")
        .first_mut()
        .expect("pinned control address")
        .operation_id = Some(operation("*"));
    assert_eq!(
        control_id_of(&NextControl::AwaitSuccessor(address_wildcard)),
        control_id_of(&NextControl::AwaitSuccessor(address_literal.clone())),
        "null and literal '*' control-address IDs retain the legacy collision"
    );

    for control in [
        shared_literal,
        wait_wildcard,
        wait_literal_control,
        NextControl::AwaitSuccessor(address_literal),
    ] {
        let raw = serde_json::to_value(control).expect("wildcard compatibility control serializes");
        assert!(
            is_valid_next_control(&raw),
            "literal '*' remains a valid opaque ID"
        );
    }
}

#[test]
fn control_id_uses_encode_uri_component_and_utf16_ordering() {
    let terminal = NextControl::Terminal(TerminalControl {
        terminal_id: "é/🙂?&=+% #!*'()~_-.".to_owned(),
    });
    assert_eq!(
        control_id_of(&terminal),
        "TERMINAL/%C3%A9%2F%F0%9F%99%82%3F%26%3D%2B%25%20%23!*'()~_-."
    );

    let high_plane = operation("𐀀");
    let private_use = operation("");
    let first = shared_control(
        "REWARD",
        Some(vec![private_use.clone(), high_plane.clone()]),
    );
    let second = shared_control("REWARD", Some(vec![high_plane, private_use]));
    assert_eq!(control_id_of(&first), control_id_of(&second));
    assert!(control_id_of(&first).contains("resultIds:%F0%90%80%80,%EE%80%80"));
}

#[test]
fn control_id_canonicalizes_sets_but_preserves_replacement_tail_order() {
    let first = command_control(vec![
        command_target(2, 1, 99),
        command_target(0, 1, 11),
        command_target(1, 0, 22),
    ]);
    let second = command_control(vec![
        command_target(1, 0, 22),
        command_target(2, 1, 99),
        command_target(0, 1, 11),
    ]);
    assert_eq!(control_id_of(&first), control_id_of(&second));
    assert!(controls_equal(Some(&first), Some(&second)));
    assert!(same_control_address(&first, &second));

    let mut replacement = replacement_control("head");
    if let NextControl::Replacement(control) = &mut replacement {
        control.remaining.push(er_types::ReplacementControlAddress {
            operation_id: operation("replacement/tail/2"),
            owner_seat_id: SeatId::new(safe(0)),
            epoch: safe(1),
            wave: safe(2),
            turn: safe(3),
            occurrence: safe(2),
            field_index: safe(2),
        });
    }
    let replacement_id = control_id_of(&replacement);
    if let NextControl::Replacement(control) = &mut replacement {
        control.remaining.reverse();
    }
    assert_ne!(replacement_id, control_id_of(&replacement));

    let mut wait_a = successor_wait();
    wait_a.allowed_kinds.reverse();
    wait_a.allowed_interaction_addresses = Some(vec![
        InteractionControlAddress {
            surface_class: "op:reward".to_owned(),
            operation_kind: "REWARD".to_owned(),
            wave: safe(2),
            turn: safe(3),
        },
        InteractionControlAddress {
            surface_class: "op:me".to_owned(),
            operation_kind: "ME_BUTTON".to_owned(),
            wave: safe(2),
            turn: safe(3),
        },
    ]);
    wait_a.allowed_control_addresses = Some(vec![
        ControlAddress {
            material_kind: "interaction-open".to_owned(),
            wave: safe(2),
            turn: safe(3),
            operation_id: Some(operation("control/2")),
        },
        ControlAddress {
            material_kind: "command-open".to_owned(),
            wave: safe(2),
            turn: safe(3),
            operation_id: None,
        },
    ]);
    let mut wait_b = wait_a.clone();
    if let Some(items) = wait_b.allowed_interaction_addresses.as_mut() {
        items.reverse();
    }
    if let Some(items) = wait_b.allowed_control_addresses.as_mut() {
        items.reverse();
    }
    assert_eq!(
        control_id_of(&NextControl::AwaitSuccessor(wait_a)),
        control_id_of(&NextControl::AwaitSuccessor(wait_b))
    );
}

#[test]
fn semantic_validation_rejects_invalid_coordinates_chains_and_closed_surfaces() {
    let invalid_command = json!({
        "kind": "COMMAND_FRONTIER",
        "epoch": 0,
        "wave": 2,
        "turn": 3,
        "commands": [
            {"ownerSeatId": 0, "pokemonId": 7, "fieldIndex": 0},
            {"ownerSeatId": 1, "pokemonId": 8, "fieldIndex": 0}
        ]
    });
    let issues = next_control_issues(&invalid_command);
    assert!(issues.contains(&"epoch".to_owned()));
    assert!(issues.contains(&"commands[1].fieldIndex: duplicate".to_owned()));
    assert!(!is_valid_next_control(&invalid_command));

    let invalid_replacement = json!({
        "kind": "REPLACEMENT",
        "operationId": "head",
        "ownerSeatId": 0,
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "occurrence": 2,
        "fieldIndex": 0,
        "remaining": [
            {"operationId": "head", "ownerSeatId": 1, "epoch": 1, "wave": 2, "turn": 3, "occurrence": 2, "fieldIndex": 1},
            {"operationId": "tail", "ownerSeatId": 1, "epoch": 1, "wave": 4, "turn": 3, "occurrence": 1, "fieldIndex": 2}
        ]
    });
    let issues = next_control_issues(&invalid_replacement);
    assert!(issues.contains(&"remaining[0].occurrence: order".to_owned()));
    assert!(issues.contains(&"remaining[0].operationId: duplicate".to_owned()));
    assert!(issues.contains(&"remaining[1]: boundary".to_owned()));

    let invalid_shared = json!({
        "kind": "SHARED_INTERACTION",
        "operationId": "interaction",
        "ownerSeatId": 0,
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "surfaceClass": "op:reward",
        "operationKind": "LEARN_MOVE",
        "successor": {"operationKinds": ["REWARD", "REWARD"], "operationIds": []}
    });
    let issues = next_control_issues(&invalid_shared);
    assert_eq!(
        issues,
        vec![
            "surfaceClass/operationKind",
            "successor.operationKinds[1]: duplicate",
            "successor.operationIds",
        ]
    );
    assert_eq!(SuccessorValidator::new().issues(&invalid_shared), issues);
    assert_eq!(
        validate_next_control(&invalid_shared)
            .expect_err("invalid shared control must fail")
            .issues,
        vec!["surfaceClass/operationKind"]
    );
    assert_eq!(
        SuccessorValidator::new()
            .validate(&invalid_shared)
            .expect_err("invalid shared control must fail")
            .issues,
        vec!["surfaceClass/operationKind"]
    );

    let invalid_wait = json!({
        "kind": "AWAIT_SUCCESSOR",
        "afterOperationId": "predecessor",
        "epoch": 1,
        "wave": 2,
        "turn": 3,
        "allowedKinds": ["CONTROL_COMMIT"],
        "allowNextWaveStart": false,
        "expectedOperationId": null,
        "allowedControlAddresses": [{"materialKind": "command-open", "wave": 3, "turn": 1, "operationId": null}]
    });
    let issues = next_control_issues(&invalid_wait);
    assert!(issues.contains(&"allowedControlAddresses[0]".to_owned()));

    let invalid_terminal = json!({"kind": "TERMINAL", "terminalId": ""});
    assert_eq!(next_control_issues(&invalid_terminal), vec!["terminalId"]);
    assert!(!is_valid_next_control(&invalid_terminal));

    let valid = serde_json::to_value(command_control(vec![command_target(0, 0, 7)]))
        .expect("typed control serializes");
    assert!(validate_next_control(&valid).is_ok());
}

#[test]
fn duplicate_key_diagnostics_match_javascript_string_conversion() {
    let cases = [
        ("undefined", None, "undefined", false),
        ("null", Some(Value::Null), "null", true),
        ("true", Some(json!(true)), "true", false),
        ("false", Some(json!(false)), "false", false),
        ("fractional number", Some(json!(1.5)), "1.5", false),
        ("negative zero", Some(json!(-0.0)), "0", false),
        (
            "fixed threshold number",
            Some(serde_json::from_str::<Value>("1e-6").expect("number fixture")),
            "0.000001",
            false,
        ),
        (
            "exponent number",
            Some(serde_json::from_str::<Value>("1e21").expect("number fixture")),
            "1e+21",
            false,
        ),
        ("string", Some(json!("opaque")), "opaque", true),
        ("array", Some(json!([1])), "1", false),
        ("array with null", Some(json!([null, 1])), ",1", false),
        (
            "nested array with null",
            Some(json!([[null], 1])),
            ",1",
            false,
        ),
        (
            "object",
            Some(json!({"field": 1})),
            "[object Object]",
            false,
        ),
    ];

    for (name, first_operation_id, second_operation_id, first_is_valid) in cases {
        let expected = if first_is_valid {
            vec!["allowedControlAddresses[1]: duplicate".to_owned()]
        } else {
            vec![
                "allowedControlAddresses[0]".to_owned(),
                "allowedControlAddresses[1]: duplicate".to_owned(),
            ]
        };
        assert_eq!(
            duplicate_control_address_issues(first_operation_id, second_operation_id),
            expected,
            "JavaScript String parity for {name}"
        );
    }
}

#[test]
fn successor_authorization_rejects_stale_and_unauthorized_entries() {
    let predecessor = operation("predecessor");
    let command = command_control(vec![command_target(0, 0, 7)]);
    let accepted = entry(
        AuthorityEntryKind::TurnCommit,
        "turn/accepted",
        json!({"epoch": 1, "wave": 2, "turn": 3}),
        command.clone(),
    );
    assert!(control_allows_successor_entry(
        &command,
        &predecessor,
        &accepted
    ));

    let stale = entry(
        AuthorityEntryKind::TurnCommit,
        "turn/stale",
        json!({"epoch": 1, "wave": 2, "turn": 4}),
        command.clone(),
    );
    assert!(!control_allows_successor_entry(
        &command,
        &predecessor,
        &stale
    ));

    let wrong_kind = entry(
        AuthorityEntryKind::ControlCommit,
        "control/wrong-kind",
        json!({"wave": 2, "turn": 3, "kind": "command-open"}),
        command.clone(),
    );
    assert!(!control_allows_successor_entry(
        &command,
        &predecessor,
        &wrong_kind
    ));

    let replacement = replacement_control("replacement/head");
    let replacement_entry = entry(
        AuthorityEntryKind::ReplacementCommit,
        "replacement/head",
        json!({"sourceAddress": {"epoch": 1, "wave": 2, "turn": 3}}),
        replacement.clone(),
    );
    assert!(control_allows_successor_entry(
        &replacement,
        &predecessor,
        &replacement_entry
    ));
    let unauthorized_replacement = entry(
        AuthorityEntryKind::ReplacementCommit,
        "replacement/other",
        json!({"sourceAddress": {"epoch": 1, "wave": 2, "turn": 3}}),
        replacement.clone(),
    );
    assert!(!control_allows_successor_entry(
        &replacement,
        &predecessor,
        &unauthorized_replacement
    ));

    let shared = shared_control("REWARD_PRESENT", Some(vec![operation("interaction/wrong")]));
    let shared_entry = entry(
        AuthorityEntryKind::InteractionCommit,
        "interaction/result",
        json!({
            "surfaceClass": "op:reward",
            "envelope": {
                "sessionEpoch": 1,
                "wave": 2,
                "turn": 3,
                "pendingOperation": {"kind": "REWARD"}
            }
        }),
        shared.clone(),
    );
    assert!(!control_allows_successor_entry(
        &shared,
        &predecessor,
        &shared_entry
    ));
    let shared_result = NextControl::SharedInteraction(SharedInteractionControl {
        operation_id: operation("interaction/current"),
        owner_seat_id: SeatId::new(safe(1)),
        epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        surface_class: "op:reward".to_owned(),
        operation_kind: "REWARD_PRESENT".to_owned(),
        successor: InteractionSuccessor {
            operation_kinds: vec!["REWARD".to_owned()],
            operation_ids: Some(vec![operation("interaction/result")]),
        },
    });
    assert!(control_allows_successor_entry(
        &shared_result,
        &predecessor,
        &shared_entry
    ));
}

#[test]
fn successor_wait_applies_exact_addresses_and_bounded_progression() {
    let mut wait = successor_wait();
    wait.allowed_kinds = vec![
        AuthorityEntryKind::ControlCommit,
        AuthorityEntryKind::InteractionCommit,
    ];
    wait.allow_next_wave_start = false;
    let wait_id = operation("predecessor");
    let command_open = json!({"kind": "command-open", "wave": 2, "turn": 4});
    assert!(successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("control/4"),
        safe(1),
        &command_open
    ));
    assert!(!successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("control/3"),
        safe(1),
        &json!({"kind": "command-open", "wave": 2, "turn": 3})
    ));
    assert!(!successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("control/4"),
        safe(2),
        &command_open
    ));

    wait.allowed_kinds = vec![AuthorityEntryKind::InteractionCommit];
    wait.allowed_interaction_addresses = Some(vec![InteractionControlAddress {
        surface_class: "op:me".to_owned(),
        operation_kind: "ME_TERMINAL".to_owned(),
        wave: safe(2),
        turn: safe(3),
    }]);
    let interaction_material = json!({
        "surfaceClass": "op:me",
        "envelope": {
            "sessionEpoch": 1,
            "wave": 2,
            "turn": 3,
            "pendingOperation": {"kind": "ME_TERMINAL"}
        }
    });
    assert!(successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::InteractionCommit,
        &operation("interaction/terminal"),
        safe(1),
        &interaction_material
    ));
    assert!(!successor_wait_allows(
        &wait,
        &wait_id,
        AuthorityEntryKind::InteractionCommit,
        &operation("interaction/terminal"),
        safe(1),
        &json!({
            "surfaceClass": "op:reward",
            "envelope": {"sessionEpoch": 1, "wave": 2, "turn": 3, "pendingOperation": {"kind": "ME_TERMINAL"}}
        })
    ));
}

#[test]
fn successor_wait_preserves_n_plus_one_wave_settlement_and_interaction_open_rules() {
    let wait_id = operation("predecessor");

    let mut wave_wait = successor_wait();
    assert!(successor_wait_allows(
        &wave_wait,
        &wait_id,
        AuthorityEntryKind::WaveAdvance,
        &operation("wave/next"),
        safe(1),
        &json!({"wave": 3, "turn": 1})
    ));
    assert!(!successor_wait_allows(
        &wave_wait,
        &wait_id,
        AuthorityEntryKind::WaveAdvance,
        &operation("wave/too-far"),
        safe(1),
        &json!({"wave": 3, "turn": 2})
    ));
    wave_wait.allow_next_wave_start = false;
    assert!(!successor_wait_allows(
        &wave_wait,
        &wait_id,
        AuthorityEntryKind::WaveAdvance,
        &operation("wave/closed"),
        safe(1),
        &json!({"wave": 3, "turn": 1})
    ));

    let settlement_wait = successor_wait();
    for (kind, turn) in [
        (AuthorityEntryKind::WaveAdvance, 3),
        (AuthorityEntryKind::WaveAdvance, 4),
        (AuthorityEntryKind::TerminalCommit, 3),
        (AuthorityEntryKind::TerminalCommit, 4),
    ] {
        assert!(successor_wait_allows(
            &settlement_wait,
            &wait_id,
            kind,
            &operation("settlement"),
            safe(1),
            &json!({"wave": 2, "turn": turn})
        ));
    }
    assert!(!successor_wait_allows(
        &settlement_wait,
        &wait_id,
        AuthorityEntryKind::WaveAdvance,
        &operation("settlement/drift"),
        safe(1),
        &json!({"wave": 2, "turn": 5})
    ));

    let interaction_open = json!({"kind": "interaction-open", "wave": 2, "turn": 3});
    assert!(successor_wait_allows(
        &settlement_wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("interaction-open"),
        safe(1),
        &interaction_open
    ));
    assert!(!successor_wait_allows(
        &settlement_wait,
        &wait_id,
        AuthorityEntryKind::ControlCommit,
        &operation("command-open/same-turn"),
        safe(1),
        &json!({"kind": "command-open", "wave": 2, "turn": 3})
    ));
}

#[test]
fn command_frontier_accepts_only_the_frozen_turn_resolve_prompt_bridge() {
    let command = command_control(vec![command_target(0, 0, 7)]);
    let prompt = entry(
        AuthorityEntryKind::InteractionCommit,
        "prompt/learn",
        json!({
            "kind": "OPERATION_ENVELOPE_V1",
            "surfaceClass": "op:learnMove",
            "envelope": {
                "logicalPhase": "TURN_RESOLVE",
                "sessionEpoch": 1,
                "wave": 2,
                "turn": 3,
                "pendingOperation": {
                    "id": "prompt/learn",
                    "kind": "LEARN_MOVE",
                    "status": "applied",
                    "payload": {"type": "prompt"}
                }
            }
        }),
        command.clone(),
    );
    assert!(control_allows_successor_entry(
        &command,
        &operation("predecessor"),
        &prompt
    ));

    let not_prompt = entry(
        AuthorityEntryKind::InteractionCommit,
        "prompt/learn",
        json!({
            "kind": "OPERATION_ENVELOPE_V1",
            "surfaceClass": "op:learnMove",
            "envelope": {
                "logicalPhase": "TURN_RESOLVE",
                "sessionEpoch": 1,
                "wave": 2,
                "turn": 3,
                "pendingOperation": {
                    "id": "prompt/learn",
                    "kind": "LEARN_MOVE",
                    "status": "applied",
                    "payload": {"type": "choice"}
                }
            }
        }),
        command.clone(),
    );
    assert!(!control_allows_successor_entry(
        &command,
        &operation("predecessor"),
        &not_prompt
    ));
}

#[test]
fn local_presentation_bridge_is_limited_to_level_up_and_next_encounter() {
    let mut wait = successor_wait();
    wait.allowed_kinds = vec![AuthorityEntryKind::InteractionCommit];
    let exact_level_up = LocalPresentationInputProof {
        session_epoch: safe(1),
        wave: safe(2),
        turn: safe(3),
        phase_name: "LevelUpPhase".to_owned(),
        message_handler_actionable: true,
    };
    let exact_next_encounter = LocalPresentationInputProof {
        session_epoch: safe(1),
        wave: safe(3),
        turn: safe(1),
        phase_name: "NextEncounterPhase".to_owned(),
        message_handler_actionable: true,
    };
    assert!(successor_wait_allows_local_presentation_input(
        &wait,
        &exact_level_up
    ));
    assert!(successor_wait_allows_local_presentation_input(
        &wait,
        &exact_next_encounter
    ));
    assert!(!successor_wait_allows_local_presentation_input(
        &wait,
        &LocalPresentationInputProof {
            phase_name: "MessagePhase".to_owned(),
            ..exact_level_up.clone()
        }
    ));
    assert!(!successor_wait_allows_local_presentation_input(
        &wait,
        &LocalPresentationInputProof {
            session_epoch: safe(2),
            ..exact_next_encounter.clone()
        }
    ));
    wait.allow_next_wave_start = false;
    assert!(!successor_wait_allows_local_presentation_input(
        &wait,
        &exact_level_up
    ));
}

#[test]
fn ownership_and_partitions_are_numeric_and_deterministic() {
    let frontier = command_control(vec![
        command_target(2, 1, 44),
        command_target(0, 0, 42),
        command_target(1, 1, 43),
    ]);
    assert_eq!(
        control_owner_seat_ids(&frontier),
        [SeatId::new(safe(0)), SeatId::new(safe(1))]
            .into_iter()
            .collect()
    );
    assert_eq!(control_owner_seat_id(&frontier), None);
    let seat_one = partition_control_for_seat(&frontier, SeatId::new(safe(1)));
    assert_eq!(seat_one, Some(frontier.clone()));
    assert_eq!(
        control_id_of(seat_one.as_ref().expect("seat one owns targets")),
        control_id_of(&frontier)
    );
    assert_eq!(
        partition_control_for_seat(&frontier, SeatId::new(safe(2))),
        None
    );

    let replacement = replacement_control("replacement/head");
    assert_eq!(
        partition_control_for_seat(&replacement, SeatId::new(safe(1))),
        Some(replacement.clone())
    );

    let shared = shared_control("REWARD_PRESENT", None);
    assert_eq!(
        partition_control_for_seat(&shared, SeatId::new(safe(0))),
        Some(shared.clone())
    );

    let wait = NextControl::AwaitSuccessor(successor_wait());
    assert_eq!(
        partition_control_for_seat(&wait, SeatId::new(safe(2))),
        Some(wait.clone())
    );

    let terminal = NextControl::Terminal(TerminalControl {
        terminal_id: "terminal".to_owned(),
    });
    assert_eq!(
        partition_control_for_seat(&terminal, SeatId::new(safe(2))),
        Some(terminal.clone())
    );
    assert_eq!(control_owner_seat_ids(&terminal).len(), 0);
    assert_eq!(control_owner_seat_id(&terminal), None);
}
